import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Telegraf } from "telegraf";
import { config } from "./config.mjs";
import { calendarYmd, NEWS_TZ } from "./news-date.mjs";
import { publishToWebhook } from "./publish-webhook.mjs";
import { isPublicR2Url, uploadToR2 } from "./r2.mjs";

const LAST_CHAT_FILE = join(config.root, ".last-chat.json");
const QUOTES_PATH = join(config.root, "src", "frase-celebre-quotes.json");
const HF_PIN = "hyperframes@0.7.17";

export function loadQuotes() {
  const raw = JSON.parse(readFileSync(QUOTES_PATH, "utf8"));
  if (!Array.isArray(raw) || raw.length !== 30) {
    throw new Error(`Catalogo de frases invalido (${raw?.length || 0}, se esperan 30)`);
  }
  return raw;
}

function ymdRD(date = new Date()) {
  return calendarYmd(date, NEWS_TZ);
}

/** 0 = 1 ene. Indice estable en America/Santo_Domingo. */
export function dayOfYearIndex(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const start = Date.UTC(y, 0, 1);
  const cur = Date.UTC(y, m - 1, d);
  return Math.floor((cur - start) / 86400000);
}

export function pickQuote({ test = false, date = new Date() } = {}) {
  const quotes = loadQuotes();
  if (test) {
    const item = quotes[0];
    return { ...item, index: 0, ymd: ymdRD(date), test: true };
  }
  const ymd = ymdRD(date);
  const index = dayOfYearIndex(ymd) % quotes.length;
  return { ...quotes[index], index, ymd, test: false };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function quoteFontSize(text) {
  const n = String(text).length;
  if (n > 120) return 32;
  if (n > 90) return 36;
  if (n > 70) return 42;
  if (n > 50) return 48;
  return 52;
}

function displayQuote(quote) {
  const inner = String(quote || "")
    .trim()
    .replace(/^[«"“]+|[»"”]+$/g, "")
    .trim();
  return `\u201C${inner}\u201D`;
}

export function buildCaption(quote, author) {
  const inner = String(quote || "")
    .trim()
    .replace(/^[«"“]+|[»"”]+$/g, "")
    .trim();
  return `"${inner}" \u2014 ${author}`;
}

function projectDir() {
  return (
    config.video?.frase?.dir ||
    join(config.root, process.env.FRASE_HYPERFRAMES_DIR || "video/frase-celebre")
  );
}

export function writeFraseHtml({ quote, author, dir } = {}) {
  const project = dir || projectDir();
  const shown = displayQuote(quote);
  const authorLine = `\u2014 ${author}`;
  const fontSize = quoteFontSize(shown);
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1280, height=720" />
    <title>Frase celebre</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 1280px;
        height: 720px;
        overflow: hidden;
        background: #0a3d8f;
      }
      #root {
        position: relative;
        width: 1280px;
        height: 720px;
        overflow: hidden;
      }
      #bg {
        position: absolute;
        inset: 0;
        width: 1280px;
        height: 720px;
        object-fit: cover;
        display: block;
      }
      #copy {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 168px 96px 72px;
        text-align: center;
      }
      #quote {
        max-width: 1040px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: ${fontSize}px;
        font-weight: 400;
        line-height: 1.28;
        color: #fff;
        text-shadow: 0 2px 18px rgba(8, 36, 90, 0.45);
      }
      #quote .ch { display: inline; }
      #author {
        display: block;
        max-width: 920px;
        margin-top: 32px;
        font-family: "Segoe UI", Inter, system-ui, sans-serif;
        font-size: ${authorLine.length > 40 ? 22 : 26}px;
        font-weight: 600;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.92);
        text-shadow: 0 2px 12px rgba(8, 36, 90, 0.4);
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="30"
      data-width="1280"
      data-height="720"
    >
      <img
        id="bg"
        class="clip"
        data-start="0"
        data-duration="30"
        data-track-index="0"
        src="assets/fondo.png"
        alt=""
      />
      <div
        id="copy"
        class="clip"
        data-start="0"
        data-duration="30"
        data-track-index="1"
      >
        <blockquote id="quote" data-text="${escapeHtml(shown)}"></blockquote>
        <p id="author">${escapeHtml(authorLine)}</p>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const quoteEl = document.getElementById("quote");
      const text = quoteEl.getAttribute("data-text") || "";
      quoteEl.textContent = "";
      for (const ch of text) {
        const span = document.createElement("span");
        span.className = "ch";
        span.textContent = ch === " " ? "\\u00A0" : ch;
        quoteEl.appendChild(span);
      }
      const chars = quoteEl.querySelectorAll(".ch");
      const typewriter = 4;
      const charDur = 0.05;
      const stagger = chars.length > 1 ? (typewriter - charDur) / (chars.length - 1) : 0;
      const tl = gsap.timeline({ paused: true });
      if (chars.length) {
        tl.fromTo(
          chars,
          { opacity: 0 },
          { opacity: 1, duration: charDur, stagger: stagger, ease: "none" },
          0
        );
      }
      tl.fromTo(
        "#author",
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" },
        4.1
      );
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  writeFileSync(join(project, "index.html"), html, "utf8");
}

