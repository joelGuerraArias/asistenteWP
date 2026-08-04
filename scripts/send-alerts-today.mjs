/**
 * Sync Google Alerts de hoy → Sheets + digest Telegram (Intrant + eléctrico).
 *   node scripts/send-alerts-today.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Telegraf } from "telegraf";
import { config } from "../src/config.mjs";
import { fetchGoogleAlertsForSheet } from "../src/gmail-alerts.mjs";
import { replaceAlertsSheet } from "../src/sheets-alerts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveChatId() {
  const last = join(root, ".last-chat.json");
  if (existsSync(last)) {
    const data = JSON.parse(readFileSync(last, "utf8"));
    if (data.chatId) return String(data.chatId);
  }
  throw new Error("No hay chat de Telegram (.last-chat.json)");
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

function formatDigest(label, alerts, sheetId) {
  const lines = [
    `📰 ${label} (hoy · ${alerts.length})`,
    "Fuente: Google Alerts Gmail · desde = firma agente",
    "",
  ];
  if (!alerts.length) {
    lines.push("Sin alertas de hoy con keyword en el título.");
  } else {
    alerts.slice(0, 15).forEach((a, i) => {
      lines.push(`${i + 1}. ${a.title}`);
      lines.push(`   ${a.source || ""} · ${a.alertQuery || ""}`);
      if (a.url) lines.push(`   ${a.url}`);
      lines.push("");
    });
    if (alerts.length > 15) lines.push(`… y ${alerts.length - 15} más`);
  }
  if (sheetId) {
    lines.push(`Sheet: https://docs.google.com/spreadsheets/d/${sheetId}`);
  }
  return lines.join("\n");
}

const chatId = resolveChatId();
const bot = new Telegraf(config.telegram.token);

console.log(`Chat Telegram: ${chatId}`);

const intrant = await fetchGoogleAlertsForSheet({
  onlyToday: true,
  maxMessages: 100,
  mode: "intrant",
  onStatus: (m) => console.log(m),
});
console.log(`Intrant: ${intrant.length}`);
const r1 = await replaceAlertsSheet(intrant);
console.log(
  `Sheet Intrant: ${r1.added} hoy | histórico ${r1.keptHistorical}`
);

let electricCount = 0;
const sheetId = config.electricAlerts?.sheetId;
if (config.edesurEnabled !== false) {
  const electric = await fetchGoogleAlertsForSheet({
    onlyToday: true,
    maxMessages: 100,
    mode: "electric",
    onStatus: (m) => console.log(m),
  });
  electricCount = electric.length;
  console.log(`Eléctrico: ${electric.length}`);
  const sheetName = config.electricAlerts?.sheetName || "Hoja 1";
  const r2 = await replaceAlertsSheet(electric, {
    spreadsheetId: sheetId,
    sheetName,
  });
  console.log(
    `Sheet eléctrico: ${r2.added} hoy | histórico ${r2.keptHistorical}`
  );
  for (const part of chunkText(formatDigest("ELÉCTRICO", electric, sheetId))) {
    await bot.telegram.sendMessage(chatId, part, {
      disable_web_page_preview: true,
    });
  }
} else {
  console.log("Eléctrico omitido (EDESUR_ENABLED=false)");
}

await bot.telegram.sendMessage(
  chatId,
  config.edesurEnabled === false
    ? `📬 Alertas de hoy (solo Intrant)\nIntrant: ${intrant.length}\nEdesur: pausado`
    : `📬 Alertas de hoy listas\nIntrant: ${intrant.length}\nEléctrico: ${electricCount}`
);

for (const part of chunkText(
  formatDigest("INTRANT", intrant, config.googleAlerts.sheetId)
)) {
  await bot.telegram.sendMessage(chatId, part, {
    disable_web_page_preview: true,
  });
}

console.log("✅ Enviado a Telegram");
