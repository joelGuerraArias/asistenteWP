/**
 * Google Alerts desde Gmail → filas para Sheet.
 * Preferencia: Gmail API (OAuth). Fallback: IMAP + app password.
 */
import { simpleParser } from "mailparser";
import { config } from "./config.mjs";
import { getGmailApi } from "./google-auth.mjs";
import {
  isRelevantElectricAlert,
  isRelevantIntrantAlert,
  parseAlertSubject,
  parseGoogleAlertsHtml,
} from "./google-alerts-parse.mjs";
import {
  fetchGoogleAlertsImap,
  filterTodayAlerts,
  isSameLocalDay,
} from "./gmail-alerts-imap.mjs";
import { DESDE_AGENTE } from "./sheets-alerts.mjs";

function startOfLocalDay(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function decodeBodyData(data = "") {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8"
  );
}

function extractHtmlFromPayload(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBodyData(payload.body.data);
  }
  for (const part of payload.parts || []) {
    const html = extractHtmlFromPayload(part);
    if (html) return html;
  }
  return "";
}

function headerValue(headers = [], name) {
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function relevanceFor(mode, filters) {
  if (mode === "electric") {
    return (row) => isRelevantElectricAlert(row, filters);
  }
  return (row) => isRelevantIntrantAlert(row, filters);
}

function dedupeAlerts(alerts) {
  const seen = new Set();
  return alerts.filter((a) => {
    const key = `${(a.title || "").toLowerCase()}|${a.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Lee Google Alerts del día vía Gmail API (OAuth).
 */
export async function fetchGoogleAlertsGmailApi({
  onlyToday = true,
  maxMessages = 80,
  mode = "intrant",
  filters,
} = {}) {
  const gmail = getGmailApi();
  const isRelevant = relevanceFor(mode, filters);
  const since = onlyToday
    ? startOfLocalDay()
    : (() => {
        const d = startOfLocalDay();
        d.setDate(d.getDate() - 6);
        return d;
      })();
  const afterSec = Math.floor(since.getTime() / 1000);
  const q = `from:googlealerts-noreply@google.com after:${afterSec}`;

  const listed = await gmail.users.messages.list({
    userId: "me",
    q,
    maxResults: maxMessages,
  });

  const alerts = [];
  for (const ref of listed.data.messages || []) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: ref.id,
      format: "full",
    });
    const headers = full.data.payload?.headers || [];
    const subject = headerValue(headers, "Subject");
    const dateHdr = headerValue(headers, "Date");
    const receivedAt = dateHdr
      ? new Date(dateHdr).toISOString()
      : new Date(Number(full.data.internalDate) || Date.now()).toISOString();

    if (onlyToday && !isSameLocalDay(receivedAt)) continue;

    let html = extractHtmlFromPayload(full.data.payload);
    if (!html && full.data.raw) {
      const parsed = await simpleParser(
        Buffer.from(full.data.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64")
      );
      html = parsed.html || "";
    }

    const query = parseAlertSubject(subject);
    for (const item of html ? parseGoogleAlertsHtml(html) : []) {
      const row = {
        messageUid: String(ref.id),
        alertQuery: query,
        subject,
        receivedAt,
        periodista: "Redacción",
        fuente: DESDE_AGENTE,
        ...item,
      };
      if (!isRelevant(row)) continue;
      alerts.push(row);
    }
  }

  return dedupeAlerts(alerts);
}

/**
 * Google Alerts → alertas tipadas para Sheet (Intrant o eléctrico).
 * Sin Tavily.
 */
export async function fetchGoogleAlertsForSheet({
  onlyToday = true,
  maxMessages = 80,
  mode = "intrant",
  filters,
  onStatus,
} = {}) {
  const resolvedFilters =
    filters ||
    (mode === "electric"
      ? config.electricAlerts?.filters
      : config.googleAlerts?.filters) ||
    [];

  onStatus?.(
    `📬 Leyendo Google Alerts de Gmail (${mode}, ${onlyToday ? "hoy" : "semana"})...`
  );

  // 1) OAuth Gmail API
  try {
    const viaApi = await fetchGoogleAlertsGmailApi({
      onlyToday,
      maxMessages,
      mode,
      filters: resolvedFilters,
    });
    onStatus?.(`✅ Gmail API: ${viaApi.length} noticia(s) filtrada(s)`);
    return viaApi.map((a) => ({
      ...a,
      fuente: DESDE_AGENTE,
      periodista: a.periodista || "Redacción",
    }));
  } catch (error) {
    onStatus?.(`⚠️ Gmail API falló (${error.message}). Probando IMAP...`);
  }

  // 2) IMAP + app password
  const viaImap = await fetchGoogleAlertsImap({
    onlyToday,
    maxMessages,
    filters: resolvedFilters,
    mode,
  });
  const filtered =
    mode === "electric"
      ? viaImap.filter((a) => isRelevantElectricAlert(a, resolvedFilters))
      : viaImap;
  const today = onlyToday ? filterTodayAlerts(filtered) : filtered;
  onStatus?.(`✅ IMAP: ${today.length} noticia(s) filtrada(s)`);
  return today.map((a) => ({
    ...a,
    fuente: DESDE_AGENTE,
    periodista: a.periodista || "Redacción",
  }));
}
