/**
 * /ndigital — crop overlays N Digital (top/bottom) + trim last N seconds.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { config } from "./config.mjs";
import { downloadSocialVideo } from "./social-video.mjs";
import { LOGO_F1RD_PATH } from "./social-card.mjs";
import { generateTradHeadline } from "./trad-video.mjs";

const __ndigitalDir = dirname(fileURLToPath(import.meta.url));
const LOGO_FV_PATH = join(__ndigitalDir, "..", "assets", "logo_fv.png");
const FONT_BOLD = join(
  __ndigitalDir,
  "..",
  "assets",
  "fonts",
  "Montserrat-ExtraBold.ttf"
);

function resolveFfmpeg() {
  const fromEnv = String(config.trad?.ffmpegPath || config.ndigital?.ffmpegPath || "").trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    process.env.FFMPEG_PATH,
    "C:\\Users\\Joel Guerra\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe",
    "ffmpeg",
    "ffmpeg.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (p === "ffmpeg" || p === "ffmpeg.exe") return p;
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

function resolveFfprobe() {
  const ff = resolveFfmpeg();
  const probe = ff.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  if (probe !== ff && existsSync(probe)) return probe;
  return "ffprobe";
}

function runCmd(bin, args, { timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`No pude ejecutar ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || `${bin} exit ${code}`).trim().slice(-600)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function probeVideoMeta(filePath) {
  const { stdout } = await runCmd(
    resolveFfprobe(),
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ],
    { timeoutMs: 60_000 }
  );
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe no devolvió JSON válido.");
  }
  const stream = data?.streams?.[0] || {};
  const width = Number(stream.width) || 0;
  const height = Number(stream.height) || 0;
  const duration = Number(stream.duration || data?.format?.duration) || 0;
  if (!width || !height || !duration) {
    throw new Error("No pude leer tamaño/duración del video (ffprobe).");
  }
  return { width, height, duration };
}

function evenFloor(n) {
  const v = Math.max(2, Math.floor(Number(n) || 0));
  return v % 2 === 0 ? v : v - 1;
}

export function buildNdigitalR2Key(ext = ".mp4") {
  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "-",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join("");
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : ".mp4";
  return `videos/ndigital-${stamp}${safeExt}`;
}

export async function discardNdigitalJob(job) {
  if (job?.workDir) {
    await rm(job.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Crop top/bottom + trim end. Returns job with localPath for preview/publish.
 */
