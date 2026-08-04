/**
 * Tags de WordPress según contenido (máx. 5).
 * Crea el tag si no existe.
 */

import { askDeepseek } from "./deepseek.mjs";

const MAX_TAGS = 5;

const STOP = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "al",
  "y",
  "o",
  "en",
  "por",
  "para",
  "con",
  "sin",
  "sobre",
  "entre",
  "que",
  "se",
  "su",
  "sus",
  "es",
  "son",
  "fue",
  "ser",
  "como",
  "mas",
  "más",
  "muy",
  "ya",
  "hoy",
  "ayer",
  "este",
  "esta",
  "estos",
  "estas",
  "eso",
  "esa",
  "desde",
  "hasta",
  "tras",
  "ante",
  "hacia",
  "durante",
  "segun",
  "según",
  "tambien",
  "también",
  "noticia",
  "noticias",
  "dice",
  "dijo",
  "anuncio",
  "anunció",
  "republica",
  "república",
  "dominicana",
]);

function cleanTagName(raw = "") {
  return String(raw)
    .replace(/^#/, "")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function slugifyTag(name = "") {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function uniqueTags(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const name = cleanTagName(raw);
    if (!name || name.length < 2) continue;
    const key = slugifyTag(name);
    if (!key || key.length < 2 || STOP.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Fallback local: nombres propios / términos relevantes del título. */
function fallbackTagsFromText(title = "", body = "") {
  const text = `${title}. ${String(body).slice(0, 400)}`;
  const candidates = [];

  // Frases con mayúscula inicial (nombres)
  const proper = text.match(
    /\b([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+){0,3})\b/g
  );
  if (proper) {
    for (const p of proper) {
      const n = cleanTagName(p);
      if (n.split(" ").length >= 1 && n.length >= 3) candidates.push(n);
    }
  }

  // Keywords temáticas frecuentes
  const hay = text.toLowerCase();
  const known = [
    ["inteligencia artificial", "Inteligencia Artificial"],
    ["chatgpt", "ChatGPT"],
    ["edesur", "Edesur"],
    ["edeeste", "Edeeste"],
    ["intrant", "INTRANT"],
    ["santo domingo", "Santo Domingo"],
    ["abinader", "Luis Abinader"],
    ["trump", "Donald Trump"],
    ["formula 1", "Fórmula 1"],
    ["fórmula 1", "Fórmula 1"],
    ["ciberseguridad", "Ciberseguridad"],
  ];
  for (const [needle, label] of known) {
    if (hay.includes(needle)) candidates.push(label);
  }

  return uniqueTags(candidates);
}

/**
 * Sugiere hasta 5 tags según el contenido.
 * @returns {Promise<string[]>} nombres de tags
 */
export async function suggestPostTags(title = "", body = "") {
  const fallback = fallbackTagsFromText(title, body);

  try {
    const prompt = `Eres editor SEO de un medio dominicano (FV Digital).
Sugiere entre 3 y 5 etiquetas (tags) para esta noticia.
Reglas:
- Máximo 5 tags
- Cortos (1-3 palabras)
- En español (nombres propios se respetan)
- Relevantes al contenido (personas, lugares, temas, instituciones)
- Sin hashtags, sin numeración, sin explicaciones
- Responde SOLO una lista separada por comas

Título: ${String(title).slice(0, 220)}
Texto: ${String(body).slice(0, 900)}`;

    const raw = String(await askDeepseek(prompt)).trim();
    const fromAi = raw
      .split(/[,;\n|]+/)
      .map((s) => s.replace(/^[\d.\-\*\s]+/, "").trim())
      .filter(Boolean);

    const merged = uniqueTags([...fromAi, ...fallback]);
    if (merged.length) return merged.slice(0, MAX_TAGS);
  } catch (error) {
    console.warn("suggestPostTags:", error.message);
  }

  return fallback.slice(0, MAX_TAGS);
}

export { MAX_TAGS, slugifyTag, cleanTagName };
