import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "./config.mjs";
import {
  isRelevantElectricAlert,
  isRelevantIntrantAlert,
  parseAlertSubject,
  parseGoogleAlertsHtml,
} from "./google-alerts-parse.mjs";
import { DESDE_AGENTE } from "./sheets-alerts.mjs";

/** True si la fecha ISO cae en el día local actual. */
export function isSameLocalDay(iso, now = new Date()) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function filterTodayAlerts(alerts, now = new Date()) {
  return alerts.filter((a) => isSameLocalDay(a.receivedAt, now));
}

/** Fallback IMAP si no hay OAuth (requiere app password). */
export async function fetchGoogleAlertsImap({
  sinceDays = 1,
  onlyToday = true,
  maxMessages = 80,
  mode = "intrant",
  filters = config.googleAlerts?.filters || [],
} = {}) {
  const isRelevant =
    mode === "electric"
      ? (row) => isRelevantElectricAlert(row, filters)
      : (row) => isRelevantIntrantAlert(row, filters);
  const { user, appPassword } = config.googleAlerts?.gmail || {};
  if (!user || !appPassword) {
    throw new Error(
      "Falta OAuth (GOOGLE_REFRESH_TOKEN) o GMAIL_ALERTS_APP_PASSWORD en .env"
    );
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass: appPassword },
    logger: false,
  });

  // Solo desde inicio del día local (o sinceDays atrás si onlyToday=false)
  const since = new Date();
  if (onlyToday) {
    since.setHours(0, 0, 0, 0);
  } else {
    since.setDate(since.getDate() - Math.max(0, sinceDays - 1));
    since.setHours(0, 0, 0, 0);
  }
  const alerts = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({
        from: "googlealerts-noreply@google.com",
        since,
      });
      const recent = (uids || []).slice(-maxMessages);
      for (const uid of recent) {
        const msg = await client.fetchOne(uid, { source: true, envelope: true });
        if (!msg?.source) continue;
        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || "";
        const html = parsed.html || "";
        const text = parsed.text || "";
        const query = parseAlertSubject(subject);
        const receivedAt = parsed.date?.toISOString() || new Date().toISOString();
        if (onlyToday && !isSameLocalDay(receivedAt)) continue;
        // Tomar todos los correos Google Alerts del día; el filtro fino es por noticia
        const items = html ? parseGoogleAlertsHtml(html) : [];
        for (const item of items) {
          const row = {
            messageUid: String(uid),
            alertQuery: query,
            subject,
            receivedAt,
            ...item,
          };
          if (!isRelevant(row)) continue;
          alerts.push({
            ...row,
            fuente: DESDE_AGENTE,
            periodista: "Redacción",
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  const seen = new Set();
  return alerts.filter((a) => {
    const key = `${(a.title || "").toLowerCase()}|${a.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
