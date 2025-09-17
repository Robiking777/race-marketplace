import React, { useEffect, useMemo, useState } from "react";

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

function clsx(...args) {
  return args.filter(Boolean).join(" ");
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
      raceName: "Bieg Niepodległości 10 km",
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
      raceName: "Bieg Ursynowa 5 km",
      eventDate: "2025-06-15",
      location: "Warszawa",
      price: 110,
      contact: "kasia@example.com",
      description: "Start w elicie 5 km, możliwość osobistego przekazania numeru.",
      createdAt: now - 1000 * 60 * 60 * 60,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Nocny Bieg Świętojański 5 km",
      eventDate: "2025-07-21",
      location: "Gdynia",
      price: 100,
      contact: "gosia@example.com",
      description: "Kupię pakiet na szybkie 5 km nad morzem, preferuję odbiór mailowy.",
      createdAt: now - 1000 * 60 * 60 * 72,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Wrocław Fast Run 5 km",
      eventDate: "2025-09-14",
      location: "Wrocław",
      price: 95,
      contact: "piotr@example.com",
      description: "Pakiet z oficjalną możliwością zmiany danych do końca sierpnia.",
      createdAt: now - 1000 * 60 * 60 * 84,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Poznań Run 5 km",
      eventDate: "2025-08-10",
      location: "Poznań",
      price: 90,
      contact: "pawel@example.com",
      description: "Szukam pakietu na rodzinny bieg 5 km, budżet do 100 PLN.",
      createdAt: now - 1000 * 60 * 60 * 96,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Gdańsk Business Run 10 km",
      eventDate: "2025-09-28",
      location: "Gdańsk",
      price: 150,
      contact: "biuro@sprinter.pl",
      description: "Sprzedam pakiet 10 km, odbiór osobisty w Gdańsku lub wysyłka PDF.",
      createdAt: now - 1000 * 60 * 60 * 108,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Białystok City Run 10 km",
      eventDate: "2025-09-07",
      location: "Białystok",
      price: 140,
      contact: "agnieszka@example.com",
      description: "Kupię pakiet na 10 km, proszę o kontakt SMS.",
      createdAt: now - 1000 * 60 * 60 * 120,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Silesia 10 km Night Run",
      eventDate: "2025-10-18",
      location: "Katowice",
      price: 160,
      contact: "michal@example.com",
      description: "Sprzedam pakiet z pamiątkową koszulką L.",
      createdAt: now - 1000 * 60 * 60 * 132,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Toruńska Dycha 10 km",
      eventDate: "2025-10-05",
      location: "Toruń",
      price: 150,
      contact: "torun.biegacz@example.com",
      description: "Kupię pakiet 10 km, najlepiej z opcją przepisu online.",
      createdAt: now - 1000 * 60 * 60 * 144,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Gdynia Półmaraton",
      eventDate: "2026-03-22",
      location: "Gdynia",
      price: 260,
      contact: "martyna@example.com",
      description: "Sprzedam pakiet VIP na półmaraton, w cenie strefa regeneracji.",
      createdAt: now - 1000 * 60 * 60 * 156,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Wrocławski Półmaraton",
      eventDate: "2025-06-22",
      location: "Wrocław",
      price: 240,
      contact: "adam@example.com",
      description: "Szukam pakietu na półmaraton, potrzebuję numeru w fali 2.",
      createdAt: now - 1000 * 60 * 60 * 168,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Półmaraton Lublin",
      eventDate: "2025-09-14",
      location: "Lublin",
      price: 230,
      contact: "lublin-runner@example.com",
      description: "Sprzedam pakiet + nocleg w hostelu w centrum.",
      createdAt: now - 1000 * 60 * 60 * 180,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Półmaraton Praski",
      eventDate: "2025-08-31",
      location: "Warszawa",
      price: 250,
      contact: "praga-run@example.com",
      description: "Kupię pakiet startowy, zależy mi na rozmiarze koszulki S.",
      createdAt: now - 1000 * 60 * 60 * 192,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Maraton Warszawski",
      eventDate: "2025-09-28",
      location: "Warszawa",
      price: 320,
      contact: "warsaw.marathon@example.com",
      description: "Pakiet na maraton, odeślę dane do oficjalnego przepisania.",
      createdAt: now - 1000 * 60 * 60 * 204,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Maraton Poznań",
      eventDate: "2025-10-19",
      location: "Poznań",
      price: 310,
      contact: "joanna@example.com",
      description: "Chętnie odkupię pakiet, rozważę też opcję z noclegiem.",
      createdAt: now - 1000 * 60 * 60 * 216,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Silesia Marathon",
      eventDate: "2025-10-05",
      location: "Katowice",
      price: 300,
      contact: "silesia@example.com",
      description: "Numer startowy w strefie 3, możliwość przekazania osobiście.",
      createdAt: now - 1000 * 60 * 60 * 228,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Łódź Maraton Dbam o Zdrowie",
      eventDate: "2026-04-19",
      location: "Łódź",
      price: 290,
      contact: "kontakt@lodzbiega.pl",
      description: "Poszukuję pakietu z wcześniejszą falą startową.",
      createdAt: now - 1000 * 60 * 60 * 240,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Beskidy Ultra Trail 70 km",
      eventDate: "2025-09-07",
      location: "Szczyrk",
      price: 520,
      contact: "beskidy@example.com",
      description: "Sprzedam pakiet na dystans 70 km, zawiera pasta party i depozyt.",
      createdAt: now - 1000 * 60 * 60 * 252,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Łemkowyna Ultra Trail 100 km",
      eventDate: "2025-10-12",
      location: "Krynica-Zdrój",
      price: 550,
      contact: "lemko@example.com",
      description: "Kupię pakiet na dystans ultra, budżet do 600 PLN.",
      createdAt: now - 1000 * 60 * 60 * 264,
    },
    {
      id: cryptoRandom(),
      type: "sell",
      raceName: "Ultra Mazury 70 km",
      eventDate: "2025-07-05",
      location: "Giżycko",
      price: 540,
      contact: "mazury@example.com",
      description: "Pakiet na ultra wraz z voucherem na nocleg przy starcie.",
      createdAt: now - 1000 * 60 * 60 * 276,
    },
    {
      id: cryptoRandom(),
      type: "buy",
      raceName: "Sudety Ultra Trail 50 km",
      eventDate: "2025-08-23",
      location: "Karpacz",
      price: 500,
      contact: "sudety@example.com",
      description: "Szukam pakietu na 50 km, ważne potwierdzenie przepisu od organizatora.",
      createdAt: now - 1000 * 60 * 60 * 288,
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

/** @param {{ onAdd: (l: Listing)=>void }} props */
function ListingForm({ onAdd }) {
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

  function reset() {
    setRaceName("");
    setEventDate("");
    setLocation("");
    setDistance("");
    setPrice("");
    setContact("");
    setDescription("");
    setAgree(false);
  }

  function validate() {
    if (!raceName.trim()) return "Podaj nazwę biegu.";
    if (!distance) return "Wybierz dystans biegu.";
    if (!price || isNaN(Number(price)) || Number(price) <= 0) return "Podaj poprawną kwotę.";
    if (!contact.trim()) return "Podaj kontakt (e-mail/telefon).";
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
    };
    onAdd(l);
    reset();
    setMsg("Dodano ogłoszenie ✔");
    setTimeout(() => setMsg(""), 2000);
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

/** @param {{ listing: Listing, onDelete: (id:string)=>void }} props */
function ListingCard({ listing, onDelete }) {
  const isSell = listing.type === "sell";
  const distanceLabel = listing.distance || inferDistance(listing.raceName) || "—";
  return (
    <div id={listing.id} className="rounded-2xl border p-4 hover:shadow-sm transition bg-white">
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm text-gray-600 mb-2">
        <div>
          <span className="block text-gray-500">Data</span>
          <span>{listing.eventDate || "—"}</span>
        </div>
        <div>
          <span className="block text-gray-500">Lokalizacja</span>
          <span>{listing.location || "—"}</span>
        </div>
        <div>
          <span className="block text-gray-500">Kontakt</span>
          <span className="break-all">{listing.contact}</span>
        </div>
        <div>
          <span className="block text-gray-500">Dystans</span>
          <span>{distanceLabel}</span>
        </div>
        <div>
          <span className="block text-gray-500">Dodano</span>
          <span>{new Date(listing.createdAt).toLocaleString("pl-PL")}</span>
        </div>
      </div>
      {listing.description && (
        <p className="text-sm text-gray-800 mb-3">{listing.description}</p>
      )}
      <div className="flex items-center justify-between">
        <button onClick={() => copyPermalink(listing.id)} className="text-sm px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200">Kopiuj link</button>
        <button onClick={() => onDelete(listing.id)} className="text-sm px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100">Usuń</button>
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

// ------------------------------- App -----------------------------

export default function App() {
  const [listings, setListings] = useState(/** @type {Listing[]} */([]));
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(/** @type {"all"|ListingType} */("all"));
  const [distanceFilter, setDistanceFilter] = useState(/** @type {"all" | Distance} */("all"));
  const [sort, setSort] = useState("newest");

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

  function resetDemoData() {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
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
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Section title="Dodaj ogłoszenie" right={<Badge>bez logowania</Badge>}>
            <ListingForm onAdd={addListing} />
          </Section>
          <Section title="Wskazówki" right={null}>
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
              <li>Sprawdź, czy organizator biegu dopuszcza oficjalny transfer pakietu.</li>
              <li>Nie publikuj danych wrażliwych. Korzystaj z czatu/e-maila do ustaleń.</li>
              <li>Unikaj przedpłat bez zabezpieczenia. Wybierz odbiór osobisty lub bezpieczne płatności.</li>
            </ul>
            <div className="mt-4">
              <button onClick={resetDemoData} className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white hover:bg-neutral-50">
                Przywróć dane demo
              </button>
            </div>
          </Section>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Section
            title="Ogłoszenia"
            right={
              <div className="flex items-center gap-2">
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
            }
          >
            {filtered.length === 0 ? (
              <div className="text-sm text-gray-600">Brak ogłoszeń dla wybranych filtrów.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filtered.map((l) => (
                  <ListingCard key={l.id} listing={l} onDelete={deleteListing} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-12 pt-2 text-xs text-gray-500">
        <p>
          Uwaga prawna: wiele wydarzeń pozwala na oficjalny transfer pakietu w określonych terminach — publikując ogłoszenie,
          upewnij się, że działasz zgodnie z regulaminem organizatora.
        </p>
      </footer>
    </div>
  );
}
