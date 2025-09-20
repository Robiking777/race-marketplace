import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

// ----------------------------- Typy -----------------------------
/** @typedef {"sell" | "buy"} ListingType */

const DISTANCES = /** @type {const} */ (
  ["5 km", "10 km", "15 km", "Półmaraton", "Maraton", "Ultramaraton", "50 km", "100 km"]
);

const DISTANCE_SUGGESTIONS = /** @type {const} */ ([
  "5 km",
  "10 km",
  "15 km",
  "Półmaraton",
  "Maraton",
  "Ultramaraton",
  "50 km",
  "100 km",
]);

const CONTACT_KINDS = /** @type {const} */ (["Pomysł", "Problem", "Błąd", "Współpraca"]);

/** @typedef {string} Distance */

/**
 * @typedef {Object} Listing
 * @property {string} id
 * @property {ListingType} type
 * @property {string} raceName
 * @property {string} [eventDate]
 * @property {string} [location]
 * @property {number} price
 * @property {string} [currency]
  * @property {string} contact
  * @property {string} [description]
  * @property {Distance} [distance]
 * @property {string[]} [distances]
 * @property {number} [distanceKm]
 * @property {number} [edition_id]
 * @property {string} [editionEventName]
 * @property {number} [editionYear]
 * @property {string} [editionStartDate]
 * @property {string} [bib]
 * @property {"none" | "verified" | "not_found" | "error"} [proof_status]
 * @property {string} [proof_source_url]
 * @property {string} [proof_checked_at]
 * @property {number} [transferFee]
 * @property {string} [transferFeeCurrency]
 * @property {string} [transferDeadline]
 * @property {number} createdAt // epoch ms
 * @property {string} [ownerId]
 * @property {string} [owner_id]
 * @property {string} [user_id]
 * @property {string} [author_display_name]
 */

