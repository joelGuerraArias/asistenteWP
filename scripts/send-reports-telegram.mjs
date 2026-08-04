/**
 * Envía a Telegram:
 * 1) Digest de Google Alerts Intrant (hoy)
 * 2) Reportes MONITOREO TV Intrant + Edesur (texto + PDF)
 *
 *   node scripts/send-reports-telegram.mjs
 *   node scripts/send-reports-telegram.mjs --chat=1651659573
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Input } from "telegraf";
import { Telegraf } from "telegraf";
import { config } from "../src/config.mjs";
import { fetchGoogleAlertsForSheet } from "../src/gmail-alerts.mjs";
import { prepareClientEmail } from "../src/informe-email.mjs";

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

function formatAlertsMessage(alerts) {
  const lines = [
    "📰 *Noticias INTRANT (hoy)*",
    `Total: *${alerts.length}* (Tavily · periodista + resumen)`,
    "",
  ];
  alerts.slice(0, 15).forEach((a, i) => {
    lines.push(`${i + 1}. ${a.title}`);
    lines.push(`   Periodista: ${a.periodista || "Redacción"} · ${a.source || ""}`);
    if (a.snippet) lines.push(`   ${(a.snippet || "").slice(0, 180)}…`);
    if (a.url) lines.push(`   ${a.url}`);
    lines.push("");
  });
  lines.push(
    `Sheet: https://docs.google.com/spreadsheets/d/${config.googleAlerts.sheetId}`
  );
  return lines.join("\n");
}

function formatMonitoreoMessage(clientLabel, items, displayDate, pdfName) {
  const pos = items.filter((i) => i.tono === "positiva").length;
  const neg = items.filter((i) => i.tono === "negativa").length;
  const neu = items.filter((i) => i.tono === "neutral").length;
  const lines = [
    `📺 *MONITOREO TV — ${clientLabel}*`,
    `${displayDate}`,
    `Menciones: *${items.length}* (➕${pos} / ➖${neg} / ○${neu})`,
    "",
  ];
  items.slice(0, 12).forEach((item, i) => {
    const tono = (item.tono || "neutral").toUpperCase();
    lines.push(`${i + 1}. [${tono}] ${item.tema || item.term}`);
    if (item.medio) lines.push(`   Medio: *${item.medio}*`);
    lines.push("");
  });
  if (items.length > 12) lines.push(`… y ${items.length - 12} más`);
  if (pdfName) lines.push(`📎 PDF: ${pdfName}`);
  return lines.join("\n");
}

async function replyLong(bot, chatId, text) {
  for (const part of chunkText(text)) {
    await bot.telegram.sendMessage(chatId, part, {
      disable_web_page_preview: true,
    });
  }
}

const opts = parseArgs(process.argv.slice(2));
const chatId = resolveChatId(opts.chatId);

if (!config.telegram.token) {
  console.error("Falta TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const bot = new Telegraf(config.telegram.token);

try {
  console.log(`Enviando reportes a Telegram chat ${chatId}...`);

  await bot.telegram.sendMessage(
    chatId,
    "📬 Preparando reportes: Google Alerts Intrant + MONITOREO TV…"
  );

  // 1) Google Alerts Intrant (Gmail)
  const alerts = await fetchGoogleAlertsForSheet({
    onlyToday: true,
    maxMessages: 80,
    mode: "intrant",
  });
  await replyLong(bot, chatId, formatAlertsMessage(alerts));
  console.log(`✅ Intrant Google Alerts: ${alerts.length}`);

  // 2) MONITOREO TV + RADIO · Intrant (+ Edesur si está habilitado)
  for (const channel of ["tv", "radio"]) {
    const clients =
      config.edesurEnabled === false ? ["intrant"] : ["intrant", "edesur"];
    for (const clientId of clients) {
      let prepared;
      try {
        prepared = await prepareClientEmail(clientId, new Date(), { channel });
      } catch (error) {
        console.warn(`MONITOREO ${channel}/${clientId}:`, error.message);
        continue;
      }
      const label = prepared.client.monitorLabel || "MONITOREO";
      const msg = formatMonitoreoMessage(
        `${prepared.client.label} (${channel.toUpperCase()})`,
        prepared.items,
        prepared.analisis.displayDate,
        prepared.pdf?.filename
      );
      await replyLong(bot, chatId, msg);

      if (prepared.pdf?.path && existsSync(prepared.pdf.path)) {
        await bot.telegram.sendDocument(
          chatId,
          Input.fromLocalFile(prepared.pdf.path, prepared.pdf.filename),
          {
            caption: `${label} — ${prepared.client.label}`,
          }
        );
      }
      console.log(
        `✅ ${label} ${prepared.client.label}: ${prepared.items.length} + PDF`
      );
    }
  }

  await bot.telegram.sendMessage(chatId, "✅ Reportes enviados.");
  console.log("Listo.");
  process.exit(0);
} catch (error) {
  console.error("❌", error.message);
  try {
    await bot.telegram.sendMessage(chatId, `❌ Error al enviar reportes: ${error.message}`);
  } catch {
    // ignore
  }
  process.exit(1);
}
