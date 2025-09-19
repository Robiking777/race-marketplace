import cheerio from "cheerio";
import slugify from "slugify";
import { createClient } from "@supabase/supabase-js";
import { parseDistances } from "../src/lib/race-parse.js";

if (typeof slugify.extend === "function") {
  slugify.extend({
    ą: "a",
    ć: "c",
    ę: "e",
    ł: "l",
    ń: "n",
    ó: "o",
    ś: "s",
    ź: "z",
    ż: "z",
    Ą: "a",
    Ć: "c",
    Ę: "e",
    Ł: "l",
    Ń: "n",
    Ó: "o",
    Ś: "s",
    Ź: "z",
    Ż: "z",
  });
}

const BASE_URL =
  "https://www.maratonypolskie.pl/mp_index.php?action=1&dzial=3&grp=13&trgr=1&wielkosc=2";
const DEFAULT_FROM = "2025-10-01";
const DEFAULT_TO = "2026-12-31";
const PAGE_STEP = 6;
const MAX_PAGES = 200;
const FETCH_TIMEOUT_MS = 20000;
const DATE_PATTERN = /(20\d{2})\.(\d{1,2})\.(\d{1,2})/;

const pageCache = new Map();

function send(res, statusCode, data) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  if (!req) return {};
  if (typeof req.body === "string") {
    if (!req.body) return {};
    return JSON.parse(req.body);
  }
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.text === "function") {
    const raw = await req.text();
    return raw ? JSON.parse(raw) : {};
  }
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseInputDate(value, fallback) {
  if (!value) return fallback;
  const str = String(value).trim();
  if (!str) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dotMatch = str.match(DATE_PATTERN);
  if (dotMatch) {
    return toIsoDate(dotMatch[1], dotMatch[2], dotMatch[3]);
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return formatDateOnly(parsed);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(year, month, day) {
  if (!year) return "";
  const mm = String(month || "").padStart(2, "0");
  const dd = String(day || "").padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function extractIsoDate(text) {
  if (!text) return null;
  const match = String(text).match(DATE_PATTERN);
  if (!match) return null;
  return toIsoDate(match[1], match[2], match[3]);
}

function parseEventRow($, row) {
  const cells = $(row).find("td");
  if (!cells.length) return null;

  const cellTexts = cells
    .map((_, cell) => cleanText($(cell).text()))
    .get()
    .filter(Boolean);

  if (!cellTexts.length) return null;

  const joined = cellTexts.join(" | ");
  const isoDate = extractIsoDate(joined);
  if (!isoDate) return null;

  let dateIndex = -1;
  cells.each((idx, cell) => {
    const text = cleanText($(cell).text());
    if (dateIndex === -1 && extractIsoDate(text)) {
      dateIndex = idx;
    }
  });

  if (dateIndex === -1) {
    dateIndex = cellTexts.findIndex((text) => Boolean(extractIsoDate(text)));
  }

  let city = "";
  if (dateIndex !== -1 && cells[dateIndex + 1]) {
    city = cleanText($(cells[dateIndex + 1]).text());
  }

  let name = "";
  if (dateIndex !== -1 && cells[dateIndex + 2]) {
    name = cleanText($(cells[dateIndex + 2]).text());
  }

  if (!name) {
    const link = $(row).find("a").first();
    if (link && link.length) {
      name = cleanText(link.text());
    }
  }

  if (!name) {
    for (const text of cellTexts) {
      if (extractIsoDate(text)) continue;
      if (!text) continue;
      name = text;
      break;
    }
  }

  let distancesSource = "";
  if (dateIndex !== -1) {
    const extra = [];
    cells.each((idx, cell) => {
      if (idx <= dateIndex + 1) return;
      const text = cleanText($(cell).text());
      if (text) extra.push(text);
    });
    distancesSource = extra.join(" ");
  }

  if (!distancesSource) {
    distancesSource = joined;
  }

  const distances = parseDistances(distancesSource);

  return {
    date: isoDate,
    city: city || "",
    name: name || "",
    distances,
    rawText: joined,
  };
}

function parseFallbackBlocks($) {
  const events = [];
  $("div, li, p").each((_, element) => {
    const text = cleanText($(element).text());
    if (!text) return;
    const isoDate = extractIsoDate(text);
    if (!isoDate) return;
    const linkText = cleanText($(element).find("a").first().text());
    const parts = text
      .split(/[|\n]/)
      .map((part) => cleanText(part))
      .filter(Boolean);
    let city = "";
    let name = linkText;
    for (const part of parts) {
      if (!name && !extractIsoDate(part) && !/(km|maraton)/i.test(part)) {
        name = part;
        continue;
      }
      if (!city && !extractIsoDate(part) && /(miasto|woj\.|pow\.|PL|Polska)/i.test(part)) {
        city = part;
      }
    }
    if (!name) {
      for (const part of parts) {
        if (extractIsoDate(part)) continue;
        if (!/(km|maraton)/i.test(part)) {
          name = part;
          break;
        }
      }
    }
    const distances = parseDistances(text);
    events.push({
      date: isoDate,
      city: city || "",
      name: name || "",
      distances,
      rawText: text,
    });
  });
  return events;
}

function parseCalendarPage(html) {
  const $ = cheerio.load(html);
  const events = [];
  $("tr").each((_, row) => {
    const event = parseEventRow($, row);
    if (event && event.name) {
      events.push(event);
    }
  });

  if (!events.length) {
    events.push(...parseFallbackBlocks($));
  }

  return events;
}

async function fetchPage(url) {
  if (pageCache.has(url)) {
    return pageCache.get(url);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "race-marketplace-importer/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const text = await response.text();
    pageCache.set(url, text);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureEvent(client, { name, slug, city }) {
  const { data: existing, error } = await client
    .from("events")
    .select("id,name,city,country_code,sport_type")
    .eq("slug", slug)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (!existing) {
    const { data, error: insertError } = await client
      .from("events")
      .insert({
        name,
        slug,
        city: city || null,
        country_code: "PL",
        sport_type: "running",
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    return { id: data.id, inserted: true, updated: false };
  }

  const updates = {};
  if (name && existing.name !== name) {
    updates.name = name;
  }
  if (city && city !== existing.city) {
    updates.city = city;
  }
  if (!existing.country_code) {
    updates.country_code = "PL";
  }
  if (!existing.sport_type) {
    updates.sport_type = "running";
  }

  if (Object.keys(updates).length) {
    const { data, error: updateError } = await client
      .from("events")
      .update(updates)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updateError) throw updateError;
    return { id: data.id, inserted: false, updated: true };
  }

  return { id: existing.id, inserted: false, updated: false };
}

async function ensureEdition(client, { eventId, year, startDate, endDate, distances }) {
  const { data: existing, error } = await client
    .from("event_editions")
    .select("id,start_date,end_date,distances")
    .eq("event_id", eventId)
    .eq("year", year)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (!existing) {
    const { data, error: insertError } = await client
      .from("event_editions")
      .insert({
        event_id: eventId,
        year,
        start_date: startDate,
        end_date: endDate,
        distances: distances && distances.length ? distances : null,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    return { id: data.id, inserted: true, updated: false };
  }

  const updates = {};
  if ((!existing.start_date || existing.start_date === "") && startDate) {
    updates.start_date = startDate;
  }
  if ((!existing.end_date || existing.end_date === "") && endDate) {
    updates.end_date = endDate;
  }
  if (
    distances &&
    distances.length &&
    (!Array.isArray(existing.distances) || existing.distances.length === 0)
  ) {
    updates.distances = distances;
  }

  if (Object.keys(updates).length) {
    const { data, error: updateError } = await client
      .from("event_editions")
      .update(updates)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updateError) throw updateError;
    return { id: data.id, inserted: false, updated: true };
  }

  return { id: existing.id, inserted: false, updated: false };
}

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, { status: "error", error: "Method not allowed." });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error("Failed to parse request body", err);
    send(res, 400, { status: "error", error: "Nieprawidłowe dane wejściowe." });
    return;
  }

  const from = parseInputDate(body?.from, DEFAULT_FROM);
  const to = parseInputDate(body?.to, DEFAULT_TO);

  const fromDate = toDate(from);
  const toDateValue = toDate(to);
  if (!fromDate || !toDateValue) {
    send(res, 400, { status: "error", error: "Nieprawidłowy zakres dat." });
    return;
  }
  if (fromDate > toDateValue) {
    send(res, 400, { status: "error", error: "Data początkowa musi być nie późniejsza niż końcowa." });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
  if (!supabaseUrl || !supabaseKey) {
    send(res, 500, { status: "error", error: "Brak konfiguracji Supabase." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "race-marketplace-importer/1.0" } },
  });

  let offset = 0;
  let scannedPages = 0;
  let insertedEvents = 0;
  let updatedEvents = 0;
  let insertedEditions = 0;
  let updatedEditions = 0;
  const seenEntries = new Set();
  const eventCache = new Map();
  const editionCache = new Set();
  let reachedRange = false;
  let wentPastRange = false;

  try {
    while (scannedPages < MAX_PAGES) {
      const pageUrl = offset === 0 ? BASE_URL : `${BASE_URL}&starty=${offset}`;
      const html = await fetchPage(pageUrl);
      scannedPages += 1;

      const entries = parseCalendarPage(html);
      if (!entries.length) {
        break;
      }

      let pageProgress = false;

      for (const entry of entries) {
        const isoDate = entry?.date;
        if (!isoDate) continue;

        const eventDate = toDate(isoDate);
        if (!eventDate) continue;

        const name = cleanText(entry?.name);
        if (!name) continue;
        const city = cleanText(entry?.city);

        const signature = `${isoDate}|${name.toLowerCase()}|${city.toLowerCase()}`;
        if (seenEntries.has(signature)) continue;
        seenEntries.add(signature);
        pageProgress = true;

        if (eventDate > toDateValue) {
          continue;
        }
        if (eventDate < fromDate) {
          wentPastRange = true;
          continue;
        }

        reachedRange = true;

        const distances = Array.isArray(entry?.distances) && entry.distances.length
          ? entry.distances
          : parseDistances(entry?.rawText || "");

        const slug = slugify(name, { lower: true, strict: true, locale: "pl" });
        if (!slug) continue;

        const year = Number.parseInt(isoDate.slice(0, 4), 10);
        if (!Number.isFinite(year)) continue;

        let eventRecord = eventCache.get(slug);
        if (!eventRecord) {
          try {
            const { id, inserted, updated } = await ensureEvent(supabase, {
              name,
              slug,
              city,
            });
            eventRecord = { id };
            eventCache.set(slug, eventRecord);
            if (inserted) insertedEvents += 1;
            if (updated) updatedEvents += 1;
          } catch (err) {
            console.error("Failed to upsert event", err);
            continue;
          }
        }

        const eventId = eventRecord.id;
        if (!eventId) continue;
        const editionKey = `${eventId}:${year}`;
        if (editionCache.has(editionKey)) {
          continue;
        }
        try {
          const { inserted, updated } = await ensureEdition(supabase, {
            eventId,
            year,
            startDate: isoDate,
            endDate: isoDate,
            distances,
          });
          editionCache.add(editionKey);
          if (inserted) insertedEditions += 1;
          if (updated) updatedEditions += 1;
        } catch (err) {
          console.error("Failed to upsert edition", err);
        }
      }

      if ((reachedRange && wentPastRange) || !pageProgress) {
        break;
      }

      offset += Math.max(entries.length, PAGE_STEP);
      if (scannedPages >= MAX_PAGES) {
        break;
      }
      await delay(1200);
    }
  } catch (err) {
    console.error("Importer failed", err);
    send(res, 500, { status: "error", error: "Import nie powiódł się." });
    return;
  }

  send(res, 200, {
    status: "ok",
    from,
    to,
    insertedEvents,
    updatedEvents,
    insertedEditions,
    updatedEditions,
    scannedPages,
  });
}
