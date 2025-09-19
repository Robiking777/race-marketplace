import { createClient } from "@supabase/supabase-js";

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

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  const str = String(value).trim();
  if (!str) return null;
  const ts = Date.parse(str);
  if (!Number.isNaN(ts)) {
    return new Date(ts).toISOString();
  }
  return null;
}

function normalizeDateOnly(value) {
  const iso = normalizeDate(value);
  if (!iso) return null;
  return iso.slice(0, 10);
}

function safeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return null;
}

function sanitizeListing(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Listing payload is required.");
  }
  const type = raw.type === "buy" ? "buy" : "sell";
  const price = safeNumber(raw.price);
  if (price == null) {
    throw new Error("Listing price is required.");
  }
  const ownerId = raw.owner_id || raw.ownerId || raw.user_id || raw.userId;
  if (!ownerId) {
    throw new Error("Listing owner_id is required.");
  }
  const createdAtMs = safeNumber(raw.createdAt);
  const createdAtIso = createdAtMs ? new Date(createdAtMs).toISOString() : normalizeDate(raw.created_at) || new Date().toISOString();
  const payload = { ...raw };

  return {
    id: String(raw.id || "").trim(),
    type,
    race_name: String(raw.raceName || raw.race_name || "").trim(),
    edition_id: raw.edition_id ?? raw.editionId ?? null,
    edition_event_name: raw.editionEventName || raw.edition_event_name || null,
    edition_year: raw.editionYear ?? raw.edition_year ?? null,
    edition_start_date: normalizeDateOnly(raw.editionStartDate || raw.edition_start_date || raw.eventDate || raw.event_date),
    distance: raw.distance || null,
    price,
    owner_id: ownerId,
    location: raw.location || null,
    created_at: createdAtIso,
    payload,
  };
}

function buildNotificationPayload(listingRow, alerts) {
  const base = {
    id: listingRow.id,
    type: listingRow.type,
    race_name: listingRow.race_name,
    price: listingRow.price,
    distance: listingRow.distance,
    edition_event_name: listingRow.edition_event_name,
    edition_year: listingRow.edition_year,
    created_at: listingRow.created_at,
  };
  return {
    listing: base,
    alerts: alerts.map((a) => ({
      alert_id: a.alert_id,
      event_label: a.event_label,
      query_text: a.query_text,
      send_email: a.send_email,
    })),
  };
}

async function fetchProfiles(client, userIds) {
  if (!userIds.length) return new Map();
  const chunks = [];
  const size = 50;
  for (let i = 0; i < userIds.length; i += size) {
    chunks.push(userIds.slice(i, i + size));
  }
  const results = new Map();
  for (const chunk of chunks) {
    const { data, error } = await client
      .from("profiles")
      .select("id, display_name, email_notifications")
      .in("id", chunk);
    if (error) {
      throw error;
    }
    for (const row of data || []) {
      results.set(row.id, row);
    }
  }
  return results;
}

async function fetchUserEmails(client, userIds) {
  const entries = new Map();
  for (const userId of userIds) {
    try {
      const { data, error } = await client.auth.admin.getUserById(userId);
      if (error) throw error;
      if (data?.user?.email) {
        entries.set(userId, data.user.email);
      }
    } catch (err) {
      console.error("Failed to fetch email for user", userId, err?.message || err);
    }
  }
  return entries;
}

