import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

// ----------------------------- Typy -----------------------------
/** @typedef {"sell" | "buy"} ListingType */

const DISTANCES = /** @type {const} */ ([
  "5 km",
  "10 km",
  "15 km",
  "Półmaraton",
  "30 km",
  "Maraton",
  "Ultramaraton",
  "50 km",
  "100 km",
]);

/** @typedef {typeof DISTANCES[number]} Distance */

/**
 * @typedef {Object} Listing
 * @property {string} id
 * @property {ListingType} type
 * @property {string} raceName
 * @property {string} [eventDate]
 * @property {string} [location]
 * @property {number} price
 * @property {string} contact
 * @property {string} [description]
 * @property {string} [distance]
 * @property {number} [distanceKm]
 * @property {number} [edition_id]
 * @property {string} [editionEventName]
 * @property {number} [editionYear]
 * @property {string} [editionStartDate]
 * @property {string} [bib]
 * @property {"none" | "verified" | "not_found" | "error"} [proof_status]
 * @property {string} [proof_source_url]
 * @property {string} [proof_checked_at]
 * @property {number} createdAt // epoch ms
 * @property {string} [ownerId]
 * @property {string} [owner_id]
 * @property {string} [user_id]
 * @property {string} [author_display_name]
 */

/**
 * @typedef {Object} ThreadMessage
 * @property {string} id
 * @property {string} thread_id
 * @property {string} sender_id
 * @property {string} body
 * @property {string} created_at
 * @property {string | null} [read_at]
 */

/**
 * @typedef {Object} EditionSearchResult
 * @property {number} edition_id
 * @property {string} event_name
 * @property {string | null} city
 * @property {string | null} country_code
 * @property {number | null} year
 * @property {string | null} start_date
 * @property {string[] | null} distances
 */

/** @typedef {"sell" | "buy" | "any"} AlertMode */

/**
 * @typedef {Object} Alert
 * @property {string} id
 * @property {string} user_id
 * @property {AlertMode} mode
 * @property {number | null} [event_id]
 * @property {string | null} [event_label]
 * @property {string | null} [query_text]
 * @property {Distance | null} [distance]
 * @property {number | null} [max_price]
 * @property {boolean} is_active
 * @property {boolean} send_email
 * @property {string} created_at
 */

/**
 * @typedef {Object} UserNotification
 * @property {string} id
 * @property {string} user_id
 * @property {string | null} [listing_id]
 * @property {"inapp" | "email"} channel
 * @property {boolean} is_read
 * @property {string} created_at
 * @property {{ listing?: any, alerts?: any[] }} [payload]
 */

// ----------------------- Pomocnicze funkcje ----------------------
const STORAGE_KEY = "race_listings_v1";

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractDateString(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(str)) return str.slice(0, 10);
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateOnly(parsed);
}

function listingIsExpired(listing, todayStr) {
  if (!todayStr) return false;
  const eventDateStr = extractDateString(listing?.eventDate);
  if (eventDateStr && eventDateStr < todayStr) return true;
  if (listing?.edition_id || listing?.editionYear) {
    const editionDateStr =
      extractDateString(listing?.editionStartDate) ||
      extractDateString(listing?.edition_start_date) ||
      extractDateString(listing?.start_date);
    if (editionDateStr && editionDateStr < todayStr) return true;
  }
  return false;
}

/** @returns {Listing[]} */
function loadListings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return demoSeed();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return migrateListings(parsed);
    return demoSeed();
  } catch {
    return demoSeed();
  }
}

/** @param {Listing[]} listings */
function saveListings(listings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(listings));
}

function toPLN(n) {
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(n ?? 0);
  } catch {
    return `${n} PLN`;
  }
}

const NBHYPHEN = "\u2011"; // nierozdzielający łącznik
function noWrapDate(s) {
  if (!s) return "—";
  return String(s).replace(/-/g, NBHYPHEN);
}

function clsx(...args) {
  return args.filter(Boolean).join(" ");
}

function maskBib(value = "") {
  const input = String(value).trim();
  if (!input) return "";
  if (input.length <= 3) {
    return "•".repeat(input.length || 3);
  }
  const visible = input.slice(-3);
  return `${"•".repeat(Math.max(3, input.length - 3))}${visible}`;
}

function parseDistanceToKm(s) {
  if (!s) return undefined;
  const t = String(s).toLowerCase().trim();
  if (t.includes("ultra")) return 50;
  if (t.includes("półmaraton") || t.includes("polmaraton") || t.includes("half")) return 21.0975;
  if ((t.includes("maraton") || t.includes("marathon")) && !t.includes("pół") && !t.includes("pol") && !t.includes("half")) {
    return 42.195;
  }
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(k|km|kil|kilometr)/);
  if (!m) return undefined;
  return parseFloat(m[1].replace(",", "."));
}

function distanceBand(km) {
  if (km == null || isNaN(km)) return null;
  if (km <= 5) return { key: "up_to_5", label: "≤5 km", cls: "bg-emerald-100 text-emerald-800" };
  if (km > 5 && km <= 10) return { key: "5_to_10", label: "5–10 km", cls: "bg-cyan-100 text-cyan-800" };
  if (km >= 21.0 && km <= 21.2) return { key: "half", label: "Półmaraton", cls: "bg-indigo-100 text-indigo-800" };
  if (km > 10 && km < 21.0) return { key: "10_to_half", label: "10–21 km", cls: "bg-sky-100 text-sky-800" };
  if (km >= 42.0 && km <= 42.4) return { key: "marathon", label: "Maraton", cls: "bg-amber-100 text-amber-800" };
  if (km > 21.2 && km < 42.0) return { key: "half_to_mar", label: "21–42 km", cls: "bg-fuchsia-100 text-fuchsia-800" };
  if (km > 42.4) return { key: "ultra", label: "Ultramaraton", cls: "bg-rose-100 text-rose-800" };
  return null;
}

