import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

// ----------------------------- Typy -----------------------------
/** @typedef {"sell" | "buy"} ListingType */

const DISTANCES = /** @type {const} */ (["5 km", "10 km", "Półmaraton", "Maraton", "Ultramaraton"]);

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
 * @property {Distance} [distance]
 * @property {number} createdAt // epoch ms
 * @property {string} [bib]
 * @property {"verified"|"not_found"|"unknown"|"none"} [proof_status]
 * @property {string} [proof_source_url]
 * @property {number} [proof_checked_at]
 * @property {string} [ownerId]
 * @property {string} [owner_id]
 * @property {string} [user_id]
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

// ----------------------- Pomocnicze funkcje ----------------------
const STORAGE_KEY = "race_listings_v1";

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

const BULLET = "\u2022";

function maskBib(bib = "") {
  const value = String(bib || "").trim();
  if (!value) return "";
  if (value.length <= 3) return value;
  const hidden = BULLET.repeat(value.length - 3);
  return hidden + value.slice(-3);
}

const PROOF_STATUS_META = {
  verified: { icon: "✅", label: "Zweryfikowany", color: "bg-emerald-100 text-emerald-800" },
  not_found: { icon: "❌", label: "Nie znaleziono", color: "bg-rose-100 text-rose-700" },
  unknown: { icon: "⚪", label: "Nie udało się sprawdzić", color: "bg-gray-100 text-gray-700" },
  none: { icon: "⚪", label: "Nie zweryfikowano", color: "bg-gray-100 text-gray-500" },
};

function ProofStatusBadge({ status = "none", source, className = "", stopClick }) {
  const meta = PROOF_STATUS_META[status] || PROOF_STATUS_META.none;
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full", meta.color, className)}>
      <span aria-hidden>{meta.icon}</span>
      <span>{meta.label}</span>
      {status === "verified" && source && (
        <a
          href={source}
          target="_blank"
          rel="noreferrer"
          onClick={stopClick}
          className="underline decoration-dotted font-normal"
        >
          (źródło)
        </a>
      )}
    </span>
  );
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
  if (lower.includes("10")) return "10 km";
  if (lower.includes("5")) return "5 km";
  return undefined;
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
    if (l.distance) return l;
    const inferred = inferDistance(l.raceName || "");
    if (inferred) {
      changed = true;
      return { ...l, distance: inferred };
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
      bib: "A123",
      proof_status: "verified",
      proof_source_url: "https://example.com/lista-startowa",
      proof_checked_at: now - 1000 * 60 * 30,
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
      bib: "PL-908",
      proof_status: "not_found",
      proof_source_url: "https://example.com/lista-niepodleglosc",
      proof_checked_at: now - 1000 * 60 * 60 * 5,
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
      bib: "ZD-77",
      proof_status: "unknown",
      proof_source_url: "https://example.com/lista-zdrowie",
      proof_checked_at: now - 1000 * 60 * 60 * 30,
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
      bib: "GD15-221",
      proof_status: "none",
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
      bib: "UM-55-12",
      proof_status: "verified",
      proof_source_url: "https://example.com/lista-mazury",
      proof_checked_at: now - 1000 * 60 * 60 * 12,
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
      bib: "BU100-7",
      proof_status: "none",
      createdAt: now - 1000 * 60 * 60 * 192,
    },
  ];
  saveListings(data);
  return data;
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

