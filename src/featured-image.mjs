import { createHash } from "node:crypto";
import { config } from "./config.mjs";
import { fetchWithRetry } from "./fetch-retry.mjs";
import { mimeFromBuffer } from "./image.mjs";
import { uploadToR2 } from "./r2.mjs";

const USER_AGENT =
  "Mozilla/5.0 (compatible; FVDigitalBot/1.0; +https://fvdigital.do)";

function imageFetchHeaders(url) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  try {
    const { origin } = new URL(url);
    headers.Referer = `${origin}/`;
  } catch {
    // URL inválida: seguimos sin Referer
  }
  return headers;
}

/**
 * Descarga una imagen remota con cabeceras de navegador (evita bloqueos hotlink).
 */
export async function downloadImageFromUrl(url) {
  const res = await fetchWithRetry(
    url,
    { headers: imageFetchHeaders(url), redirect: "follow" },
    { label: "Descarga de imagen", retries: 3, delayMs: 1000 }
  );

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 400) {
    throw new Error("archivo demasiado pequeño o vacío");
  }

  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
  const sniffed = mimeFromBuffer(buffer);
  const mimeType =
    sniffed ||
    (headerMime && /^image\//i.test(headerMime) ? headerMime : "image/jpeg");

  return { buffer, mimeType };
}

/**
 * Sube la imagen a R2 bajo featured/ y devuelve la URL pública.
 */
export async function mirrorFeaturedImageToR2(buffer, mimeType = "image/jpeg") {
  if (!config.r2?.enabled) return null;

  const ext = mimeType.includes("png") ? "png" : "jpg";
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  const key = `featured/telegram-${Date.now()}-${hash}.${ext}`;
  return uploadToR2(buffer, key, mimeType);
}

/**
 * Descarga imagen y, si R2 está configurado, la replica allí.
 */
export async function resolveFeaturedImage(url, { mirrorR2 = true } = {}) {
  const { buffer, mimeType } = await downloadImageFromUrl(url);

  let r2Url = null;
  if (mirrorR2 && config.r2?.enabled) {
    try {
      r2Url = await mirrorFeaturedImageToR2(buffer, mimeType);
    } catch (error) {
      console.warn("mirrorFeaturedImageToR2:", error.message);
    }
  }

  return { buffer, mimeType, sourceUrl: url, r2Url };
}

export function applyResolvedFeaturedImage(wf, resolved) {
  if (!wf || !resolved) return;
  wf.imageBuffer = resolved.buffer;
  wf.imageMimeType = resolved.mimeType;
  wf.imageSourceUrl = resolved.sourceUrl;
  if (resolved.r2Url) {
    wf.imageR2Url = resolved.r2Url;
    wf.imageUrl = resolved.r2Url;
  }
}
