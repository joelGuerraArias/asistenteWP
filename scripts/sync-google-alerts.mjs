/**
 * Sync Google Alerts (Gmail) → Sheet Intrant.
 * Si encuentra noticias, reporta por Telegram.
 *
 *   npm run alerts:sync
 *   npm run alerts:sync -- --replace
 *   npm run alerts:dry
 *   node scripts/sync-google-alerts.mjs --no-telegram
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Telegraf } from "telegraf";
import { config } from "../src/config.mjs";
import { fetchGoogleAlertsForSheet } from "../src/gmail-alerts.mjs";
import { appendAlertsToSheet, replaceAlertsSheet } from "../src/sheets-alerts.mjs";

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), "..");
const LAST_CHAT_FILE = join(root, ".last-chat.json");
const isMain =
  Boolean(process.argv[1]) &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    replace: true,
    onlyToday: true,
    notifyTelegram: true,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    if (arg === "--replace") opts.replace = true;
    if (arg === "--append") opts.replace = false;
    if (arg === "--week") opts.onlyToday = false;
    if (arg === "--no-telegram") opts.notifyTelegram = false;
  }
  return opts;
}

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

function chunkText(text, max = 3900) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

export function formatIntrantAlertsTelegram(alerts, spreadsheetId) {
  const now = new Date().toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const lines = [
    `📰 Intrant · Google Alerts (${alerts.length})`,
    `🕐 ${now}`,
    "Fuente: Gmail",
    "",
  ];
  alerts.slice(0, 20).forEach((a, i) => {
    lines.push(`${i + 1}. ${a.title || "(sin título)"}`);
    const meta = [a.source, a.alertQuery].filter(Boolean).join(" · ");
    if (meta) lines.push(`   ${meta}`);
    if (a.url) lines.push(`   ${a.url}`);
    lines.push("");
  });
  if (alerts.length > 20) lines.push(`… y ${alerts.length - 20} más`);
  if (spreadsheetId) {
    lines.push(`Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  }
  return lines.join("\n");
}

export async function notifyIntrantAlertsTelegram(alerts, spreadsheetId) {
  if (!alerts?.length) return false;
  const token = config.telegram?.token;
  const chatId = resolveChatId();
  if (!token || !chatId) {
    console.warn("Telegram: sin token/chat — no reporto alertas Intrant.");
    return false;
  }
  const bot = new Telegraf(token);
  const text = formatIntrantAlertsTelegram(alerts, spreadsheetId);
  for (const part of chunkText(text)) {
    await bot.telegram.sendMessage(chatId, part, {
      disable_web_page_preview: true,
    });
  }
  console.log(`Telegram: Intrant ${alerts.length} alerta(s) → chat ${chatId}`);
  return true;
}

const opts = parseArgs(process.argv.slice(2));

if (isMain) {
  try {
    console.log(
      `📬 Google Alerts Intrant desde Gmail (${opts.onlyToday ? "hoy" : "semana"})...`
    );
    console.log(
      `Filtros: ${(config.googleAlerts?.filters || []).join(", ") || "(default)"}`
    );

    const alerts = await fetchGoogleAlertsForSheet({
      onlyToday: opts.onlyToday,
      maxMessages: 100,
      mode: "intrant",
      onStatus: (m) => console.log(m),
    });

    console.log(`Encontradas ${alerts.length} alerta(s).`);

    if (opts.dryRun) {
      for (const a of alerts.slice(0, 20)) {
        console.log(`- ${a.title}`);
        console.log(`  Medio: ${a.source} | Query: ${a.alertQuery}`);
        console.log(`  ${a.url}`);
        console.log("");
      }
      process.exit(0);
    }

    const result = opts.replace
      ? await replaceAlertsSheet(alerts)
      : await appendAlertsToSheet(alerts);

    if (result.removedTodayNoise != null) {
      console.log(
        `✅ Sheet: ${result.added} filas hoy | quitadas previas auto: ${result.removedTodayNoise} | histórico: ${result.keptHistorical}`
      );
    } else {
      console.log(`✅ Sheet: +${result.added} (skip ${result.skipped})`);
    }
    console.log(`📄 https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`);

    if (opts.notifyTelegram && alerts.length) {
      try {
        await notifyIntrantAlertsTelegram(alerts, result.spreadsheetId);
      } catch (error) {
        console.warn(`Telegram Intrant falló: ${error.message}`);
      }
    } else if (!alerts.length) {
      console.log("Sin alertas Intrant — no se envía Telegram.");
    }
  } catch (error) {
    console.error("❌", error.message);
    process.exit(1);
  }
}
