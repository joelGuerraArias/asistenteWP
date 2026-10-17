/**
 * Digests diarios YouTube / Instagram desde Gmail.
 * SOLO para el REPORTE Intrant — no usar en alertas ni sheet.
 *
 * Preferencia: Gmail API OAuth. Fallback: IMAP (mismo app password que alertas).
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "./config.mjs";
import { getGmailApi } from "./google-auth.mjs";

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function decodeBodyData(data = "") {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8"
  );
}

function extractPart(payload, mime) {
  if (!payload) return "";
  if (payload.mimeType === mime && payload.body?.data) {
    return decodeBodyData(payload.body.data);
  }
  for (const part of payload.parts || []) {
    const found = extractPart(part, mime);
    if (found) return found;
  }
  return "";
}

function headerValue(headers = [], name) {
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

/** 2026-09-07 → 07/09/2026 */
export function ymdToDdMmYyyy(ymd = "") {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** 2026-09-07 → 7 de septiembre de 2026 */
export function ymdToSpanishLong(ymd = "") {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const day = Number(m[3]);
  const month = MONTHS_ES[Number(m[2]) - 1] || "";
  return `${day} de ${month} de ${m[1]}`;
}

function htmlToText(html = "") {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function getMessageBodiesApi(gmail, messageId) {
  const full = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const headers = full.data.payload?.headers || [];
  let html = extractPart(full.data.payload, "text/html");
  let text = extractPart(full.data.payload, "text/plain");
  if ((!html || !text) && full.data.raw) {
    const parsed = await simpleParser(
      Buffer.from(full.data.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    );
    html = html || parsed.html || "";
    text = text || parsed.text || "";
  }
  if (!text && html) text = htmlToText(html);
  return {
    subject: headerValue(headers, "Subject"),
    html,
    text,
  };
}

async function findFirstMessageApi(gmail, query) {
  const listed = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 5,
  });
  return listed.data.messages?.[0]?.id || "";
}

/**
 * Busca en INBOX por subject (IMAP). sinceDays: mirar N días atrás desde dateYmd.
 */
async function findDigestViaImap({
  subjectIncludes = [],
  sinceDays = 2,
  dateYmd,
} = {}) {
  const { user, appPassword } = config.googleAlerts?.gmail || {};
  if (!user || !appPassword) {
    throw new Error(
      "Falta GMAIL_ALERTS_USER / GMAIL_ALERTS_APP_PASSWORD para digests IMAP"
    );
  }

  const needles = subjectIncludes
    .map((s) => String(s || "").toLowerCase())
    .filter(Boolean);
  if (!needles.length) return null;

  const since = new Date();
  if (dateYmd) {
    const [y, m, d] = dateYmd.split("-").map(Number);
    since.setFullYear(y, m - 1, d);
  }
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - Math.max(0, sinceDays - 1));

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass: appPassword },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ since });
      const recent = (uids || []).slice(-150);
      for (const uid of [...recent].reverse()) {
        const msg = await client.fetchOne(uid, {
          source: true,
          envelope: true,
        });
        if (!msg?.source) continue;
        const parsed = await simpleParser(msg.source);
        const subject = String(parsed.subject || "").toLowerCase();
        if (!needles.every((n) => subject.includes(n))) continue;
        const html = parsed.html || "";
        let text = parsed.text || "";
        if (!text && html) text = htmlToText(html);
        return {
          subject: parsed.subject || "",
          html,
          text,
        };
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return null;
}

async function loadDigestMessage({ apiQuery, subjectIncludes, dateYmd }) {
  // IMAP primero: el OAuth del bot suele carecer de gmail.readonly (alertas ya usan IMAP).
  const { user, appPassword } = config.googleAlerts?.gmail || {};
  if (user && appPassword) {
    const viaImap = await findDigestViaImap({
      subjectIncludes,
      dateYmd,
      sinceDays: 2,
    });
    if (viaImap) return viaImap;
  }
  try {
    const gmail = getGmailApi();
    const id = await findFirstMessageApi(gmail, apiQuery);
    if (id) return await getMessageBodiesApi(gmail, id);
  } catch (error) {
    console.warn(`Digest Gmail API: ${error.message}`);
  }
  return null;
}

/**
 * Parsea ranking del digest YouTube Apify (título «…» + URL youtube).
 */
