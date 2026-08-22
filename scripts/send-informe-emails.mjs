/**
 * Envía los correos diarios Intrant / Edesur desde Analisishoy / AnalisisHoyRadio.
 *
 * Uso:
 *   node scripts/send-informe-emails.mjs
 *   node scripts/send-informe-emails.mjs --channel=radio
 *   node scripts/send-informe-emails.mjs --channel=tv,radio
 *   node scripts/send-informe-emails.mjs --dry-run --channel=radio
 *   node scripts/send-informe-emails.mjs --only=edesur --channel=radio
 *   node scripts/send-informe-emails.mjs --to=autosemana@gmail.com
 *   node scripts/send-informe-emails.mjs --date=20260713
 *   node scripts/send-informe-emails.mjs --no-telegram
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Telegraf } from "telegraf";
import { config } from "../src/config.mjs";
import {
  mergeFixedCc,
  prepareClientEmail,
  sendDailyInformeEmails,
  sendEmail,
} from "../src/informe-email.mjs";
import {
  resolveAnalisisHoyPath,
  todayStamp,
} from "../src/informe-parse.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    to: null,
    date: null,
    only: null,
    channel: "tv,radio",
    notifyTelegram: true,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-telegram") opts.notifyTelegram = false;
    else if (arg.startsWith("--to=")) opts.to = arg.slice(5).trim();
    else if (arg.startsWith("--date=")) opts.date = arg.slice(7).trim();
    else if (arg.startsWith("--only=")) opts.only = arg.slice(7).trim().toLowerCase();
    else if (arg.startsWith("--channel=")) opts.channel = arg.slice(10).trim().toLowerCase();
  }
  return opts;
}

function parseDateStamp(stamp) {
  if (!stamp) return new Date();
  if (!/^\d{8}$/.test(stamp)) throw new Error(`Fecha inválida: ${stamp} (use YYYYMMDD)`);
  const y = Number(stamp.slice(0, 4));
  const m = Number(stamp.slice(4, 6)) - 1;
  const d = Number(stamp.slice(6, 8));
  return new Date(y, m, d);
}

function parseChannels(raw) {
  return String(raw || "tv")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function resolveChatId() {
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
  return null;
}

function expectedAnalisisName(channel, stamp) {
  return channel === "radio"
    ? `AnalisisHoyRadio_${stamp}.md`
    : `Analisishoy_${stamp}.md`;
}

function findMissingAnalisis(date, channels) {
  const stamp = todayStamp(date);
  const missing = [];
  for (const ch of channels) {
    const path = resolveAnalisisHoyPath(date, ch);
    if (!path) {
      missing.push({
        channel: ch,
        stamp,
        expected: expectedAnalisisName(ch, stamp),
        dir: config.informes.dir,
      });
    }
  }
  return missing;
}

async function getTelegramBot() {
  if (!config.telegram?.token) return null;
  const chatId = resolveChatId();
  if (!chatId) return null;
  return { bot: new Telegraf(config.telegram.token), chatId };
}

async function notifyMissingAnalisis(missing, { sending = [] } = {}) {
  if (!missing?.length) return;
  const tg = await getTelegramBot();
  if (!tg) {
    console.warn("Telegram: no pude avisar archivos faltantes (sin token/chat).");
    return;
  }
  const lines = [
    "⚠️ Falta análisis del día",
    `📅 ${missing[0].stamp}`,
    `📁 ${missing[0].dir}`,
    "",
  ];
  for (const m of missing) {
    const label = m.channel === "radio" ? "RADIO" : "TV";
    lines.push(`❌ ${label}: no está \`${m.expected}\``);
  }
  if (sending.length) {
    lines.push(
      "",
      `✅ Se envía solo: ${sending.map((c) => c.toUpperCase()).join(", ")}`,
      "El canal sin MD se omite; no se reenvía un archivo viejo."
    );
  } else {
    lines.push("", "⛔ No se envió ningún correo.", "Genera el MD de hoy y reintenta.");
  }
  await tg.bot.telegram.sendMessage(tg.chatId, lines.join("\n"));
  console.log(`Telegram: aviso de MD faltante → chat ${tg.chatId}`);
}

function formatInformeTelegramNotice(results = []) {
  const now = new Date().toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const lines = ["📧 Monitoreo enviado", `🕐 ${now}`, ""];

  const sent = (results || []).filter((r) => !r.skipped);
  const skipped = (results || []).filter((r) => r.skipped);

  if (!sent.length && !skipped.length) {
    lines.push("Sin resultados.");
    return lines.join("\n");
  }

  for (const r of sent) {
    const ch = (r.channel || "?").toUpperCase();
    const client = (r.client || "?").toUpperCase();
    lines.push(`✅ ${ch} · ${client}: ${r.count ?? 0} mención(es)`);
    if (r.to) lines.push(`   → ${r.to}`);
  }
  for (const r of skipped) {
    const ch = (r.channel || "?").toUpperCase();
    if (/No encontré|sin archivo/i.test(r.reason || "")) {
      lines.push(`⚠️ ${ch}: falta análisis del día (no enviado)`);
    } else {
      const client = (r.client || "?").toUpperCase();
      lines.push(`⏭ ${ch} · ${client}: omitido (${r.reason || "skip"})`);
    }
  }

  return lines.join("\n");
}

async function notifyTelegramInforme(results) {
  const tg = await getTelegramBot();
  if (!tg) {
    console.warn("Telegram: sin TELEGRAM_BOT_TOKEN/chat, no aviso al bot.");
    return;
  }
  await tg.bot.telegram.sendMessage(tg.chatId, formatInformeTelegramNotice(results));
  console.log(`Telegram: aviso enviado a chat ${tg.chatId}`);
}

async function notifyTelegramError(message) {
  const tg = await getTelegramBot();
  if (!tg) return;
  await tg.bot.telegram.sendMessage(
    tg.chatId,
    `❌ Falló el envío de monitoreo\n${message}`
  );
}

async function sendOnlyClient(clientId, { date, to, dryRun, channel }) {
  if (clientId === "edesur" && config.edesurEnabled === false) {
    console.log("Edesur omitido (EDESUR_ENABLED=false)");
    return {
      dryRun: true,
      file: "",
      results: [
        {
          client: "edesur",
          channel,
          skipped: true,
          reason: "EDESUR_ENABLED=false",
          to: "(omitido)",
          count: 0,
        },
      ],
    };
  }
  const prepared = await prepareClientEmail(clientId, date, { channel });
  const dest =
    to ||
    (clientId === "edesur"
      ? config.informes.emailEdesur
      : config.informes.emailIntrant);
  const rawCc = to
    ? ""
    : clientId === "edesur"
      ? config.informes.emailEdesurCc
      : config.informes.emailIntrantCc;
  const cc = mergeFixedCc(rawCc);

  if (!dest) throw new Error(`Falta destino para ${clientId}`);

  if (dryRun) {
    return {
      dryRun: true,
      file: prepared.analisis.path,
      results: [
        {
          client: clientId,
          channel,
          to: dest,
          cc: cc || null,
          count: prepared.items.length,
          pdf: prepared.pdf.path,
          subject: prepared.email.subject,
        },
      ],
    };
  }

  const sent = await sendEmail({
    to: dest,
    cc,
    ...prepared.email,
    attachments: prepared.attachments,
  });

  return {
    dryRun: false,
    file: prepared.analisis.path,
    results: [
      {
        client: clientId,
        channel,
        to: dest,
        cc: cc || null,
        count: prepared.items.length,
        pdf: prepared.pdf.path,
        ...sent,
      },
    ],
  };
}

const opts = parseArgs(process.argv.slice(2));
const date = parseDateStamp(opts.date);
const channels = parseChannels(opts.channel);

try {
  const onlyLabel = opts.only ? opts.only.toUpperCase() : "Intrant + Edesur";
  const channelLabel = channels.map((c) => c.toUpperCase()).join("+");
  console.log(
    opts.dryRun
      ? `Modo dry-run — ${onlyLabel} · ${channelLabel}...`
      : `Enviando correos ${onlyLabel} · ${channelLabel}...`
  );

  const missing = findMissingAnalisis(date, channels);
  const available = channels.filter(
    (ch) => !missing.some((m) => m.channel === ch)
  );

  if (missing.length) {
    for (const m of missing) {
      console.warn(`⚠️  Falta ${m.expected} en ${m.dir}`);
    }
    if (opts.notifyTelegram) {
      try {
        await notifyMissingAnalisis(missing, { sending: available });
      } catch (error) {
        console.warn(`Telegram aviso MD faltante falló: ${error.message}`);
      }
    }
    if (!available.length) {
      console.error(
        "❌ Falta análisis del día en todos los canales. No se envía ningún correo (solo se acepta el MD de hoy)."
      );
      process.exit(1);
    }
    console.warn(
      `⏭  Sin MD: ${missing.map((m) => m.channel).join(", ")} — se envía: ${available.join(", ")}`
    );
  }

  let result;
  if (opts.only === "edesur" || opts.only === "intrant") {
    const allResults = [];
    let file = "";
    for (const ch of available) {
      try {
        const part = await sendOnlyClient(opts.only, {
          date,
          to: opts.to || undefined,
          dryRun: opts.dryRun,
          channel: ch,
        });
        file = file || part.file;
        allResults.push(...part.results);
      } catch (error) {
        if (/No encontré/i.test(error.message)) {
          console.warn(`⚠️  Canal ${ch}: ${error.message}`);
          allResults.push({
            client: opts.only,
            channel: ch,
            skipped: true,
            reason: error.message,
            to: "(sin archivo del día)",
            count: 0,
          });
          continue;
        }
        throw error;
      }
    }
    if (!allResults.length) {
      throw new Error("No se generó ningún informe para ese cliente/canal");
    }
    result = { dryRun: opts.dryRun, file, results: allResults };
  } else {
    result = await sendDailyInformeEmails({
      date,
      toIntrant: opts.to || undefined,
      toEdesur: opts.to || undefined,
      dryRun: opts.dryRun,
      channel: available,
    });
  }

  console.log("Archivo:", result.file);
  if (result.files?.length > 1) {
    for (const f of result.files) console.log("  ·", f);
  }

  if (result.dryRun && result.intrant && available.length === 1) {
    console.log("INTRANT:", result.intrant);
    console.log("EDESUR:", result.edesur);
  } else {
    for (const r of result.results || []) {
      const ch = r.channel ? `[${r.channel}] ` : "";
      if (r.skipped) {
        console.log(`⏭  ${ch}${r.client.toUpperCase()} omitido (${r.reason || "skip"})`);
        continue;
      }
      const cc = r.cc ? ` | CC: ${r.cc}` : "";
      const pdf = r.pdf ? ` | PDF: ${r.pdf}` : "";
      console.log(
        `✅ ${ch}${r.client.toUpperCase()} → ${r.to}${cc}${pdf} (${r.count} menciones) id=${r.messageId || "dry-run"}`
      );
    }
  }

  if (opts.notifyTelegram && !opts.dryRun) {
    try {
      await notifyTelegramInforme(result.results || []);
    } catch (error) {
      console.warn(`Telegram aviso falló: ${error.message}`);
    }
  }
} catch (error) {
  console.error("❌", error.message);
  if (opts.notifyTelegram && !opts.dryRun) {
    try {
      await notifyTelegramError(error.message);
    } catch {
      // ignore notify failure
    }
  }
  process.exit(1);
}