/**
 * @typedef {Object} DirectMessage
 * @property {number} id
 * @property {string} from_user
 * @property {string} to_user
 * @property {string | null} [listing_id]
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

function toCurrency(v, currency = "PLN") {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

function toPLN(n) {
  return toCurrency(n, "PLN");
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
  if (lower.includes("15")) return "15 km";
  if (lower.includes("10")) return "10 km";
  if (lower.includes("5")) return "5 km";
  return undefined;
}

function sanitizeDistances(distances) {
  if (!Array.isArray(distances)) return [];
  const seen = new Set();
  const result = [];
  for (const item of distances) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function parseDistanceToKm(value) {
  if (!value) return NaN;
  const str = String(value).trim().toLowerCase();
  if (!str) return NaN;
  if (str.includes("pół") || str.includes("pol") || str.includes("half")) return 21.0975;
  if (str.includes("ultra") && !/\d/.test(str)) return NaN;
  if (str.includes("marat") && !str.includes("pół") && !str.includes("half")) return 42.195;
  const match = str.match(/(\d+(?:[\.,]\d+)?)\s*(km|kilom(?:etr(?:ów|ow|y)?|eter)?)/);
  if (match) {
    const numeric = Number.parseFloat(match[1].replace(",", "."));
    return Number.isFinite(numeric) ? numeric : NaN;
  }
  return NaN;
}

function normalizeListing(listing) {
  if (!listing || typeof listing !== "object") return listing;
  const next = { ...listing };
  let changed = false;

  const inferred = inferDistance(next.raceName || "");
  const baseDistance = typeof next.distance === "string" ? next.distance.trim() : "";
  let distances = sanitizeDistances(next.distances);

  if (!distances.length) {
    if (baseDistance) {
      distances = [baseDistance];
    } else if (inferred) {
      distances = [inferred];
    }
  }

  if (baseDistance && (!distances.length || distances[0] !== baseDistance)) {
    distances = [baseDistance, ...distances.filter((d) => d !== baseDistance)];
  }

  if (!distances.length && inferred) {
    distances = [inferred];
  }

  if (!arraysShallowEqual(next.distances, distances)) {
    next.distances = distances;
    changed = true;
  }

  const primary = distances[0] || "";
  if (primary) {
    if (next.distance !== primary) {
      next.distance = primary;
      changed = true;
    }
  } else if (next.distance) {
    delete next.distance;
    changed = true;
  }

  const km = parseDistanceToKm(primary);
  if (Number.isFinite(km)) {
    if (next.distanceKm !== km) {
      next.distanceKm = km;
      changed = true;
    }
  } else if (typeof next.distanceKm === "number") {
    delete next.distanceKm;
    changed = true;
  }

  return changed ? next : listing;
}

function arraysShallowEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Array.isArray(a) === Array.isArray(b) && (!Array.isArray(a) || a.length === 0) && (!Array.isArray(b) || b.length === 0);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getListingDistances(listing) {
  if (!listing || typeof listing !== "object") return [];
  let distances = sanitizeDistances(listing.distances);
  const trimmedPrimary = typeof listing.distance === "string" ? listing.distance.trim() : "";
  if (trimmedPrimary) {
    const lower = trimmedPrimary.toLowerCase();
    if (!distances.length || (distances[0] && distances[0].toLowerCase() !== lower)) {
      distances = [trimmedPrimary, ...distances.filter((item) => item.toLowerCase() !== lower)];
    }
  }
  if (!distances.length) {
    const inferred = inferDistance(listing.raceName || "");
    if (inferred) {
      distances = [inferred];
    }
  }
  return distances;
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
    const normalized = normalizeListing(l);
    if (normalized !== l) changed = true;
    return normalized;
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
  const normalized = data.map((item) => normalizeListing(item));
  saveListings(normalized);
  return normalized;
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

/** @param {{ onAdd: (l: Listing)=>void, ownerId?: string, authorDisplayName?: string, editingListing?: Listing | null, onCancelEdit?: ()=>void, onOpenTerms?: () => void }} props */
function ListingForm({ onAdd, ownerId, authorDisplayName, editingListing = null, onCancelEdit, onOpenTerms }) {
  /** @type {[ListingType, Function]} */
  const [type, setType] = useState(/** @type {ListingType} */("sell"));
  const [raceName, setRaceName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [distance, setDistance] = useState("");
  const [distancesList, setDistancesList] = useState(/** @type {string[]} */([]));
  const [distanceInput, setDistanceInput] = useState("");
  const [price, setPrice] = useState("");
  const [transferFee, setTransferFee] = useState("");
  const [transferFeeCurrency, setTransferFeeCurrency] = useState("PLN");
  const [transferDeadline, setTransferDeadline] = useState("");
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

  function arrangeDistances(list, primary) {
    const normalized = sanitizeDistances(list);
    const trimmedPrimary = typeof primary === "string" ? primary.trim() : "";
    if (!trimmedPrimary) return normalized;
    const lower = trimmedPrimary.toLowerCase();
    const filtered = normalized.filter((item) => item.toLowerCase() !== lower);
    return [trimmedPrimary, ...filtered];
  }

  function applyDistances(list, primary) {
    const arranged = arrangeDistances(list, primary);
    setDistancesList(arranged);
    setDistance(arranged[0] || "");
    return arranged;
  }

  function handleSelectEdition(item) {
    setSelectedEdition(item);
    setRaceName(item.event_name || "");
    setSearchTerm("");
    setSuggestions([]);
    setShowSuggestions(false);
    setEventDate(item.start_date || "");
    if (Array.isArray(item.distances) && item.distances.length) {
      const normalized = sanitizeDistances(item.distances);
      if (normalized.length) {
        const trimmedCurrent = distance.trim();
        const currentLower = trimmedCurrent.toLowerCase();
        const includesCurrent = trimmedCurrent
          ? normalized.some((value) => value.toLowerCase() === currentLower)
          : false;
        const recognized = normalized.find((value) => DISTANCES.includes(value));
        const primary =
          recognized || (includesCurrent ? trimmedCurrent : normalized[0] || trimmedCurrent);
        applyDistances(normalized, primary);
      }
    }
  }

  function reset() {
    setRaceName("");
    setEventDate("");
    setLocation("");
    setDistance("");
    setDistancesList([]);
    setDistanceInput("");
    setPrice("");
    setTransferFee("");
    setTransferFeeCurrency("PLN");
    setTransferDeadline("");
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
    const normalizedDistances = sanitizeDistances(
      Array.isArray(editingListing.distances) && editingListing.distances.length
        ? editingListing.distances
        : editingListing.distance
        ? [editingListing.distance]
        : []
    );
    const primaryDistance = editingListing.distance || normalizedDistances[0] || "";
    applyDistances(normalizedDistances, primaryDistance);
    setDistanceInput("");
    setPrice(
      typeof editingListing.price === "number"
        ? String(editingListing.price)
        : editingListing.price
        ? String(editingListing.price)
        : ""
    );
    setTransferFee(
      typeof editingListing.transferFee === "number" && Number.isFinite(editingListing.transferFee)
        ? String(editingListing.transferFee)
        : ""
    );
    setTransferFeeCurrency(editingListing.transferFeeCurrency || "PLN");
    setTransferDeadline(extractDateString(editingListing.transferDeadline) || "");
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
    const normalized = sanitizeDistances(distancesList);
    if (!normalized.length) return "Dodaj co najmniej jeden dystans biegu.";
    if (!price || isNaN(Number(price)) || Number(price) <= 0) return "Podaj poprawną kwotę.";
    if (transferFee.trim()) {
      const parsedFee = Number(transferFee);
      if (!Number.isFinite(parsedFee) || parsedFee < 0) {
        return "Podaj poprawną opłatę (nie mniejszą niż 0).";
      }
    }
    if (!contact.trim()) return "Podaj kontakt (e-mail/telefon).";
    if (!agree) return "Musisz zaakceptować Regulamin, aby kontynuować.";
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
    const trimmedPrimary = distance.trim();
    let normalizedList = sanitizeDistances(distancesList);
    if (trimmedPrimary) {
      normalizedList = [trimmedPrimary, ...normalizedList];
    }
    let distancesArray = arrangeDistances(
      normalizedList,
      trimmedPrimary || normalizedList[0] || ""
    );
    if (!distancesArray.length && trimmedPrimary) {
      distancesArray = [trimmedPrimary];
    }
    l.distances = distancesArray.length ? distancesArray : [];
    l.distance = l.distances[0] || "";
    const km = parseDistanceToKm(l.distance);
    if (Number.isFinite(km)) {
      l.distanceKm = km;
    } else if ("distanceKm" in l) {
      delete l.distanceKm;
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
    const normalizedTransferFee = transferFee.trim() === "" ? NaN : Number(transferFee);
    l.transferFee = Number.isFinite(normalizedTransferFee) ? normalizedTransferFee : undefined;
    l.transferFeeCurrency = transferFeeCurrency || "PLN";
    l.transferDeadline = transferDeadline || "";
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

  function handleAddDistance() {
    const value = distanceInput.trim();
    if (!value) return;
    const lower = value.toLowerCase();
    const normalized = sanitizeDistances(distancesList);
    const exists = normalized.some((item) => item.toLowerCase() === lower);
    const baseList = exists ? normalized : [...normalized, value];
    const primaryCandidate = distance.trim() || value;
    applyDistances(baseList, primaryCandidate);
    setDistanceInput("");
  }

  function handleRemoveDistance(value) {
    const lower = value.toLowerCase();
    const normalized = sanitizeDistances(distancesList);
    const next = normalized.filter((item) => item.toLowerCase() !== lower);
    const currentPrimary = distance.trim();
    const nextPrimary =
      currentPrimary && currentPrimary.toLowerCase() !== lower ? currentPrimary : next[0] || "";
    applyDistances(next, nextPrimary);
  }

  function handleMakePrimary(value) {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (distance.trim().toLowerCase() === trimmed.toLowerCase()) return;
    applyDistances(distancesList, trimmed);
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
        <div className="flex flex-wrap items-center gap-2">
          {distancesList.length === 0 && (
            <span className="text-sm text-gray-500">Dodaj co najmniej jeden dystans.</span>
          )}
          {distancesList.map((value, index) => {
            const isPrimary = index === 0;
            return (
              <div
                key={value}
                className={clsx(
                  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm",
                  isPrimary ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-700"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleMakePrimary(value)}
                  className={clsx(
                    "inline-flex items-center gap-1 focus:outline-none",
                    isPrimary ? "cursor-default" : "hover:text-neutral-900"
                  )}
                  title={isPrimary ? "Główny dystans" : "Ustaw jako główny dystans"}
                >
                  <span>{value}</span>
                  <span
                    className={clsx(
                      "text-[10px] font-semibold uppercase tracking-wide",
                      isPrimary ? "bg-white/20 text-white px-1 py-0.5 rounded" : "text-neutral-500"
                    )}
                  >
                    {isPrimary ? "Główny" : "Ustaw"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveDistance(value)}
                  className={clsx(
                    "leading-none focus:outline-none",
                    isPrimary ? "text-white/80 hover:text-white" : "text-neutral-500 hover:text-neutral-700"
                  )}
                  aria-label={`Usuń dystans ${value}`}
                >
                  ×
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <input
              list="distance-suggestions"
              value={distanceInput}
              onChange={(e) => setDistanceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddDistance();
                }
              }}
              className="min-w-[140px] flex-1 px-3 py-2 rounded-xl border focus:outline-none focus:ring"
              placeholder="np. 5 km"
            />
            <button
              type="button"
              onClick={handleAddDistance}
              disabled={!distanceInput.trim()}
              className="px-3 py-2 rounded-xl border bg-white hover:bg-neutral-50 disabled:opacity-50"
            >
              Dodaj
            </button>
            <datalist id="distance-suggestions">
              {DISTANCE_SUGGESTIONS.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Enter lub „Dodaj” dopisuje dystans. Kliknij odznakę, aby ustawić ją jako główną.
        </p>
      </Field>

      <Field label={type === "sell" ? "Cena (PLN)" : "Budżet / proponowana kwota (PLN)"} required>
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(",", "."))} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" placeholder="np. 199" />
      </Field>

      <Field label="Opłata za przerejestrowanie">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            inputMode="decimal"
            min="0"
            step="0.01"
            value={transferFee}
            onChange={(e) => setTransferFee(e.target.value.replace(",", "."))}
            className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
            placeholder="np. 50"
          />
          <select
            value={transferFeeCurrency}
            onChange={(e) => setTransferFeeCurrency(e.target.value || "PLN")}
            className="w-full sm:w-32 px-3 py-2 rounded-xl border focus:outline-none focus:ring"
          >
            <option value="PLN">PLN</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        </div>
        {type === "sell" && (
          <p className="mt-1 text-xs text-emerald-600">
            Wyróżnij ofertę podając koszt oficjalnego przepisania pakietu.
          </p>
        )}
      </Field>

      <Field label="Zmiana możliwa do">
        <input
          type="date"
          value={transferDeadline}
          onChange={(e) => setTransferDeadline(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring whitespace-nowrap tabular-nums"
        />
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
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" required />
        <span>
          Akceptuję
          {" "}
          <a
            href="#regulamin"
            className="text-sky-600 underline"
            onClick={(e) => {
              e.preventDefault();
              onOpenTerms?.();
            }}
          >
            Regulamin
          </a>
          {" "}
          serwisu i potwierdzam, że zapoznałem(am) się z zasadami transferu pakietu.
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

/** @param {{ listing: Listing, onDelete: (id:string)=>void, onOpen: (listing: Listing)=>void, onMessage: (listing: Listing)=>void, currentUserId?: string, onEdit?: (listing: Listing)=>void, viewerDisplayName?: string }} props */
function ListingCard({ listing, onDelete, onOpen, onMessage, currentUserId, onEdit, viewerDisplayName }) {
  const isSell = listing.type === "sell";
  const distances = getListingDistances(listing);
  const primaryDistance = distances[0] || "—";
  const extraDistanceCount = primaryDistance === "—" ? 0 : Math.max(0, distances.length - 1);
  const hasAdditionalDistances = extraDistanceCount > 0;
  const ownerId = getListingOwnerId(listing);
  const canMessage = !!ownerId && ownerId !== currentUserId;
  const canManage = !!currentUserId && !!ownerId && ownerId === currentUserId;
  const hasTransferFee = typeof listing.transferFee === "number" && Number.isFinite(listing.transferFee);
  const transferFeeLabel = hasTransferFee
    ? toCurrency(listing.transferFee, listing.transferFeeCurrency || "PLN")
    : "";
  const listingProofStatus = listing.proof_status || (listing.bib ? "none" : "");
  const listingProofBadge = proofStatusBadgeMeta(listingProofStatus || "none");
  const maskedBib = listing.bib ? maskBib(listing.bib) : "";
  const showProof = isSell && (listing.bib || (listing.proof_status && listing.proof_status !== "none"));
  const priceValue = Number(listing.price);
  const hasPrice = Number.isFinite(priceValue);
  const priceLabel = hasPrice ? toCurrency(priceValue, listing.currency || "PLN") : "";
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
      className="rounded-2xl border p-4 hover:shadow-sm transition bg-white cursor-pointer"
      onClick={() => onOpen(listing)}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(listing)}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1 text-xs text-gray-500">
            <Badge color={isSell ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>{
              isSell ? "SPRZEDAM" : "KUPIĘ"
            }</Badge>
            {listing.edition_id && (
              <span>
                {(listing.editionEventName || listing.raceName) + (listing.editionYear ? ` — ${listing.editionYear}` : "")}
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold leading-tight truncate">{listing.raceName}</h3>
        </div>
        {hasPrice && (
          <div className="shrink-0 text-right">
            <span className="text-xl font-bold">{priceLabel}</span>
          </div>
        )}
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
        <div>
          <span className="block text-gray-500">Dystans</span>
          <span className="inline-flex items-center gap-2">
            <span>{primaryDistance}</span>
            {hasAdditionalDistances && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-neutral-200 text-neutral-700">
                +{extraDistanceCount}
              </span>
            )}
          </span>
        </div>
        {hasTransferFee && (
          <div>
            <span className="block text-gray-500">Opłata</span>
            <span>{transferFeeLabel}</span>
          </div>
        )}
        {listing.transferDeadline && (
          <div>
            <span className="block text-gray-500">Zmiana możliwa do</span>
            <span className="whitespace-nowrap tabular-nums">{listing.transferDeadline}</span>
          </div>
        )}
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
      <div className="text-xs text-gray-500 mb-3 space-y-1">
        <div>Dodano: {new Date(listing.createdAt).toLocaleString("pl-PL")}</div>
        {authorLabel && <div>Autor: {authorLabel}</div>}
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

function Terms() {
  return (
    <section id="regulamin" className="bg-white rounded-2xl shadow-sm p-6 md:p-8 space-y-4">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">Regulamin korzystania z marketplace</h2>
        <p className="text-sm text-gray-500">Aktualizacja: 1 czerwca 2024 r.</p>
      </header>
      <p className="text-sm text-gray-700">
        Korzystając z serwisu zobowiązujesz się do przestrzegania poniższych zasad. Regulamin stanowi punkt wyjścia i może
        być doprecyzowywany wraz z rozwojem projektu.
      </p>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-700">
        <li>Publikuj wyłącznie ogłoszenia dotyczące transferu pakietów startowych na wydarzenia sportowe.</li>
        <li>Podawaj prawdziwe informacje — w tym dane kontaktowe, cenę oraz ewentualne koszty przepisania pakietu.</li>
        <li>
          Sprawdź regulamin organizatora biegu i upewnij się, że transfer jest możliwy w podanym terminie i na wskazanych
          zasadach.
        </li>
        <li>Szanuj pozostałych użytkowników, odpowiadaj na wiadomości i nie publikuj treści naruszających dobre obyczaje.</li>
        <li>
          Administrator serwisu może usuwać ogłoszenia lub blokować konta w przypadku naruszenia niniejszych postanowień
          bądź prawa powszechnie obowiązującego.
        </li>
      </ol>
      <p className="text-xs text-gray-500">
        Regulamin ma charakter informacyjny i może zostać zaktualizowany. Korzystanie z serwisu oznacza akceptację jego
        treści.
      </p>
    </section>
  );
}

function isBetaFreeEnabled() {
  if (typeof window !== "undefined" && window.FLAGS && window.FLAGS.BETA_FREE) {
    return true;
  }
  if (typeof globalThis !== "undefined" && globalThis.FLAGS && globalThis.FLAGS.BETA_FREE) {
    return true;
  }
  return false;
}

/**
 * @param {{
 *   session: any,
 *   profileDisplayName: string,
 *   sessionEmail: string,
 *   onShowToast?: (message: string) => void,
 *   onNavigateListings: () => void,
 * }} props
 */
function ContactPage({ session, profileDisplayName, sessionEmail, onShowToast, onNavigateListings }) {
  const isLoggedIn = !!session?.user;
  const [kind, setKind] = useState(CONTACT_KINDS[0]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(sessionEmail || "");
  const [displayName, setDisplayName] = useState(profileDisplayName || "");
  const [agree, setAgree] = useState(false);
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState(/** @type {"idle" | "submitting" | "success" | "error"} */("idle"));
  const [error, setError] = useState("");
  const isSubmitting = status === "submitting";
  const isBetaFree = useMemo(() => isBetaFreeEnabled(), []);

  useEffect(() => {
    if (sessionEmail) {
      setEmail((prev) => prev || sessionEmail);
    }
  }, [sessionEmail]);

  useEffect(() => {
    if (profileDisplayName) {
      setDisplayName((prev) => prev || profileDisplayName);
    }
  }, [profileDisplayName]);

  const emailRequired = !isLoggedIn;

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setError("");

      const trimmedSubject = subject.trim();
      const trimmedBody = message.trim();
      const trimmedEmail = email.trim();
      const trimmedDisplayName = displayName.trim();
      const normalizedKind = CONTACT_KINDS.includes(kind) ? kind : CONTACT_KINDS[0];
      const fallbackEmail = isLoggedIn ? (sessionEmail || "").trim() : "";
      const fallbackDisplayName = isLoggedIn ? (profileDisplayName || "").trim() : "";

      if (!trimmedSubject) {
        setError("Podaj temat wiadomości.");
        return;
      }
      if (trimmedBody.length < 20) {
        setError("Wiadomość musi mieć co najmniej 20 znaków.");
        return;
      }
      if (emailRequired && !trimmedEmail) {
        setError("Podaj adres e-mail, abyśmy mogli odpowiedzieć.");
        return;
      }
      if (trimmedEmail && !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
        setError("Podaj poprawny adres e-mail.");
        return;
      }
      if (!agree) {
        setError("Musisz wyrazić zgodę na kontakt.");
        return;
      }

      setStatus("submitting");

      const currentUrl =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}${window.location.hash}`
          : "";

      try {
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-id": session?.user?.id || "",
          },
          body: JSON.stringify({
            subject: trimmedSubject,
            body: trimmedBody,
            kind: normalizedKind,
            email: trimmedEmail || fallbackEmail,
            displayName: trimmedDisplayName || fallbackDisplayName,
            urlPath: currentUrl,
            honeypot: company.trim(),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const messageText = data?.error || "Nie udało się wysłać wiadomości.";
          throw new Error(messageText);
        }

        setKind(CONTACT_KINDS[0]);
        setSubject("");
        setMessage("");
        setCompany("");
        setAgree(false);
        setStatus("success");
        if (!isLoggedIn) {
          setEmail("");
          setDisplayName("");
        } else {
          setEmail(fallbackEmail);
          setDisplayName(fallbackDisplayName);
        }
        if (onShowToast) {
          onShowToast("Dzięki! Odpowiemy wkrótce");
        }
      } catch (err) {
        console.error("contact submit failed", err);
        setStatus("error");
        setError(err?.message ? String(err.message) : "Nie udało się wysłać wiadomości.");
      }
    },
    [
      agree,
      company,
      displayName,
      email,
      emailRequired,
      isLoggedIn,
      kind,
      message,
      onShowToast,
      profileDisplayName,
      session,
      sessionEmail,
      subject,
    ]
  );

  return (
    <Section title="Skontaktuj się z nami" right={null}>
      <div className="space-y-4 text-sm text-gray-700">
        <p>
          Masz pytanie, pomysł na rozwój marketplace lub zauważyłeś problem? Napisz do nas, odpowiemy najszybciej jak
          to możliwe.
        </p>
        {isBetaFree && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Beta: odpowiedzi mogą zająć do 48h
          </div>
        )}
      </div>
      {status === "success" && (
        <div className="mt-4 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div className="font-medium">Wiadomość została wysłana.</div>
          <p>
            Dziękujemy za kontakt! Postaramy się wrócić z odpowiedzią jak najszybciej. W międzyczasie możesz wrócić do
            ogłoszeń.
          </p>
          <button
            type="button"
            onClick={onNavigateListings}
            className="inline-flex w-auto items-center justify-center rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Zobacz ogłoszenia
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Typ zgłoszenia" required>
            <select
              value={kind}
              onChange={(event) => {
                const value = event.target.value;
                setKind(CONTACT_KINDS.includes(value) ? value : CONTACT_KINDS[0]);
              }}
              className="w-full rounded-xl border px-3 py-2"
            >
              {CONTACT_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Temat" required>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value.slice(0, 160))}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Krótki temat wiadomości"
              maxLength={160}
              required
            />
          </Field>
        </div>
        <Field label="Wiadomość" required>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 4000))}
            className="w-full rounded-xl border px-3 py-2"
            rows={6}
            minLength={20}
            placeholder="Opisz swój pomysł, zgłoszenie lub problem"
            maxLength={4000}
            required
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="E-mail do kontaktu" required={emailRequired}>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value.slice(0, 160))}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="twojadres@example.com"
              autoComplete="email"
              maxLength={160}
              required={emailRequired}
            />
          </Field>
          <Field label="Nazwa wyświetlana (opcjonalnie)" required={false}>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value.slice(0, 160))}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Jak mamy się do Ciebie zwracać?"
              autoComplete="name"
              maxLength={160}
            />
          </Field>
        </div>
        <div className="hidden" aria-hidden>
          <label>
            Firma
            <input
              name="company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={agree}
            onChange={(event) => setAgree(event.target.checked)}
            required
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <span>Zgadzam się na kontakt w sprawie tej wiadomości.</span>
        </label>
        {error && <div className="text-sm text-rose-600">{error}</div>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-neutral-900 px-4 py-2 text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Wysyłam…" : "Wyślij wiadomość"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function DetailModal({ listing, onClose, onMessage, currentUserId, viewerDisplayName }) {
  if (!listing) return null;
  const isSell = listing.type === "sell";
  const ownerId = getListingOwnerId(listing);
  const canMessage = !!ownerId && ownerId !== currentUserId;
  const hasTransferFee = typeof listing.transferFee === "number" && Number.isFinite(listing.transferFee);
  const transferFeeLabel = hasTransferFee
    ? toCurrency(listing.transferFee, listing.transferFeeCurrency || "PLN")
    : "";
  const listingProofStatus = listing.proof_status || (listing.bib ? "none" : "");
  const listingProofBadge = proofStatusBadgeMeta(listingProofStatus || "none");
  const maskedBib = listing.bib ? maskBib(listing.bib) : "";
  const proofUrl = listing.proof_source_url || "";
  const showProof = isSell && (listing.bib || (listing.proof_status && listing.proof_status !== "none"));
  const distances = getListingDistances(listing);
  const hasDistances = distances.length > 0;
  const priceValue = Number(listing.price);
  const hasPrice = Number.isFinite(priceValue);
  const priceLabel = hasPrice ? toCurrency(priceValue, listing.currency || "PLN") : "";
  const createdAtLabel = new Date(listing.createdAt).toLocaleString("pl-PL");
  let listingProofCheckedLabel = "";
  if (listing.proof_checked_at) {
    const parsed = new Date(listing.proof_checked_at);
    if (!Number.isNaN(parsed.getTime())) {
      listingProofCheckedLabel = parsed.toLocaleString("pl-PL");
    }
  }
  const authorLabel =
    listing.author_display_name || (ownerId && ownerId === currentUserId ? viewerDisplayName : "");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[min(92vw,700px)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
        {hasPrice && (
          <div className="mb-3">
            <div className="text-2xl font-semibold">{priceLabel}</div>
          </div>
        )}
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
          {hasDistances && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-gray-500">Dystanse</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {distances.map((value) => (
                  <Badge key={value}>{value}</Badge>
                ))}
              </div>
            </div>
          )}
          {hasTransferFee && (
            <div>
              <div className="text-gray-500">Opłata</div>
              <div>{transferFeeLabel}</div>
            </div>
          )}
          {listing.transferDeadline && (
            <div>
              <div className="text-gray-500">Zmiana możliwa do</div>
              <span className="whitespace-nowrap tabular-nums">{listing.transferDeadline}</span>
            </div>
          )}
        </div>
        {authorLabel && <div className="text-sm text-gray-500 mb-3">Autor: {authorLabel}</div>}
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
        <div className="mt-4 text-xs text-gray-500">Dodano: {createdAtLabel}</div>
      </div>
    </div>
  );
}

/** @param {{
 * open: boolean,
 * onClose: () => void,
 * listing: Listing | null,
 * sending: boolean,
 * error: string,
 * onSend: (body: string) => Promise<void>,
 * }} props */
function MessageModal({ open, onClose, listing, sending, error, onSend }) {
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (open) {
      setText("");
      setLocalError("");
    }
  }, [open, listing?.id]);

  if (!open || !listing) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setLocalError("Wpisz treść wiadomości.");
      return;
    }
    if (trimmed.length > 4000) {
      setLocalError("Wiadomość może mieć maks. 4000 znaków.");
      return;
    }
    setLocalError("");
    try {
      await onSend(trimmed);
      setText("");
    } catch (err) {
      const message = err?.message || "Nie udało się wysłać wiadomości.";
      setLocalError(message);
    }
  }

  const authorLabel = listing.author_display_name ? `Autor: ${listing.author_display_name}` : "";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[min(92vw,480px)] p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">Ogłoszenie</div>
            <div className="font-semibold text-lg leading-tight">{listing.raceName}</div>
            {authorLabel && <div className="text-xs text-gray-500 mt-1">{authorLabel}</div>}
          </div>
          <button className="px-2 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm text-gray-600" htmlFor="message-modal-textarea">
            Wiadomość (max. 4000 znaków)
          </label>
          <textarea
            id="message-modal-textarea"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
            placeholder="Twoja wiadomość…"
            disabled={sending}
          />
          {(error || localError) && <div className="text-sm text-rose-600">{error || localError}</div>}
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-gray-500">{text.trim().length}/4000</span>
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-2 rounded-xl bg-neutral-900 text-white disabled:opacity-50"
            >
              {sending ? "Wysyłam…" : "Wyślij"}
            </button>
          </div>
        </form>
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
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  if (!open) return null;

  function handleClose() {
    setMode("login");
    setEmail("");
    setPassword("");
    setDisplayName("");
    setMsg("");
    setLoading(false);
    onClose();
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    const trimmedDisplayName = displayName.trim();
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg("Zalogowano.");
        handleClose();
        return;
      }

      if (trimmedDisplayName.length < 3 || trimmedDisplayName.length > 30) {
        setMsg("Wyświetlana nazwa musi mieć od 3 do 30 znaków.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: trimmedDisplayName } },
      });
      if (error) throw error;

      if (data?.user) {
        const { error: profileError } = await supabase.from("profiles").upsert({
          id: data.user.id,
          display_name: trimmedDisplayName,
        });
        if (profileError) {
          console.error(profileError);
        }
      }

      setMsg("Konto utworzone. Możesz się zalogować.");
    } catch (err) {
      const message = err?.message || "Nie udało się przetworzyć żądania.";
      setMsg(message);
    } finally {
      setLoading(false);
    }
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
          {mode === "register" && (
            <label className="block">
              <span className="block text-sm text-gray-600 mb-1">Wyświetlana nazwa (pseudonim)</span>
              <input
                className="w-full px-3 py-2 rounded-xl border"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                minLength={3}
                maxLength={30}
                required
              />
            </label>
          )}
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
  const [activeTab, setActiveTab] = useState(/** @type {"listings" | "terms" | "contact"} */("listings"));
  const [activeView, setActiveView] = useState(/** @type {"market" | "profile" | "messages"} */("market"));
  const [profileTab, setProfileTab] = useState(/** @type {"info" | "listings" | "alerts"} */("listings"));
  const [selected, setSelected] = useState/** @type {(Listing|null)} */(null);
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageListing, setMessageListing] = useState/** @type {(Listing|null)} */(null);
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [directMessages, setDirectMessages] = useState(/** @type {DirectMessage[]} */([]));
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [selectedConversationUserId, setSelectedConversationUserId] = useState/** @type {(string|null)} */(null);
  const [conversationSending, setConversationSending] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [conversationDraft, setConversationDraft] = useState("");
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [sessionProfile, setSessionProfile] = useState(/** @type {{ display_name?: string } | null} */(null));
  const [purgeMessage, setPurgeMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
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
  const toastTimeoutRef = useRef(/** @type {(ReturnType<typeof setTimeout> | null)} */(null));
  const [alertsMessage, setAlertsMessage] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [emailOptInSaving, setEmailOptInSaving] = useState(false);
  const currentUserId = session?.user?.id || null;
  const sessionEmail = session?.user?.email || "";
  const emailName = sessionEmail.includes("@") ? sessionEmail.split("@")[0] : sessionEmail;
  const profileDisplayName =
    sessionProfile?.display_name ||
    session?.user?.user_metadata?.display_name ||
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    emailName;
  const purgeMessageTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const showToast = useCallback((message) => {
    if (!message) return;
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage("");
    }, 3000);
  }, []);

  const syncTabWithHash = useCallback(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash?.toLowerCase();
    if (hash === "#regulamin") {
      setActiveTab("terms");
    } else if (hash === "#kontakt") {
      setActiveTab("contact");
    } else {
      setActiveTab("listings");
      setActiveView("market");
      if (hash !== "#ogloszenia") {
        window.location.hash = "#ogloszenia";
      }
    }
  }, [setActiveView]);

  const handleTabChange = useCallback(
    /** @param {"listings" | "terms" | "contact"} tab */
    (tab) => {
      setActiveTab(tab);
      if (tab === "listings") {
        setActiveView("market");
      }
      if (typeof window !== "undefined") {
        const targetHash = tab === "terms" ? "#regulamin" : tab === "contact" ? "#kontakt" : "#ogloszenia";
        if (window.location.hash !== targetHash) {
          window.location.hash = targetHash;
        }
      }
    },
    [setActiveView]
  );

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
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    syncTabWithHash();
    const handler = () => syncTabWithHash();
    window.addEventListener("hashchange", handler);
    return () => {
      window.removeEventListener("hashchange", handler);
    };
  }, [syncTabWithHash]);

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
      .eq("to_user", currentUserId);
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
      setActiveView("market");
      setProfileTab("listings");
      setAlerts([]);
      setAlertsError("");
      setEditingAlert(null);
      setEmailOptIn(false);
      setNotifications([]);
      setNotificationUnreadCount(0);
      setNotificationsOpen(false);
      setSessionProfile(null);
      setDirectMessages([]);
      setSelectedConversationUserId(null);
      setInboxError("");
      setConversationError("");
      setMessageModalOpen(false);
      setMessageListing(null);
      setMessageError("");
      setUnreadMessages(0);
      return;
    }
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
        setSessionProfile(data?.display_name ? { display_name: data.display_name } : null);
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

  const openMessageModal = useCallback(
    (listing) => {
      if (!session || !currentUserId) {
        setAuthOpen(true);
        return;
      }
      const ownerId = getListingOwnerId(listing);
      if (!ownerId || ownerId === currentUserId) {
        return;
      }
      setMessageError("");
      setMessageListing(listing);
      setMessageModalOpen(true);
    },
    [session, currentUserId]
  );

  const closeMessageModal = useCallback(() => {
    setMessageModalOpen(false);
    setMessageListing(null);
    setMessageError("");
  }, []);

  const sendDirectMessage = useCallback(
    async (body) => {
      if (!session || !currentUserId || !messageListing) {
        throw new Error("Brak danych do wysłania wiadomości.");
      }
      const ownerId = getListingOwnerId(messageListing);
      if (!ownerId || ownerId === currentUserId) {
        throw new Error("Nie można wysłać wiadomości.");
      }
      setMessageSending(true);
      setMessageError("");
      try {
        const { data, error } = await supabase
          .from("messages")
          .insert({
            from_user: currentUserId,
            to_user: ownerId,
            listing_id: messageListing.id,
            body,
          })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          setDirectMessages((prev) => {
            if (prev.some((msg) => msg.id === data.id)) return prev;
            const next = [/** @type {DirectMessage} */ (data), ...prev];
            return next.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          });
        }
        showToast("Wysłano");
        refreshUnread();
        closeMessageModal();
      } catch (err) {
        const message = err?.message || "Nie udało się wysłać wiadomości.";
        setMessageError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setMessageSending(false);
      }
    },
    [session, currentUserId, messageListing, closeMessageModal, refreshUnread, showToast]
  );

  const fetchDirectMessages = useCallback(async () => {
    if (!currentUserId) return;
    setInboxLoading(true);
    setInboxError("");
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id,from_user,to_user,listing_id,body,created_at,read_at")
        .or(`from_user.eq.${currentUserId},to_user.eq.${currentUserId}`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setDirectMessages((data || []).map((item) => /** @type {DirectMessage} */ (item)));
      refreshUnread();
    } catch (err) {
      console.error(err);
      setDirectMessages([]);
      setInboxError(err?.message || "Nie udało się pobrać wiadomości.");
    } finally {
      setInboxLoading(false);
    }
  }, [currentUserId, refreshUnread]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchDirectMessages();
  }, [currentUserId, fetchDirectMessages]);

  useEffect(() => {
    if (activeView === "messages" && currentUserId) {
      fetchDirectMessages();
    }
  }, [activeView, currentUserId, fetchDirectMessages]);

  const threads = useMemo(() => {
    if (!currentUserId) return [];
    /** @type {{ otherUserId: string, lastMessage: DirectMessage, unreadCount: number }[]} */
    const entries = [];
    const map = new Map();
    for (const msg of directMessages) {
      const otherUser = msg.from_user === currentUserId ? msg.to_user : msg.from_user;
      if (!otherUser) continue;
      const existing = map.get(otherUser);
      const unreadIncrement = msg.to_user === currentUserId && !msg.read_at ? 1 : 0;
      if (!existing) {
        const record = { otherUserId: otherUser, lastMessage: msg, unreadCount: unreadIncrement };
        map.set(otherUser, record);
        entries.push(record);
      } else {
        if (new Date(msg.created_at) > new Date(existing.lastMessage.created_at)) {
          existing.lastMessage = msg;
        }
        existing.unreadCount += unreadIncrement;
      }
    }
    return entries.sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
  }, [directMessages, currentUserId]);

  useEffect(() => {
    if (!selectedConversationUserId) {
      if (threads.length > 0) {
        setSelectedConversationUserId(threads[0].otherUserId);
      }
      return;
    }
    if (!threads.some((thread) => thread.otherUserId === selectedConversationUserId)) {
      setSelectedConversationUserId(threads[0]?.otherUserId || null);
    }
  }, [threads, selectedConversationUserId]);

  useEffect(() => {
    setConversationDraft("");
    setConversationError("");
  }, [selectedConversationUserId]);

  const conversationMessages = useMemo(() => {
    if (!selectedConversationUserId || !currentUserId) return [];
    return directMessages
      .filter(
        (msg) =>
          (msg.from_user === currentUserId && msg.to_user === selectedConversationUserId) ||
          (msg.to_user === currentUserId && msg.from_user === selectedConversationUserId)
      )
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [directMessages, selectedConversationUserId, currentUserId]);

  const activeConversationListing = useMemo(() => {
    if (!conversationMessages.length) return null;
    for (let i = conversationMessages.length - 1; i >= 0; i -= 1) {
      const id = conversationMessages[i]?.listing_id;
      if (!id) continue;
      const match = listings.find((listing) => listing.id === id);
      if (match) return match;
    }
    return null;
  }, [conversationMessages, listings]);

  const markConversationRead = useCallback(
    async (otherUserId) => {
      if (!currentUserId || !otherUserId) return;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("messages")
        .update({ read_at: now })
        .eq("to_user", currentUserId)
        .eq("from_user", otherUserId)
        .is("read_at", null);
      if (error) {
        console.error(error);
        return;
      }
      setDirectMessages((prev) =>
        prev.map((msg) =>
          msg.to_user === currentUserId && msg.from_user === otherUserId && !msg.read_at ? { ...msg, read_at: now } : msg
        )
      );
      refreshUnread();
    },
    [currentUserId, refreshUnread]
  );

  useEffect(() => {
    if (!selectedConversationUserId || !currentUserId) return;
    const hasUnread = conversationMessages.some((msg) => msg.to_user === currentUserId && !msg.read_at);
    if (hasUnread) {
      markConversationRead(selectedConversationUserId);
    }
  }, [selectedConversationUserId, conversationMessages, currentUserId, markConversationRead]);

  const sendConversationMessage = useCallback(
    async (body) => {
      if (!currentUserId || !selectedConversationUserId) {
        throw new Error("Brak odbiorcy rozmowy.");
      }
      setConversationSending(true);
      setConversationError("");
      try {
        const lastListingId = conversationMessages[conversationMessages.length - 1]?.listing_id || null;
        const { data, error } = await supabase
          .from("messages")
          .insert({
            from_user: currentUserId,
            to_user: selectedConversationUserId,
            listing_id: lastListingId,
            body,
          })
          .select()
          .single();
        if (error) throw error;
        if (data) {
          setDirectMessages((prev) => {
            if (prev.some((msg) => msg.id === data.id)) return prev;
            const next = [/** @type {DirectMessage} */ (data), ...prev];
            return next.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          });
        }
        showToast("Wysłano");
        refreshUnread();
        setConversationDraft("");
      } catch (err) {
        const message = err?.message || "Nie udało się wysłać wiadomości.";
        setConversationError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setConversationSending(false);
      }
    },
    [currentUserId, selectedConversationUserId, conversationMessages, refreshUnread, showToast]
  );

  const handleConversationSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmed = conversationDraft.trim();
      if (!trimmed) return;
      if (trimmed.length > 4000) {
        setConversationError("Wiadomość może mieć maks. 4000 znaków.");
        return;
      }
      try {
        await sendConversationMessage(trimmed);
      } catch (err) {
        console.error(err);
      }
    },
    [conversationDraft, sendConversationMessage]
  );

  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase
      .channel(`messages-to-${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `to_user=eq.${currentUserId}` },
        (payload) => {
          const newMessage = /** @type {DirectMessage} */ (payload.new);
          setDirectMessages((prev) => {
            if (prev.some((msg) => msg.id === newMessage.id)) return prev;
            const next = [newMessage, ...prev];
            return next.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          });
          refreshUnread();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, refreshUnread]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = listings.filter((l) => {
      const okType = typeFilter === "all" ? true : l.type === typeFilter;
      const okQuery = !q ||
        l.raceName.toLowerCase().includes(q) ||
        (l.location || "").toLowerCase().includes(q) ||
        (l.description || "").toLowerCase().includes(q);
      const distances = getListingDistances(l);
      const okDistance =
        distanceFilter === "all" ||
        distances.includes(distanceFilter);
      return okType && okQuery && okDistance;
    });

    if (sort === "newest") arr = arr.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "priceAsc") arr = arr.sort((a, b) => a.price - b.price);
    if (sort === "priceDesc") arr = arr.sort((a, b) => b.price - a.price);

    return arr;
  }, [listings, query, typeFilter, distanceFilter, sort]);

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
    const emailLabel = session.user?.email?.split("@")[0] || session.user?.email || "";
    const fallbackName = profileDisplayName || emailLabel;
    const payload = {
      ...l,
      ownerId: currentUserId,
      owner_id: l.owner_id || currentUserId,
      author_display_name: l.author_display_name || fallbackName,
    };
    const normalizedPayload = normalizeListing(payload);
    setListings((prev) => {
      const idx = prev.findIndex((item) => item.id === normalizedPayload.id);
      if (idx >= 0) {
        const existing = prev[idx];
        const ownerId = getListingOwnerId(existing);
        if (ownerId && ownerId !== currentUserId) {
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...existing, ...normalizedPayload };
        return next;
      }
      return [normalizedPayload, ...prev];
    });
    setEditingListing(null);
    purgeExpiredListings();
    publishListing(normalizedPayload);
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
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => handleTabChange("listings")}
              className={clsx(
                "px-3 py-1.5 rounded-xl border",
                activeTab === "listings"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white hover:bg-neutral-50"
              )}
            >
              Ogłoszenia
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("terms")}
              className={clsx(
                "px-3 py-1.5 rounded-xl border",
                activeTab === "terms"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white hover:bg-neutral-50"
              )}
            >
              Regulamin
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("contact")}
              className={clsx(
                "px-3 py-1.5 rounded-xl border",
                activeTab === "contact"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white hover:bg-neutral-50"
              )}
            >
              Kontakt
            </button>
            {session && activeTab === "listings" && (
              <button
                type="button"
                onClick={() => {
                  setProfileTab("listings");
                  handleTabChange("listings");
                  setActiveView("profile");
                }}
                className={clsx(
                  "px-3 py-1.5 rounded-xl border",
                  activeView === "profile"
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white hover:bg-neutral-50"
                )}
              >
                Mój profil
              </button>
            )}
          </nav>
          <div className="md:ml-auto flex items-center gap-2">
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
                          const priceLabel =
                            typeof listing?.price === "number"
                              ? toCurrency(listing.price, listing?.currency || "PLN")
                              : "";
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
                <button
                  type="button"
                  onClick={() => {
                    handleTabChange("listings");
                    setActiveView("messages");
                  }}
                  className={clsx(
                    "text-sm px-2 py-1 rounded-xl border flex items-center gap-1",
                    unreadMessages
                      ? "bg-sky-50 text-sky-700 border-sky-200"
                      : "bg-neutral-100 text-gray-600 border-neutral-200",
                    "hover:bg-neutral-50"
                  )}
                  aria-label="Wiadomości"
                >
                  <span aria-hidden>📨</span>
                  <span className="tabular-nums">{unreadMessages}</span>
                </button>
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

      {activeTab === "listings" ? (
        activeView === "market" ? (
          <main
            id="ogloszenia"
            className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            <div className="lg:col-span-1">
              <Section
                title="Dodaj ogłoszenie"
                right={<Badge>{session ? "zalogowano" : "konto wymagane"}</Badge>}
              >
                {session ? (
                  <ListingForm
                    onAdd={addListing}
                    ownerId={session.user.id}
                    authorDisplayName={profileDisplayName}
                    editingListing={editingListing}
                    onCancelEdit={() => setEditingListing(null)}
                    onOpenTerms={() => handleTabChange("terms")}
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
                        onMessage={openMessageModal}
                        currentUserId={currentUserId || undefined}
                        onEdit={startEditListing}
                        viewerDisplayName={profileDisplayName}
                      />
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </main>
        ) : activeView === "profile" ? (
          <main id="ogloszenia" className="max-w-5xl mx-auto px-4 py-6 space-y-6">
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
                    <>
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
                    </>
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
                            onMessage={openMessageModal}
                            currentUserId={currentUserId || undefined}
                            onEdit={startEditListing}
                            viewerDisplayName={profileDisplayName}
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
        ) : (
          <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
            {session ? (
              <Section title="Wiadomości" right={null}>
                {threads.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    {inboxLoading ? "Ładuję wiadomości…" : "Brak wiadomości."}
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                    <div className="space-y-2">
                      {threads.map((thread) => {
                        const isActive = thread.otherUserId === selectedConversationUserId;
                        const previewText = thread.lastMessage.body.trim();
                        const preview =
                          previewText.length > 120 ? `${previewText.slice(0, 120)}…` : previewText || "—";
                        const label = `Użytkownik ${thread.otherUserId.slice(0, 8)}…`;
                        const time = formatRelativeTime(thread.lastMessage.created_at);
                        return (
                          <button
                            key={thread.otherUserId}
                            type="button"
                            onClick={() => setSelectedConversationUserId(thread.otherUserId)}
                            className={clsx(
                              "w-full text-left px-3 py-2 rounded-xl border transition",
                              isActive ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-50"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-sm">{label}</span>
                              {thread.unreadCount > 0 && (
                                <span className="text-xs rounded-full bg-sky-100 text-sky-700 px-2 py-0.5">
                                  {thread.unreadCount}
                                </span>
                              )}
                            </div>
                            <div className={clsx("text-xs mt-1", isActive ? "text-neutral-200" : "text-gray-500")}>
                              {time}
                            </div>
                            <div className={clsx("text-xs mt-1", isActive ? "text-neutral-100" : "text-gray-600")}>
                              {preview}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-4">
                      {selectedConversationUserId ? (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                Rozmowa z użytkownikiem {selectedConversationUserId.slice(0, 8)}…
                              </div>
                              <div className="text-xs text-gray-500">
                                {conversationMessages.length} wiadomości
                              </div>
                            </div>
                            {activeConversationListing && (
                              <button
                                type="button"
                                className="text-xs text-sky-600 hover:underline"
                                onClick={() => {
                                  setSelected(activeConversationListing);
                                  setActiveView("market");
                                }}
                              >
                                Otwórz ogłoszenie
                              </button>
                            )}
                          </div>
                          {activeConversationListing && (
                            <div className="rounded-xl border bg-neutral-50 px-3 py-2 text-xs text-gray-600">
                              <div className="font-semibold text-gray-800">{activeConversationListing.raceName}</div>
                              {activeConversationListing.author_display_name && (
                                <div>
                                  Autor: {activeConversationListing.author_display_name}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                            {conversationMessages.map((msg) => {
                              const isMine = msg.from_user === currentUserId;
                              const time = new Date(msg.created_at).toLocaleString("pl-PL", {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "2-digit",
                                month: "2-digit",
                              });
                              return (
                                <div key={msg.id} className="flex flex-col">
                                  <div
                                    className={clsx(
                                      "max-w-[85%] px-4 py-2 rounded-2xl text-sm",
                                      isMine ? "self-end bg-neutral-900 text-white" : "self-start bg-white border"
                                    )}
                                  >
                                    {msg.body}
                                  </div>
                                  <div
                                    className={clsx(
                                      "text-xs text-gray-500 mt-1",
                                      isMine ? "self-end" : "self-start"
                                    )}
                                  >
                                    {time}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <form onSubmit={handleConversationSubmit} className="space-y-2">
                            <textarea
                              rows={4}
                              value={conversationDraft}
                              onChange={(e) => setConversationDraft(e.target.value.slice(0, 4000))}
                              className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
                              placeholder="Napisz odpowiedź…"
                              disabled={conversationSending}
                            />
                            {conversationError && <div className="text-sm text-rose-600">{conversationError}</div>}
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-500">{conversationDraft.trim().length}/4000</span>
                              <button
                                type="submit"
                                disabled={conversationSending || !conversationDraft.trim()}
                                className="px-4 py-2 rounded-xl bg-neutral-900 text-white disabled:opacity-50"
                              >
                                {conversationSending ? "Wysyłam…" : "Wyślij"}
                              </button>
                            </div>
                          </form>
                        </>
                      ) : (
                        <div className="text-sm text-gray-500">Wybierz rozmowę po lewej stronie.</div>
                      )}
                    </div>
                  </div>
                )}
                {inboxLoading && threads.length > 0 && (
                  <div className="text-xs text-gray-500 mt-3">Aktualizuję listę wiadomości…</div>
                )}
                {inboxError && <div className="text-sm text-rose-600 mt-4">{inboxError}</div>}
              </Section>
            ) : (
              <Section title="Wymagane logowanie" right={null}>
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">Zaloguj się, aby przeglądać prywatne wiadomości.</p>
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
        )
      ) : activeTab === "contact" ? (
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          <ContactPage
            session={session}
            profileDisplayName={profileDisplayName}
            sessionEmail={sessionEmail}
            onShowToast={showToast}
            onNavigateListings={() => handleTabChange("listings")}
          />
        </main>
      ) : (
        <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <Terms />
        </main>
      )}

      <DetailModal
        listing={selected}
        onClose={() => setSelected(null)}
        onMessage={openMessageModal}
        currentUserId={currentUserId || undefined}
        viewerDisplayName={profileDisplayName}
      />

      <MessageModal
        open={messageModalOpen}
        onClose={closeMessageModal}
        listing={messageListing}
        sending={messageSending}
        error={messageError}
        onSend={sendDirectMessage}
      />

      <footer className="max-w-6xl mx-auto px-4 pb-12 pt-2 text-xs text-gray-500">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p>
            Uwaga prawna: wiele wydarzeń pozwala na oficjalny transfer pakietu w określonych terminach — publikując
            ogłoszenie, upewnij się, że działasz zgodnie z regulaminem organizatora.
          </p>
          <button
            type="button"
            onClick={() => handleTabChange("contact")}
            className="text-xs font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
          >
            Kontakt
          </button>
        </div>
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

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 px-4 py-2 rounded-xl bg-emerald-600 text-white shadow-lg text-sm"
        >
          {toastMessage}
        </div>
      )}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
