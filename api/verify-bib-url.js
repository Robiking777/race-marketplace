const FETCH_TIMEOUT_MS = 10000;

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

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createBibRegex(bib) {
  const escaped = escapeRegExp(bib);
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`, "i");
}

function matchesBibInJson(value, tester, normalizedBib, numericBib, hasNumeric) {
  if (value == null) return false;
  if (typeof value === "string") {
    return tester.test(value);
  }
  if (typeof value === "number") {
    if (String(value) === normalizedBib) return true;
    if (hasNumeric && Number.isFinite(value) && Number(value) === numericBib) return true;
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => matchesBibInJson(item, tester, normalizedBib, numericBib, hasNumeric));
  }
  if (typeof value === "object") {
    return Object.values(value).some((item) => matchesBibInJson(item, tester, normalizedBib, numericBib, hasNumeric));
  }
  return false;
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function isJsonType(contentType = "", url = "") {
  const lower = contentType.toLowerCase();
  const urlLower = url.toLowerCase();
  return lower.includes("application/json") || urlLower.endsWith(".json");
}

function isCsvType(contentType = "", url = "") {
  const lower = contentType.toLowerCase();
  const urlLower = url.toLowerCase();
  return lower.includes("text/csv") || lower.includes("application/csv") || urlLower.endsWith(".csv");
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

  const normalizedBib = String(body?.bib ?? "").trim();
  const startUrl = String(body?.url ?? "").trim();

  if (!normalizedBib) {
    send(res, 400, { status: "error", error: "Podaj numer BIB." });
    return;
  }
  if (!startUrl) {
    send(res, 400, { status: "error", error: "Podaj adres listy startowej." });
    return;
  }

  let normalizedUrl;
  try {
    const url = new URL(startUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    normalizedUrl = url.toString();
  } catch (err) {
    send(res, 400, { status: "error", error: "Nieprawidłowy adres URL listy startowej." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "race-marketplace-bib-verifier/1.0",
        Accept: "text/html,text/csv,application/json;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    console.error("Fetch error", err);
    send(res, 400, {
      status: "error",
      error: "Nie udało się pobrać listy startowej.",
      sourceUrl: normalizedUrl,
    });
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    send(res, 400, {
      status: "error",
      error: `Serwer listy startowej zwrócił kod ${response.status}.`,
      sourceUrl: normalizedUrl,
    });
    return;
  }

  let raw;
  try {
    raw = await response.text();
  } catch (err) {
    console.error("Failed to read response body", err);
    send(res, 400, {
      status: "error",
      error: "Nie udało się odczytać danych listy startowej.",
      sourceUrl: normalizedUrl,
    });
    return;
  }

  const checkedAt = new Date().toISOString();
  const contentType = response.headers.get("content-type") || "";
  const tester = createBibRegex(normalizedBib);
  const numericBib = Number(normalizedBib);
  const hasNumeric = Number.isFinite(numericBib);

  try {
    if (isJsonType(contentType, normalizedUrl)) {
      const data = JSON.parse(raw);
      const found = matchesBibInJson(data, tester, normalizedBib, numericBib, hasNumeric);
      send(res, 200, {
        status: found ? "verified" : "not_found",
        message: found ? "Numer potwierdzony na liście startowej." : "Nie znaleziono numeru na liście startowej.",
        sourceUrl: normalizedUrl,
        checkedAt,
      });
      return;
    }
  } catch (err) {
    console.error("JSON parse error", err);
    send(res, 400, {
      status: "error",
      error: "Nie udało się przetworzyć danych JSON z listy startowej.",
      sourceUrl: normalizedUrl,
    });
    return;
  }

  let text = raw;
  const lowerContentType = contentType.toLowerCase();
  const isHtml = lowerContentType.includes("text/html") || lowerContentType.includes("application/xhtml");
  if (isHtml && !isCsvType(contentType, normalizedUrl)) {
    text = cleanHtml(raw);
  }

  const found = tester.test(text);
  send(res, 200, {
    status: found ? "verified" : "not_found",
    message: found ? "Numer potwierdzony na liście startowej." : "Nie znaleziono numeru na liście startowej.",
    sourceUrl: normalizedUrl,
    checkedAt,
  });
}
