import { config } from "./config.mjs";

// Estados de gateway que indican que n8n recibió la petición pero tardó en
// responder (procesa en segundo plano). Se tratan como "encolado", no error.
const QUEUED_GATEWAY_STATUS = new Set([202, 408, 502, 503, 504, 520, 522, 524]);
const WEBHOOK_TIMEOUT_MS = 20000;

/**
 * Envía un post al webhook de publicación (n8n).
 * El webhook exige que el texto contenga el hashtag configurado (#fvdigital).
 *
 * Para videos: `videoUrl` debe ser la URL pública del bucket R2
 * (R2_PUBLIC_BASE_URL / r2.dev), no el endpoint API cloudflarestorage.com.
 *
 * @param {object} params
 * @param {string} params.title       Texto/título del post.
 * @param {string} [params.imageUrl]  URL pública de la imagen.
 * @param {string} [params.videoUrl]  URL pública R2 del video.
 * @param {string} [params.r2Key]     Key del objeto en el bucket (opcional).
 * @param {string} [params.mediaType] VIDEO | IMAGE | REEL | PHOTO ...
 * @returns {Promise<{ok: boolean, status?: number, body?: any, error?: string}>}
 */
export async function publishToWebhook({
  caption = "",
  title = "",
  imageUrl = null,
  videoUrl = null,
  r2Key = null,
  mediaType = null,
} = {}) {
  const cfg = config.publishWebhook;
  if (!cfg?.enabled) return { ok: false, error: "webhook deshabilitado" };
  if (!cfg.url) return { ok: false, error: "falta PUBLISH_WEBHOOK_URL" };
  if (!imageUrl && !videoUrl) {
    return { ok: false, error: "falta imageUrl o videoUrl" };
  }

  if (videoUrl && /cloudflarestorage\.com/i.test(videoUrl)) {
    return {
      ok: false,
      error:
        "videoUrl es el endpoint API de R2 (cloudflarestorage.com). Usa la URL pública r2.dev.",
    };
  }

  const hashtag = cfg.hashtag || "#fvdigital";
  // Prioriza el caption generado; si no hay, usa el título.
  const baseText = (caption || title || "").trim();
  const finalCaption = baseText.includes(hashtag)
    ? baseText
    : `${baseText} ${hashtag}`.trim();

  const payload = {
    caption: finalCaption,
    title: (title || "").trim() || finalCaption,
    source: cfg.source || "asistente-wp",
  };

  if (videoUrl) {
    payload.videoUrl = videoUrl;
    payload.r2Url = videoUrl;
    payload.storage = "r2";
    if (r2Key) payload.r2Key = r2Key;
    payload.mediaType = mediaType || "VIDEO";
  } else {
    payload.imageUrl = imageUrl;
    payload.mediaType = mediaType || "IMAGE";
  }

  // Sin reintentos: n8n procesa cada POST, reintentar duplicaría la publicación.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }

    if (res.ok) {
      return { ok: true, status: res.status, body };
    }

    // Timeout de gateway (Cloudflare 524, etc.): n8n lo está procesando.
    if (QUEUED_GATEWAY_STATUS.has(res.status)) {
      return { ok: true, queued: true, status: res.status, body };
    }

    return { ok: false, status: res.status, body };
  } catch (error) {
    // Nuestro propio timeout: la petición salió; n8n sigue procesando.
    if (error.name === "AbortError") {
      return { ok: true, queued: true, error: "timeout local (n8n procesando)" };
    }
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}
