/**
 * Busca noticias eléctricas de hoy → Sheet + Telegram.
 *   node scripts/send-electric-today.mjs
 *   node scripts/send-electric-today.mjs --chat=ID
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Telegraf } from "telegraf";
import { config } from "../src/config.mjs";
import { fetchGoogleAlertsForSheet } from "../src/gmail-alerts.mjs";
import { replaceAlertsSheet } from "../src/sheets-alerts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = { chatId: null };
  for (const arg of argv) {
    if (arg.startsWith("--chat=")) opts.chatId = arg.slice(7).trim();
  }
  return opts;
}

function resolveChatId(cliChat) {
  if (cliChat) return cliChat;
  const last = join(root, ".last-chat.json");
  if (existsSync(last)) {
    try {
      const data = JSON.parse(readFileSync(last, "utf8"));
      if (data.chatId) return String(data.chatId);
    } catch {
      // ignore
    }
  }
  const fromEnv = config.telegram.allowedChatIds?.[0];
  if (fromEnv) return String(fromEnv);
  throw new Error("No hay chat de Telegram. Usa --chat=ID o escribe antes al bot.");
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

const opts = parseArgs(process.argv.slice(2));
const chatId = resolveChatId(opts.chatId);

if (!config.telegram.token) {
  console.error("Falta TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const bot = new Telegraf(config.telegram.token);
const sheetId = config.electricAlerts?.sheetId;
const sheetName = config.electricAlerts?.sheetName || "Hoja 1";

try {
  if (config.edesurEnabled === false) {
    console.log("Edesur/eléctrico pausado (EDESUR_ENABLED=false)");
    process.exit(0);
  }
  console.log(`Chat: ${chatId}`);
  await bot.telegram.sendMessage(
    chatId,
    "⚡ Leyendo Google Alerts eléctricas de Gmail (hoy)…"
  );

  const alerts = await fetchGoogleAlertsForSheet({
    onlyToday: true,
    maxMessages: 80,
    mode: "electric",
    onStatus: (m) => console.log(m),
  });
  console.log(`Encontradas: ${alerts.length}`);

  if (sheetId) {
    const result = await replaceAlertsSheet(alerts, {
      spreadsheetId: sheetId,
      sheetName,
    });
    console.log(
      `Sheet: ${result.added} hoy | quitadas: ${result.removedTodayNoise} | historico: ${result.keptHistorical}`
    );
  }

  if (!alerts.length) {
    await bot.telegram.sendMessage(
      chatId,
      "No hay noticias eléctricas de hoy con keywords en el título."
    );
    process.exit(0);
  }

  const lines = [
    `Noticias ELECTRICAS (hoy · ${alerts.length})`,
    "Filtro: edesur/edeeste/egehid/eted/cued/marranzini/apagones/punta catalina en título",
    "",
  ];
  alerts.slice(0, 12).forEach((a, i) => {
    lines.push(`${i + 1}. ${a.title}`);
    lines.push(`   ${a.periodista || "Redacción"} · ${a.source || ""}`);
    if (a.snippet) lines.push(`   ${a.snippet.slice(0, 160)}…`);
    if (a.url) lines.push(`   ${a.url}`);
    lines.push("");
  });
  if (sheetId) {
    lines.push(`Sheet: https://docs.google.com/spreadsheets/d/${sheetId}`);
  }

  for (const part of chunkText(lines.join("\n"))) {
    await bot.telegram.sendMessage(chatId, part, {
      disable_web_page_preview: true,
    });
  }
  console.log("Enviado a Telegram.");
  process.exit(0);
} catch (error) {
  console.error("❌", error.message);
  try {
    await bot.telegram.sendMessage(
      chatId,
      `❌ Error noticias eléctricas: ${error.message}`
    );
  } catch {
    // ignore
  }
  process.exit(1);
}
