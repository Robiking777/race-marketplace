import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "nodejs", maxDuration: 10 };

const CONTACT_KINDS = ["Pomysł", "Problem", "Błąd", "Współpraca"];

function parseFromAddress(value) {
  if (!value) {
    return { email: "alerts@example.com", name: "Race Marketplace" };
  }
  const str = String(value).trim();
  if (!str) {
    return { email: "alerts@example.com", name: "Race Marketplace" };
  }
  const match = str.match(/^(.*)<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    const email = match[2].trim();
    if (email) {
      return { email, name };
    }
  }
  return { email: str, name: "" };
}

async function sendViaResend(apiKey, message) {
  const endpoint = "https://api.resend.com/emails";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

async function sendViaSendgrid(apiKey, payload) {
  const endpoint = "https://api.sendgrid.com/v3/mail/send";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sendgrid error ${res.status}: ${text}`);
  }
  return res.text();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const { subject, body, kind, email, displayName, urlPath, honeypot } = req.body || {};

  if (typeof honeypot === "string" && honeypot.trim()) return res.status(200).json({ ok: true });
  if (honeypot && typeof honeypot !== "string") return res.status(200).json({ ok: true });

  const normalizedKind = typeof kind === "string" && CONTACT_KINDS.includes(kind) ? kind : null;
  const trimmedSubject = typeof subject === "string" ? subject.trim() : "";
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const trimmedDisplayName = typeof displayName === "string" ? displayName.trim() : "";
  const sanitizedUrlPath = typeof urlPath === "string" ? urlPath.slice(0, 500) : "";

  if (!trimmedSubject || !trimmedBody || !normalizedKind) {
    return res.status(400).json({ ok: false, error: "missing fields" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
  if (!supabaseUrl || !serviceRole) {
    return res.status(500).json({ ok: false, error: "supabase env missing" });
  }

  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userAgent = req.headers["user-agent"] || null;
  const userId = req.headers["x-user-id"] || null;

  const limitedBody = trimmedBody.slice(0, 8000);
  const limitedSubject = trimmedSubject.slice(0, 200);

  const { error } = await sb.from("contact_messages").insert({
    user_id: userId || null,
    display_name: trimmedDisplayName || null,
    email: trimmedEmail || null,
    kind: normalizedKind,
    subject: limitedSubject,
    body: limitedBody,
    url_path: sanitizedUrlPath || null,
    user_agent: userAgent || null,
  });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const to = process.env.CONTACT_EMAIL;
  const resendKey = process.env.RESEND_API_KEY || null;
  const sendgridKey = process.env.SENDGRID_API_KEY || null;
  const apiKey = resendKey || sendgridKey || null;

  if (to && apiKey) {
    const fromRaw = process.env.RESEND_FROM || "Race Marketplace <alerts@example.com>";
    const fromParsed = parseFromAddress(fromRaw);
    const subjectLine = `[Kontakt] ${normalizedKind}: ${limitedSubject}`.slice(0, 200);
    const textLines = [
      `Typ: ${normalizedKind}`,
      `Temat: ${limitedSubject}`,
      "",
      String(limitedBody || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n"),
      "",
      `Wyświetlana nazwa: ${trimmedDisplayName || "—"}`,
      `E-mail: ${trimmedEmail || "—"}`,
      `Użytkownik ID: ${userId || "—"}`,
      `Adres URL: ${sanitizedUrlPath || "—"}`,
      `User-Agent: ${userAgent || "—"}`,
      `Wysłano: ${new Date().toISOString()}`,
    ];
    const text = textLines.join("\n");

    try {
      if (resendKey) {
        await sendViaResend(resendKey, {
          from: fromParsed.name ? `${fromParsed.name} <${fromParsed.email}>` : fromParsed.email,
          to: [to],
          subject: subjectLine,
          text,
        });
      } else if (sendgridKey) {
        const sendgridPayload = {
          personalizations: [
            {
              to: [{ email: to }],
            },
          ],
          from: fromParsed.name ? { email: fromParsed.email, name: fromParsed.name } : { email: fromParsed.email },
          subject: subjectLine,
          content: [
            {
              type: "text/plain",
              value: text,
            },
          ],
        };
        await sendViaSendgrid(sendgridKey, sendgridPayload);
      }
    } catch (e) {
      console.warn("contact email failed", e);
    }
  }

  return res.status(200).json({ ok: true });
}