function runProcess(bin, args, { cwd, timeoutMs = 600000, onLine } = {}) {
  const shell = process.platform === "win32" && bin === "npx";
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      shell,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    const emit = (chunk, isErr = false) => {
      if (isErr) stderr += chunk;
      else stdout += chunk;
      if (!onLine) return;
      lineBuffer += chunk;
      const parts = lineBuffer.split(/\r?\n/);
      lineBuffer = parts.pop() || "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timeout HyperFrames (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => emit(d.toString()));
    child.stderr?.on("data", (d) => emit(d.toString(), true));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (lineBuffer.trim() && onLine) onLine(lineBuffer.trim());
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            `hyperframes salio ${code}: ${(stderr || stdout).slice(0, 400)}`
          )
        );
      }
    });
  });
}

export async function renderFraseVideo({ quote, author, ymd, onProgress } = {}) {
  const dir = projectDir();
  if (!existsSync(join(dir, "package.json"))) {
    throw new Error(`Proyecto HyperFrames no encontrado en ${dir}`);
  }
  if (!existsSync(join(dir, "assets", "fondo.png"))) {
    throw new Error(`Falta ${join(dir, "assets", "fondo.png")}`);
  }
  writeFraseHtml({ quote, author, dir });
  const rendersDir = join(dir, "renders");
  if (!existsSync(rendersDir)) mkdirSync(rendersDir, { recursive: true });
  const stamp = String(ymd || ymdRD()).replace(/-/g, "");
  const fileName = `frase-${stamp}.mp4`;
  const outputPath = join(rendersDir, fileName);
  await runProcess(
    "npx",
    ["--yes", HF_PIN, "render", "-o", `renders/${fileName}`, "-q", "draft", "-w", "2"],
    { cwd: dir, timeoutMs: 900000, onLine: onProgress }
  );
  if (!existsSync(outputPath)) {
    throw new Error(`Render no produjo ${outputPath}`);
  }
  return outputPath;
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

async function notifyTelegram(lines) {
  const token = config.telegram?.token;
  const chatId = resolveChatId();
  if (!token || !chatId) {
    console.warn("Telegram: sin token/chat — no aviso de frase.");
    return;
  }
  const bot = new Telegraf(token);
  await bot.telegram.sendMessage(chatId, lines.join("\n"), {
    disable_web_page_preview: true,
  });
}

/**
 * @param {{ test?: boolean, publish?: boolean, onProgress?: Function }} opts
 * test: frase de Socrates, sin webhook salvo publish=true
 * publish: default true si no es test
 */
export async function runFraseCelebre({
  test = false,
  publish,
  onProgress,
} = {}) {
  const shouldPublish = publish ?? !test;
  if (config.video?.hyperframes?.enabled === false) {
    console.log("HYPERFRAMES_ENABLED=false — omito frase celebre.");
    return { skipped: true, reason: "hyperframes-disabled" };
  }

  const picked = pickQuote({ test });
  const caption = buildCaption(picked.quote, picked.author);
  console.log(`Frase ${picked.index + 1}/30 (${picked.ymd}): ${caption}`);

  const outputPath = await renderFraseVideo({
    quote: picked.quote,
    author: picked.author,
    ymd: picked.ymd,
    onProgress,
  });
  console.log(`MP4: ${outputPath}`);

  const result = {
    skipped: false,
    test: Boolean(test),
    published: false,
    quote: picked.quote,
    author: picked.author,
    index: picked.index,
    ymd: picked.ymd,
    caption,
    outputPath,
    videoUrl: null,
    r2Key: null,
    webhook: null,
  };

  if (!shouldPublish) {
    await notifyTelegram([
      "Frase celebre (prueba, sin webhook)",
      caption,
      outputPath,
    ]).catch((err) => console.warn("Telegram:", err.message));
    return result;
  }

  const buffer = readFileSync(outputPath);
  const r2Key = `frases/frase-${picked.ymd.replace(/-/g, "")}.mp4`;
  const videoUrl = await uploadToR2(buffer, r2Key, "video/mp4");
  if (!isPublicR2Url(videoUrl)) {
    throw new Error("URL R2 no es publica (r2.dev). Revisa R2_PUBLIC_BASE_URL.");
  }
  result.videoUrl = videoUrl;
  result.r2Key = r2Key;
  console.log(`R2: ${videoUrl}`);

  const webhook = await publishToWebhook({
    title: caption,
    caption,
    videoUrl,
    r2Key,
    mediaType: "VIDEO",
  });
  result.webhook = webhook;
  result.published = Boolean(webhook?.ok);
  if (!webhook?.ok) {
    await notifyTelegram([
      "Frase celebre — fallo webhook",
      caption,
      outputPath,
      videoUrl,
      webhook?.error || `status ${webhook?.status || "?"}`,
    ]).catch(() => {});
    throw new Error(
      `Webhook no publico: ${webhook?.error || webhook?.status || "error"}`
    );
  }

  await notifyTelegram([
    `Frase celebre · ${picked.ymd}`,
    caption,
    webhook.queued ? "Webhook: encolado" : "Webhook: ok",
    videoUrl,
  ]).catch((err) => console.warn("Telegram:", err.message));

  return result;
}
