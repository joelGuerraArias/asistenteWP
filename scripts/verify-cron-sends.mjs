/**
 * Verifica envíos programados ~5 min después de cada pauta.
 * Revisa logs (+ Word del REPORTE) y avisa por Telegram si falló o no corrió.
 *
 *   node scripts/verify-cron-sends.mjs
 *   node scripts/verify-cron-sends.mjs --all
 *   node scripts/verify-cron-sends.mjs --notify-ok
 *   node scripts/verify-cron-sends.mjs --no-telegram
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Telegraf } from "telegraf";
import { config } from "../src/config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = join(root, "logs");

const OFFSET_MIN = Math.max(
  1,
  Math.min(30, Number(process.env.VERIFY_SENDS_OFFSET_MIN || 5))
);
/** Ventana: pauta hace entre (offset-2) y (offset+grace) minutos */
const GRACE_MIN = Math.max(
  2,
  Math.min(20, Number(process.env.VERIFY_SENDS_GRACE_MIN || 8))
);

function parseArgs(argv) {
  const opts = {
    all: false,
    notifyOk: process.env.VERIFY_SENDS_NOTIFY_OK === "true",
    notifyTelegram: true,
  };
  for (const arg of argv) {
    if (arg === "--all") opts.all = true;
    else if (arg === "--notify-ok") opts.notifyOk = true;
    else if (arg === "--no-telegram") opts.notifyTelegram = false;
  }
  return opts;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function hm({ hour, minute }) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function addMinutes(hour, minute, delta) {
  let total = hour * 60 + minute + delta;
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

function minutesSinceMidnight(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseLogStamp(line) {
  const m = String(line).match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})]/);
  if (!m) return null;
  return new Date(
    Number(m[1].slice(0, 4)),
    Number(m[1].slice(5, 7)) - 1,
    Number(m[1].slice(8, 10)),
    Number(m[2]),
    Number(m[3]),
    Number(m[4])
  );
}

function feedRepostTimes() {
  const [sh, sm = "0"] = String(config.feedRepost?.start || "09:15").split(":");
  const [eh, em = "0"] = String(config.feedRepost?.end || "21:15").split(":");
  const startH = Number(sh) || 9;
  const startM = Number(sm) || 15;
  const endH = Number(eh) || 21;
  const endM = Number(em) || 15;
  const times = [];
  for (let h = startH; h <= endH; h++) {
    const t = { hour: h, minute: startM };
    if (h * 60 + startM > endH * 60 + endM) break;
    times.push(t);
  }
  return times;
}

function encuestasPublishTime() {
  const [h, m = "0"] = String(config.encuestas?.cronTime || "10:00").split(":");
  return [{ hour: Number(h) || 10, minute: Number(m) || 0 }];
}