/** @param {{ onAdd: (l: Listing)=>void, ownerId?: string }} props */
function ListingForm({ onAdd, ownerId }) {
  /** @type {[ListingType, Function]} */
  const [type, setType] = useState(/** @type {ListingType} */("sell"));
  const [raceName, setRaceName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [distance, setDistance] = useState("");
  const [price, setPrice] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [bib, setBib] = useState("");
  const [startListUrl, setStartListUrl] = useState("");
  const [proofStatus, setProofStatus] = useState("");
  const [proofSourceUrl, setProofSourceUrl] = useState("");
  const [proofCheckedAt, setProofCheckedAt] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [proofError, setProofError] = useState("");
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState("");

  function reset() {
    setRaceName("");
    setEventDate("");
    setLocation("");
    setDistance("");
    setPrice("");
    setContact("");
    setDescription("");
    setBib("");
    setStartListUrl("");
    setProofStatus("");
    setProofSourceUrl("");
    setProofCheckedAt(null);
    setVerifying(false);
    setProofError("");
    setAgree(false);
  }

  function validate() {
    if (!raceName.trim()) return "Podaj nazwę biegu.";
    if (!distance) return "Wybierz dystans biegu.";
    if (!price || isNaN(Number(price)) || Number(price) <= 0) return "Podaj poprawną kwotę.";
    if (!contact.trim()) return "Podaj kontakt (e-mail/telefon).";
    if (type === "sell") {
      const trimmedBib = bib.trim();
      if (!trimmedBib) return "Podaj numer startowy (BIB).";
      if (!/^[A-Za-z0-9-]{1,12}$/.test(trimmedBib)) {
        return "Numer BIB może zawierać litery, cyfry oraz myślnik (max 12 znaków).";
      }
    }
    if (!agree) return "Musisz zaakceptować regulamin i zasady transferu pakietu.";
    return "";
  }

  function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setMsg(err);
      setTimeout(() => setMsg(""), 2500);
      return;
    }
    /** @type {Listing} */
    const l = {
      id: cryptoRandom(),
      type,
      raceName: raceName.trim(),
      eventDate: eventDate || undefined,
      location: location || undefined,
      distance: /** @type {Distance} */ (distance),
      price: Number(price),
      contact: contact.trim(),
      description: description?.trim() || undefined,
      createdAt: Date.now(),
      ...(ownerId ? { ownerId } : {}),
    };
    if (type === "sell") {
      const trimmedBib = bib.trim();
      const trimmedUrl = startListUrl.trim();
      l.bib = trimmedBib;
      l.proof_status = (proofStatus || "none");
      if (proofSourceUrl || trimmedUrl) {
        l.proof_source_url = proofSourceUrl || trimmedUrl;
      }
      if (proofCheckedAt) {
        l.proof_checked_at = proofCheckedAt;
      }
    }
    onAdd(l);
    reset();
    setMsg("Dodano ogłoszenie ✔");
    setTimeout(() => setMsg(""), 2000);
  }

  useEffect(() => {
    setProofError("");
    setProofStatus("");
    setProofSourceUrl("");
    setProofCheckedAt(null);
  }, [bib, startListUrl]);

  useEffect(() => {
    if (type !== "sell") {
      setBib("");
      setStartListUrl("");
      setProofStatus("");
      setProofSourceUrl("");
      setProofCheckedAt(null);
      setProofError("");
      setVerifying(false);
    }
  }, [type]);

  async function handleVerify() {
    if (type !== "sell") return;
    const trimmedBib = bib.trim();
    const trimmedUrl = startListUrl.trim();
    if (!trimmedBib || !trimmedUrl) return;
    if (!/^[A-Za-z0-9-]{1,12}$/.test(trimmedBib)) {
      setProofError("Numer BIB ma nieprawidłowy format.");
      return;
    }
    try {
      new URL(trimmedUrl);
    } catch {
      setProofError("Podaj poprawny link do listy startowej.");
      return;
    }
    setVerifying(true);
    setProofError("");
    try {
      const resp = await fetch("/api/verify-bib-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, bib: trimmedBib }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data || typeof data.status !== "string") {
        throw new Error("invalid_response");
      }
      const allowed = ["verified", "not_found", "unknown"];
      const status = allowed.includes(data.status) ? data.status : "unknown";
      setProofStatus(status);
      setProofSourceUrl(data.source || trimmedUrl);
      setProofCheckedAt(Date.now());
      if (status === "unknown" && data.reason) {
        setProofError("Nie udało się potwierdzić numeru. Spróbuj ponownie później.");
      }
    } catch (err) {
      console.error(err);
      setProofStatus("unknown");
      setProofSourceUrl(trimmedUrl);
      setProofCheckedAt(Date.now());
      setProofError("Nie udało się zweryfikować numeru. Spróbuj ponownie później.");
    } finally {
      setVerifying(false);
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
        <input value={raceName} onChange={(e) => setRaceName(e.target.value)} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" placeholder="np. Półmaraton Warszawski" />
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
        <select
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
          required
        >
          <option value="" disabled>
            Wybierz dystans…
          </option>
          {DISTANCES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>

      <Field label={type === "sell" ? "Cena (PLN)" : "Budżet / proponowana kwota (PLN)"} required>
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(",", "."))} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" placeholder="np. 199" />
      </Field>

      <Field label="Kontakt (e-mail lub telefon)" required>
        <input value={contact} onChange={(e) => setContact(e.target.value)} className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring" placeholder="np. ala@domena.pl / 600123123" />
      </Field>

      {type === "sell" && (
        <>
          <Field label="Numer startowy (BIB)" required>
            <input
              value={bib}
              onChange={(e) => setBib(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
              placeholder="np. 1234 lub A12-7"
              maxLength={12}
              pattern="[A-Za-z0-9-]{1,12}"
            />
          </Field>
          <Field label="Link do listy startowej (URL)">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={startListUrl}
                onChange={(e) => setStartListUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring"
                placeholder="https://..."
                type="url"
                inputMode="url"
              />
              <button
                type="button"
                onClick={handleVerify}
                disabled={
                  verifying ||
                  !bib.trim() ||
                  !/^[A-Za-z0-9-]{1,12}$/.test(bib.trim()) ||
                  !startListUrl.trim()
                }
                className={clsx(
                  "px-4 py-2 rounded-xl border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed",
                  verifying
                    ? "bg-neutral-100 text-gray-500 border-neutral-200"
                    : "bg-white hover:bg-neutral-50 border-neutral-300"
                )}
              >
                {verifying ? "Sprawdzam…" : "Zweryfikuj numer"}
              </button>
            </div>
            {(proofStatus || proofError || verifying) && (
              <div className="mt-2 space-y-1 text-sm">
                {!verifying && proofStatus && (
                  <ProofStatusBadge status={proofStatus} source={proofSourceUrl} />
                )}
                {proofCheckedAt && proofStatus && !verifying && (
                  <div className="text-xs text-gray-500">
                    Sprawdzono: {new Date(proofCheckedAt).toLocaleString("pl-PL")}
                  </div>
                )}
                {verifying && <div className="text-xs text-gray-500">Trwa sprawdzanie…</div>}
                {proofError && <div className="text-xs text-rose-600">{proofError}</div>}
              </div>
            )}
          </Field>
        </>
      )}

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
        <button className="px-4 py-2 rounded-xl bg-neutral-900 text-white hover:opacity-90" type="submit">Dodaj ogłoszenie</button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </form>
  );
}

/** @param {{ listing: Listing, onDelete: (id:string)=>void, onOpen: (listing: Listing)=>void, onMessage: (listing: Listing)=>void, currentUserId?: string }} props */
function ListingCard({ listing, onDelete, onOpen, onMessage, currentUserId }) {
  const isSell = listing.type === "sell";
  const distanceLabel = listing.distance || inferDistance(listing.raceName) || "—";
  const ownerId = getListingOwnerId(listing);
  const canMessage = !!ownerId && ownerId !== currentUserId;
  const proofStatus = listing.proof_status || "none";
  const showProofBadge = proofStatus !== "";
  return (
    <div
      id={listing.id}
      className="rounded-2xl border p-4 hover:shadow-sm transition bg-white cursor-pointer"
      onClick={() => onOpen(listing)}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(listing)}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Badge color={isSell ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>{isSell ? "SPRZEDAM" : "KUPIĘ"}</Badge>
          <h3 className="font-semibold text-lg">{listing.raceName}</h3>
        </div>
        <div className="text-right">
          {!isSell && (
            <div className="text-xs text-gray-500 leading-tight">Proponowana cena zakupu</div>
          )}
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
        <div>
          <span className="block text-gray-500">Dystans</span>
          <span>{distanceLabel}</span>
        </div>
      </div>
      {listing.bib && (
        <div className="mb-3 space-y-1">
          <div className="text-sm text-gray-700">
            <span className="text-gray-500">Numer startowy:</span>{" "}
            <span className="font-mono tracking-widest">{maskBib(listing.bib)}</span>
          </div>
          {showProofBadge && (
            <ProofStatusBadge
              status={proofStatus}
              source={listing.proof_source_url}
              stopClick={(e) => e.stopPropagation()}
            />
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
    </div>
  );
}

function DetailModal({ listing, onClose, onMessage, currentUserId }) {
  if (!listing) return null;
  const isSell = listing.type === "sell";
  const ownerId = getListingOwnerId(listing);
  const canMessage = !!ownerId && ownerId !== currentUserId;
  const proofStatus = listing.proof_status || "none";
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
        <div className="mb-3">
          {!isSell && <div className="text-xs text-gray-500 leading-tight">Proponowana cena zakupu</div>}
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
          {listing.distance && (
            <div>
              <div className="text-gray-500">Dystans</div>
              <div>{listing.distance}</div>
            </div>
          )}
          <div>
            <div className="text-gray-500">Dodano</div>
            <div>{new Date(listing.createdAt).toLocaleString("pl-PL")}</div>
          </div>
        </div>
        {listing.bib && (
          <div className="mb-4 space-y-1">
            <div className="text-sm text-gray-500">Numer startowy (BIB)</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-base tracking-widest">{listing.bib}</span>
              <ProofStatusBadge status={proofStatus} source={listing.proof_source_url} />
            </div>
            {listing.proof_checked_at && (
              <div className="text-xs text-gray-500">
                Sprawdzono: {new Date(listing.proof_checked_at).toLocaleString("pl-PL")}
              </div>
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
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(/** @type {"all"|ListingType} */("all"));
  const [distanceFilter, setDistanceFilter] = useState(/** @type {"all" | Distance} */("all"));
  const [sort, setSort] = useState("newest");
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
  const [unreadCount, setUnreadCount] = useState(0);
  const currentUserId = session?.user?.id || null;

  const refreshUnread = useCallback(async () => {
    if (!currentUserId) {
      setUnreadCount(0);
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
    setUnreadCount(count ?? 0);
  }, [currentUserId]);

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

    // Po wejściu z kotwicą #id przewiń do ogłoszenia
    const hash = window.location.hash?.slice(1);
    if (hash) {
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, []);

  useEffect(() => {
    saveListings(listings);
  }, [listings]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      setUnreadCount(0);
      return;
    }
    refreshUnread();
  }, [currentUserId, refreshUnread]);

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
      const okDistance = distanceFilter === "all" || (l.distance || inferDistance(l.raceName)) === distanceFilter;
      return okType && okQuery && okDistance;
    });

    if (sort === "newest") arr = arr.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "priceAsc") arr = arr.sort((a, b) => a.price - b.price);
    if (sort === "priceDesc") arr = arr.sort((a, b) => b.price - a.price);

    return arr;
  }, [listings, query, typeFilter, distanceFilter, sort]);

  function addListing(l) {
    setListings((prev) => [l, ...prev]);
  }

  function deleteListing(id) {
    if (!confirm("Na pewno usunąć to ogłoszenie?")) return;
    setListings((prev) => prev.filter((x) => x.id !== id));
  }

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
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-neutral-900 text-white grid place-items-center text-lg">🏃‍♂️</div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold leading-tight">Marketplace pakietów startowych</h1>
            <p className="text-sm text-gray-600">Dodawaj ogłoszenia: sprzedaj i kup pakiety na biegi</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportCSV} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-neutral-50">Eksportuj CSV</button>
            {session ? (
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "text-sm px-2 py-1 rounded-xl border flex items-center gap-1",
                    unreadCount
                      ? "bg-sky-50 text-sky-700 border-sky-200"
                      : "bg-neutral-100 text-gray-600 border-neutral-200"
                  )}
                >
                  <span aria-hidden>📨</span>
                  <span className="tabular-nums">{unreadCount}</span>
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

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Section
            title="Dodaj ogłoszenie"
            right={<Badge>{session ? "zalogowano" : "konto wymagane"}</Badge>}
          >
            {session ? (
              <ListingForm onAdd={addListing} ownerId={session.user.id} />
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
                    onMessage={openChat}
                    currentUserId={currentUserId || undefined}
                  />
                ))}
              </div>
            )}
          </Section>
        </div>
      </main>

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

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