export function parseYoutubeDigestText(body = "", dateYmd = "") {
  const text = String(body || "");
  const items = [];
  const seen = new Set();

  const blockRe =
    /\[([^\]]+)\][^\n]*\n[ \t]*[«"“]([^»"”]+)[»"”][ \t]*\n[ \t]*(https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s<>"']+)/gi;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const medio = String(m[1] || "").trim() || "YouTube";
    const title = String(m[2] || "").trim();
    let url = String(m[3] || "").trim().replace(/[),.;]+$/, "");
    if (!title || !url) continue;
    const key = url.replace(/&list=[^&]+/i, "").replace(/&start_radio=\d+/i, "");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      source: "youtube",
      medio,
      title,
      summary: title,
      url,
      at: dateYmd,
      via: "gmail-digest",
    });
  }

  if (items.length) return items;

  const urlRe = /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s<>"']+/gi;
  const urls = text.match(urlRe) || [];
  for (const rawUrl of urls) {
    const url = rawUrl.replace(/[),.;]+$/, "");
    const key = url.replace(/&list=[^&]+/i, "").replace(/&start_radio=\d+/i, "");
    if (seen.has(key)) continue;
    const idx = text.indexOf(rawUrl);
    const before = text.slice(Math.max(0, idx - 400), idx);
    const titleM = before.match(/[«"“]([^»"”]{8,200})[»"”]\s*$/);
    const title = titleM?.[1]?.trim();
    if (!title) continue;
    seen.add(key);
    items.push({
      source: "youtube",
      medio: "YouTube",
      title,
      summary: title,
      url,
      at: dateYmd,
      via: "gmail-digest",
    });
  }
  return items;
}

/**
 * Parsea el reporte diario Instagram @intrant_rd.
 */
export function parseInstagramDigestText(body = "", dateYmd = "") {
  const text = String(body || "");
  let caption = "";
  const capM =
    text.match(
      /Caption:\s*([\s\S]*?)(?=\n\s*(?:❤️|❤|Likes|##|🔗|Reporte generado|$))/i
    ) ||
    text.match(
      /📝\s*Caption:\s*([\s\S]*?)(?=\n\s*(?:❤️|❤|Likes|##|🔗|Reporte generado|$))/i
    );
  if (capM) {
    caption = String(capM[1] || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (!caption) {
    const alt = text.match(/@intrant_rd[^\n]*\n([\s\S]{20,400})/i);
    caption = alt ? String(alt[1]).replace(/\s+/g, " ").trim() : "";
  }

  let url = "";
  const igUrl =
    text.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s<>"')]+/i) ||
    text.match(/https?:\/\/[^\s<>"']*instagram[^\s<>"']+/i);
  if (igUrl) url = igUrl[0].replace(/[),.;]+$/, "");

  if (!url) {
    const any = text.match(/https?:\/\/[^\s<>"']+/i);
    if (any && /instagram|sendibt|bh\.d\./i.test(any[0])) {
      url = any[0].replace(/[),.;]+$/, "");
    }
  }

  if (!caption && !url) return [];

  const title =
    (caption.length > 120 ? `${caption.slice(0, 117).trim()}…` : caption) ||
    "Post Instagram @intrant_rd";

  return [
    {
      source: "instagram",
      medio: "intrant_rd",
      title,
      summary: caption || title,
      url: url || "",
      at: dateYmd,
      via: "gmail-digest",
    },
  ];
}

/**
 * Digest YouTube del día (correo Apify). Aislado del fetch de Google Alerts.
 */
export async function fetchYoutubeDigestFromGmail({ dateYmd } = {}) {
  if (!dateYmd) return [];
  const dd = ymdToDdMmYyyy(dateYmd);
  if (!dd) return [];
  const msg = await loadDigestMessage({
    apiQuery: `subject:"YouTube" subject:"${dd}" (INTRANT OR Tránsito OR "Tránsito RD")`,
    subjectIncludes: ["youtube", dd],
    dateYmd,
  });
  if (!msg) return [];
  return parseYoutubeDigestText(msg.text || htmlToText(msg.html), dateYmd);
}

/**
 * Digest Instagram del día. Aislado del fetch de Google Alerts.
 */
export async function fetchInstagramDigestFromGmail({ dateYmd } = {}) {
  if (!dateYmd) return [];
  const longEs = ymdToSpanishLong(dateYmd);
  if (!longEs) return [];

  const msg = await loadDigestMessage({
    apiQuery: `subject:"Seguimiento Intrant en Instagram" subject:"${longEs}"`,
    subjectIncludes: ["seguimiento intrant en instagram", longEs.toLowerCase()],
    dateYmd,
  });
  if (!msg) return [];
  return parseInstagramDigestText(msg.text || htmlToText(msg.html), dateYmd);
}
