/**
 * Sugiere una categoría temática de WordPress a partir del título/cuerpo.
 * Se suma a las categorías fijas (fv + tweet2).
 */

/** slug WP → keywords (texto normalizado sin acentos) */
const TOPIC_RULES = [
  {
    slug: "ia",
    label: "IA",
    keywords: [
      "inteligencia artificial",
      "chatgpt",
      "gpt-4",
      "gpt-5",
      "openai",
      "gemini",
      "claude",
      "deepseek",
      "machine learning",
      "aprendizaje automatico",
      "midjourney",
      "stable diffusion",
      "ia generativa",
      "chatbot",
    ],
  },
  {
    slug: "tecnologia",
    label: "Tecnología",
    keywords: [
      "tecnolog",
      "smartphone",
      "iphone",
      "android",
      "samsung",
      "microsoft",
      "software",
      "hardware",
      "cibersegur",
      "hackeo",
      "ransomware",
      "aplicaci",
      "startup",
      "silicon valley",
      "redes sociales",
      "tiktok",
      "elon musk",
      "spacex",
      "semiconductor",
      "gadget",
      "innovacion digital",
    ],
  },
  {
    slug: "salud",
    label: "Salud",
    keywords: [
      "salud",
      "hospital",
      "medico",
      "medica",
      "doctor",
      "enfermed",
      "virus",
      "vacuna",
      "covid",
      "cancer",
      "cirugia",
      "farmaceut",
      "paciente",
      "ministerio de salud",
    ],
  },
  {
    slug: "politica",
    label: "Politica",
    keywords: [
      "politica",
      "gobierno",
      "presidente",
      "congreso",
      "senado",
      "diputado",
      "ministro",
      "ministerio",
      "partido",
      "elecciones",
      "campana",
      "palacio nacional",
      "abinader",
      "alcalde",
      "ayuntamiento",
      "decreto",
      "reforma",
      "oposicion",
    ],
  },
  {
    slug: "espectaculo",
    label: "Espectáculo",
    keywords: [
      "espectaculo",
      "farandula",
      "celebridad",
      "famoso",
      "cantante",
      "concierto",
      "actor",
      "actriz",
      "hollywood",
      "hollywood",
      " hollywood",
      "netflix",
      "regueton",
      "bachata",
      "merengue",
      "influencer",
      "reality",
      "oscar",
      "grammy",
      "premios",
      "estreno",
      "pelicula",
      "cine",
      "vedette",
    ],
  },
  {
    slug: "deportes",
    label: "Deportes",
    keywords: [
      "deporte",
      "futbol",
      "beisbol",
      "baloncesto",
      "nba",
      "mlb",
      "ligas mayores",
      "olimpic",
      "boxeo",
      "tenis",
      "voleibol",
      "campeon",
      "seleccion",
      "lidom",
    ],
  },
  {
    slug: "f1",
    label: "F1",
    keywords: [
      "formula 1",
      "grand prix",
      "red bull racing",
      "verstappen",
      "hamilton",
    ],
  },
  {
    slug: "internacionales",
    label: "Internacionales",
    keywords: [
      "estados unidos",
      "ee.uu",
      "eeuu",
      "casa blanca",
      "trump",
      "putin",
      "ucrania",
      "rusia",
      "china",
      "israel",
      "gaza",
      "onu",
      "otan",
      "union europea",
      "america latina",
      "venezuela",
      "haiti",
    ],
  },
  {
    slug: "nacionales",
    label: "Nacionales",
    keywords: [
      "republica dominicana",
      "santo domingo",
      "santiago",
      "distrito nacional",
      "intrant",
      "edesur",
      "edeeste",
      "edenorte",
      "policia nacional",
    ],
  },
  {
    slug: "cultura",
    label: "Cultura",
    keywords: [
      "cultura",
      "museo",
      "teatro",
      "literatura",
      "libro",
      "exposicion",
      "patrimonio",
      "festival cultural",
    ],
  },
  {
    slug: "autos",
    label: "Autos",
    keywords: [
      "automovil",
      "vehiculo",
      "motocicleta",
      "toyota",
      "honda",
      "hyundai",
      "concesionario",
      "autosemana",
    ],
  },
];

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTopic(haystack, rule) {
  let score = 0;
  for (const kw of rule.keywords) {
    if (haystack.includes(kw)) {
      score += Math.min(5, Math.max(1, Math.floor(kw.length / 4)));
    }
  }
  if (rule.slug === "ia" && /\bia\b/.test(haystack)) score += 4;
  if (rule.slug === "f1" && /\bf1\b/.test(haystack)) score += 4;
  if (rule.slug === "tecnologia" && /\btech\b/.test(haystack)) score += 3;
  return score;
}

/**
 * Detecta slug temático por keywords.
 * @returns {{ slug: string, label: string, score: number } | null}
 */
export function detectTopicCategory(title = "", body = "") {
  const hay = normalizeText(`${title}\n${String(body).slice(0, 2500)}`);
  if (!hay) return null;

  let best = null;
  for (const rule of TOPIC_RULES) {
    const score = scoreTopic(hay, rule);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { slug: rule.slug, label: rule.label, score };
    }
  }

  if (!best || best.score < 2) return null;
  return best;
}

/**
 * Sugiere categoría temática. Keywords primero; DeepSeek si no hay match claro.
 * @returns {Promise<string|null>} slug WP
 */
export async function suggestTopicCategory(title = "", body = "") {
  const detected = detectTopicCategory(title, body);
  if (detected) return detected.slug;

  try {
    const { askDeepseek } = await import("./deepseek.mjs");
    const allowed = TOPIC_RULES.map((r) => r.slug).join(", ");
    const prompt = `Clasifica esta noticia dominicana en UNA sola categoría.
Responde SOLO con el slug exacto de esta lista (minúsculas), o "ninguna" si no encaja:
${allowed}

Título: ${String(title).slice(0, 200)}
Texto: ${String(body).slice(0, 800)}`;

    const raw = String(await askDeepseek(prompt)).trim().toLowerCase();
    const slug = raw.replace(/[^a-z0-9-]/g, "");
    if (TOPIC_RULES.some((r) => r.slug === slug)) return slug;
  } catch (error) {
    console.warn("suggestTopicCategory IA:", error.message);
  }

  return null;
}

export function listTopicSlugs() {
  return TOPIC_RULES.map((r) => r.slug);
}
