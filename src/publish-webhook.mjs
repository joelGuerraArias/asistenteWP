import { config } from "./config.mjs";

const QUEUED_GATEWAY_STATUS = new Set([202, 408, 502, 503, 504, 520, 522, 524]);
const WEBHOOK_TIMEOUT_MS = 20000;

const F1_CHOICE_HOST =
  /(?:youtube\.com|youtu\.be|youtube-nocookie\.com|instagram\.com|instagr\.am|facebook\.com|fb\.watch|\bfb\.com|dailymotion\.com|\bdai\.ly)$/i;

export function isF1ChoiceUrl(url = "") {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|mobile|web)\./i, "");
    return F1_CHOICE_HOST.test(host);
  } catch {
    return /youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|dailymotion\.com|\bdai\.ly/i.test(
      String(url)
    );
  }
}

export function webhookTargets(dest = "fvdigital") {
  if (dest === "both") return ["fvdigital", "f1rd"];
  if (dest === "f1rd") return ["f1rd"];
  return ["fvdigital"];
}

export function destIncludesFv(dest = "fvdigital") {
  return dest !== "f1rd";
}

export function destLabel(dest = "fvdigital") {
  if (dest === "both") return "FV Digital + F1RD";
  if (dest === "f1rd") return "F1RD";
  return "FV Digital";
}

export function destPrimaryHashtag(dest = "fvdigital") {
  if (dest === "f1rd") return config.f1rdWebhook?.hashtag || "#Formula1RD";
  return config.publishWebhook?.hashtag || "#fvdigital";
}

export function assertDestWebhooksReady(dest = "fvdigital") {
  for (const target of webhookTargets(dest)) {
    const cfg = targetConfig(target);
    if (!cfg.enabled || !cfg.url) {
      throw new Error(
        target === "f1rd"
          ? "Webhook F1RD deshabilitado o falta F1RD_WEBHOOK_URL."
          : "Webhook FV deshabilitado o falta PUBLISH_WEBHOOK_URL."
      );
    }
  }
}

function targetConfig(target = "fvdigital") {
  if (target === "f1rd") {
    const cfg = config.f1rdWebhook || {};
    return {
      url: cfg.url || "https://meny.app.n8n.cloud/webhook/formula1rd",
      hashtag: cfg.hashtag || "#Formula1RD",
      source: cfg.source || config.publishWebhook?.source || "asistente-wp",
      enabled: cfg.enabled !== false && Boolean(cfg.url || true),
    };
  }
  const cfg = config.publishWebhook || {};
  return {
    url: cfg.url,
    hashtag: cfg.hashtag || "#fvdigital",
    source: cfg.source || "asistente-wp",
    enabled: cfg.enabled !== false && Boolean(cfg.url),
  };
}

export function captionForTarget(text = "", target = "fvdigital") {
  const tag = targetConfig(target).hashtag;
  let base = String(text || "")
    .replace(/#fvdigital(?:\.do)?/gi, "")
    .replace(/#f1rd|#formula1rd/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (!base) return tag;
  return base.includes(tag) ? base : `${base}\n\n${tag}`.trim();
}

/**
 * @param {object} params
 * @param {"fvdigital"|"f1rd"} [params.target]
 */
export async function publishToWebhook({
  caption = "",
  title = "",
  imageUrl = null,
  videoUrl = null,
  r2Key = null,
  mediaType = null,
  target = "fvdigital",
} = {}) {
  const cfg = targetConfig(target);
  if (!cfg.enabled) return { ok: false, error: "webhook deshabilitado", target };
  if (!cfg.url) return { ok: false, error: "falta URL de webhook", target };
  if (!imageUrl && !videoUrl) {
    return { ok: false, error: "falta imageUrl o videoUrl", target };
  }

  if (videoUrl && /cloudflarestorage\.com/i.test(videoUrl)) {
    return {
      ok: false,
      target,
      error:
        "videoUrl es el endpoint API de R2 (cloudflarestorage.com). Usa la URL pública r2.dev.",
    };
  }

  const hashtag = cfg.hashtag;
  const baseText = (caption || title || "").trim();
  const finalCaption = baseText.includes(hashtag)
    ? baseText
    : `${baseText} ${hashtag}`.trim();

  const payload = {
    caption: finalCaption,
    title: (title || "").trim() || finalCaption,
    source: cfg.source || "asistente-wp",
    brand: target,
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
      return { ok: true, status: res.status, body, target, caption: finalCaption };
    }

    if (QUEUED_GATEWAY_STATUS.has(res.status)) {
      return {
        ok: true,
        queued: true,
        status: res.status,
        body,
        target,
        caption: finalCaption,
      };
    }

    return { ok: false, status: res.status, body, target };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        ok: true,
        queued: true,
        error: "timeout local (n8n procesando)",
        target,
        caption: finalCaption,
      };
    }
    return { ok: false, error: error.message, target };
  } finally {
    clearTimeout(timer);
  }
}

export async function publishToDestinations(dest, payload) {
  const targets = webhookTargets(dest);
  const results = [];
  for (const target of targets) {
    const caption = captionForTarget(payload.caption || payload.title || "", target);
    results.push(
      await publishToWebhook({
        ...payload,
        caption,
        target,
      })
    );
  }
  return results;
}
