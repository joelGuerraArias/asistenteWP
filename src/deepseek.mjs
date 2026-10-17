import { config } from "./config.mjs";
import { fetchWithRetry } from "./fetch-retry.mjs";
import {
  coerceArticleFields,
  coerceArticleHtml,
  parseModelJson,
} from "./article-json.mjs";
import {
  extractOriginalTitle,
  looksLikeRawNewsLead,
  NEVER_NAME_MILTON_JEREZ_RULE,
  parseSourceFromUrl,
  scrubMiltonJerez,
  stripMediaDateline,
} from "./news-format.mjs";

const SYSTEM_PROMPT = `Eres JARVIS, asistente de FV Digital (fvdigital.do). Español, breve, útil.
El usuario usa /ia solo para charlar. La publicación a WordPress es automática: enlaces, capturas y fotos.
No hagas análisis largos ni listas de opciones. No preguntes categorías, borrador ni confirmaciones.
Si preguntan cómo publicar: "Envía el enlace o una captura con /noticia."`;

/**
 * DeepSeek's JSON parser 400s on lone UTF-16 surrogates ("unexpected end of hex escape").
 * Scraped titles/summaries often slice mid-emoji; JSON.stringify emits unpaired \udXXX.
 */
export function sanitizeForDeepseek(value = "") {
  const s = String(value ?? "");
  if (!s) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
        continue;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += s[i];
  }
  return out;
}