function formatKilometersLabel(km) {
  if (!Number.isFinite(km)) return "";
  const absKm = Math.abs(km);
  const hasFraction = Math.abs(km - Math.round(km)) > 1e-3;
  const formatted = km.toLocaleString("pl-PL", {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
  if (hasFraction) {
    return `${formatted} kilometra`;
  }
  const rounded = Math.round(absKm);
  const lastTwo = rounded % 100;
  if (lastTwo >= 12 && lastTwo <= 14) {
    return `${formatted} kilometrów`;
  }
  const lastDigit = rounded % 10;
  if (lastDigit === 1) return `${formatted} kilometr`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${formatted} kilometry`;
  return `${formatted} kilometrów`;
}

function distanceTagLabel(distanceValue, km, band) {
  const normalized = typeof distanceValue === "string" ? distanceValue.trim() : "";
  if (band?.key === "half") return "Półmaraton";
  if (band?.key === "marathon") return "Maraton";
  if (normalized) return normalized;
  if (Number.isFinite(km)) return formatKilometersLabel(km);
  return band?.label ?? "";
}

function distanceTagTitle(distanceValue, km, band) {
  const normalized = typeof distanceValue === "string" ? distanceValue.trim() : "";
  if (normalized) return normalized;
  if (Number.isFinite(km)) return formatKilometersLabel(km);
  return band?.label ?? "";
}

function formatEditionMeta(item) {
  if (!item) return "";
  const locationParts = [item.city, item.country_code].filter(Boolean);
  const locationLabel = locationParts.length ? `(${locationParts.join(", ")})` : "";
  const year = item.year ?? item.edition_year ?? item.editionYear ?? null;
  const yearLabel = year ? `— ${year}` : "";
  return [locationLabel, yearLabel].filter(Boolean).join(" ").trim();
}

function formatEditionLabel(item) {
  if (!item) return "";
  const name = item.event_name || item.editionEventName || item.event_label || "";
  const year = item.year ?? item.edition_year ?? item.editionYear ?? null;
  return [name, year ? String(year) : ""].filter(Boolean).join(" ").trim();
}

function proofStatusBadgeMeta(status = "") {
  switch (status) {
    case "verified":
      return { label: "Zweryfikowany", color: "bg-emerald-100 text-emerald-800" };
    case "not_found":
      return { label: "Nie znaleziono", color: "bg-amber-100 text-amber-800" };
    case "error":
      return { label: "Błąd weryfikacji", color: "bg-rose-100 text-rose-700" };
    default:
      return { label: "Niezweryfikowany", color: "bg-neutral-100 text-gray-600" };
  }
}

/**
 * @param {string} raceName
 * @returns {Distance | undefined}
 */
function inferDistance(raceName = "") {
  const lower = raceName.toLowerCase();
  if (lower.includes("ultra")) return "Ultramaraton";
  if (lower.includes("pół") || lower.includes("pol") || lower.includes("half")) return "Półmaraton";
  if (lower.includes("marat") && !lower.includes("pół")) return "Maraton";
  if (lower.includes("100")) return "100 km";
  if (lower.includes("50")) return "50 km";
  if (lower.includes("30")) return "30 km";
  if (lower.includes("15")) return "15 km";
  if (lower.includes("10")) return "10 km";
  if (lower.includes("5")) return "5 km";
  return undefined;
}

function alertModeLabel(mode) {
  switch (mode) {
    case "sell":
      return "Sprzedam";
    case "buy":
      return "Kupię";
    default:
      return "Sprzedam/Kupię";
  }
}

function formatRelativeTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "przed chwilą";
  if (diffMs < hour) {
    const minutes = Math.round(diffMs / minute);
    return `${minutes} min temu`;
  }
  if (diffMs < day) {
    const hours = Math.round(diffMs / hour);
    return `${hours} godz. temu`;
  }
  const days = Math.round(diffMs / day);
  if (days <= 7) {
    return `${days} dni temu`;
  }
  return date.toLocaleString("pl-PL");
}

/**
 * @param {Listing} listing
 * @returns {string | null}
 */
function getListingOwnerId(listing) {
  return (
    listing?.owner_id ||
    listing?.ownerId ||
    listing?.user_id ||
    listing?.userId ||
    (listing?.user && typeof listing.user === "object" ? listing.user.id : null) ||
    null
  );
}

/** @param {Listing[]} listings */
function migrateListings(listings) {
  let changed = false;
  const migrated = listings.map((l) => {
    let next = l;
    let mutated = false;
    const rawDistance = typeof l.distance === "string" ? l.distance.trim() : "";
    let distanceValue = rawDistance;
    if (rawDistance !== (l.distance || "")) {
      next = mutated ? next : { ...l };
      mutated = true;
      if (rawDistance) {
        next.distance = rawDistance;
      } else {
        delete next.distance;
      }
      distanceValue = rawDistance;
    }
    if (!distanceValue) {
      const inferred = inferDistance(l.raceName || "");
      if (inferred) {
        if (!mutated) {
          next = { ...l };
          mutated = true;
        }
        next.distance = inferred;
        distanceValue = inferred;
      }
    }
    const computedKm = Number.isFinite(l.distanceKm)
      ? l.distanceKm
      : parseDistanceToKm(distanceValue || l.distance);
    if (Number.isFinite(computedKm)) {
      if (!Number.isFinite(l.distanceKm) || l.distanceKm !== computedKm) {
        if (!mutated) {
          next = { ...l };
          mutated = true;
        }
        next.distanceKm = computedKm;
      }
    } else if (typeof l.distanceKm === "number") {
      if (!mutated) {
        next = { ...l };
        mutated = true;
      }
      delete next.distanceKm;
    }
    if (mutated) {
      changed = true;
      return next;
    }
    return l;
  });
  if (changed) saveListings(migrated);
  return migrated;
}

function demoSeed() {
  /** @type {Listing[]} */
  const now = Date.now();
  const data = [
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Półmaraton Warszawski",
      eventDate: "2025-10-05",
      location: "Warszawa",
      price: 250,
      contact: "ania@example.com",
      description: "Pakiet z możliwością oficjalnego przepisania.",
      distance: "Półmaraton",
      createdAt: now - 1000 * 60 * 60 * 6,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Cracovia Maraton",
      eventDate: "2026-04-26",
      location: "Kraków",
      price: 200,
      contact: "marek@example.com",
      description: "Kupię w rozsądnej cenie – najlepiej z koszulką M.",
      distance: "Maraton",
      createdAt: now - 1000 * 60 * 60 * 24,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Bieg Niepodległości",
      eventDate: "2025-11-11",
      location: "Poznań",
      price: 120,
      contact: "ola@example.com",
      description: "Sprzedam, odbiór elektroniczny.",
      distance: "10 km",
      createdAt: now - 1000 * 60 * 60 * 48,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Bieg po Zdrowie 5 km",
      eventDate: "2025-06-15",
      location: "Łódź",
      price: 80,
      contact: "kasia@example.com",
      description: "Startówki z pamiątkowym medalem i strefą rodzinną.",
      createdAt: now - 1000 * 60 * 60 * 72,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Silesia Night Run 10 km",
      eventDate: "2025-08-23",
      location: "Katowice",
      price: 150,
      contact: "piotr@example.com",
      description: "Szukam pakietu VIP z miejscem w pierwszej strefie.",
      createdAt: now - 1000 * 60 * 60 * 96,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Gdańsk Bieg na 15 km",
      eventDate: "2025-09-07",
      location: "Gdańsk",
      price: 110,
      contact: "ewa@example.com",
      description: "Pakiet wraz z koszulką rozmiar S, odbiór na miejscu.",
      createdAt: now - 1000 * 60 * 60 * 120,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Trail Beskidy 30 km",
      eventDate: "2025-07-12",
      location: "Ustroń",
      price: 180,
      contact: "agnieszka@example.com",
      description: "Interesuje mnie transfer last minute, mogę dopłacić.",
      createdAt: now - 1000 * 60 * 60 * 144,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Ultra Mazury 55 km",
      eventDate: "2025-09-28",
      location: "Giżycko",
      price: 320,
      contact: "tomek@example.com",
      description: "Nie startuję – oddam z opłaconym noclegiem w hostelu.",
      createdAt: now - 1000 * 60 * 60 * 168,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Bieszczadzki Ultramaraton 100 km",
      eventDate: "2025-10-19",
      location: "Cisna",
      price: 450,
      contact: "magda@example.com",
      description: "Przepiszę pełny pakiet + pasta party, odbiór online.",
      createdAt: now - 1000 * 60 * 60 * 192,
    },
  ];
  const enriched = data.map((item) => {
    const inferredDistance = item.distance || inferDistance(item.raceName) || "";
    const km = parseDistanceToKm(inferredDistance);
    if (!inferredDistance && !Number.isFinite(km)) return item;
    const next = { ...item };
    if (inferredDistance) {
      next.distance = inferredDistance;
    }
    if (Number.isFinite(km)) {
      next.distanceKm = km;
    }
    return next;
  });
  saveListings(enriched);
  return enriched;
}

function cryptoRandom() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (
      Date.now().toString(36) +
      "-" +
      Array.from(buf)
        .map((x) => x.toString(36))
        .join("")
    );
  }
  return Math.random().toString(36).slice(2);
}

// --------------------------- Komponenty --------------------------

function Badge({ children, color = "" }) {
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-medium", color || "bg-gray-100 text-gray-800")}>{children}</span>
  );
}

function Section({ title, children, right }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg md:text-xl font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

/** @param {{ onAdd: (l: Listing)=>void, ownerId?: string, authorDisplayName?: string, editingListing?: Listing | null, onCancelEdit?: ()=>void }} props */
function ListingForm({ onAdd, ownerId, authorDisplayName, editingListing = null, onCancelEdit }) {
  /** @type {[ListingType, Function]} */
  const [type, setType] = useState(/** @type {ListingType} */("sell"));
  const [raceName, setRaceName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [distance, setDistance] = useState("");
  const [price, setPrice] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState("");
  const [selectedEdition, setSelectedEdition] = useState(/** @type {(EditionSearchResult | null)} */(null));
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState(/** @type {EditionSearchResult[]} */([]));
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [bib, setBib] = useState("");
  const [startListUrl, setStartListUrl] = useState("");
  const [proofStatus, setProofStatus] = useState("");
  const [proofSourceUrl, setProofSourceUrl] = useState("");
  const [proofCheckedAt, setProofCheckedAt] = useState(/** @type {string | null} */(null));
  const [proofError, setProofError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const isEditing = !!(editingListing && editingListing.id);

  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      setSearchError("");
      return;
    }

    let ignore = false;
    setIsSearching(true);
    setSearchError("");
    const handler = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("event_editions_search")
          .select("edition_id,event_name,city,country_code,year,start_date,distances")
          .ilike("event_name", `%${q}%`)
          .order("year", { ascending: false })
          .limit(20);
        if (ignore) return;
        if (error) {
          console.error(error);
          setSearchError("Nie udało się pobrać propozycji.");
          setSuggestions([]);
        } else {
          setSuggestions(data || []);
        }
      } catch (err) {
        if (ignore) return;
        console.error(err);
        setSearchError("Nie udało się pobrać propozycji.");
        setSuggestions([]);
      } finally {
        if (!ignore) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      ignore = true;
      clearTimeout(handler);
    };
  }, [searchTerm]);

  useEffect(() => {
    setProofStatus("");
    setProofSourceUrl("");
    setProofCheckedAt(null);
    setProofError("");
    setVerifying(false);
  }, [bib, startListUrl]);

  useEffect(() => {
    if (type === "buy") {
      setBib("");
      setStartListUrl("");
      setProofStatus("");
      setProofSourceUrl("");
      setProofCheckedAt(null);
      setProofError("");
      setVerifying(false);
    }
  }, [type]);

  function handleSelectEdition(item) {
    setSelectedEdition(item);
    setRaceName(item.event_name || "");
    setSearchTerm("");
    setSuggestions([]);
    setShowSuggestions(false);
    setEventDate(item.start_date || "");
    if (Array.isArray(item.distances) && item.distances.length === 1) {
      const first = item.distances[0] || "";
      setDistance(typeof first === "string" ? first.trim() : String(first || ""));
    }
  }

  function reset() {
    setRaceName("");
    setEventDate("");
    setLocation("");
    setDistance("");
    setPrice("");
    setContact("");
    setDescription("");
    setAgree(false);
    setSelectedEdition(null);
    setSearchTerm("");
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchError("");
    setBib("");
    setStartListUrl("");
    setProofStatus("");
    setProofSourceUrl("");
    setProofCheckedAt(null);
    setProofError("");
    setVerifying(false);
  }

  useEffect(() => {
    if (!editingListing) {
      reset();
      return;
    }
    setType(editingListing.type || "sell");
    setRaceName(editingListing.raceName || "");
    setEventDate(
      extractDateString(editingListing.eventDate) ||
        extractDateString(editingListing.editionStartDate) ||
        extractDateString(editingListing.edition_start_date) ||
        ""
    );
    setLocation(editingListing.location || "");
    setDistance((editingListing.distance || "").trim());
    setPrice(
      typeof editingListing.price === "number"
        ? String(editingListing.price)
        : editingListing.price
        ? String(editingListing.price)
        : ""
    );
    setContact(editingListing.contact || "");
    setDescription(editingListing.description || "");
    setAgree(true);
    setSelectedEdition(
      editingListing.edition_id
        ? {
            edition_id: editingListing.edition_id,
            event_name: editingListing.editionEventName || editingListing.raceName || "",
            city: null,
            country_code: null,
            year: editingListing.editionYear ?? null,
            start_date:
              editingListing.editionStartDate ||
              editingListing.eventDate ||
              editingListing.start_date ||
              null,
            distances: null,
          }
        : null
    );
    const existingBib = editingListing.bib || "";
    setBib(existingBib);
    const sourceUrl = editingListing.proof_source_url || "";
    setStartListUrl(sourceUrl);
    setProofStatus(editingListing.proof_status || (existingBib ? "none" : ""));
    setProofSourceUrl(sourceUrl);
    setProofCheckedAt(editingListing.proof_checked_at || null);
    setProofError("");
    setMsg("");
  }, [editingListing]);

  function validate() {
    if (!raceName.trim()) return "Podaj nazwę biegu.";
    if (!distance.trim()) return "Wybierz dystans biegu.";
    if (!price || isNaN(Number(price)) || Number(price) <= 0) return "Podaj poprawną kwotę.";
    if (!contact.trim()) return "Podaj kontakt (e-mail/telefon).";
    if (!agree) return "Musisz zaakceptować regulamin i zasady transferu pakietu.";
    return "";
  }

  async function handleVerify() {
    if (!bib.trim()) {
      setProofError("Podaj numer BIB do weryfikacji.");
      return;
    }
    if (!startListUrl.trim()) {
      setProofError("Podaj link do listy startowej.");
      return;
    }

    setVerifying(true);
    setProofError("");

    try {
      const response = await fetch("/api/verify-bib-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bib: bib.trim(), url: startListUrl.trim() }),
      });

      /** @type {{ status?: string, sourceUrl?: string, checkedAt?: string, message?: string, error?: string }} */
      let payload = {};
      try {
        payload = await response.json();
      } catch (err) {
        console.error(err);
      }

      if (!response.ok) {
        setProofStatus("error");
        setProofSourceUrl(payload?.sourceUrl || startListUrl.trim());
        setProofCheckedAt(payload?.checkedAt || new Date().toISOString());
        setProofError(payload?.error || payload?.message || "Nie udało się zweryfikować numeru.");
        return;
      }

      const nextStatus = payload.status || "not_found";
      setProofStatus(nextStatus);
      setProofSourceUrl(payload?.sourceUrl || startListUrl.trim());
      setProofCheckedAt(payload?.checkedAt || new Date().toISOString());

      if (nextStatus === "verified") {
        setProofError(payload?.message || "");
      } else {
        setProofError(payload?.message || payload?.error || "Numeru nie znaleziono na liście startowej.");
      }
    } catch (err) {
      console.error(err);
      setProofStatus("error");
      setProofSourceUrl(startListUrl.trim());
      setProofCheckedAt(new Date().toISOString());
      setProofError("Nie udało się zweryfikować numeru.");
    } finally {
      setVerifying(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setMsg(err);
      setTimeout(() => setMsg(""), 2500);
      return;
    }
    const fallbackEdition =
      (!selectedEdition && editingListing && editingListing.edition_id)
        ? {
            edition_id: editingListing.edition_id,
            event_name: editingListing.editionEventName || editingListing.raceName || "",
            year: editingListing.editionYear ?? null,
            start_date:
              editingListing.editionStartDate ||
              editingListing.eventDate ||
              editingListing.start_date ||
              null,
          }
        : null;
    const selected = selectedEdition || fallbackEdition;
    /** @type {Listing} */
    const base = editingListing ? { ...editingListing } : {};
    const createdAt = editingListing?.createdAt ?? Date.now();
    /** @type {Listing} */
    const l = {
      ...base,
      id: editingListing?.id || cryptoRandom(),
      type,
      raceName: raceName.trim(),
      eventDate: eventDate || undefined,
      location: location || undefined,
      price: Number(price),
      contact: contact.trim(),
      description: description?.trim() || undefined,
      createdAt,
    };
    const trimmedDistance = (distance || "").trim();
    l.distance = trimmedDistance;
    const km = parseDistanceToKm(l.distance);
    if (Number.isFinite(km)) {
      l.distanceKm = km;
    } else {
      delete l.distanceKm;
    }
    if (!trimmedDistance) {
      delete l.distance;
    }
    if (!editingListing) {
      l.createdAt = createdAt;
    }
    if (ownerId) {
      l.ownerId = ownerId;
    }
    if (!l.ownerId && editingListing?.ownerId) {
      l.ownerId = editingListing.ownerId;
    }
    if (!l.owner_id && editingListing?.owner_id) {
      l.owner_id = editingListing.owner_id;
    }
    if (authorDisplayName) {
      l.author_display_name = authorDisplayName;
    } else if (editingListing?.author_display_name) {
      l.author_display_name = editingListing.author_display_name;
    }
    if (selected) {
      l.edition_id = selected.edition_id;
      l.editionEventName = selected.event_name;
      l.editionYear = selected.year ?? undefined;
      l.editionStartDate = selected.start_date || undefined;
    }
    if (!selected && editingListing) {
      if (!editingListing.edition_id) {
        delete l.edition_id;
        delete l.editionEventName;
        delete l.editionYear;
        delete l.editionStartDate;
      }
    }
    if (type === "sell") {
      const trimmedBib = bib.trim();
      const normalizedProofStatus = proofStatus || (trimmedBib ? "none" : "");
      const sourceUrl = proofSourceUrl || startListUrl.trim();
      if (trimmedBib) {
        l.bib = trimmedBib;
        l.proof_status = /** @type {Listing["proof_status"]} */ (normalizedProofStatus || "none");
        if (sourceUrl) l.proof_source_url = sourceUrl;
        if (proofCheckedAt) l.proof_checked_at = proofCheckedAt;
      } else if (proofStatus) {
        l.proof_status = /** @type {Listing["proof_status"]} */ (proofStatus);
        if (sourceUrl) l.proof_source_url = sourceUrl;
        if (proofCheckedAt) l.proof_checked_at = proofCheckedAt;
      } else {
        delete l.bib;
        delete l.proof_status;
        delete l.proof_source_url;
        delete l.proof_checked_at;
      }
    } else {
      delete l.bib;
      delete l.proof_status;
      delete l.proof_source_url;
      delete l.proof_checked_at;
    }
    onAdd(l);
    reset();
    setMsg(isEditing ? "Zapisano zmiany ✔" : "Dodano ogłoszenie ✔");
    setTimeout(() => setMsg(""), 2000);
  }

  const editionForMeta = selectedEdition ||
    (editingListing && editingListing.edition_id
      ? {
          edition_id: editingListing.edition_id,
          event_name: editingListing.editionEventName || editingListing.raceName || "",
          city: null,
          country_code: null,
          year: editingListing.editionYear ?? null,
          start_date:
            editingListing.editionStartDate ||
            editingListing.eventDate ||
            editingListing.start_date ||
            null,
          distances: null,
        }
      : null);
  const selectedEditionMeta = editionForMeta ? formatEditionMeta(editionForMeta) : "";
  const normalizedProofStatus = proofStatus || (bib ? "none" : "");
  const proofBadge = proofStatusBadgeMeta(normalizedProofStatus || "none");
  let proofCheckedLabel = "";
  if (proofCheckedAt) {
    const parsed = new Date(proofCheckedAt);
    if (!Number.isNaN(parsed.getTime())) {
      proofCheckedLabel = parsed.toLocaleString("pl-PL");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setType("sell")} className={clsx("px-3 py-2 rounded-xl border", type === "sell" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50")}>
          Sprzedam pakiet
        </button>
        <button type="button" onClick={() => setType("buy")} className={clsx("px-3 py-2 rounded-xl border", type === "buy" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50")}>
          Kupię pakiet
        </button>
      </div>

      <Field label="Nazwa biegu" required>
        <div className="relative">
          <input
            value={raceName}
            onChange={(e) => {
              const value = e.target.value;
              setRaceName(value);
              setSearchTerm(value);
              setShowSuggestions(true);
              setSearchError("");
              if (selectedEdition && value !== selectedEdition.event_name) {
                setSelectedEdition(null);
              }
            }}
            onFocus={() => {
              setShowSuggestions(true);
              if (!searchTerm && raceName.trim().length >= 2) {
                setSearchTerm(raceName);
              }
            }}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setShowSuggestions(false);
              }
            }}
            className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
            placeholder="np. Półmaraton Warszawski"
            autoComplete="off"
          />
          {showSuggestions && (
            <div className="absolute left-0 right-0 mt-1 rounded-xl border bg-white shadow-lg z-20">
              <div className="max-h-60 overflow-auto py-1">
                {searchTerm.trim().length < 2 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">Wpisz min. 2 znaki, aby wyszukać.</div>
                ) : (
                  <>
                    {isSearching && <div className="px-3 py-2 text-sm text-gray-500">Wyszukiwanie…</div>}
                    {searchError && !isSearching && (
                      <div className="px-3 py-2 text-sm text-rose-600">{searchError}</div>
                    )}
                    {!isSearching && !searchError && suggestions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500">Brak wyników.</div>
                    )}
                    {suggestions.map((item) => (
                      <button
                        key={item.edition_id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectEdition(item);
                        }}
                      >
                        <div className="font-medium text-neutral-900">{item.event_name}</div>
                        <div className="text-xs text-gray-500">{formatEditionMeta(item) || ""}</div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {selectedEdition && (
          <div className="mt-1 text-xs text-gray-500">
            Wybrano: {selectedEdition.event_name}
            {selectedEditionMeta ? <span> {selectedEditionMeta}</span> : null}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Data wydarzenia">
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" />
        </Field>
        <Field label="Lokalizacja">
          <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" placeholder="np. Warszawa" />
        </Field>
      </div>

      <Field label="Dystans" required>
        <>
          <input
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
            list="listing-distance-options"
            placeholder="np. 10 km"
            required
          />
          <datalist id="listing-distance-options">
            {DISTANCES.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </>
      </Field>

      <Field label={type === "sell" ? "Cena (PLN)" : "Budżet / proponowana kwota (PLN)"} required>
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(",", "."))} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" placeholder="np. 199" />
      </Field>

      {type === "sell" && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Numer BIB">
              <input
                value={bib}
                onChange={(e) => setBib(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
                placeholder="np. 1234"
              />
            </Field>
            <Field label="Link do listy startowej">
              <input
                type="url"
                value={startListUrl}
                onChange={(e) => setStartListUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
                placeholder="https://…"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying || !bib.trim() || !startListUrl.trim()}
              className="px-3 py-1.5 rounded-xl border bg-white hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifying ? "Sprawdzam…" : "Zweryfikuj numer"}
            </button>
            {(bib || proofStatus) && (
              <Badge color={proofBadge.color}>{proofBadge.label}</Badge>
            )}
            {proofCheckedLabel && (
              <span className="text-xs text-gray-500">Sprawdzono {proofCheckedLabel}</span>
            )}
            {proofSourceUrl && normalizedProofStatus === "verified" && (
              <a
                href={proofSourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-600 underline"
              >
                Zobacz listę
              </a>
            )}
          </div>
          {proofError && (
            <div className={clsx("text-xs", normalizedProofStatus === "verified" ? "text-emerald-600" : "text-rose-600")}>
              {proofError}
            </div>
          )}
        </div>
      )}

      <Field label="Kontakt (e-mail lub telefon)" required>
        <input value={contact} onChange={(e) => setContact(e.target.value)} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" placeholder="np. ala@domena.pl / 600123123" />
      </Field>

      <Field label="Opis">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" rows={3} placeholder="Szczegóły: rozmiar koszulki, możliwość oficjalnego przepisania, itp." />
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
        <span>
          Akceptuję regulamin serwisu oraz oświadczam, że transfer pakietu jest dozwolony przez organizatora biegu.
        </span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button className="px-4 py-2 rounded-xl bg-neutral-900 text-white hover:opacity-90" type="submit">
          {isEditing ? "Zapisz zmiany" : "Dodaj ogłoszenie"}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={() => {
              onCancelEdit?.();
              reset();
            }}
            className="px-4 py-2 rounded-xl border bg-white hover:bg-neutral-50"
          >
            Anuluj edycję
          </button>
        )}
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </form>
  );
}

/**
 * @param {{
 *   onSubmit: (payload: Partial<Alert> & { mode: AlertMode, send_email: boolean, is_active: boolean }) => Promise<void> | void,
 *   saving: boolean,
 *   editingAlert: Alert | null,
 *   onCancelEdit: () => void,
 *   emailOptIn: boolean,
 *   requestEmailOptIn: (next: boolean) => Promise<boolean>,
 * }} props
 */
function AlertForm({ onSubmit, saving, editingAlert, onCancelEdit, emailOptIn, requestEmailOptIn }) {
  const [mode, setMode] = useState(/** @type {AlertMode} */ ("any"));
  const [searchValue, setSearchValue] = useState("");
  const [selectedEdition, setSelectedEdition] = useState(/** @type {(EditionSearchResult | null)} */(null));
  const [distance, setDistance] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState(/** @type {EditionSearchResult[]} */([]));
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const term = searchValue.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      setSearchError("");
      return;
    }

    let ignore = false;
    setIsSearching(true);
    setSearchError("");
    const handler = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("event_editions_search")
          .select("edition_id,event_name,city,country_code,year,start_date,distances")
          .ilike("event_name", `%${term}%`)
          .order("year", { ascending: false })
          .limit(20);
        if (ignore) return;
        if (error) {
          console.error(error);
          setSearchError("Nie udało się pobrać propozycji.");
          setSuggestions([]);
        } else {
          setSuggestions(data || []);
        }
      } catch (err) {
        if (ignore) return;
        console.error(err);
        setSearchError("Nie udało się pobrać propozycji.");
        setSuggestions([]);
      } finally {
        if (!ignore) setIsSearching(false);
      }
    }, 250);

    return () => {
      ignore = true;
      clearTimeout(handler);
    };
  }, [searchValue]);

  useEffect(() => {
    if (!editingAlert) {
      setMode("any");
      setSearchValue("");
      setSelectedEdition(null);
      setDistance("");
      setMaxPrice("");
      setSendEmail(false);
      setIsActive(true);
      setMessage("");
      return;
    }

    setMode(editingAlert.mode || "any");
    if (editingAlert.event_id) {
      setSelectedEdition({
        edition_id: editingAlert.event_id,
        event_name: editingAlert.event_label || editingAlert.query_text || "",
        city: null,
        country_code: null,
        year: null,
        start_date: null,
        distances: null,
      });
      setSearchValue(formatEditionLabel({
        event_name: editingAlert.event_label || editingAlert.query_text || "",
        year: null,
      }));
    } else {
      setSelectedEdition(null);
      setSearchValue(editingAlert.query_text || "");
    }
    setDistance(editingAlert.distance || "");
    setMaxPrice(
      typeof editingAlert.max_price === "number" && Number.isFinite(editingAlert.max_price)
        ? String(editingAlert.max_price)
        : ""
    );
    setSendEmail(!!editingAlert.send_email);
    setIsActive(editingAlert.is_active !== false);
    setMessage("");
  }, [editingAlert]);

  function resetForm() {
    setMode("any");
    setSearchValue("");
    setSelectedEdition(null);
    setDistance("");
    setMaxPrice("");
    setSendEmail(false);
    setIsActive(true);
    setMessage("");
    setSuggestions([]);
    setSearchError("");
  }

  function handleSelectEdition(item) {
    setSelectedEdition(item);
    setSearchValue(formatEditionLabel(item) || item.event_name || "");
    setShowSuggestions(false);
    setSuggestions([]);
  }

  async function handleSendEmailToggle(next) {
    if (next && !emailOptIn) {
      const ok = await requestEmailOptIn(true);
      if (!ok) {
        setMessage("Nie udało się włączyć powiadomień e-mail.");
        return;
      }
    }
    setSendEmail(next);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage("");
    const trimmed = searchValue.trim();
    if (!selectedEdition && !trimmed) {
      setMessage("Podaj nazwę biegu lub wybierz go z listy.");
      return;
    }
    const payload = {
      mode,
      distance: distance || null,
      max_price: maxPrice ? Number(maxPrice.replace(",", ".")) : null,
      send_email: sendEmail,
      is_active: isActive,
      event_id: selectedEdition ? selectedEdition.edition_id : null,
      event_label: selectedEdition ? formatEditionLabel(selectedEdition) || selectedEdition.event_name || null : null,
      query_text: selectedEdition ? null : trimmed || null,
    };
    if (Number.isNaN(payload.max_price)) {
      setMessage("Podaj poprawną maksymalną cenę.");
      return;
    }
    try {
      await onSubmit(editingAlert ? { ...payload, id: editingAlert.id } : payload);
      if (!editingAlert) {
        resetForm();
        setMessage("Alert zapisany ✔");
        setTimeout(() => setMessage(""), 2000);
      } else {
        setMessage("Zapisano zmiany ✔");
        setTimeout(() => setMessage(""), 2000);
      }
    } catch (err) {
      console.error(err);
      setMessage(err?.message || "Nie udało się zapisać alertu.");
    }
  }

  const selectedEditionMeta = selectedEdition ? formatEditionMeta(selectedEdition) : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className={clsx(
            "px-3 py-2 rounded-xl border",
            mode === "sell" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
          )}
          onClick={() => setMode("sell")}
        >
          Sprzedam
        </button>
        <button
          type="button"
          className={clsx(
            "px-3 py-2 rounded-xl border",
            mode === "buy" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
          )}
          onClick={() => setMode("buy")}
        >
          Kupię
        </button>
        <button
          type="button"
          className={clsx(
            "px-3 py-2 rounded-xl border",
            mode === "any" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
          )}
          onClick={() => setMode("any")}
        >
          Oba typy
        </button>
      </div>

      <Field label="Bieg lub fraza" required>
        <div className="relative">
          <input
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
              setShowSuggestions(true);
              if (selectedEdition) {
                setSelectedEdition(null);
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
            placeholder="np. Maraton Warszawski"
            disabled={saving}
          />
          {selectedEdition && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-sky-600 underline"
              onClick={() => setSelectedEdition(null)}
            >
              Usuń wybór
            </button>
          )}
          {showSuggestions && (suggestions.length > 0 || isSearching || searchError) && (
            <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-white border rounded-xl shadow-lg text-sm">
              {isSearching && (
                <div className="px-3 py-2 text-gray-500">Wyszukuję…</div>
              )}
              {searchError && <div className="px-3 py-2 text-rose-600">{searchError}</div>}
              {suggestions.map((item) => (
                <button
                  type="button"
                  key={item.edition_id}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-100"
                  onClick={() => handleSelectEdition(item)}
                >
                  <div className="font-medium">{item.event_name}</div>
                  <div className="text-xs text-gray-500">{formatEditionMeta(item) || ""}</div>
                </button>
              ))}
              {!isSearching && !suggestions.length && !searchError && (
                <div className="px-3 py-2 text-gray-500">Brak propozycji.</div>
              )}
            </div>
          )}
        </div>
        {selectedEditionMeta && (
          <div className="text-xs text-gray-500 mt-1">Wybrana edycja: {selectedEditionMeta}</div>
        )}
      </Field>

      <Field label="Dystans">
        <select
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
          disabled={saving}
        >
          <option value="">Dowolny dystans</option>
          {DISTANCES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Maksymalna cena">
        <input
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value.replace(",", "."))}
          inputMode="decimal"
          placeholder="np. 250"
          className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
          disabled={saving}
        />
      </Field>

      <div className="flex items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => {
              const next = e.target.checked;
              handleSendEmailToggle(next);
            }}
            disabled={saving}
          />
          <span>Powiadom mnie e-mailem</span>
        </label>
        {!emailOptIn && (
          <span className="text-xs text-gray-500">
            Wymaga zgody w profilu.
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          disabled={saving}
        />
        <span>Alert aktywny</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="px-4 py-2 rounded-xl bg-neutral-900 text-white disabled:opacity-50"
          disabled={saving}
        >
          {editingAlert ? "Zapisz alert" : "Dodaj alert"}
        </button>
        {editingAlert && (
          <button
            type="button"
            className="px-4 py-2 rounded-xl border bg-white hover:bg-neutral-50"
            onClick={() => {
              onCancelEdit();
              resetForm();
            }}
            disabled={saving}
          >
            Anuluj edycję
          </button>
        )}
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>
    </form>
  );
}

/**
 * @param {{
 *  alerts: Alert[],
 *  loading: boolean,
 *  onToggle: (alert: Alert, next: boolean) => Promise<void> | void,
 *  onDelete: (alert: Alert) => Promise<void> | void,
 *  onEdit: (alert: Alert) => void,
 *  emailOptIn: boolean,
 * }} props
 */
function AlertsList({ alerts, loading, onToggle, onDelete, onEdit, emailOptIn }) {
  if (loading) {
    return <div className="text-sm text-gray-500">Ładuję alerty…</div>;
  }
  if (!alerts.length) {
    return <div className="text-sm text-gray-600">Nie masz jeszcze alertów. Dodaj pierwszy, aby otrzymywać powiadomienia.</div>;
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => {
        const created = formatRelativeTime(alert.created_at);
        const distanceLabel = alert.distance || "Dowolny dystans";
        const priceLabel = alert.max_price ? `≤ ${toPLN(alert.max_price)}` : "Dowolna kwota";
        const targetLabel = alert.event_label || alert.query_text || "Dowolna fraza";
        return (
          <div key={alert.id} className="border rounded-2xl p-4 bg-white">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge color="bg-sky-50 text-sky-700">{alertModeLabel(alert.mode)}</Badge>
                <span className="font-semibold text-sm">{targetLabel}</span>
                {alert.event_id && <span className="text-xs text-gray-500">ID edycji: {alert.event_id}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggle(alert, !alert.is_active)}
                  className={clsx(
                    "px-3 py-1.5 rounded-xl border text-sm",
                    alert.is_active ? "bg-white hover:bg-neutral-50" : "bg-neutral-900 text-white"
                  )}
                >
                  {alert.is_active ? "Wyłącz" : "Włącz"}
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(alert)}
                  className="px-3 py-1.5 rounded-xl border text-sm bg-white hover:bg-neutral-50"
                >
                  Edytuj
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(alert)}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm"
                >
                  Usuń
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-600 mt-2 flex flex-wrap gap-2">
              <span>Dystans: {distanceLabel}</span>
              <span>Maks. cena: {priceLabel}</span>
              <span>Alert {alert.is_active ? "aktywny" : "wyłączony"}</span>
              <span>Powiadomienie e-mail: {alert.send_email ? (emailOptIn ? "tak" : "czeka na zgodę") : "nie"}</span>
            </div>
            {created && <div className="text-xs text-gray-400 mt-1">Dodano {created}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** @param {{ listing: Listing, onDelete: (id:string)=>void, onOpen: (listing: Listing)=>void, onMessage: (listing: Listing)=>void, currentUserId?: string, onEdit?: (listing: Listing)=>void }} props */
function ListingCard({ listing, onDelete, onOpen, onMessage, currentUserId, onEdit }) {
  const isSell = listing.type === "sell";
  const distanceText = (listing.distance || inferDistance(listing.raceName) || "").trim();
  const kmValue = Number.isFinite(listing.distanceKm)
    ? listing.distanceKm
    : parseDistanceToKm(distanceText || listing.distance);
  const band = distanceBand(kmValue);
  const tagLabel = band ? distanceTagLabel(distanceText, kmValue, band) : "";
  const tagTitle = band ? distanceTagTitle(distanceText, kmValue, band) : "";
  const ownerId = getListingOwnerId(listing);
  const canMessage = !!ownerId && ownerId !== currentUserId;
  const canManage = !!currentUserId && !!ownerId && ownerId === currentUserId;
  const listingProofStatus = listing.proof_status || (listing.bib ? "none" : "");
  const listingProofBadge = proofStatusBadgeMeta(listingProofStatus || "none");
  const maskedBib = listing.bib ? maskBib(listing.bib) : "";
  const showProof = isSell && (listing.bib || (listing.proof_status && listing.proof_status !== "none"));
  let listingProofCheckedLabel = "";
  if (listing.proof_checked_at) {
    const parsed = new Date(listing.proof_checked_at);
    if (!Number.isNaN(parsed.getTime())) {
      listingProofCheckedLabel = parsed.toLocaleString("pl-PL");
    }
  }
  return (
    <div
      id={listing.id}
      className="relative rounded-2xl border p-4 hover:shadow-sm transition bg-white cursor-pointer"
      onClick={() => onOpen(listing)}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(listing)}
    >
      {band && (
        <div className="absolute top-3 right-3">
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium ${band.cls}`}
            title={tagTitle || undefined}
          >
            {tagLabel}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge color={isSell ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>{isSell ? "SPRZEDAM" : "KUPIĘ"}</Badge>
          <h3 className="font-semibold text-lg">{listing.raceName}</h3>
          {listing.edition_id && (
            <span className="text-xs text-gray-500">
              {(listing.editionEventName || listing.raceName) + (listing.editionYear ? ` — ${listing.editionYear}` : "")}
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="font-semibold">{toPLN(listing.price)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-600 mb-2">
        <div>
          <span className="block text-gray-500">Data</span>
          <span className="whitespace-nowrap tabular-nums">
            {noWrapDate(listing.eventDate)}
          </span>
        </div>
        <div>
          <span className="block text-gray-500">Lokalizacja</span>
          <span>{listing.location || "—"}</span>
        </div>
      </div>
      {showProof && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 mb-2">
          {maskedBib && (
            <span className="text-sm text-gray-800">
              Numer startowy: <span className="font-semibold">{maskedBib}</span>
            </span>
          )}
          <Badge color={listingProofBadge.color}>{listingProofBadge.label}</Badge>
          {listingProofCheckedLabel && (
            <span>Sprawdzono {listingProofCheckedLabel}</span>
          )}
        </div>
      )}
      {listing.description && (
        <p className="text-sm text-gray-800 mb-3">{listing.description}</p>
      )}
      <div className="text-xs text-gray-500 mb-3">
        Dodano: {new Date(listing.createdAt).toLocaleString("pl-PL")}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyPermalink(listing.id);
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200"
          >
            Kopiuj link
          </button>
          {canMessage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMessage(listing);
              }}
              className="text-sm px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:opacity-90"
            >
              Napisz wiadomość
            </button>
          )}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(listing);
              }}
              className="text-sm px-3 py-1.5 rounded-lg border bg-white hover:bg-neutral-50"
            >
              Edytuj
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(listing.id);
              }}
              className="text-sm px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100"
            >
              Usuń
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailModal({ listing, onClose, onMessage, currentUserId }) {
  if (!listing) return null;
  const isSell = listing.type === "sell";
  const ownerId = getListingOwnerId(listing);
  const canMessage = !!ownerId && ownerId !== currentUserId;
  const listingProofStatus = listing.proof_status || (listing.bib ? "none" : "");
  const listingProofBadge = proofStatusBadgeMeta(listingProofStatus || "none");
  const maskedBib = listing.bib ? maskBib(listing.bib) : "";
  const proofUrl = listing.proof_source_url || "";
  const showProof = isSell && (listing.bib || (listing.proof_status && listing.proof_status !== "none"));
  const distanceText = (listing.distance || inferDistance(listing.raceName) || "").trim();
  const kmValue = Number.isFinite(listing.distanceKm)
    ? listing.distanceKm
    : parseDistanceToKm(distanceText || listing.distance);
  const band = distanceBand(kmValue);
  const tagLabel = band ? distanceTagLabel(distanceText, kmValue, band) : "";
  const tagTitle = band ? distanceTagTitle(distanceText, kmValue, band) : "";
  const distanceDisplay = distanceTagTitle(distanceText, kmValue, band);
  let listingProofCheckedLabel = "";
  if (listing.proof_checked_at) {
    const parsed = new Date(listing.proof_checked_at);
    if (!Number.isNaN(parsed.getTime())) {
      listingProofCheckedLabel = parsed.toLocaleString("pl-PL");
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="relative bg-white rounded-2xl w-[min(92vw,700px)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {band && (
          <div className="absolute top-3 right-3">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${band.cls}`} title={tagTitle || undefined}>
              {tagLabel}
            </span>
          </div>
        )}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className={"px-2 py-0.5 rounded-full text-xs font-medium " + (isSell ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800")}>
              {isSell ? "SPRZEDAM" : "KUPIĘ"}
            </span>
            <h3 className="text-xl font-semibold">{listing.raceName}</h3>
          </div>
          <button className="px-2 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="mb-3">
          <div className="text-2xl font-semibold">{toPLN(listing.price)}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-700 mb-3">
          <div>
            <div className="text-gray-500">Data</div>
            <div className="whitespace-nowrap tabular-nums">
              {noWrapDate(listing.eventDate)}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Lokalizacja</div>
            <div>{listing.location || "—"}</div>
          </div>
          {distanceDisplay && (
            <div>
              <div className="text-gray-500">Dystans</div>
              <div>{distanceDisplay}</div>
            </div>
          )}
          <div>
            <div className="text-gray-500">Dodano</div>
            <div>{new Date(listing.createdAt).toLocaleString("pl-PL")}</div>
          </div>
        </div>
        {showProof && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 mb-4">
            {maskedBib && (
              <div>
                Numer startowy: <span className="font-semibold">{maskedBib}</span>
              </div>
            )}
            <Badge color={listingProofBadge.color}>{listingProofBadge.label}</Badge>
            {listingProofCheckedLabel && <div>Sprawdzono {listingProofCheckedLabel}</div>}
            {proofUrl && (
              <a href={proofUrl} target="_blank" rel="noreferrer" className="text-sky-600 underline">
                Lista startowa
              </a>
            )}
          </div>
        )}
        {listing.description && <p className="text-sm text-gray-800 mb-4">{listing.description}</p>}
        <div className="border-t pt-3">
          <div className="text-sm text-gray-500 mb-1">Kontakt</div>
          <div className="flex items-center gap-2">
            <span className="text-sm break-all">{listing.contact}</span>
            <button
              className="text-sm px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200"
              onClick={() => {
                navigator.clipboard?.writeText(listing.contact);
              }}
            >
              Kopiuj
            </button>
          </div>
          {canMessage && (
            <button
              className="mt-3 text-sm px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:opacity-90"
              onClick={() => {
                onMessage?.(listing);
                onClose();
              }}
            >
              Napisz wiadomość
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** @param {{
 * open: boolean,
 * onClose: () => void,
 * listing: Listing | null,
 * messages: ThreadMessage[],
 * loading: boolean,
 * error: string,
 * onSend: (body: string) => Promise<void>,
 * sending: boolean,
 * currentUserId?: string,
 * threadReady: boolean
 * }} props */
function ChatModal({ open, onClose, listing, messages, loading, error, onSend, sending, currentUserId, threadReady }) {
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText("");
    }
  }, [open, listing?.id]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  if (!open || !listing) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    try {
      await onSend(trimmed);
      setText("");
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[min(95vw,720px)] h-[min(90vh,640px)] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">Ogłoszenie</div>
            <div className="font-semibold">{listing.raceName}</div>
          </div>
          <button className="px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-neutral-50">
          {loading ? (
            <div className="text-sm text-gray-500">Ładuję wiadomości…</div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-gray-500">Brak wiadomości — napisz pierwszą.</div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender_id === currentUserId;
              const time = new Date(msg.created_at).toLocaleString("pl-PL", {
                hour: "2-digit",
                minute: "2-digit",
                day: "2-digit",
                month: "2-digit",
              });
              return (
                <div key={msg.id} className="flex flex-col">
                  <div className={clsx("max-w-[85%] px-4 py-2 rounded-2xl", isMine ? "self-end bg-neutral-900 text-white" : "self-start bg-white border")}>{msg.body}</div>
                  <div className={clsx("text-xs text-gray-500 mt-1", isMine ? "self-end" : "self-start")}>{time}</div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
        <div className="px-5 py-3 border-t space-y-2 bg-white">
          {error && <div className="text-sm text-rose-600">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-2">
            <textarea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
              placeholder="Twoja wiadomość…"
              disabled={sending || loading || !threadReady}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={sending || !text.trim() || loading || !threadReady}
                className="px-4 py-2 rounded-xl bg-neutral-900 text-white disabled:opacity-50"
              >
                {sending ? "Wysyłam…" : "Wyślij"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function copyPermalink(id) {
  try {
    const url = new URL(window.location.href);
    url.hash = id;
    navigator.clipboard?.writeText(url.toString());
    alert("Skopiowano link do schowka.");
  } catch (e) {
    console.error(e);
  }
}

function AuthModal({ open, onClose }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  if (!open) return null;

  function handleClose() {
    setMode("login");
    setEmail("");
    setPassword("");
    setMsg("");
    setLoading(false);
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    const action =
      mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await action;
    if (error) {
      setMsg(error.message);
      setLoading(false);
      return;
    }

    setMsg(mode === "login" ? "Zalogowano." : "Konto utworzone. Możesz się zalogować.");
    if (mode === "login") {
      handleClose();
      return;
    }

    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={handleClose}>
      <div
        className="bg-white rounded-2xl w-[min(92vw,420px)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{mode === "login" ? "Zaloguj się" : "Załóż konto"}</h3>
          <button className="px-2 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200" onClick={handleClose}>
            Zamknij
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="block text-sm text-gray-600 mb-1">E-mail</span>
            <input
              className="w-full px-3 py-2 rounded-xl border"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600 mb-1">Hasło</span>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-xl border"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {msg && <div className="text-sm text-gray-600">{msg}</div>}
          <button
            disabled={loading}
            className="w-full px-4 py-2 rounded-xl bg-neutral-900 text-white hover:opacity-90"
          >
            {loading ? "Przetwarzam…" : mode === "login" ? "Zaloguj się" : "Zarejestruj"}
          </button>
        </form>
        <div className="text-xs text-gray-500 mt-3">
          {mode === "login" ? (
            <button className="underline" onClick={() => setMode("register")}>
              Nie masz konta? Zarejestruj się
            </button>
          ) : (
            <button className="underline" onClick={() => setMode("login")}>
              Masz konto? Zaloguj się
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------- App -----------------------------

export default function App() {
  const [listings, setListings] = useState(/** @type {Listing[]} */([]));
  const [editingListing, setEditingListing] = useState/** @type {(Listing|null)} */(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(/** @type {"all"|ListingType} */("all"));
  const [distanceFilter, setDistanceFilter] = useState(/** @type {"all" | Distance} */("all"));
  const [sort, setSort] = useState("newest");
  const [ownershipFilter, setOwnershipFilter] = useState(/** @type {"all" | "mine"} */("all"));
  const [activeView, setActiveView] = useState(/** @type {"market" | "profile"} */("market"));
  const [profileTab, setProfileTab] = useState(/** @type {"info" | "listings" | "alerts"} */("listings"));
  const [selected, setSelected] = useState/** @type {(Listing|null)} */(null);
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatListing, setChatListing] = useState/** @type {(Listing|null)} */(null);
  const [chatThreadId, setChatThreadId] = useState(/** @type {string | null} */(null));
  const [chatMessages, setChatMessages] = useState(/** @type {ThreadMessage[]} */([]));
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [authorDisplayName, setAuthorDisplayName] = useState("");
  const [purgeMessage, setPurgeMessage] = useState("");
  const [alerts, setAlerts] = useState(/** @type {Alert[]} */([]));
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [editingAlert, setEditingAlert] = useState/** @type {(Alert|null)} */(null);
  const [notifications, setNotifications] = useState(/** @type {UserNotification[]} */([]));
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const notificationsRef = useRef(/** @type {(HTMLDivElement | null)} */(null));
  const [alertsMessage, setAlertsMessage] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [emailOptInSaving, setEmailOptInSaving] = useState(false);
  const currentUserId = session?.user?.id || null;
  const sessionEmail = session?.user?.email || "";
  const profileDisplayName =
    authorDisplayName ||
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    sessionEmail;
  const purgeMessageTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  const showPurgeFeedback = useCallback((count) => {
    if (!count) return;
    if (purgeMessageTimeoutRef.current) {
      clearTimeout(purgeMessageTimeoutRef.current);
    }
    setPurgeMessage(`Usunięto ${count} wygasłych ogłoszeń.`);
    purgeMessageTimeoutRef.current = setTimeout(() => {
      setPurgeMessage("");
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (purgeMessageTimeoutRef.current) {
        clearTimeout(purgeMessageTimeoutRef.current);
      }
    };
  }, []);

  const purgeExpiredListings = useCallback(
    (now = new Date()) => {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayStr = formatDateOnly(today);
      if (!todayStr) return 0;
      let removedCount = 0;
      setListings((prev) => {
        if (!prev.length) return prev;
        const filtered = prev.filter((listing) => {
          if (listingIsExpired(listing, todayStr)) {
            removedCount += 1;
            return false;
          }
          return true;
        });
        if (removedCount === 0) return prev;
        return filtered;
      });
      if (removedCount > 0) {
        showPurgeFeedback(removedCount);
      }
      return removedCount;
    },
    [showPurgeFeedback]
  );

  const refreshUnread = useCallback(async () => {
    if (!currentUserId) {
      setUnreadMessages(0);
      return;
    }
    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .neq("sender_id", currentUserId);
    if (error) {
      console.error(error);
      return;
    }
    setUnreadMessages(count ?? 0);
  }, [currentUserId]);

  const fetchAlerts = useCallback(async () => {
    if (!currentUserId) return;
    setAlertsLoading(true);
    setAlertsError("");
    try {
      const { data, error } = await supabase
        .from("alerts")
        .select(
          "id,user_id,mode,event_id,event_label,query_text,distance,max_price,send_email,is_active,created_at"
        )
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAlerts(data || []);
    } catch (err) {
      console.error(err);
      setAlerts([]);
      setAlertsError("Nie udało się pobrać alertów.");
    } finally {
      setAlertsLoading(false);
    }
  }, [currentUserId]);

  const fetchNotifications = useCallback(async () => {
    if (!currentUserId) return;
    setNotificationsLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,user_id,listing_id,channel,is_read,created_at,payload")
        .eq("user_id", currentUserId)
        .eq("channel", "inapp")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      setNotifications(data || []);
      const { count, error: countError } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", currentUserId)
        .eq("channel", "inapp")
        .eq("is_read", false);
      if (!countError) {
        setNotificationUnreadCount(count ?? 0);
      }
    } catch (err) {
      console.error(err);
      setNotifications([]);
      setNotificationUnreadCount(0);
    } finally {
      setNotificationsLoading(false);
    }
  }, [currentUserId]);

  const requestEmailOptIn = useCallback(
    async (next) => {
      if (!currentUserId) return false;
      setEmailOptInSaving(true);
      setAlertsMessage("");
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ email_notifications: next })
          .eq("id", currentUserId);
        if (error) throw error;
        setEmailOptIn(next);
        return true;
      } catch (err) {
        console.error(err);
        setAlertsMessage(err?.message || "Nie udało się zaktualizować zgody e-mail.");
        return false;
      } finally {
        setEmailOptInSaving(false);
      }
    },
    [currentUserId]
  );

  const handleAlertSubmit = useCallback(
    async (payload) => {
      if (!currentUserId) {
        const err = new Error("Musisz być zalogowany, aby tworzyć alerty.");
        setAlertsMessage(err.message);
        throw err;
      }
      setAlertSaving(true);
      setAlertsMessage("");
      const base = {
        user_id: currentUserId,
        mode: payload.mode,
        event_id: payload.event_id || null,
        event_label: payload.event_label || null,
        query_text: payload.query_text || null,
        distance: payload.distance || null,
        max_price: payload.max_price ?? null,
        send_email: payload.send_email,
        is_active: payload.is_active,
      };
      try {
        if (payload.id) {
          const { error } = await supabase.from("alerts").update(base).eq("id", payload.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("alerts").insert(base);
          if (error) throw error;
        }
        await fetchAlerts();
        setEditingAlert(null);
      } catch (err) {
        console.error(err);
        const message = err?.message || "Nie udało się zapisać alertu.";
        setAlertsMessage(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setAlertSaving(false);
      }
    },
    [currentUserId, fetchAlerts]
  );

  const handleToggleAlert = useCallback(
    async (alert, next) => {
      if (!currentUserId) return;
      setAlerts((prev) => prev.map((item) => (item.id === alert.id ? { ...item, is_active: next } : item)));
      const { error } = await supabase.from("alerts").update({ is_active: next }).eq("id", alert.id);
      if (error) {
        console.error(error);
        setAlertsMessage("Nie udało się zaktualizować alertu.");
        fetchAlerts();
      }
    },
    [currentUserId, fetchAlerts]
  );

  const handleDeleteAlert = useCallback(
    async (alert) => {
      if (!currentUserId) return;
      if (!confirm("Na pewno usunąć ten alert?")) return;
      try {
        const { error } = await supabase.from("alerts").delete().eq("id", alert.id);
        if (error) throw error;
        setAlerts((prev) => prev.filter((item) => item.id !== alert.id));
        if (editingAlert?.id === alert.id) {
          setEditingAlert(null);
        }
      } catch (err) {
        console.error(err);
        setAlertsMessage(err?.message || "Nie udało się usunąć alertu.");
      }
    },
    [currentUserId, editingAlert]
  );

  const markNotificationRead = useCallback(
    async (notification) => {
      if (!currentUserId || notification.channel !== "inapp" || notification.is_read) return;
      setNotifications((prev) => prev.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item)));
      setNotificationUnreadCount((prev) => (prev > 0 ? prev - 1 : 0));
      const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", notification.id);
      if (error) {
        console.error(error);
        fetchNotifications();
      }
    },
    [currentUserId, fetchNotifications]
  );

  const publishListing = useCallback(async (listing) => {
    try {
      await fetch("/api/alerts-fanout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing }),
      });
    } catch (err) {
      console.error("Nie udało się opublikować ogłoszenia do alertów", err);
    }
  }, []);

  const markThreadMessagesRead = useCallback(
    async (threadId) => {
      if (!currentUserId || !threadId) return;
      const { error } = await supabase.rpc("mark_thread_messages_read", { thread_id_input: threadId });
      if (error) {
        console.error(error);
        return;
      }
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.thread_id === threadId && msg.sender_id !== currentUserId && !msg.read_at
            ? { ...msg, read_at: new Date().toISOString() }
            : msg
        )
      );
      refreshUnread();
    },
    [currentUserId, refreshUnread]
  );

  useEffect(() => {
    const l = loadListings();
    setListings(l);

    const timeout = setTimeout(() => {
      purgeExpiredListings();
    }, 0);

    // Po wejściu z kotwicą #id przewiń do ogłoszenia
    const hash = window.location.hash?.slice(1);
    if (hash) {
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }

    return () => {
      clearTimeout(timeout);
    };
  }, [purgeExpiredListings]);

  useEffect(() => {
    saveListings(listings);
  }, [listings]);

  useEffect(() => {
    const interval = setInterval(() => {
      purgeExpiredListings();
    }, 1000 * 60 * 60 * 6);
    return () => clearInterval(interval);
  }, [purgeExpiredListings]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setAuthorDisplayName("");
      setActiveView("market");
      setProfileTab("listings");
      setAlerts([]);
      setAlertsError("");
      setEditingAlert(null);
      setEmailOptIn(false);
      setNotifications([]);
      setNotificationUnreadCount(0);
      setNotificationsOpen(false);
      return;
    }
    const fallback =
      session.user?.user_metadata?.full_name ||
      session.user?.user_metadata?.name ||
      session.user?.email ||
      "";
    setAuthorDisplayName(fallback);
    let ignore = false;
    async function loadProfile() {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("display_name,email_notifications")
          .eq("id", session.user.id)
          .maybeSingle();
        if (ignore) return;
        if (error) {
          if (error.code !== "PGRST116") {
            console.error(error);
          }
          return;
        }
        if (data?.display_name) {
          setAuthorDisplayName(data.display_name);
        }
        if (typeof data?.email_notifications === "boolean") {
          setEmailOptIn(data.email_notifications);
        }
      } catch (err) {
        if (!ignore) {
          console.error(err);
        }
      }
    }
    loadProfile();
    return () => {
      ignore = true;
    };
  }, [session]);

  useEffect(() => {
    if (!currentUserId) {
      setUnreadMessages(0);
      return;
    }
    refreshUnread();
  }, [currentUserId, refreshUnread]);

  useEffect(() => {
    if (!currentUserId) {
      setOwnershipFilter("all");
      setEditingListing(null);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchAlerts();
    fetchNotifications();
  }, [currentUserId, fetchAlerts, fetchNotifications]);

  useEffect(() => {
    if (!notificationsOpen) return;
    function handleClickOutside(event) {
      if (!notificationsRef.current) return;
      if (!notificationsRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    const channel = supabase
      .channel(`notifications-${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentUserId}` },
        (payload) => {
          if (payload?.new?.channel !== "inapp") return;
          setNotifications((prev) => {
            const next = [payload.new, ...prev];
            return next.slice(0, 20);
          });
          setNotificationUnreadCount((prev) => prev + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${currentUserId}` },
        (payload) => {
          setNotifications((prev) => prev.map((item) => (item.id === payload.new.id ? { ...item, ...payload.new } : item)));
          if (
            payload?.old?.channel === "inapp" &&
            payload?.old?.is_read === false &&
            payload?.new?.is_read === true
          ) {
            setNotificationUnreadCount((prev) => (prev > 0 ? prev - 1 : 0));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (selected && !listings.some((l) => l.id === selected.id)) {
      setSelected(null);
    }
  }, [listings, selected]);

  useEffect(() => {
    if (editingListing && !listings.some((l) => l.id === editingListing.id)) {
      setEditingListing(null);
    }
  }, [listings, editingListing]);

  const openChat = useCallback(
    async (listing) => {
      if (!session || !currentUserId) {
        setAuthOpen(true);
        return;
      }

      setChatListing(listing);
      setChatMessages([]);
      setChatThreadId(null);
      setChatError("");
      setChatOpen(true);

      const ownerId = getListingOwnerId(listing);
      if (!ownerId) {
        setChatLoading(false);
        setChatError("Nie znaleziono właściciela ogłoszenia.");
        return;
      }
      if (ownerId === currentUserId) {
        setChatLoading(false);
        setChatError("To Twoje ogłoszenie — nie możesz wysłać wiadomości do siebie.");
        return;
      }

      setChatLoading(true);

      try {
        const { data: threadsData, error } = await supabase
          .from("threads")
          .select("id, thread_participants ( user_id )")
          .eq("listing_id", listing.id);
        if (error) throw error;

        let threadId = null;
        if (Array.isArray(threadsData)) {
          for (const thread of threadsData) {
            const participants = (thread.thread_participants || []).map((p) => p.user_id);
            if (participants.includes(currentUserId) && participants.includes(ownerId)) {
              threadId = thread.id;
              break;
            }
          }
        }

        if (!threadId) {
          const { data: newThread, error: threadError } = await supabase
            .from("threads")
            .insert({ listing_id: listing.id })
            .select()
            .single();
          if (threadError) throw threadError;

          const { error: selfError } = await supabase
            .from("thread_participants")
            .insert({ thread_id: newThread.id, user_id: currentUserId });
          if (selfError && selfError.code !== "23505") throw selfError;

          const { error: otherError } = await supabase
            .from("thread_participants")
            .insert({ thread_id: newThread.id, user_id: ownerId });
          if (otherError && otherError.code !== "23505") throw otherError;

          threadId = newThread.id;
        }

        setChatThreadId(threadId);
      } catch (err) {
        console.error(err);
        setChatError(err.message || "Nie udało się otworzyć czatu.");
        setChatThreadId(null);
        setChatLoading(false);
      }
    },
    [session, currentUserId]
  );

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatListing(null);
    setChatThreadId(null);
    setChatMessages([]);
    setChatError("");
    setChatLoading(false);
    setChatSending(false);
  }, []);

  const sendChatMessage = useCallback(
    async (body) => {
      if (!chatThreadId || !currentUserId) {
        throw new Error("Brak aktywnego wątku czatu.");
      }
      setChatError("");
      setChatSending(true);
      try {
        const { data, error } = await supabase
          .from("messages")
          .insert({ thread_id: chatThreadId, sender_id: currentUserId, body })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          setChatMessages((prev) => {
            if (prev.some((msg) => msg.id === data.id)) return prev;
            return [...prev, /** @type {ThreadMessage} */ (data)];
          });
        }
      } catch (err) {
        setChatError(err.message || "Nie udało się wysłać wiadomości.");
        throw err;
      } finally {
        setChatSending(false);
      }
    },
    [chatThreadId, currentUserId]
  );

  useEffect(() => {
    if (!currentUserId && chatOpen) {
      closeChat();
    }
  }, [currentUserId, chatOpen, closeChat]);

  useEffect(() => {
    if (!chatThreadId || !chatOpen) return;
    let active = true;
    setChatLoading(true);
    supabase
      .from("messages")
      .select("*")
      .eq("thread_id", chatThreadId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setChatError(error.message);
        } else {
          setChatMessages((data || []).map((m) => /** @type {ThreadMessage} */ (m)));
          setChatError("");
          markThreadMessagesRead(chatThreadId);
        }
        setChatLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chatThreadId, chatOpen, markThreadMessagesRead]);

  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase
      .channel(`messages-user-${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const newMessage = /** @type {ThreadMessage} */ (payload.new);
          if (chatOpen && chatThreadId === newMessage.thread_id) {
            setChatMessages((prev) => {
              if (prev.some((msg) => msg.id === newMessage.id)) return prev;
              return [...prev, newMessage];
            });
            if (newMessage.sender_id !== currentUserId) {
              markThreadMessagesRead(newMessage.thread_id);
            }
          } else {
            refreshUnread();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const updated = /** @type {ThreadMessage} */ (payload.new);
          if (chatOpen && chatThreadId === updated.thread_id) {
            setChatMessages((prev) => prev.map((msg) => (msg.id === updated.id ? { ...msg, ...updated } : msg)));
          }
          refreshUnread();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, chatOpen, chatThreadId, markThreadMessagesRead, refreshUnread]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = listings.filter((l) => {
      const okType = typeFilter === "all" ? true : l.type === typeFilter;
      const okQuery = !q ||
        l.raceName.toLowerCase().includes(q) ||
        (l.location || "").toLowerCase().includes(q) ||
        (l.description || "").toLowerCase().includes(q);
      const okDistance = (() => {
        if (distanceFilter === "all") return true;
        const listingDistanceLabel = (l.distance || inferDistance(l.raceName) || "").trim();
        const listingKm = Number.isFinite(l.distanceKm)
          ? l.distanceKm
          : parseDistanceToKm(listingDistanceLabel || l.distance);
        const filterKm = parseDistanceToKm(distanceFilter);
        const listingBand = distanceBand(listingKm);
        const filterBand = distanceBand(filterKm);
        if (listingBand && filterBand && listingBand.key === filterBand.key) return true;
        if (listingDistanceLabel && distanceFilter) {
          return listingDistanceLabel.toLowerCase() === distanceFilter.trim().toLowerCase();
        }
        if (Number.isFinite(listingKm) && Number.isFinite(filterKm)) {
          return Math.abs(listingKm - filterKm) < 0.25;
        }
        return false;
      })();
      return okType && okQuery && okDistance;
    });

    if (ownershipFilter === "mine" && currentUserId) {
      arr = arr.filter((l) => getListingOwnerId(l) === currentUserId);
    }

    if (sort === "newest") arr = arr.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "priceAsc") arr = arr.sort((a, b) => a.price - b.price);
    if (sort === "priceDesc") arr = arr.sort((a, b) => b.price - a.price);

    return arr;
  }, [listings, query, typeFilter, distanceFilter, sort, ownershipFilter, currentUserId]);

  const myListings = useMemo(() => {
    if (!currentUserId) return [];
    return listings.filter((l) => getListingOwnerId(l) === currentUserId);
  }, [listings, currentUserId]);

  function addListing(l) {
    if (!currentUserId || !session) {
      return;
    }
    if (editingListing) {
      const ownerId = getListingOwnerId(editingListing);
      if (ownerId && ownerId !== currentUserId) {
        setEditingListing(null);
        return;
      }
    }
    const fallbackName =
      authorDisplayName ||
      session.user?.user_metadata?.full_name ||
      session.user?.user_metadata?.name ||
      session.user?.email ||
      "";
    const payload = {
      ...l,
      ownerId: currentUserId,
      owner_id: l.owner_id || currentUserId,
      author_display_name: l.author_display_name || fallbackName,
    };
    setListings((prev) => {
      const idx = prev.findIndex((item) => item.id === payload.id);
      if (idx >= 0) {
        const existing = prev[idx];
        const ownerId = getListingOwnerId(existing);
        if (ownerId && ownerId !== currentUserId) {
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...existing, ...payload };
        return next;
      }
      return [payload, ...prev];
    });
    setEditingListing(null);
    purgeExpiredListings();
    publishListing(payload);
  }

  function deleteListing(id) {
    const target = listings.find((x) => x.id === id);
    if (!target) return;
    const ownerId = getListingOwnerId(target);
    if (!currentUserId || ownerId !== currentUserId) return;
    if (!confirm("Na pewno usunąć to ogłoszenie?")) return;
    setListings((prev) => prev.filter((x) => x.id !== id));
    if (selected?.id === id) setSelected(null);
    if (editingListing?.id === id) setEditingListing(null);
  }

  const startEditListing = useCallback(
    (listing) => {
      if (!currentUserId) return;
      if (getListingOwnerId(listing) !== currentUserId) return;
      setActiveView("market");
      setProfileTab("listings");
      setEditingListing(listing);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [currentUserId, setActiveView, setProfileTab]
  );

  function exportCSV() {
    const headers = ["id","typ","bieg","data","lokalizacja","cena","kontakt","opis","dodano"];
    const rows = listings.map((l) => [
      l.id,
      l.type,
      l.raceName,
      l.eventDate || "",
      l.location || "",
      l.price,
      l.contact,
      (l.description || "").replace(/\n/g, " "),
      new Date(l.createdAt).toISOString()
    ]);

    // Poprawne „escape’owanie” wartości do CSV (średnik, cudzysłów, nowe linie)
    const escapeCSV = (val) => {
      const s = String(val);
      if (/[;"\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const csv = [
      headers.join(";"),
      ...rows.map((r) => r.map(escapeCSV).join(";"))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ogloszenia.csv";
    a.click();
    URL.revokeObjectURL(url);
  }


  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-neutral-900 text-white grid place-items-center text-lg">🏃‍♂️</div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold leading-tight">Marketplace pakietów startowych</h1>
              <p className="text-sm text-gray-600">Dodawaj ogłoszenia: sprzedaj i kup pakiety na biegi</p>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setActiveView("market")}
              className={clsx(
                "px-3 py-1.5 rounded-xl border",
                activeView === "market" ? "bg-neutral-900 text-white border-neutral-900" : "bg-white hover:bg-neutral-50"
              )}
            >
              Ogłoszenia
            </button>
            {session && (
              <button
                type="button"
                onClick={() => {
                  setProfileTab("listings");
                  setActiveView("profile");
                }}
                className={clsx(
                  "px-3 py-1.5 rounded-xl border",
                  activeView === "profile" ? "bg-neutral-900 text-white border-neutral-900" : "bg-white hover:bg-neutral-50"
                )}
              >
                Mój profil
              </button>
            )}
          </nav>
          <div className="md:ml-auto flex items-center gap-2">
            <button onClick={exportCSV} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-neutral-50">Eksportuj CSV</button>
            {session ? (
              <div className="flex items-center gap-2">
                <div className="relative" ref={notificationsRef}>
                  <button
                    type="button"
                    onClick={() => setNotificationsOpen((open) => !open)}
                    className={clsx(
                      "px-2 py-1.5 rounded-xl border flex items-center gap-1 text-sm",
                      notificationUnreadCount
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-white hover:bg-neutral-50"
                    )}
                  >
                    <span aria-hidden>🔔</span>
                    <span className="tabular-nums">{notificationUnreadCount}</span>
                  </button>
                  {notificationsOpen && (
                    <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border bg-white shadow-xl text-sm z-20">
                      <div className="px-4 py-2 border-b font-semibold text-gray-800">Powiadomienia</div>
                      {notificationsLoading ? (
                        <div className="px-4 py-3 text-gray-500">Ładuję…</div>
                      ) : notifications.length === 0 ? (
                        <div className="px-4 py-3 text-gray-500">Brak powiadomień.</div>
                      ) : (
                        notifications.map((notif) => {
                          const listing = notif?.payload?.listing || {};
                          const typeLabel = listing?.type === "sell" ? "Sprzedam" : listing?.type === "buy" ? "Kupię" : "Ogłoszenie";
                          const time = formatRelativeTime(notif.created_at);
                          const priceLabel = typeof listing?.price === "number" ? toPLN(listing.price) : "";
                          const localListing = listings.find((l) => l.id === notif.listing_id);
                          return (
                            <button
                              key={notif.id}
                              type="button"
                              onClick={() => {
                                markNotificationRead(notif);
                                if (localListing) {
                                  setSelected(localListing);
                                  setActiveView("market");
                                }
                                setNotificationsOpen(false);
                              }}
                              className={clsx(
                                "w-full text-left px-4 py-3 border-b last:border-b-0",
                                notif.is_read ? "bg-white" : "bg-neutral-50"
                              )}
                            >
                              <div className="font-medium text-gray-900">{listing?.race_name || "Nowe ogłoszenie"}</div>
                              <div className="text-xs text-gray-600">
                                {typeLabel}
                                {priceLabel ? ` • ${priceLabel}` : ""}
                              </div>
                              {time && <div className="text-xs text-gray-400">{time}</div>}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                <span
                  className={clsx(
                    "text-sm px-2 py-1 rounded-xl border flex items-center gap-1",
                    unreadMessages
                      ? "bg-sky-50 text-sky-700 border-sky-200"
                      : "bg-neutral-100 text-gray-600 border-neutral-200"
                  )}
                >
                  <span aria-hidden>📨</span>
                  <span className="tabular-nums">{unreadMessages}</span>
                </span>
                <span className="text-sm text-gray-600">{session.user.email}</span>
                <button
                  className="px-3 py-1.5 rounded-xl border bg-white hover:bg-neutral-50"
                  onClick={() => supabase.auth.signOut()}
                >
                  Wyloguj
                </button>
              </div>
            ) : (
              <button
                className="px-3 py-1.5 rounded-xl border bg-white hover:bg-neutral-50"
                onClick={() => setAuthOpen(true)}
              >
                Zaloguj się
              </button>
            )}
          </div>
        </div>
      </header>

      {activeView === "market" ? (
        <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <Section
              title="Dodaj ogłoszenie"
              right={<Badge>{session ? "zalogowano" : "konto wymagane"}</Badge>}
            >
              {session ? (
                <ListingForm
                  onAdd={addListing}
                  ownerId={session.user.id}
                  authorDisplayName={authorDisplayName}
                  editingListing={editingListing}
                  onCancelEdit={() => setEditingListing(null)}
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">
                    Zaloguj się, aby dodać ogłoszenie. Ogłoszenia możesz przeglądać bez logowania.
                  </p>
                  <button
                    className="px-4 py-2 rounded-xl bg-neutral-900 text-white hover:opacity-90"
                    onClick={() => setAuthOpen(true)}
                  >
                    Zaloguj się / Zarejestruj
                  </button>
                </div>
              )}
            </Section>
            <Section title="Wskazówki" right={null}>
              <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Sprawdź, czy organizator biegu dopuszcza oficjalny transfer pakietu.</li>
                <li>Nie publikuj danych wrażliwych. Korzystaj z czatu/e-maila do ustaleń.</li>
                <li>Unikaj przedpłat bez zabezpieczenia. Wybierz odbiór osobisty lub bezpieczne płatności.</li>
              </ul>
            </Section>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <Section title="Ogłoszenia" right={null}>
              <div className="mb-4 flex items-center gap-2">
                <input value={query} onChange={(e) => setQuery(e.target.value)} className="px-3 py-2 rounded-xl border w-48" placeholder="Szukaj…" />
                <select value={typeFilter} onChange={(e) => setTypeFilter(/** @type any */(e.target.value))} className="px-3 py-2 rounded-xl border">
                  <option value="all">Wszystkie</option>
                  <option value="sell">Sprzedam</option>
                  <option value="buy">Kupię</option>
                </select>
                <select
                  value={distanceFilter}
                  onChange={(e) => setDistanceFilter(/** @type {"all" | Distance} */(e.target.value))}
                  className="px-3 py-2 rounded-xl border"
                >
                  <option value="all">Wszystkie dystanse</option>
                  {DISTANCES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="px-3 py-2 rounded-xl border">
                  <option value="newest">Najnowsze</option>
                  <option value="priceAsc">Cena rosnąco</option>
                  <option value="priceDesc">Cena malejąco</option>
                </select>
                {session && (
                  <div className="flex rounded-xl border overflow-hidden text-sm">
                    <button
                      type="button"
                      onClick={() => setOwnershipFilter("all")}
                      className={clsx(
                        "px-3 py-2",
                        ownershipFilter === "all" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
                      )}
                    >
                      Wszystkie
                    </button>
                    <button
                      type="button"
                      onClick={() => setOwnershipFilter("mine")}
                      className={clsx(
                        "px-3 py-2 border-l",
                        ownershipFilter === "mine" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
                      )}
                    >
                      Moje
                    </button>
                  </div>
                )}
              </div>
              {filtered.length === 0 ? (
                <div className="text-sm text-gray-600">Brak ogłoszeń dla wybranych filtrów.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filtered.map((l) => (
                    <ListingCard
                      key={l.id}
                      listing={l}
                      onDelete={deleteListing}
                      onOpen={setSelected}
                      onMessage={openChat}
                      currentUserId={currentUserId || undefined}
                      onEdit={startEditListing}
                    />
                  ))}
                </div>
              )}
            </Section>
          </div>
        </main>
      ) : (
        <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          {session ? (
            <>
              <Section
                title="Mój profil"
                right={
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("market");
                      setEditingListing(null);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="px-3 py-1.5 rounded-xl border bg-white hover:bg-neutral-50 text-sm"
                  >
                    Dodaj ogłoszenie
                  </button>
                }
              >
                <div className="text-sm text-gray-700 space-y-2">
                  <div>
                    <div className="text-xs uppercase text-gray-500">Nazwa wyświetlana</div>
                    <div className="text-base font-semibold text-gray-900">{profileDisplayName || "Brak danych"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-gray-500">Adres e-mail</div>
                    <div className="text-sm font-medium text-gray-900">{sessionEmail}</div>
                  </div>
                  <p className="text-xs text-gray-500">
                    Dane pochodzą z Twojego profilu. Zmienisz je w ustawieniach konta Supabase.
                  </p>
                </div>
              </Section>
              <Section
                title="Zakładki profilu"
                right={
                  <div className="flex rounded-xl border overflow-hidden text-sm">
                    <button
                      type="button"
                      onClick={() => setProfileTab("info")}
                      className={clsx(
                        "px-3 py-1.5",
                        profileTab === "info" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
                      )}
                    >
                      Dane konta
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileTab("listings")}
                      className={clsx(
                        "px-3 py-1.5 border-l",
                        profileTab === "listings" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
                      )}
                    >
                      Moje ogłoszenia
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileTab("alerts")}
                      className={clsx(
                        "px-3 py-1.5 border-l",
                        profileTab === "alerts" ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
                      )}
                    >
                      Alerty
                    </button>
                  </div>
                }
              >
                {profileTab === "info" && (
                  <div className="text-sm text-gray-700 space-y-2">
                    <p>Możesz kontaktować się z innymi użytkownikami bezpośrednio z kart ogłoszeń.</p>
                    <p>
                      W zakładce „Moje ogłoszenia” znajdziesz swoje aktywne wpisy wraz z opcjami edycji i usuwania.
                    </p>
                  </div>
                )}
                {profileTab === "listings" && (
                  <div className="space-y-4">
                    {myListings.length === 0 ? (
                      <div className="text-sm text-gray-600">
                        Nie masz jeszcze żadnych ogłoszeń. Użyj przycisku „Dodaj ogłoszenie”, aby opublikować pierwszy wpis.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {myListings.map((l) => (
                          <ListingCard
                            key={l.id}
                            listing={l}
                            onDelete={deleteListing}
                            onOpen={setSelected}
                            onMessage={openChat}
                            currentUserId={currentUserId || undefined}
                            onEdit={startEditListing}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {profileTab === "alerts" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-sm">
                      <div>
                        <div className="font-medium text-gray-900">Powiadomienia e-mail</div>
                        <div className="text-xs text-gray-500">
                          {emailOptIn
                            ? "Dla alertów z zaznaczoną opcją wyślemy e-mail."
                            : "Włącz, aby otrzymywać e-maile o nowych ogłoszeniach."}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => requestEmailOptIn(!emailOptIn)}
                        disabled={emailOptInSaving}
                        className={clsx(
                          "px-3 py-1.5 rounded-xl border text-sm",
                          emailOptIn ? "bg-white hover:bg-neutral-50" : "bg-neutral-900 text-white",
                          emailOptInSaving && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {emailOptIn ? "Wyłącz" : "Włącz"}
                      </button>
                    </div>
                    {alertsMessage && <div className="text-sm text-rose-600">{alertsMessage}</div>}
                    <AlertForm
                      onSubmit={handleAlertSubmit}
                      saving={alertSaving}
                      editingAlert={editingAlert}
                      onCancelEdit={() => setEditingAlert(null)}
                      emailOptIn={emailOptIn}
                      requestEmailOptIn={requestEmailOptIn}
                    />
                    <AlertsList
                      alerts={alerts}
                      loading={alertsLoading}
                      onToggle={handleToggleAlert}
                      onDelete={handleDeleteAlert}
                      onEdit={(alert) => {
                        setEditingAlert(alert);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      emailOptIn={emailOptIn}
                    />
                    {alertsError && <div className="text-sm text-rose-600">{alertsError}</div>}
                  </div>
                )}
              </Section>
            </>
          ) : (
            <Section title="Wymagane logowanie" right={null}>
              <div className="space-y-3">
                <p className="text-sm text-gray-700">Zaloguj się, aby zobaczyć swój profil i zarządzać ogłoszeniami.</p>
                <button
                  className="px-4 py-2 rounded-xl bg-neutral-900 text-white hover:opacity-90"
                  onClick={() => setAuthOpen(true)}
                >
                  Zaloguj się / Zarejestruj
                </button>
              </div>
            </Section>
          )}
        </main>
      )}

      <DetailModal
        listing={selected}
        onClose={() => setSelected(null)}
        onMessage={openChat}
        currentUserId={currentUserId || undefined}
      />

      <ChatModal
        open={chatOpen}
        onClose={closeChat}
        listing={chatListing}
        messages={chatMessages}
        loading={chatLoading}
        error={chatError}
        onSend={sendChatMessage}
        sending={chatSending}
        currentUserId={currentUserId || undefined}
        threadReady={!!chatThreadId}
      />

      <footer className="max-w-6xl mx-auto px-4 pb-12 pt-2 text-xs text-gray-500">
        <p>
          Uwaga prawna: wiele wydarzeń pozwala na oficjalny transfer pakietu w określonych terminach — publikując ogłoszenie,
          upewnij się, że działasz zgodnie z regulaminem organizatora.
        </p>
      </footer>

      {purgeMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-neutral-900 text-white shadow-lg text-sm"
        >
          {purgeMessage}
        </div>
      )}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
