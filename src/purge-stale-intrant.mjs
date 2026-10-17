/**
 * Revisa filas Intrant del día, abre cada URL y borra si la noticia tiene >24h.
 * No inventa fechas: solo elimina tras verificar la URL.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Telegraf } from "telegraf";
import { config } from "./config.mjs";
import { getSheetsApi, resolveAlertsSpreadsheetId } from "./google-auth.mjs";
import { fetchArticleFromUrl } from "./news-fetch.mjs";
import {
  calendarYmd,
  isFreshIntrantAlert,
  newsAgeHours,
  NEWS_TZ,
  todayYmd,
} from "./news-date.mjs";
import {
  HEADERS,
  normalizeFechaKey,
} from "./sheets-alerts.mjs";

const LAST_CHAT_FILE = join(config.root, ".last-chat.json");

function resolveChatId() {
  if (process.env.TELEGRAM_CHAT_ID) return String(process.env.TELEGRAM_CHAT_ID);
  if (!existsSync(LAST_CHAT_FILE)) return "";
  try {
    const data = JSON.parse(readFileSync(LAST_CHAT_FILE, "utf8"));
    return data.chatId ? String(data.chatId) : "";
  } catch {
    return "";
  }
}

function isSheetFechaToday(fecha = "") {
  const ymd = todayYmd();
  const [y, m, d] = ymd.split("-");
  const todayKey = normalizeFechaKey(`${Number(d)}/${Number(m)}/${y}`);
  const key = normalizeFechaKey(String(fecha || "").trim());
  return Boolean(key && todayKey && key === todayKey);
}

function padRow(row = []) {
  const out = [...(row || [])];
  while (out.length < HEADERS.length) out.push("");
  return out.slice(0, HEADERS.length);
}

/** Verifica URL (meta + cuerpo). Sin fecha o >24h → stale. */
async function verifyArticleAge(url, titleHint = "", now = new Date()) {
  const article = await fetchArticleFromUrl(url);
  const title = article.title || titleHint || "";
  const publishedAt = article.publishedAt || "";
  const fresh = isFreshIntrantAlert(
    { url, publishedAt, title },
    { maxAgeHours: 24, now }
  );
  const hours = newsAgeHours({ url, publishedAt }, now);
  let reason = "ok-menor-24h";
  if (!fresh) {
    reason =
      hours == null
        ? "sin-fecha-publicacion"
        : hours > 24
          ? "mayor-24h"
          : "stale";
  }
  return {
    ok: true,
    verified: true,
    stale: !fresh,
    reason,
    title,
    publishedAt: publishedAt || "",
    ageHours: hours == null ? null : Math.round(hours * 10) / 10,
  };
}

/**
 * @param {{ dryRun?: boolean, notify?: boolean, maxRows?: number }} opts
 */
export async function purgeStaleIntrantDayRows({
  dryRun = false,
  notify = true,
  maxRows = 80,
} = {}) {
  const id = await resolveAlertsSpreadsheetId();
  const tab = config.googleAlerts?.sheetName || "Hoja 1";
  const sheets = getSheetsApi();
  const now = new Date();

  const full = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A:H`,
  });
  const values = full.data.values || [];
  if (values.length <= 1) {
    const empty = {
      checked: 0,
      deleted: 0,
      kept: 0,
      failed: 0,
      dryRun,
      spreadsheetId: id,
      sheetName: tab,
      removed: [],
      errors: [],
    };
    if (notify) await notifyTelegramPurge(empty);
    return empty;
  }

  const header = values[0];
  const body = values.slice(1);
  const todayRows = [];
  const otherRows = [];

  for (const row of body) {
    const fecha = String(row[0] || "").trim();
    const url = String(row[6] || "").trim();
    if (isSheetFechaToday(fecha)) {
      todayRows.push(padRow(row));
    } else {
      otherRows.push(padRow(row));
    }
  }

  const toCheck = todayRows.slice(0, maxRows);
  const overflow = todayRows.slice(maxRows);
  const keptToday = [...overflow];
  const removed = [];
  const errors = [];

  for (const row of toCheck) {
    const titulo = String(row[2] || "").trim();
    const url = String(row[6] || "").trim();
    const fecha = String(row[0] || "").trim();

    if (!/^https?:\/\//i.test(url)) {
      keptToday.push(row);
      errors.push({ titulo, url, error: "sin-url" });
      continue;
    }

    try {
      const check = await verifyArticleAge(url, titulo, now);
      if (check.stale) {
        removed.push({
          titulo: check.title || titulo,
          url,
          fechaSheet: fecha,
          publishedAt: check.publishedAt,
          ageHours: check.ageHours,
          reason: check.reason,
        });
      } else {
        keptToday.push(row);
      }
    } catch (error) {
      // Sin verificación fiable → no borrar
      keptToday.push(row);
      errors.push({ titulo, url, error: error.message || String(error) });
    }
  }

  if (!dryRun && removed.length) {
    const next = [HEADERS.length ? HEADERS : header, ...otherRows, ...keptToday];
    // Preferir encabezados canónicos
    next[0] = HEADERS;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: id,
      range: `${tab}!A:H`,
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: next },
    });
  }

  const result = {
    checked: toCheck.length,
    deleted: removed.length,
    kept: keptToday.length + otherRows.length,
    failed: errors.length,
    dryRun,
    spreadsheetId: id,
    sheetName: tab,
    todayYmd: calendarYmd(now, NEWS_TZ),
    removed,
    errors: errors.slice(0, 20),
  };

  if (notify) await notifyTelegramPurge(result);
  return result;
}

export async function notifyTelegramPurge(result) {
  const token = config.telegram?.token;
  const chatId = resolveChatId();
  if (!token || !chatId) {
    console.warn("Telegram: sin token/chat — no aviso de purge.");
    return;
  }

  const now = new Date().toLocaleString("es-DO", {
    timeZone: NEWS_TZ,
    dateStyle: "short",
    timeStyle: "short",
  });
  const lines = [
    result.dryRun
      ? "🧹 Intrant · revisión >24h (dry-run)"
      : "🧹 Intrant · limpieza noticias >24h",
    `🕐 ${now}`,
    `📅 Filas del día: ${result.todayYmd || todayYmd()}`,
    `🔎 Revisadas: ${result.checked}`,
    `🗑️ Borradas: ${result.deleted}${result.dryRun ? " (no aplicadas)" : ""}`,
    `⚠️ Sin verificar: ${result.failed}`,
    "",
  ];

  if (result.removed?.length) {
    lines.push("Eliminadas (URL verificada, >24h):");
    for (const r of result.removed.slice(0, 12)) {
      const age =
        r.ageHours != null ? ` · ${r.ageHours}h` : "";
      lines.push(`• ${(r.titulo || "sin título").slice(0, 80)}${age}`);
      if (r.url) lines.push(`  ${r.url}`);
    }
    if (result.removed.length > 12) {
      lines.push(`… y ${result.removed.length - 12} más`);
    }
  } else {
    lines.push("Ninguna fila del día superaba 24h (tras abrir URL).");
  }

  if (result.errors?.length) {
    lines.push("", "No se pudo verificar (se conservan):");
    for (const e of result.errors.slice(0, 5)) {
      lines.push(`• ${(e.titulo || e.url || "?").slice(0, 70)} — ${e.error}`);
    }
  }

  if (result.spreadsheetId) {
    lines.push(
      "",
      `Sheet: https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`
    );
  }

  const bot = new Telegraf(token);
  await bot.telegram.sendMessage(chatId, lines.join("\n"));
  console.log(`Telegram: aviso purge → chat ${chatId}`);
}