export async function deepseekChat(
  messages,
  { json = false, temperature = 0.75, thinking = null, system = SYSTEM_PROMPT } = {}
) {
  if (!config.deepseek.apiKey) {
    throw new Error("Configura DEEPSEEK_API_KEY en .env");
  }

  const model = config.deepseek.model || "deepseek-v4-pro";
  const useThinking = thinking ?? config.deepseek.thinking;

  const safeMessages = (messages || []).map((m) => ({
    ...m,
    content: sanitizeForDeepseek(m?.content ?? ""),
  }));

  const body = {
    model,
    messages: [
      { role: "system", content: sanitizeForDeepseek(system || SYSTEM_PROMPT) },
      ...safeMessages,
    ],
    temperature,
    thinking: { type: useThinking ? "enabled" : "disabled" },
  };

  if (useThinking) {
    body.reasoning_effort = config.deepseek.reasoningEffort;
  }

  if (json) {
    body.response_format = { type: "json_object" };
    body.thinking = { type: "disabled" };
  }

  const res = await fetchWithRetry(
    `${config.deepseek.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.deepseek.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    { label: "DeepSeek" }
  );

  const rawText = await res.text().catch(() => "");
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText.slice(0, 500) };
  }
  if (!res.ok) {
    const detail =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : "") ||
      (data?.raw ? String(data.raw) : "") ||
      rawText.slice(0, 500) ||
      `DeepSeek ${res.status}`;
    throw new Error(`DeepSeek ${res.status}: ${detail}`);
  }

  const msg = data.choices?.[0]?.message;
  return {
    content: msg?.content?.trim() || "",
    reasoning: msg?.reasoning_content?.trim() || "",
  };
}

export async function askDeepseek(userText, history = []) {
  const messages = [
    ...history.slice(-10),
    { role: "user", content: userText },
  ];
  return deepseekChat(messages);
}

export async function buildNewsPostFromOcr({
  ocrText,
  userHint = "",
  originalTitle,
  sourceName,
  sourceUrl,
}) {
  const rawTitle = originalTitle || extractOriginalTitle(ocrText);
  const title = await translateToSpanish(rawTitle, { context: "titular de noticia" });

  const prompt = `Redacta el CUERPO de una noticia para WordPress en JSON.
REGLAS OBLIGATORIAS:
- NO cambies el titular; el título ya está fijado: "${title}"
- Reescribe el cuerpo con estilo periodístico claro; traduce al español si el OCR está en otro idioma
- NO incluyas firma ni fuente en el HTML (se añaden automáticamente al pie)
- NO menciones el medio de origen ni "según X medio"
- Usa HTML simple: <p>, <strong>, <em>

${EDITORIAL_HTML_RULES}

Formato JSON:
{
  "excerpt": "resumen de 1-2 líneas",
  "content_html": "solo el cuerpo de la noticia"
}

Instrucciones extra: ${userHint || "ninguna"}

Texto OCR:
---
${scrubMiltonJerez(ocrText)}
---`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { json: true }
  );

  let draft = parseModelJson(content);
  if (!draft) {
    draft = content.trim().startsWith("{")
      ? { excerpt: "", content_html: "" }
      : { excerpt: "", content_html: `<p>${escapeHtml(content)}</p>` };
  }

  const fields = coerceArticleFields(draft.content_html || content);

  return {
    title,
    excerpt: scrubMiltonJerez((draft.excerpt || fields.excerpt || "").replace(/^["']|["']$/g, "")),
    body_html: scrubMiltonJerez(fields.content_html),
    sourceName,
    sourceUrl,
  };
}

/**
 * Redacta una nota / comunicado a partir del texto de un documento (PDF, etc.).
 */
export async function buildNoteFromDocument({ docText, userHint = "", fileName = "" }) {
  const prompt = `Eres redactor de FV Digital. A partir del documento, arma una NOTA / comunicado para WordPress en JSON.

REGLAS:
- Extrae los hechos del documento (quién, qué, cuándo, dónde, por qué)
- Titular claro y periodístico en español
- Cuerpo en HTML simple (<p>, <strong>, <em>)
- Conserva cifras, nombres, cargos e instituciones del documento
- No inventes datos que no estén en el texto
- No digas "según el documento" ni "el PDF indica"
- Estilo nota informativa / comunicado, listo para publicar

${EDITORIAL_HTML_RULES}

Formato JSON:
{
  "title": "titular",
  "excerpt": "resumen 1-2 líneas",
  "content_html": "cuerpo HTML",
  "summary": "2-4 bullets clave del documento (texto plano, uno por línea con • )"
}

Archivo: ${fileName || "documento"}
Indicaciones: ${userHint || "ninguna"}

Documento:
---
${scrubMiltonJerez(String(docText || "").slice(0, 12000))}
---`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { json: true }
  );

  let draft = parseModelJson(content);
  if (!draft) {
    draft = {
      title: extractOriginalTitle(docText, "Nota"),
      excerpt: "",
      content_html: `<p>${escapeHtml(String(docText || "").slice(0, 2000))}</p>`,
      summary: "",
    };
  }

  const title = await translateToSpanish(
    String(draft.title || extractOriginalTitle(docText, "Nota")).trim(),
    { context: "titular de nota" }
  );
  const fields = coerceArticleFields(draft.content_html || content);

  return {
    title: scrubMiltonJerez(title),
    excerpt: scrubMiltonJerez(String(draft.excerpt || fields.excerpt || "").replace(/^["']|["']$/g, "")),
    body_html: scrubMiltonJerez(fields.content_html),
    summary: scrubMiltonJerez(String(draft.summary || "").trim()),
  };
}

const EDITORIAL_HTML_RULES = `FORMATO EDITORIAL FV DIGITAL:
- TODO el contenido debe estar en español (traduce si viene en otro idioma)
- Párrafos en <p>, elegantes y legibles (2-4 oraciones cada uno)
- <strong> obligatorio en: nombres propios, países, ciudades, instituciones, cargos, cifras, porcentajes y fechas clave
- Comillas normales (" "), guiones largos (—), texto limpio sin entidades HTML (&amp; #8211; etc.)
- NO metadatos de agencia (EFE, AP, ARCHIVO, LD, Listín Diario, fechas sueltas de publicación)
- NO menciones al medio de origen ni fuentes externas en el cuerpo
${NEVER_NAME_MILTON_JEREZ_RULE}`;

/**
 * Corrige SOLO ortografía, tildes y puntuación de un titular o caption.
 * Nunca cambia el sentido, el enfoque ni las palabras clave.
 */
export async function correctHeadlineSpelling(title = "") {
  const input = String(title || "").trim();
  if (!input) return input;

  const prompt = `Corrige la ortografía de este texto para redes sociales (titular o caption corto).

OBLIGATORIO corregir:
- Tildes y acentos (pais→país, economica→económica, autpista→autopista)
- Errores de escritura y letras faltantes/sobrantes
- Mayúsculas al inicio y en nombres propios
- Puntuación básica

PROHIBIDO:
- Cambiar el sentido, añadir o quitar información
- Sinónimos, reescritura, otro enfoque
- Comillas, explicación o comentarios

Conserva nombres propios, siglas, cifras y el orden de las ideas.
Devuelve SOLO el texto corregido.

Texto:
${input}`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { temperature: 0.05, thinking: false }
  );

  const out = content.trim().replace(/^["'`]|["'`]$/g, "");
  return out || input;
}

export async function translateToSpanish(text, { context = "texto" } = {}) {
  const input = (text || "").trim();
  if (!input) return input;

  const prompt = `Traduce al español (estilo periodístico dominicano) este ${context}.
Reglas:
- Devuelve SOLO la traducción, sin comillas ni explicación
- Conserva nombres propios, siglas, cifras y nombres de lugares
- Si ya está en español, devuélvelo igual (puedes corregir gramática menor)

Texto:
${input}`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { temperature: 0.2 }
  );

  return content.trim().replace(/^["']|["']$/g, "") || input;
}

/**
 * Corrige ortografía/redacción de un texto (para /trad pegado).
 * No inventa hechos ni cambia el sentido.
 */
export async function correctTradText(text = "") {
  const input = String(text || "").trim();
  if (!input) return input;

  const prompt = `Corrige ortografía, tildes, mayúsculas, puntuación y redacción menor de este texto.

REGLAS ESTRICTAS:
- NO cambies el sentido ni inventes información
- NO añadas hechos nuevos
- Conserva nombres propios, siglas, cifras y el orden de las ideas
- Puedes suavizar frases rotas o repeticiones obvias
- Si ya está correcto, devuélvelo igual
- Devuelve SOLO el texto corregido, sin comillas ni explicación

Texto:
${input.slice(0, 8000)}`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { temperature: 0.15 }
  );

  const out = content.trim().replace(/^["']|["']$/g, "");
  return out || input;
}

/**
 * Enriquece un texto con datos de investigación (Tavily), sin inventar.
 */
export async function enrichTradTextWithResearch(text = "", researchBrief = "") {
  const input = String(text || "").trim();
  const research = String(researchBrief || "").trim();
  if (!input) return input;
  if (!research) return input;

  const prompt = `Mejora y amplía este texto usando SOLO los datos de la investigación adjunta.

REGLAS:
- Conserva el enfoque y el tono del texto original
- Incorpora cifras, nombres y hechos verificables de la investigación
- NO inventes datos que no estén en la investigación ni en el texto
- Español claro (República Dominicana)
- Devuelve SOLO el texto final, sin comillas ni explicación

Texto original:
${input.slice(0, 5000)}

Investigación:
${research.slice(0, 7000)}`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { temperature: 0.25 }
  );

  const out = content.trim().replace(/^["']|["']$/g, "");
  return out || input;
}

export async function formatNewsBodyHtml({ text, title, topic = "" }) {
  const spanishTitle = await translateToSpanish(title, { context: "titular de noticia" });

  const prompt = `Formatea el cuerpo de una noticia para WordPress en JSON.
Titular fijo (ya en español): "${spanishTitle}"
${topic ? `Tema: ${topic}` : ""}

${EDITORIAL_HTML_RULES}

Traduce al español si el texto base está en otro idioma. Reescribe con estilo periodístico dominicano elegante.

Texto base:
---
${scrubMiltonJerez(text).slice(0, 6500)}
---

JSON: { "content_html": "cuerpo en HTML con <p> y <strong>" }`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { json: true }
  );

  let draft = parseModelJson(content);
  if (!draft?.content_html) {
    draft = content.trim().startsWith("{")
      ? { content_html: "" }
      : { content_html: `<p>${escapeHtml(content)}</p>` };
  }

  return {
    content_html: scrubMiltonJerez(coerceArticleHtml(draft.content_html || content)),
    title: spanishTitle,
  };
}

export async function writeOriginalNews({
  topic,
  title,
  researchText = "",
  rewriteNotes = "",
}) {
  const notes = String(rewriteNotes || "").trim();
  const prompt = `Redacta una noticia original para WordPress (FV Digital, República Dominicana) en JSON.
Tema: ${topic}
Titular fijo (no lo cambies): "${title}"

REGLAS:
- Usa SOLO datos del material de investigación cuando esté disponible
- Prioriza nombres propios, cifras, fechas, lugares y citas del material Tavily y de las fuentes
- Si hay datos concretos en la investigación, el artículo DEBE incluirlos (no quedarse en generalidades)
- Si faltan datos concretos, redacta en tono general sin inventar cifras, fechas ni citas
- Estilo periodístico claro, informativo, 4-6 párrafos
- NO incluyas firma, fuente, enlaces ni menciones al medio de origen
- NO copies párrafos literales de las referencias; reescribe con estilo propio
- El artículo debe tratar SOLO el tema "${topic}"; ignora información no relacionada
- JSON válido: escapa comillas internas con \\"; NO uses \\' (escribe minutos como 79 min)
${notes ? `\nINDICACIONES DEL EDITOR (oblígalas en el nuevo borrador):\n${notes.slice(0, 1200)}\n` : ""}
${EDITORIAL_HTML_RULES}

${researchText ? `MATERIAL DE INVESTIGACIÓN (Tavily + web — usa nombres, cifras, fechas, lugares y fuentes; no nombres a Milton Jerez):\n---\n${scrubMiltonJerez(researchText).slice(0, 6000)}\n---` : "No hay material de investigación; redacta con cautela."}

JSON:
{
  "excerpt": "resumen de 1-2 líneas",
  "content_html": "solo el cuerpo en HTML"
}`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { json: true }
  );

  let draft = parseModelJson(content);
  if (!draft) {
    draft = content.trim().startsWith("{")
      ? { excerpt: "", content_html: "" }
      : { excerpt: "", content_html: `<p>${escapeHtml(content)}</p>` };
  }

  if (!draft.content_html && content.trim().startsWith("{")) {
    throw new Error("No pude interpretar el artículo generado por la IA.");
  }

  const fields = coerceArticleFields(draft.content_html || content);

  return {
    title,
    excerpt: scrubMiltonJerez(
      (draft.excerpt || fields.excerpt || "").replace(/^["']|["']$/g, "")
    ),
    body_html: scrubMiltonJerez(fields.content_html),
  };
}

export async function suggestNewsTitles(topic, researchText = "") {
  const prompt = `Propón 3 titulares periodísticos en español para una noticia sobre:
"${topic}"

${researchText ? `Basado en esta investigación (Tavily + fuentes — datos concretos obligatorios):\n${scrubMiltonJerez(researchText).slice(0, 5000)}` : ""}

Estilo FV Digital: claros, directos, sin clickbait exagerado.
JSON: { "titles": ["titular 1", "titular 2", "titular 3"] }`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { json: true }
  );

  const data = parseModelJson(content);
  if (data?.titles?.length) {
    const titles = data.titles.filter(Boolean).slice(0, 3);
    if (titles.length) return titles;
  }

  return [
    `${topic}: lo que debes saber`,
    `Actualidad sobre ${topic}`,
    `${topic} en el foco informativo`,
  ];
}

export async function buildNewsPostFromArticle({
  title,
  bodyText,
  sourceUrl,
  sourceName,
  userHint = "",
}) {
  const source = sourceName
    ? { name: sourceName, url: sourceUrl }
    : parseSourceFromUrl(sourceUrl || "");

  const prompt = `Redacta el CUERPO de una noticia para WordPress en JSON.
REGLAS OBLIGATORIAS:
- NO cambies el titular; el título exacto es: "${title}"
- Reescribe el cuerpo con estilo periodístico; no copies párrafo por párrafo
- NO incluyas firma ni fuente en el HTML

Formato JSON:
{
  "excerpt": "resumen de 1-2 líneas",
  "content_html": "solo el cuerpo"
}

Instrucciones extra: ${userHint || "ninguna"}

Texto de referencia:
---
${bodyText}
---`;

  const { content } = await deepseekChat(
    [{ role: "user", content: prompt }],
    { json: true }
  );

  let draft = parseModelJson(content);
  if (!draft) {
    draft = content.trim().startsWith("{")
      ? { excerpt: "", content_html: "" }
      : { excerpt: "", content_html: `<p>${escapeHtml(content)}</p>` };
  }

  const fields = coerceArticleFields(draft.content_html || content);

  return {
    title,
    excerpt: scrubMiltonJerez(draft.excerpt || fields.excerpt || ""),
    body_html: scrubMiltonJerez(fields.content_html),
    sourceName: source.name,
    sourceUrl: source.url,
  };
}

/**
 * Sugiere una etiqueta corta (1-2 palabras) para el tag rojo de la tarjeta social.
 * Devuelve algo como "IMPUESTOS", "ELECCIONES", "DEPORTES".
 */
export async function suggestNewsTag(title, bodyText = "") {
  const fallback = () => {
    const stop = new Set([
      "para","por","que","con","los","las","del","una","uno","unos","unas",
      "sobre","entre","como","desde","hasta","este","esta","esos","esas",
      "the","and","de","la","el","en","un","y","a","al","se","su","lo",
    ]);
    const word = String(title)
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !stop.has(w.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    return (word || "NOTICIA").toUpperCase();
  };

  try {
    const prompt = `Dame UNA etiqueta corta (1 o 2 palabras, en MAYÚSCULAS, español) que resuma el tema de esta noticia para una tarjeta social. Sin comillas, sin punto, solo la etiqueta.
Ejemplos válidos: IMPUESTOS, ELECCIONES, SEGURIDAD, ECONOMÍA, DEPORTES, SALUD.

Titular: "${title}"
${bodyText ? `Extracto: ${bodyText.slice(0, 400)}` : ""}`;

    const { content } = await deepseekChat(
      [{ role: "user", content: prompt }],
      { temperature: 0.2 }
    );

    const tag = (content || "")
      .replace(/["'`.]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 2)
      .join(" ")
      .toUpperCase();

    if (tag && tag.length >= 3 && tag.length <= 22) return tag;
  } catch {
    // usa fallback
  }

  return fallback();
}

export async function generateNewsHeadline(bodyText, { platform = "", fallbackTitle = "" } = {}) {
  const clean = (txt) =>
    stripMediaDateline(
      String(txt || "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/#[\p{L}\d_.]+/gu, "")
        .replace(/@[\w.]+/g, "")
        .replace(/\s+/g, " ")
        .trim()
    );

  const body = clean(bodyText);
  const fallback = () => {
    const base = clean(fallbackTitle) || body;
    const firstSentence = base.split(/(?<=[.!?])\s/)[0] || base;
    return trimHeadlineToComplete(firstSentence, 12) || firstSentence.slice(0, 90);
  };

  if (!body || body.length < 15) return fallback();

  try {
    const prompt = `Eres editor de FV Digital (fvdigital.do). Redacta UN titular periodístico propio a partir de ${platform ? `una publicación de ${platform}` : "esta noticia"}.
Reglas estrictas (SIEMPRE):
- Español, entre 6 y 12 palabras (máximo 12).
- Idea COMPLETA: sujeto + qué pasó. NUNCA dejes la frase en el aire ni termines en de/del/por/no/en/con/para/y…
- Titular propio: PROHIBIDO copiar lead del medio (AGENDA56, Listín, “SANTO DOMINGO ESTE.-”, etc.).
- Sin nombre del medio de origen, sin hashtags, sin @menciones, sin comillas, sin emojis.
- Conserva nombres propios relevantes.
- ${NEVER_NAME_MILTON_JEREZ_RULE}

Texto:
---
${body.slice(0, 1500)}
---
${fallbackTitle ? `Referencia (no copiar literal):\n${clean(fallbackTitle).slice(0, 200)}` : ""}

Devuelve SOLO el titular (≤12 palabras).`;

    const { content } = await deepseekChat(
      [{ role: "user", content: prompt }],
      { temperature: 0.45 }
    );

    let headline = clean(content)
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/[.]+$/, "")
      .trim();
    if (looksLikeRawNewsLead(headline)) headline = stripMediaDateline(headline);

    const words = headline.split(/\s+/).filter(Boolean).length;
    if (
      headline &&
      words >= 4 &&
      words <= 12 &&
      !headlineLooksIncomplete(headline) &&
      !looksLikeRawNewsLead(headline)
    ) {
      return headline;
    }
    if (headline && words > 12) {
      const trimmed = trimHeadlineToComplete(headline, 12);
      if (
        trimmed &&
        !headlineLooksIncomplete(trimmed) &&
        !looksLikeRawNewsLead(trimmed)
      ) {
        return trimmed;
      }
    }
  } catch {
    // usa fallback
  }

  return fallback();
}

/**
 * Contadores / chequeo de lower-third (tarjeta y barra roja).
 * Si pasa de 12 palabras o queda “en el aire”, hay que reescribir.
 */
const HANGING_LAST_WORD =
  /^(de|del|la|el|los|las|lo|le|les|en|con|para|por|y|o|u|a|al|un|una|unos|unas|no|ni|que|se|su|sus|mi|mis|tu|tus|como|más|menos|sin|sobre|entre|hasta|desde|hacia|bajo|ante|tras|durante|mediante|según|versus|vs|muy|tan|ya|aún|aun|si|sí|porque|aunque|mientras|cuando|donde|cual|cuál|quien|quién|esto|esta|este|esos|esas|ese|esa|the|a|an|of|in|on|for|and|or|to|with|by|at|from|into|over|about)$/i;

export function countHeadlineWords(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** True si el titular corta la idea (preposición, “por no”, puntos suspensivos…). */
export function headlineLooksIncomplete(text = "") {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return true;
  if (/\.\.\.|…\s*$/.test(raw)) return true;
  const stripped = raw.replace(/[¿?¡!.,;:…]+$/g, "").trim();
  const parts = stripped.split(/\s+/).filter(Boolean);
  if (!parts.length) return true;
  const last = parts[parts.length - 1];
  if (HANGING_LAST_WORD.test(last)) return true;
  // “por no”, “falta de”, “antes de” al final (última palabra ya cubierta; refuerzo 2-gram)
  if (parts.length >= 2) {
    const tail = `${parts[parts.length - 2]} ${last}`.toLowerCase();
    if (
      /^(por no|sin que|antes de|después de|frente a|junto a|cerca de|lejos de|a favor|en contra|debido a|gracias a|acerca de)$/i.test(
        tail
      )
    ) {
      return true;
    }
  }
  return false;
}

export function needsLowerThirdRewrite(text = "", maxWords = 12) {
  const n = countHeadlineWords(text);
  if (n < 3) return true;
  if (n > maxWords) return true;
  return headlineLooksIncomplete(text);
}

/** Acorta sin dejar la última palabra colgando (nunca corta a lo bruto a N palabras). */
export function trimHeadlineToComplete(text = "", maxWords = 12) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  let cut = words.slice(0, Math.min(maxWords, words.length));
  while (cut.length > 3 && headlineLooksIncomplete(cut.join(" "))) {
    cut.pop();
  }
  return cut.join(" ");
}

/**
 * Titular SOLO para tarjeta / lower-third (WP no usa esto).
 * SIEMPRE se analiza con las reglas ≤12 palabras + idea completa.
 * - lang "en": siempre inglés (F1RD)
 */
export async function composeCardHeadline(title, bodyText = "", { lang = "es" } = {}) {
  const clean = (txt) =>
    stripMediaDateline(
      String(txt || "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/#[\p{L}\d_.]+/gu, "")
        .replace(/\s+/g, " ")
        .trim()
    );

  const source = clean(title);
  const isEn = String(lang).toLowerCase().startsWith("en");
  if (!source) return isEn ? "News" : clean(bodyText).slice(0, 80) || "Noticia";

  const words = source.split(/\s+/).filter(Boolean);

  const accept = (candidate) => {
    const h = clean(candidate)
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/[.]+$/, "")
      .trim();
    if (!h || looksLikeRawNewsLead(h)) return "";
    if (needsLowerThirdRewrite(h, 12)) return "";
    const n = countHeadlineWords(h);
    if (n < 3 || n > 12) return "";
    return h;
  };

  // Siempre IA: no devolver el original “porque ya es corto”
  try {
    const prompt = isEn
      ? `Rewrite this for a social MEDIA CARD / lower-third.
Strict rules (ALWAYS):
- English only, MAXIMUM 12 words, COMPLETE idea.
- Do NOT copy wire/dateline or outlet names.
- NEVER end mid-thought (of, the, a, an, in, on, for, and, or, to…).
- NO ellipsis, quotes, hashtags. Keep key proper names.

Original (${words.length} words): "${source}"
${bodyText ? `Context: ${clean(bodyText).slice(0, 350)}` : ""}

Return ONLY the headline (≤12 words, complete).`
      : `Reescribe este titular para LOWER-THIRD / tarjeta FV Digital.
Reglas (SIEMPRE — las de 12 palabras):
- Español, MÁXIMO 12 palabras, idea COMPLETA (sujeto + qué pasó).
- PROHIBIDO nombre de medio (AGENDA56, Listín…) y datelines (“SANTO DOMINGO ESTE.-”).
- PROHIBIDO terminar en: de, del, la, el, en, con, para, por, y, o, a, un, una, no…
- SIN puntos suspensivos, comillas ni hashtags. Conserva nombres propios clave.

Original (${words.length} palabras): "${source}"
${bodyText ? `Contexto: ${clean(bodyText).slice(0, 350)}` : ""}

Devuelve SOLO el titular (≤12 palabras, idea cerrada).`;

    const { content } = await deepseekChat(
      [{ role: "user", content: prompt }],
      { temperature: 0.3 }
    );

    const ok = accept(content);
    if (ok) return ok;

    const { content: retry } = await deepseekChat(
      [
        {
          role: "user",
          content: isEn
            ? `COMPLETE ≤12-word headline. No outlet names.\n\n"${clean(content) || source}"\n\nReturn ONLY the headline.`
            : `Titular COMPLETO ≤12 palabras, sin medio ni dateline.\n\n"${clean(content) || source}"\n\nDevuelve SOLO el titular.`,
        },
      ],
      { temperature: 0.2 }
    );
    const ok2 = accept(retry);
    if (ok2) return ok2;
  } catch {
    // fallback abajo
  }

  const trimmed = trimHeadlineToComplete(source, 12);
  if (
    trimmed &&
    !headlineLooksIncomplete(trimmed) &&
    !looksLikeRawNewsLead(trimmed)
  ) {
    return trimmed;
  }
  return trimmed || source;
}

/**
 * Caption en español: si el texto viene en otro idioma lo traduce.
 * Las líneas finales de solo hashtags se conservan sin traducir.
 */
export async function ensureSpanishCaption(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/);
  const tail = [];
  while (lines.length && /^(\s*#[\p{L}\p{N}_.]+\s*)+$/u.test(lines[lines.length - 1])) {
    tail.unshift(lines.pop().trim());
  }
  const body = lines.join("\n").trim();
  if (!body) return raw;

  const { looksSpanishText, translateTextWithMistral } = await import("./audio.mjs");
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words >= 6 && looksSpanishText(body)) return raw;

  let translated = body;
  try {
    translated =
      String(
        (await translateTextWithMistral(body, {
          context: "caption de video para redes sociales (conserva los saltos de párrafo)",
        })) || ""
      ).trim() || body;
  } catch {
    return raw;
  }
  return [translated, tail.join(" ")].filter(Boolean).join("\n\n").trim();
}

export async function generateSocialCaption(
  title,
  bodyText = "",
  { hashtag = "#fvdigital", lang = "es", stickToSource = false } = {}
) {
  // Limpia URLs/hashtags/menciones pero CONSERVA los saltos de párrafo.
  const cleanKeepBreaks = (txt) =>
    String(txt || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/#[\p{L}\d_.]+/gu, "")
      .replace(/@[\w.]+/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .trim();

  const cleanInline = (txt) =>
    String(txt || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const isEn = String(lang).toLowerCase().startsWith("en");
  const source = cleanKeepBreaks(bodyText);
  const sourceInline = cleanInline(bodyText);

  const ensureSpanish = (text) => (isEn ? String(text || "").trim() : ensureSpanishCaption(text));

  const fallback = async () => {
    const base = sourceInline.slice(0, 700) || cleanInline(title);
    return `${await ensureSpanish(base)}\n\n${hashtag}`.trim();
  };

  // Caption de video: si no hay texto de origen, no inventar un relato.
  if (stickToSource && sourceInline.length < 12) {
    return fallback();
  }

  try {
    const sourceBlock = (stickToSource ? source : sourceInline).slice(0, 3000);
    const prompt = stickToSource
      ? isEn
        ? `Rewrite this video's OWN caption for Instagram/Facebook.
HARD RULES:
- Use ONLY facts, names, numbers and places that appear in the original caption (or title if the caption is empty).
- Do NOT invent, guess, or add context, motives, quotes, dates, scores, or people who are not in the source.
- Do NOT pad the text. If the original is short, keep it short.
- You may fix spelling, punctuation and line breaks. At most 2 short paragraphs.
- Do NOT include links, URLs, or hashtags.
- At most one emoji, and only if the original used one.

Title: "${title}"
Original caption:
---
${sourceBlock}
---

Return only the rewritten caption.`
        : `Reescribe EN ESPAÑOL el caption de este video para Instagram/Facebook.
REGLAS DURAS:
- El resultado va SIEMPRE en español. Si el caption original está en inglés, portugués, italiano, francés u otro idioma, TRADÚCELO al español (nombres propios se mantienen).
- Usa SOLO los datos del caption original (nombres, cifras, lugares, hechos). El titular solo si el caption no trae ese dato.
- NO inventes, NO adivines y NO agregues contexto, causas, citas, fechas, resultados ni personas que no estén en el original.
- NO rellenes. Si el original es corto, el resultado también.
- Puedes corregir ortografía, tildes y párrafos. Máximo 2 párrafos cortos.
- ${NEVER_NAME_MILTON_JEREZ_RULE}
- NO incluyas enlaces, URLs ni hashtags.
- Máximo un emoji, y solo si el original ya tenía.

Titular: "${title}"
Caption original del video:
---
${sourceBlock}
---

Devuelve solo el caption.`
      : isEn
      ? `Write the social caption (Instagram/Facebook) for this Formula 1 / motorsport post.
Rules:
- English only, journalistic but engaging tone.
- Length: 2 or 3 short paragraphs (about 350–700 characters total).
- Separate paragraphs with a blank line.
- MUST mention proper names from the text (drivers, teams, circuits, events) and concrete places.
- Include specific data present in the text: numbers, dates, results.
- Summarize what happened, who is involved (by name), where, and why it matters.
- Do NOT copy the headline as the first line; start with a concrete hook.
- Do NOT invent facts, names, or places not in the text. If a detail is missing, omit it.
- Do NOT include links, URLs, or hashtags (hashtag is added separately).
- At most one emoji if it helps.

Headline: "${title}"
Article / source text:
---
${sourceBlock}
---

Return only the caption.`
      : `Escribe el texto (caption) para acompañar una publicación de redes sociales (Instagram/Facebook) sobre esta noticia (si es Fórmula 1 / motorsport, escribe en español con tono aficionado a F1).
Reglas:
- Español, tono periodístico cercano.
- Extensión: 2 o 3 párrafos cortos (entre 350 y 700 caracteres en total).
- Separa los párrafos con un salto de línea en blanco.
- OBLIGATORIO: menciona los NOMBRES PROPIOS que aparezcan en el texto (personas, cargos, instituciones, empresas, equipos) y los LUGARES concretos (ciudad, provincia, país, sede). Nada de "una persona", "las autoridades" o "un lugar" si el texto da el nombre real.
- Incluye datos específicos presentes en el texto: cifras, fechas, montos o resultados.
- Resume lo esencial: qué pasó, quiénes están involucrados (con nombre), dónde y por qué importa.
- NO copies el titular textual como primera línea; empieza con una frase de gancho concreta.
- NO inventes datos, nombres ni lugares que no estén en el texto. Si falta un dato, omítelo.
- ${NEVER_NAME_MILTON_JEREZ_RULE}
- NO incluyas enlaces, URLs ni hashtags (yo agrego el hashtag aparte).
- Sin emojis excesivos (máximo uno si aporta).

Titular: "${title}"
Contenido de la noticia:
---
${sourceBlock}
---

Devuelve solo el caption.`;

    const { content } = await deepseekChat(
      [{ role: "user", content: prompt }],
      { temperature: stickToSource ? 0.2 : 0.7 }
    );

    let caption = cleanKeepBreaks(content).replace(/^["'`]|["'`]$/g, "").trim();
    if (caption.length > 1000) {
      caption = caption.slice(0, 1000).replace(/\s+\S*$/, "").trim();
    }

    const minLen = stickToSource ? 8 : 40;
    if (caption && caption.length >= minLen) {
      return `${await ensureSpanish(caption)}\n\n${hashtag}`.trim();
    }
  } catch {
    // usa fallback
  }

  return fallback();
}

/**
 * Resumen corto (2-4 oraciones) para columna "texto" del sheet Intrant.
 */
export async function summarizeArticleForSheet({ title, bodyText, maxChars = 450 }) {
  const body = String(bodyText || "").trim();
  if (!body) return "";

  if (body.length <= maxChars && body.split(/\s+/).length < 70) {
    return body.replace(/\s+/g, " ").trim();
  }

  const prompt = `Resume esta noticia en español dominicano, 2 a 4 oraciones claras, tono periodístico.
Incluye datos concretos (quién, qué, dónde) si aparecen.
SIN titular, SIN comillas, SIN "Resumen:".
Máximo ${maxChars} caracteres.

Titular: ${title || "(sin título)"}
Texto:
---
${body.slice(0, 5000)}
---`;

  try {
    const { content } = await deepseekChat(
      [{ role: "user", content: prompt }],
      { temperature: 0.3 }
    );
    let summary = String(content || "")
      .replace(/^["']|["']$/g, "")
      .replace(/^resumen\s*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (summary.length > maxChars) {
      summary = summary.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
    }
    return summary || body.slice(0, maxChars);
  } catch {
    return body.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