async function sendEmail(resendKey, message) {
  if (!resendKey) return { skipped: true };
  const endpoint = "https://api.resend.com/emails";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
  return res.json();
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
    send(res, 405, { status: "error", error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
  if (!supabaseUrl || !serviceRole) {
    send(res, 500, { status: "error", error: "Supabase service role env vars missing" });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error("alerts-fanout: failed to parse body", err);
    send(res, 400, { status: "error", error: "Invalid JSON body" });
    return;
  }

  const listingInput = body?.listing;
  let listingRow;
  try {
    listingRow = sanitizeListing(listingInput);
    if (!listingRow.id) {
      throw new Error("Listing id is required.");
    }
  } catch (err) {
    send(res, 400, { status: "error", error: err?.message || "Invalid listing" });
    return;
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { error: upsertError } = await supabaseAdmin.from("listings").upsert(listingRow);
    if (upsertError) throw upsertError;
  } catch (err) {
    console.error("alerts-fanout: failed to upsert listing", err);
    send(res, 500, { status: "error", error: "Failed to persist listing" });
    return;
  }

  let matches = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("alerts_match")
      .select("listing_id, alert_id, user_id, send_email, event_label, query_text")
      .eq("listing_id", listingRow.id);
    if (error) throw error;
    matches = data || [];
  } catch (err) {
    console.error("alerts-fanout: failed to fetch matches", err);
    send(res, 500, { status: "error", error: "Failed to load matching alerts" });
    return;
  }

  const distinctMatches = new Map();
  for (const match of matches) {
    if (!match || !match.user_id) continue;
    if (match.user_id === listingRow.owner_id) continue;
    if (!distinctMatches.has(match.user_id)) {
      distinctMatches.set(match.user_id, []);
    }
    distinctMatches.get(match.user_id).push(match);
  }

  if (!distinctMatches.size) {
    send(res, 200, { status: "ok", notifiedUsers: 0, notifications: 0 });
    return;
  }

  const userIds = Array.from(distinctMatches.keys());

  let profiles;
  try {
    profiles = await fetchProfiles(supabaseAdmin, userIds);
  } catch (err) {
    console.error("alerts-fanout: failed to load profiles", err);
    send(res, 500, { status: "error", error: "Failed to load user profiles" });
    return;
  }

  const emails = await fetchUserEmails(supabaseAdmin, userIds);
  const resendKey = process.env.RESEND_API_KEY || "";
  const resendFrom = process.env.RESEND_FROM || "Race Marketplace <alerts@example.com>";

  let notifiedUsers = 0;
  let notificationsInserted = 0;

  for (const [userId, alerts] of distinctMatches) {
    const profile = profiles.get(userId);
    const payload = buildNotificationPayload(listingRow, alerts);

    try {
      const { error: insertError } = await supabaseAdmin.from("notifications").insert({
        user_id: userId,
        listing_id: listingRow.id,
        channel: "inapp",
        is_read: false,
        payload,
      });
      if (insertError) throw insertError;
      notificationsInserted += 1;
      notifiedUsers += 1;
    } catch (err) {
      console.error("alerts-fanout: failed to insert notification", err);
      continue;
    }

    const wantsAlertEmail = alerts.some((a) => a.send_email);
    if (!wantsAlertEmail) continue;
    if (!profile?.email_notifications) continue;
    const recipient = emails.get(userId);
    if (!recipient) continue;

    const subjectPrefix = listingRow.type === "sell" ? "Nowe ogłoszenie: Sprzedam" : "Nowe ogłoszenie: Kupię";
    const subject = `${subjectPrefix} ${listingRow.race_name}`;
    const priceLabel = typeof listingRow.price === "number" ? `${listingRow.price.toFixed(2)} PLN` : String(listingRow.price || "");
    const lines = [
      `Cześć ${profile?.display_name || ""}`.trim(),
      "",
      `Znaleźliśmy nowe ogłoszenie, które pasuje do Twojego alertu:`,
      `• Bieg: ${listingRow.race_name}`,
      listingRow.distance ? `• Dystans: ${listingRow.distance}` : null,
      `• Typ ogłoszenia: ${listingRow.type === "sell" ? "Sprzedam" : "Kupię"}`,
      `• Cena / budżet: ${priceLabel}`,
      "",
      "Zaloguj się do marketplace, aby skontaktować się z autorem ogłoszenia.",
      "",
      "Dziękujemy, zespół Race Marketplace",
    ].filter(Boolean);

    try {
      await sendEmail(resendKey, {
        from: resendFrom,
        to: [recipient],
        subject,
        text: lines.join("\n"),
      });
      const { error: emailNotifError } = await supabaseAdmin.from("notifications").insert({
        user_id: userId,
        listing_id: listingRow.id,
        channel: "email",
        is_read: true,
        payload,
      });
      if (emailNotifError) {
        console.error("alerts-fanout: failed to log email notification", emailNotifError);
      }
      notificationsInserted += 1;
    } catch (err) {
      console.error("alerts-fanout: failed to send email", err);
    }
  }

  send(res, 200, { status: "ok", notifiedUsers, notifications: notificationsInserted });
}