export async function processNdigitalCrop(inputBuffer, {
  cropTop = config.ndigital?.cropTop ?? 200,
  cropBottom = config.ndigital?.cropBottom ?? 565,
  trimEndSec = config.ndigital?.trimEndSec ?? 6,
} = {}) {
  let top = Math.max(0, Math.round(Number(cropTop) || 0));
  let bottom = Math.max(0, Math.round(Number(cropBottom) || 0));
  const trim = Math.max(0, Number(trimEndSec) || 0);

  const workDir = await mkdtemp(join(tmpdir(), "asistente-ndigital-"));
  const inPath = join(workDir, "in.mp4");
  const outPath = join(workDir, "out.mp4");

  try {
    await writeFile(inPath, inputBuffer);
    const meta = await probeVideoMeta(inPath);
    if (meta.duration <= trim + 0.5) {
      throw new Error(
        `Video demasiado corto (${meta.duration.toFixed(1)}s) para quitar ${trim}s del final.`
      );
    }
    const keepSec = Math.max(0.5, meta.duration - trim);

    // Asegura crop válido y dimensiones pares (libx264 / yuv420p).
    const maxCut = Math.max(0, meta.height - 64);
    if (top + bottom > maxCut) {
      const scale = maxCut / (top + bottom);
      top = Math.floor(top * scale);
      bottom = Math.max(0, maxCut - top);
    }
    top = evenFloor(top) === top ? top : top - (top % 2);
    bottom = bottom - (bottom % 2);
    const outH = evenFloor(meta.height - top - bottom);
    const outW = evenFloor(meta.width);
    const y = Math.min(top, meta.height - outH);

    const vf = `crop=${outW}:${outH}:0:${y},setsar=1,format=yuv420p`;

    const args = [
      "-y",
      "-noautorotate",
      "-i",
      inPath,
      "-vf",
      vf,
      "-t",
      String(keepSec.toFixed(3)),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      outPath,
    ];

    await runCmd(resolveFfmpeg(), args, { timeoutMs: 420_000 });
    if (!existsSync(outPath)) {
      throw new Error("ffmpeg no generó el video recortado.");
    }
    const buffer = await readFile(outPath);
    return {
      workDir,
      localPath: outPath,
      buffer,
      bytes: buffer.length,
      durationIn: meta.duration,
      durationOut: keepSec,
      cropTop: top,
      cropBottom: bottom,
      trimEndSec: trim,
      outWidth: outW,
      outHeight: outH,
    };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Download IG/social URL + crop/trim.
 */
export async function prepareNdigitalJob(sourceUrl, { onStatus } = {}) {
  onStatus?.("⏳ Descargando reel…");
  const downloaded = await downloadSocialVideo(sourceUrl, { onStatus });
  onStatus?.(
    `✂️ Recortando ${config.ndigital?.cropTop ?? 200}px↑ / ${config.ndigital?.cropBottom ?? 565}px↓ y −${config.ndigital?.trimEndSec ?? 6}s…`
  );
  const cropped = await processNdigitalCrop(downloaded.buffer);
  return {
    ...cropped,
    sourceUrl: downloaded.sourceUrl,
    platform: downloaded.platform,
    title: downloaded.title,
    description: downloaded.description || downloaded.title,
    contentType: "video/mp4",
    ext: ".mp4",
  };
}

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapTitleLines(text = "", maxChars = 28, maxLines = 3) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  else if (cur && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${cur}`.trim();
  }
  return lines.slice(0, maxLines);
}

function logoForDest(dest = "fvdigital") {
  return dest === "f1rd" ? LOGO_F1RD_PATH : LOGO_FV_PATH;
}

/**
 * PNG del alto del stack: logo al inicio del video + barra roja pegada al borde inferior.
 * @param videoHeight alto del video ya escalado a `width`
 */
export async function buildNdigitalChromePng({
  width = config.ndigital?.width || 1080,
  videoHeight,
  headline = "",
  dest = "fvdigital",
  logoPadTop = config.ndigital?.logoPadTop ?? 16,
  titleBand = config.ndigital?.titleBand || 200,
} = {}) {
  const vidH = evenFloor(videoHeight);
  const stackH = vidH + titleBand;
  const logoPath = logoForDest(dest);
  if (!existsSync(logoPath)) {
    throw new Error(`Logo no encontrado: ${logoPath}`);
  }

  const logoMeta = await sharp(logoPath).metadata();
  const logoW = Math.round(width * (dest === "f1rd" ? 0.3 : 0.34));
  const logoH = Math.max(
    24,
    Math.round(logoW * ((logoMeta.height || 1) / (logoMeta.width || 1)))
  );
  const logoBuf = await sharp(logoPath)
    .resize(logoW, logoH, { fit: "inside" })
    .png()
    .toBuffer();

  const lines = wrapTitleLines(headline, 30, 3);
  const fontSize = lines.length >= 3 ? 36 : lines.length === 2 ? 42 : 48;
  const lineH = Math.round(fontSize * 1.2);
  const padY = Math.round((titleBand - lines.length * lineH) / 2);
  const startY = vidH + Math.max(16, padY) + fontSize;

  const fontFace = existsSync(FONT_BOLD)
    ? `font-family="Montserrat"`
    : `font-family="Segoe UI, Arial, sans-serif"`;

  const tspans = lines
    .map((line, i) => {
      const y = startY + i * lineH;
      return `<text x="${width / 2}" y="${y}" fill="#ffffff" font-size="${fontSize}" font-weight="800" text-anchor="middle" ${fontFace}>${escapeXml(line)}</text>`;
    })
    .join("");

  const fontCss = existsSync(FONT_BOLD)
    ? `@font-face { font-family: 'Montserrat'; src: url('file:///${FONT_BOLD.replace(/\\/g, "/")}'); font-weight: 800; }`
    : "";

  // Zona del video transparente (solo logo encima); barra roja empieza exactamente en vidH.
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${stackH}" viewBox="0 0 ${width} ${stackH}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>${fontCss}</style></defs>
  <rect x="0" y="${vidH}" width="${width}" height="${titleBand}" fill="#6B0F14"/>
  ${tspans}
</svg>`;

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const logoTop = Math.max(0, Math.round(logoPadTop));
  const logoLeft = Math.round((width - logoW) / 2);

  const chrome = await sharp(base)
    .composite([{ input: logoBuf, top: logoTop, left: logoLeft }])
    .png()
    .toBuffer();

  return { chrome, stackH, vidH, titleBand, logoH };
}

/**
 * Compone reel 9:16: logo al inicio del video + titular pegado al borde inferior del recorte.
 */
export async function composeNdigitalBranded(job, {
  headline,
  dest = "fvdigital",
  onStatus,
} = {}) {
  if (!job?.localPath || !existsSync(job.localPath)) {
    throw new Error("No hay video recortado para componer.");
  }
  const width = config.ndigital?.width || 1080;
  const canvasH = config.ndigital?.height || 1920;
  const titleBand = config.ndigital?.titleBand || 200;
  const logoPadTop = config.ndigital?.logoPadTop ?? 16;
  const title = String(headline || job.headline || job.title || "").trim();
  if (!title) throw new Error("Falta titular para la barra roja.");

  onStatus?.("🎨 Componiendo logo + titular…");

  const meta = await probeVideoMeta(job.localPath);
  const scale = width / meta.width;
  const vidH = evenFloor(meta.height * scale);

  const { chrome, stackH } = await buildNdigitalChromePng({
    width,
    videoHeight: vidH,
    headline: title,
    dest: dest === "f1rd" ? "f1rd" : "fvdigital",
    logoPadTop,
    titleBand,
  });

  const chromePath = join(job.workDir, "chrome.png");
  const brandedPath = join(job.workDir, "branded.mp4");
  await writeFile(chromePath, chrome);

  // Video a ancho completo → canvas = video + barra roja pegada → centrar en 9:16.
  const vf =
    `[0:v]scale=${width}:${vidH}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${vidH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,` +
    `pad=${width}:${stackH}:0:0:black[vstack];` +
    `[vstack][1:v]overlay=0:0:format=auto,` +
    `pad=${width}:${canvasH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[vout]`;

  await runCmd(
    resolveFfmpeg(),
    [
      "-y",
      "-i",
      job.localPath,
      "-loop",
      "1",
      "-i",
      chromePath,
      "-filter_complex",
      vf,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      brandedPath,
    ],
    { timeoutMs: 420_000 }
  );

  if (!existsSync(brandedPath)) {
    throw new Error("No se generó el video con marca.");
  }
  const buffer = await readFile(brandedPath);
  job.croppedPath = job.croppedPath || job.localPath;
  job.localPath = brandedPath;
  job.buffer = buffer;
  job.bytes = buffer.length;
  job.headline = title;
  job.dest = dest;
  job.branded = true;
  job.outWidth = width;
  job.outHeight = canvasH;
  return job;
}

export async function generateNdigitalHeadline(job) {
  return generateTradHeadline({
    transcript: "",
    title: job?.title || "",
    description: job?.description || "",
  });
}

