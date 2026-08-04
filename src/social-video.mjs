/**
 * Descarga videos de YouTube / Instagram / Facebook / X vía yt-dlp.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { config } from "./config.mjs";

const PLATFORM_RE = {
  youtube: /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i,
  instagram: /(?:instagram\.com|instagr\.am)/i,
  facebook: /(?:facebook\.com|fb\.watch|fb\.com)/i,
  x: /(?:\bx\.com\/|twitter\.com)/i,
};

export function detectVideoPlatform(url = "") {
  const u = String(url || "");
  for (const [id, re] of Object.entries(PLATFORM_RE)) {
    if (re.test(u)) return id;
  }
  return null;
}

export function isSupportedSocialVideoUrl(url = "") {
  return Boolean(detectVideoPlatform(url));
}

export function socialVideoPlatformLabel(platform) {
  return (
    {
      youtube: "YouTube",
      instagram: "Instagram",
      facebook: "Facebook",
      x: "X",
    }[platform] || platform || "Desconocido"
  );
}

function resolveYtdlpPath() {
  const fromEnv = config.socialVideo?.ytdlpPath;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates = [
    process.env.YTDLP_PATH,
    "C:\\Users\\Joel Guerra\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\yt-dlp.exe",
    join(process.env.LOCALAPPDATA || "", "hermes", "hermes-agent", "venv", "Scripts", "yt-dlp.exe"),
    "yt-dlp",
    "yt-dlp.exe",
  ].filter(Boolean);

  for (const p of candidates) {
    if (p === "yt-dlp" || p === "yt-dlp.exe") return p;
    if (existsSync(p)) return p;
  }
  return "yt-dlp";
}

function runYtdlp(args, { timeoutMs = 180_000 } = {}) {
  const bin = resolveYtdlpPath();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`yt-dlp timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `No pude ejecutar yt-dlp (${bin}): ${err.message}. Instálalo o define YTDLP_PATH.`
        )
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = (stderr || stdout).trim().slice(-500);
        reject(new Error(detail || `yt-dlp exit ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function findDownloadedFile(dir) {
  const names = await readdir(dir);
  const media = names.filter((n) =>
    /\.(mp4|webm|mkv|mov|m4v)$/i.test(n)
  );
  if (!media.length) return null;
  // Prefer mp4
  media.sort((a, b) => {
    const ap = /\.mp4$/i.test(a) ? 0 : 1;
    const bp = /\.mp4$/i.test(b) ? 0 : 1;
    return ap - bp || a.localeCompare(b);
  });
  return join(dir, media[0]);
}

function contentTypeForExt(ext = "") {
  const e = ext.toLowerCase();
  if (e === ".webm") return "video/webm";
  if (e === ".mkv") return "video/x-matroska";
  if (e === ".mov") return "video/quicktime";
  return "video/mp4";
}

/**
 * Descarga un video social y devuelve buffer + metadata.
 * @returns {Promise<{ buffer, contentType, ext, title, description, sourceUrl, platform, filename, bytes }>}
 */
export async function downloadSocialVideo(sourceUrl, { onStatus } = {}) {
  const url = String(sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL inválida. Usa un enlace de YouTube, Instagram, Facebook o X.");
  }
  const platform = detectVideoPlatform(url);
  if (!platform) {
    throw new Error(
      "Plataforma no soportada. Usa YouTube, Instagram, Facebook o X."
    );
  }

  const maxMb = config.socialVideo?.maxMb || 90;
  const maxBytes = maxMb * 1024 * 1024;
  const workDir = await mkdtemp(join(tmpdir(), "asistente-svideo-"));
  const outTpl = join(workDir, "video.%(ext)s");

  const args = [
    "--no-playlist",
    "--no-warnings",
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "--max-filesize",
    `${maxMb}M`,
    "-o",
    outTpl,
    "--print-json",
    "--no-simulate",
  ];

  const cookiesFile = String(config.socialVideo?.cookiesFile || "").trim();
  const cookiesBrowser = config.socialVideo?.cookiesFromBrowser;
  if (cookiesFile && existsSync(cookiesFile)) {
    args.push("--cookies", cookiesFile);
  } else if (cookiesBrowser) {
    args.push("--cookies-from-browser", cookiesBrowser);
  }

  args.push(url);

  onStatus?.(
    `⬇️ Descargando de ${socialVideoPlatformLabel(platform)} (máx ${maxMb} MB)…`
  );

  let meta = null;
  try {
    const { stdout } = await runYtdlp(args, { timeoutMs: 240_000 });
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        meta = JSON.parse(lines[i]);
        break;
      } catch {
        // keep looking
      }
    }

    const filePath = await findDownloadedFile(workDir);
    if (!filePath) {
      throw new Error("yt-dlp terminó pero no encontré el archivo de video.");
    }

    const st = await stat(filePath);
    if (st.size > maxBytes) {
      throw new Error(
        `El video pesa ${(st.size / 1024 / 1024).toFixed(1)} MB (límite ${maxMb} MB).`
      );
    }
    if (st.size < 1024) {
      throw new Error("El archivo descargado está vacío o es inválido.");
    }

    const buffer = await readFile(filePath);
    const ext = extname(filePath) || ".mp4";
    const title = String(meta?.title || meta?.fulltitle || "").trim() || "Video";
    const description = String(
      meta?.description || meta?.alt_title || ""
    ).trim();

    return {
      buffer,
      contentType: contentTypeForExt(ext),
      ext,
      title,
      description,
      sourceUrl: url,
      platform,
      filename: basename(filePath),
      bytes: buffer.length,
    };
  } catch (error) {
    const msg = String(error.message || error);
    if (/DPAPI|cookie database|decrypt/i.test(msg)) {
      throw new Error(
        "Chrome bloqueó las cookies (DPAPI). Exporta cookies de Instagram a un archivo Netscape (extensión «Get cookies.txt LOCALLY») y pon en .env:\nYTDLP_COOKIES_FILE=C:\\\\ruta\\\\instagram-cookies.txt\n(Deja YTDLP_COOKIES_FROM_BROWSER vacío o coméntalo.)"
      );
    }
    if (/login|cookies|rate-limit|403|401|private|empty media/i.test(msg)) {
      throw new Error(
        `${msg.slice(0, 280)}\n\nTip: YTDLP_COOKIES_FILE=…cookies.txt o YTDLP_COOKIES_FROM_BROWSER=chrome`
      );
    }
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildSocialVideoR2Key(ext = ".mp4") {
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
  return `videos/fv-${stamp}${safeExt}`;
}