function jobsCatalog() {
  return [
    {
      id: "reporte",
      label: "REPORTE Intrant",
      task: "AsistenteWP-REPORTE",
      log: "reporte-intrant.log",
      times: () => config.reporte?.cronTimes || [],
      success: /Fin exit=0|REPORTE Intrant enviado/i,
      fail: /Fin exit=[1-9]|Error:|DeepSeek \d{3}/i,
      extraOk: checkReporteDocx,
    },
    {
      id: "monitoreo",
      label: "Monitoreo TV/Radio",
      task: "AsistenteWP-MonitoreoTV",
      log: "informe-emails.log",
      times: () => config.informes?.cronTimes || [],
      success: /Fin \(exit=0\)/i,
      fail: /Fin \(exit=[1-9]|Falló el envío/i,
    },
    {
      id: "dgcp",
      label: "DGCP Digest",
      task: "AsistenteWP-DGCP-Digest",
      log: "dgcp-digest.log",
      times: () => config.dgcp?.cronTimes || [],
      success: /Fin \(exit=0\)/i,
      fail: /Fin \(exit=[1-9]|Falló el envío/i,
    },
    {
      id: "site-news",
      label: "Intrant Site News",
      task: "AsistenteWP-IntrantSiteNews",
      log: "intrant-site-news.log",
      times: () => config.intrantSiteNews?.cronTimes || [],
      success: /Fin \(exit=0\)/i,
      fail: /Fin \(exit=[1-9]/i,
    },
    {
      id: "encuestas",
      label: "Encuestas",
      task: "AsistenteWP-Encuestas",
      log: "encuestas.log",
      times: encuestasPublishTime,
      success: /Fin publish \(exit=0\)/i,
      fail: /Fin publish \(exit=[1-9]|ERROR:/i,
    },
    {
      id: "feed",
      label: "Feed → redes",
      task: "AsistenteWP-FeedRepost",
      log: "feed-repost.log",
      times: feedRepostTimes,
      success: /Fin \(exit=0\)/i,
      fail: /Fin \(exit=[1-9]|ERROR:/i,
      quietOk: true,
    },
  ];
}

function checkReporteDocx(since) {
  const dir = config.informes?.dir;
  if (!dir || !existsSync(dir)) return { ok: false, detail: "carpeta informes ausente" };
  const stamp = `${since.getFullYear()}${pad2(since.getMonth() + 1)}${pad2(since.getDate())}`;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`REPORTE_INTRANT_${stamp}`) && f.endsWith(".docx"))
    .map((f) => {
      const p = join(dir, f);
      return { name: f, mtime: statSync(p).mtimeMs };
    })
    .filter((f) => f.mtime >= since.getTime() - 60_000)
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return { ok: false, detail: "sin Word del ciclo" };
  return { ok: true, detail: files[0].name };
}

function readTailLines(logPath, maxBytes = 256_000) {
  if (!existsSync(logPath)) return [];
  const buf = readFileSync(logPath);
  const slice = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
  return slice.toString("utf8").split(/\r?\n/);
}

function evaluateJob(job, pautaAt, now) {
  const logPath = join(LOG_DIR, job.log);
  const lines = readTailLines(logPath);
  const windowStart = new Date(pautaAt.getTime() - 60_000);
  const relevant = [];
  for (const line of lines) {
    const ts = parseLogStamp(line);
    if (!ts) continue;
    if (ts >= windowStart && ts <= now) relevant.push({ ts, line });
  }

  const failHit = [...relevant].reverse().find((r) => job.fail.test(r.line));
  const okHit = [...relevant].reverse().find((r) => job.success.test(r.line));
  const started = relevant.some((r) => /Inicio|REPORTE Intrant\b/i.test(r.line));

  let status = "missing";
  let detail = "no hay registro en log tras la pauta";

  if (failHit && (!okHit || failHit.ts >= okHit.ts)) {
    status = "fail";
    detail = failHit.line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 160);
  } else if (okHit) {
    status = "ok";
    detail = okHit.line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120);
  } else if (started) {
    status = "fail";
    detail = "arrancó pero no hay Fin exit=0 (¿sigue corriendo o crasheó?)";
  }

  if (typeof job.extraOk === "function") {
    const extra = job.extraOk(pautaAt);
    if (status === "ok" && !extra.ok) {
      status = "fail";
      detail = `${detail} · ${extra.detail}`;
    } else if (status === "ok" && extra.ok) {
      detail = `${detail} · ${extra.detail}`;
    } else if (status === "missing" && extra.ok) {
      status = "ok";
      detail = `Word OK: ${extra.detail} (log sin Fin claro)`;
    }
  }

  return {
    id: job.id,
    label: job.label,
    task: job.task,
    pauta: hm({ hour: pautaAt.getHours(), minute: pautaAt.getMinutes() }),
    status,
    detail,
    quietOk: Boolean(job.quietOk),
  };
}

function dueJobs(now, { all = false } = {}) {
  const nowMin = minutesSinceMidnight(now);
  const results = [];
  for (const job of jobsCatalog()) {
    for (const t of job.times() || []) {
      const pautaMin = t.hour * 60 + t.minute;
      let age = nowMin - pautaMin;
      if (age < -12 * 60) age += 24 * 60; // wrap midnight
      const inWindow =
        age >= Math.max(0, OFFSET_MIN - 2) && age <= OFFSET_MIN + GRACE_MIN;
      if (!all && !inWindow) continue;

      if (all) {
        // Solo la pauta más reciente de hoy (o la última de ayer cerca de medianoche)
        const todayPauta = new Date(now);
        todayPauta.setHours(t.hour, t.minute, 0, 0);
        if (todayPauta > now) todayPauta.setDate(todayPauta.getDate() - 1);
        const ageMs = now - todayPauta;
        if (ageMs > 18 * 60 * 60 * 1000) continue; // ignora pautes viejas en --all
        results.push(evaluateJob(job, todayPauta, now));
        continue;
      }

      const pautaAt = new Date(now);
      pautaAt.setHours(t.hour, t.minute, 0, 0);
      if (pautaAt > now) pautaAt.setDate(pautaAt.getDate() - 1);
      results.push(evaluateJob(job, pautaAt, now));
    }
  }

  // Deduplicate same job+pauta
  const seen = new Set();
  return results.filter((r) => {
    const k = `${r.id}@${r.pauta}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function allVerifyTimes() {
  const set = new Set();
  for (const job of jobsCatalog()) {
    for (const t of job.times() || []) {
      const v = addMinutes(t.hour, t.minute, OFFSET_MIN);
      set.add(hm(v));
    }
  }
  return [...set].sort();
}

function resolveChatId() {
  const last = join(root, ".last-chat.json");
  if (existsSync(last)) {
    try {
      const data = JSON.parse(readFileSync(last, "utf8"));
      if (data.chatId) return String(data.chatId);
    } catch {
      /* ignore */
    }
  }
  const fromEnv = config.telegram?.allowedChatIds?.[0];
  return fromEnv ? String(fromEnv) : null;
}

async function notifyTelegram(text) {
  if (!config.telegram?.token) return false;
  const chatId = resolveChatId();
  if (!chatId) return false;
  const bot = new Telegraf(config.telegram.token);
  await bot.telegram.sendMessage(chatId, text);
  return true;
}

function formatReport(checks, { now, mode }) {
  const fails = checks.filter((c) => c.status !== "ok");
  const oks = checks.filter((c) => c.status === "ok");
  const lines = [
    mode === "all"
      ? `🔎 Verificación envíos (hoy)`
      : `🔎 Verificación envíos (+${OFFSET_MIN} min)`,
    `${pad2(now.getHours())}:${pad2(now.getMinutes())} · ${checks.length} pauta(s)`,
  ];
  if (!checks.length) {
    lines.push("Sin pautes en ventana.");
    return { text: lines.join("\n"), fails: [], oks: [] };
  }
  for (const c of checks) {
    const icon = c.status === "ok" ? "✅" : c.status === "fail" ? "❌" : "⚠️";
    lines.push(`${icon} ${c.label} @${c.pauta}: ${c.detail}`);
  }
  if (fails.length) {
    lines.push("", `Fallos: ${fails.length}/${checks.length}`);
  } else {
    lines.push("", `Todo OK (${oks.length})`);
  }
  return { text: lines.join("\n"), fails, oks };
}

export { allVerifyTimes, dueJobs, OFFSET_MIN };

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const isDirectRun =
  Boolean(entry) && pathToFileURL(entry).href === import.meta.url;

if (isDirectRun) {
  const opts = parseArgs(process.argv.slice(2));
  const now = new Date();
  const checks = dueJobs(now, { all: opts.all });
  const { text, fails } = formatReport(checks, {
    now,
    mode: opts.all ? "all" : "window",
  });
  console.log(text);
  console.log("");
  console.log(`Horarios verify: ${allVerifyTimes().join(", ")}`);

  const loudChecks = checks.filter((c) => !c.quietOk || c.status !== "ok");
  const shouldNotify =
    opts.notifyTelegram &&
    loudChecks.length > 0 &&
    (fails.length > 0 || opts.notifyOk || opts.all);

  if (shouldNotify) {
    try {
      const ok = await notifyTelegram(text);
      console.log(ok ? "Telegram: enviado" : "Telegram: sin chat/token");
    } catch (e) {
      console.error(`Telegram falló: ${e.message}`);
    }
  } else if (!opts.notifyTelegram) {
    console.log("Telegram: omitido");
  } else if (!checks.length) {
    console.log("Telegram: sin pautes en ventana");
  } else {
    console.log("Telegram: OK silencioso (cron usa --notify-ok)");
  }

  process.exit(fails.length ? 1 : 0);
}
