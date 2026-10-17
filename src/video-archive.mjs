/**
 * Archiva videos y gráficos de redes en Desktop\video2:
 * archivo + .txt con el caption. MP4 → H.264 + AAC-LC (X/Twitter).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.mjs";

export const VIDEO_ARCHIVE_DIR = "C:\\Users\\Joel Guerra\\Desktop\\video2";
const SEEN_FILE = join(config.root, ".video-archive-sent.json");

function loadSeen() {
  if (!existsSync(SEEN_FILE)) return { urls: [] };
  try {
    const data = JSON.parse(readFileSync(SEEN_FILE, "utf8"));
    return { urls: Array.isArray(data.urls) ? data.urls : [] };
  } catch {
    return { urls: [] };
  }
}

export function rememberArchivedUrl(url) {
  const src = String(url || "").trim();
  if (src) markSeen(src);
}

function markSeen(url) {
  const data = loadSeen();
  if (!data.urls.includes(url)) data.urls.push(url);
  if (data.urls.length > 400) data.urls = data.urls.slice(-400);
  writeFileSync(SEEN_FILE, JSON.stringify(data, null, 2), "utf8");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function slugFromCaption(caption = "", max = 50) {
  const line =
    String(caption || "")
      .split(/\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#")) ||
    String(caption || "").trim() ||
    "video";
  const slug = line
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "video";
}

export const MEDIA_ARCHIVE_DIR = VIDEO_ARCHIVE_DIR;

export function looksLikeImageUrl(url = "") {
  const u = String(url || "");
  if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u)) return true;
  if (/\/(cards|termometro)\//i.test(u)) return true;
  return false;
}

function extFromGraphic(buffer, url = "") {
  const m = String(url).match(/\.(png|jpe?g|webp|gif)(\?|#|$)/i);
  if (m) return `.${m[1].toLowerCase().replace("jpeg", "jpg")}`;
  if (Buffer.isBuffer(buffer) && buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return ".png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return ".jpg";
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return ".gif";
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
      return ".webp";
    }
  }
  return ".png";
}

function uniqueBase(dir, slug, ext, nameHint = "") {
  let base = `${nameHint || stamp()}_${slug}`;
  let n = 2;
  while (existsSync(join(dir, `${base}${ext}`))) {
    base = `${stamp()}_${slug}-${n}`;
    n += 1;
  }
  return base;
}

export function archiveProducedGraphic({
  buffer,
  caption = "",
  ext = "",
  dir = VIDEO_ARCHIVE_DIR,
  nameHint = "",
  sourceUrl = "",
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    throw new Error("Gráfico vacío para archivar.");
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fileExt = ext || extFromGraphic(buffer, sourceUrl);
  const slug = slugFromCaption(caption) || "grafico";
  const base = uniqueBase(dir, slug, fileExt, nameHint);
  const imagePath = join(dir, `${base}${fileExt}`);
  const txtPath = join(dir, `${base}.txt`);
  writeFileSync(imagePath, buffer);
  writeFileSync(txtPath, String(caption || slug).trim() + "\n", "utf8");
  return { imagePath, txtPath, base };
}

export async function archiveProducedGraphicFromUrl(url, caption = "", nameHint = "") {
  const src = String(url || "").trim();
  if (!/^https?:\/\//i.test(src)) return null;
  if (loadSeen().urls.includes(src)) return { skipped: true, url: src };
  const res = await fetch(src);
  if (!res.ok) throw new Error(`No pude bajar el gráfico (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const saved = archiveProducedGraphic({
    buffer: buf,
    caption,
    sourceUrl: src,
    nameHint,
  });
  markSeen(src);
  return saved;
}

/** H.264 High + AAC-LC + yuv420p + faststart (X no acepta VP9 ni HE-AAC). */
export async function encodeMp4ForX(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length < 1000) {
    throw new Error("Video vacío para recodificar.");
  }
  const dir = await mkdtemp(join(tmpdir(), "xmp4-"));
  const inFile = join(dir, "in.mp4");
  const outFile = join(dir, "out.mp4");
  await writeFile(inFile, inputBuffer);
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(
        "ffmpeg",
        [
          "-y",
          "-i",
          inFile,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-profile:v",
          "high",
          "-level",
          "4.1",
          "-pix_fmt",
          "yuv420p",
          "-vf",
          "scale=trunc(iw/2)*2:trunc(ih/2)*2",
          "-c:a",
          "aac",
          "-profile:a",
          "aac_low",
          "-b:a",
          "128k",
          "-ac",
          "2",
          "-ar",
          "44100",
          "-movflags",
          "+faststart",
          outFile,
        ],
        { stdio: "ignore" }
      );
      p.on("error", reject);
      p.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg x264 ${code}`))
      );
    });
    return await readFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function archiveProducedVideo({
  buffer,
  caption = "",
  ext = ".mp4",
  dir = VIDEO_ARCHIVE_DIR,
  nameHint = "",
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1000) {
    throw new Error("Video vacío para archivar.");
  }
  const outBuf = await encodeMp4ForX(buffer);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const slug = slugFromCaption(caption);
  const base = uniqueBase(dir, slug, ".mp4", nameHint);
  const videoPath = join(dir, `${base}.mp4`);
  const txtPath = join(dir, `${base}.txt`);
  writeFileSync(videoPath, outBuf);
  writeFileSync(txtPath, String(caption || slug).trim() + "\n", "utf8");
  return { videoPath, txtPath, base };
}

export async function archiveProducedVideoFromUrl(url, caption = "", nameHint = "") {
  const src = String(url || "").trim();
  if (!/^https?:\/\//i.test(src)) return null;
  if (loadSeen().urls.includes(src)) return { skipped: true, url: src };
  const res = await fetch(src);
  if (!res.ok) throw new Error(`No pude bajar el video (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const saved = await archiveProducedVideo({
    buffer: buf,
    caption,
    ext: ".mp4",
    nameHint,
  });
  markSeen(src);
  return saved;
}

/**
 * Archiva en Desktop\video2 en cuanto el video está procesado.
 * Fail-soft: nunca tumba el flujo. Marca la URL R2 para no re-bajar en el webhook.
 */
export async function archiveProcessedVideoSafe({
  buffer,
  caption = "",
  url = "",
  nameHint = "",
} = {}) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 1000) return null;
    const saved = await archiveProducedVideo({
      buffer,
      caption,
      nameHint,
    });
    const src = String(url || "").trim();
    if (src) markSeen(src);
    return saved;
  } catch (err) {
    console.warn("video-archive:", err.message);
    return null;
  }
}
