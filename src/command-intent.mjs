/**
 * Clasifica órdenes en lenguaje natural (texto o voz transcrita)
 * hacia acciones del bot JARVIS.
 */
import { deepseekChat } from "./deepseek.mjs";
import { parseVideoIntent } from "./video-intent.mjs";
import { wantsWriteNews, parseWriteTopic, cleanWriteTopic } from "./news-write.mjs";

const ACTIONS = [
  "write_news",
  "wp",
  "periodista",
  "termometro",
  "pic",
  "reporte",
  "busca",
  "heygen",
  "hyperframes",
  "remotion",
  "video_status",
  "trad",
  "dub",
  "video_url",
  "noticia_ocr",
  "nota",
  "recortar",
  "help",
  "estado",
  "cancel",
  "chat",
];

function stripFiller(text = "") {
  return String(text || "")
    .replace(/^(eh+|este+|bueno+|ok+|oye+|mira+|por favor|porfa)[,.\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAfter(text, re) {
  const m = String(text).match(re);
  return m?.[1] ? cleanWriteTopic(m[1].trim()) : "";
}

/**
 * Regex rápido (sin IA). Devuelve intent o null.
 * @returns {{ action: string, topic?: string, title?: string, url?: string, prompt?: string, raw: string } | null}
 */
export function matchCommandIntentRegex(text = "") {
  const raw = stripFiller(text);
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (
    /^(ayuda|help|comandos|qu[eé] puedes hacer|qu[eé] sabes hacer)\b/i.test(raw) ||
    /lista de comandos/i.test(lower)
  ) {
    return { action: "help", raw };
  }

  if (/^(cancelar|cancela|olv[ií]dalo|deja quieto|parar)\b/i.test(raw)) {
    return { action: "cancel", raw };
  }

  if (/^(estado|status|c[oó]mo est[aá]s|est[aá]s activo)\b/i.test(raw)) {
    return { action: "estado", raw };
  }

  if (
    /\bterm[oó]metro\b/i.test(raw) ||
    /(?:crea|crear|haz|hacer|genera|generar)\w*\s+(?:me\s+)?(?:una\s+)?(?:imagen|foto|gr[aá]fico)\b/i.test(
      raw
    ) ||
    /(?:imagen|foto)\s+(?:del\s+)?term[oó]metro/i.test(raw) ||
    /^\/foto\b/i.test(raw)
  ) {
    return { action: "termometro", raw };
  }

  if (
    /^\/pic\b/i.test(raw) ||
    /\b(?:lower[\s-]?third|titular\s+(?:sobre|con)\s+foto|gr[aá]fico\s+con\s+foto)\b/i.test(
      lower
    ) ||
    /(?:pon|coloca|haz)\w*\s+(?:me\s+)?(?:un\s+)?(?:lower[\s-]?third|titular)\s+(?:a\s+)?(?:esta\s+)?foto/i.test(
      lower
    )
  ) {
    return { action: "pic", raw };
  }

  if (
    /^\/reporte\b/i.test(raw) ||
    /\breporte\s+intrant\b/i.test(lower) ||
    /(?:manda|env[ií]a|genera|haz)\w*\s+(?:el\s+)?reporte\b/i.test(lower)
  ) {
    return { action: "reporte", raw };
  }

  if (
    /^\/busca\b/i.test(raw) ||
    /\bbusca(?:r)?\s+(?:este\s+)?titular\b/i.test(lower) ||
    /(?:d[oó]nde|donde)\s+(?:se\s+)?public[oó]\b/i.test(lower) ||
    /localiza(?:r)?\s+(?:este\s+)?titular\b/i.test(lower)
  ) {
    const headline = extractAfter(
      raw,
      /(?:\/busca|busca(?:r)?|localiza(?:r)?)\s+(?:este\s+)?(?:titular\s+)?[:：]?\s*(.+)$/i
    );
    return { action: "busca", headline: headline || undefined, raw };
  }

  if (
    /^\/periodista\b/i.test(raw) ||
    /\bmodo periodista\b/i.test(lower) ||
    /(?:usa|activar?)\s+periodista/i.test(lower) ||
    /titular\s+(?:m[ií]o|propio|exacto)/i.test(lower)
  ) {
    const title = extractAfter(
      raw,
      /(?:periodista|titular)\s*[:：]?\s*(.+)$/i
    );
    return { action: "periodista", title: title || undefined, raw };
  }

  if (
    /^\/wp\b/i.test(raw) ||
    /\bart[ií]culo\s+guiado\b/i.test(lower) ||
    /(?:crea|crear|haz|escribir?)\w*\s+(?:me\s+)?(?:un\s+)?art[ií]culo\b/i.test(raw) ||
    /modo\s+wordpress/i.test(lower)
  ) {
    const topic =
      extractAfter(
        raw,
        /(?:art[ií]culo|wp)\s+(?:sobre|de|acerca de)\s+(.+)/i
      ) ||
      extractAfter(raw, /^\/wp\s+(.+)/i) ||
      "";
    return { action: "wp", topic: topic || undefined, raw };
  }

  if (wantsWriteNews(raw)) {
    const topic =
      parseWriteTopic(raw) ||
      extractAfter(raw, /(?:quiero|necesito)\s+(?:una\s+)?noticia\s+(?:sobre|de|acerca de)?\s*(.+)/i) ||
      extractAfter(raw, /noticia\s+(?:sobre|de|acerca de)\s+(.+)/i) ||
      undefined;
    return { action: "write_news", topic, raw };
  }

  // Variantes habladas de noticia sin el patrón exacto de wantsWriteNews
  if (
    /(?:quiero|necesito|prep[aá]rame)\s+(?:una\s+)?noticia\b/i.test(raw) ||
    /noticia\s+(?:sobre|de|acerca)\b/i.test(raw)
  ) {
    const topic =
      extractAfter(raw, /noticia\s+(?:sobre|de|acerca de)\s+(.+)/i) ||
      extractAfter(raw, /(?:quiero|necesito|prep[aá]rame)\s+(?:una\s+)?noticia\s+(.+)/i) ||
      undefined;
    return { action: "write_news", topic, raw };
  }

  if (
    /^\/noticia\b/i.test(raw) ||
    /^\/ocr\b/i.test(raw) ||
    /(?:captura|screenshot).*(?:noticia|ocr)/i.test(lower) ||
    /noticia\s+desde\s+(?:una\s+)?(?:foto|captura)/i.test(lower)
  ) {
    return { action: "noticia_ocr", raw };
  }

  if (
    /^\/nota\b/i.test(raw) ||
    /(?:haz|crea|redact)\w*\s+(?:me\s+)?(?:una\s+)?nota\b/i.test(raw) ||
    /nota\s+desde\s+(?:un\s+)?(?:pdf|documento)/i.test(lower)
  ) {
    return { action: "nota", raw };
  }

  if (/^\/recortar\b/i.test(raw) || /\brecorta(r)?\s+(?:la\s+)?(?:foto|imagen)\b/i.test(raw)) {
    return { action: "recortar", raw };
  }

  if (
    /^\/trad\b/i.test(raw) ||
    /\btraduce\b/i.test(lower) ||
    /\bdoblaje\b/i.test(lower) ||
    /video\s+traducido/i.test(lower)
  ) {
    return { action: "trad", raw };
  }

  if (
    /^\/dub\b/i.test(raw) ||
    /\bdub\b/i.test(lower) ||
    /elevenlabs\s*dub/i.test(lower) ||
    /dobla(r)?\s+(?:con\s+)?eleven/i.test(lower)
  ) {
    return { action: "dub", raw };
  }

  const video = parseVideoIntent(raw);
  if (video) {
    if (video.tool === "status") return { action: "video_status", raw };
    if (video.tool === "heygen") {
      return { action: "heygen", prompt: video.prompt || undefined, raw };
    }
    if (video.tool === "hyperframes") {
      return {
        action: "hyperframes",
        prompt: video.prompt || undefined,
        render: video.render,
        raw,
      };
    }
    if (video.tool === "remotion") {
      return { action: "remotion", render: video.render, raw };
    }
  }

  return null;
}

/**
 * Clasificador IA cuando el regex no alcanza (voz libre).
 */
export async function classifyCommandIntentWithAi(text = "") {
  const raw = stripFiller(text);
  if (!raw || raw.length < 3) return { action: "chat", raw };

  const prompt = `Clasifica esta orden de un editor de noticias para el bot JARVIS (FV Digital).
Devuelve SOLO JSON válido:
{"action":"<una>","topic":"","title":"","headline":"","prompt":"","confidence":0.0}

Acciones permitidas: ${ACTIONS.join(", ")}

Guía:
- write_news: redactar/crear una noticia sobre un tema (buscar en web + titulares)
- wp: artículo guiado WordPress
- periodista: el usuario impone el titular
- termometro: crear imagen tipo Termómetro / foto institucional
- pic: foto + texto del usuario en lower-third FV o F1RD (sin IA)
- reporte: REPORTE Intrant consolidado (Gmail, X, YT, IG, FB, TV/radio → PDF + correo)
- busca: localizar un titular en la web (Tavily/Brave) y redactar correo con medios/URLs
- heygen: video con presentador/avatar
- hyperframes / remotion: tools de video
- video_status: estado de herramientas de video
- trad: traducir/doblar video o texto (Mistral TTS)
- dub: doblar video con ElevenLabs Dubbing API
- noticia_ocr: publicar desde captura de pantalla
- nota: nota desde PDF/documento
- recortar: recortar imagen
- help: ayuda/comandos
- estado: estado del bot
- cancel: cancelar flujo
- chat: pregunta general / conversación (no es una orden de producción)

Orden del usuario:
"""${raw.slice(0, 500)}"""`;

  try {
    const { content } = await deepseekChat([{ role: "user", content: prompt }], {
      json: true,
      temperature: 0.1,
      thinking: false,
    });
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const action = String(parsed?.action || "chat").toLowerCase();
    if (!ACTIONS.includes(action)) {
      return { action: "chat", raw };
    }
    const confidence = Number(parsed?.confidence ?? 0.5);
    if (action !== "chat" && confidence < 0.45) {
      return { action: "chat", raw };
    }
    return {
      action,
      topic: parsed?.topic ? cleanWriteTopic(String(parsed.topic)) : undefined,
      title: parsed?.title ? String(parsed.title).trim() : undefined,
      headline: parsed?.headline ? String(parsed.headline).trim() : undefined,
      prompt: parsed?.prompt ? String(parsed.prompt).trim() : undefined,
      raw,
      confidence,
    };
  } catch (error) {
    console.warn("classifyCommandIntentWithAi:", error.message);
    return { action: "chat", raw };
  }
}

/**
 * Resuelve intent: regex primero, IA si hace falta.
 */
export async function resolveCommandIntent(text = "", { useAi = true } = {}) {
  const raw = stripFiller(text);
  const quick = matchCommandIntentRegex(raw);
  if (quick) return quick;
  if (!useAi) return { action: "chat", raw };
  // Frases muy cortas / saludos → chat sin gastar IA
  if (raw.length < 12) return { action: "chat", raw };
  return classifyCommandIntentWithAi(raw);
}
