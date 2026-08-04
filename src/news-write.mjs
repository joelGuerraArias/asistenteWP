const WIKI_API = "https://es.wikipedia.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

async function wikiJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "FVDigitalBot/1.0 (fvdigital.do)" },
  });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  return res.json();
}

async function searchWikipediaImage(topic) {
  const search = await wikiJson(
    `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&srlimit=1&origin=*`
  );
  const hit = search.query?.search?.[0];
  if (!hit?.pageid) return null;

  const page = await wikiJson(
    `${WIKI_API}?action=query&pageids=${hit.pageid}&prop=pageimages&piprop=original&format=json&origin=*`
  );
  const original = page.query?.pages?.[hit.pageid]?.original?.source;
  return original || null;
}

async function searchCommonsImage(topic) {
  const data = await wikiJson(
    `${COMMONS_API}?action=query&generator=search&gsrsearch=${encodeURIComponent(topic)}&gsrnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=1400&format=json&gsrlimit=5&origin=*`
  );
  const pages = data.query?.pages;
  if (!pages) return null;

  for (const page of Object.values(pages)) {
    const url = page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url;
    if (url && !/\.svg$/i.test(url)) return url;
  }
  return null;
}

export async function searchTopicImage(topic) {
  const wiki = await searchWikipediaImage(topic).catch(() => null);
  if (wiki) return wiki;
  return searchCommonsImage(topic).catch(() => null);
}

export function cleanWriteTopic(topic = "") {
  return topic
    .replace(
      /\s*(,?\s*y\s+)?(investiga|escribe|redacta|prepara|genera)\w*\s+(un\s+)?(art[ií]culo|noticia)\s*$/i,
      ""
    )
    .replace(/\s*(investiga|busca)\s+(en\s+)?(la\s+)?web\s*$/i, "")
    .trim();
}

export function isWriteFlowQuestion(text = "") {
  const t = text.trim();
  if (/^[1-3]$/.test(t)) return false;
  if (/^(buscar|sin foto|cancelar|sí|si|publicar|ok|dale|no|ninguna|captura|usar captura)$/i.test(t)) return false;
  if (/\?/.test(t)) return true;
  if (
    /^(pero|tienes|tiene|hay|son|es|qué|que|cómo|como|cuál|cual|dime|explica|muéstrame|muestrame|investiga)/i.test(
      t
    )
  ) {
    return true;
  }
  if (/datos?\s+reales?/i.test(t)) return true;
  if (/\b(ia|inteligencia artificial|modelo|deepseek|mistral)\b/i.test(t)) return true;
  return false;
}

export function isValidCustomTitle(text = "") {
  const t = text.trim();
  if (t.length < 12) return false;
  if (isWriteFlowQuestion(t)) return false;
  return true;
}

export function formatResearchBrief(research) {
  if (!research) {
    return "⚠️ Aún no tengo investigación guardada.";
  }

  const parts = [];

  if (research.articleBodies?.length) {
    parts.push(
      `✅ Datos reales: leí ${research.articleBodies.length} artículo(s) completo(s):`
    );
    for (const article of research.articleBodies.slice(0, 2)) {
      parts.push(`• ${article.title}`);
      parts.push(`  ${article.body.slice(0, 250)}...`);
    }
  }

  if (research.tavily?.results?.length) {
    parts.push(`\n🔎 Tavily: ${research.tavily.results.length} fuentes con datos concretos.`);
    if (research.tavily.answer) {
      parts.push(research.tavily.answer.slice(0, 400));
    }
    for (const item of research.tavily.results.slice(0, 2)) {
      parts.push(`• ${item.title}`);
    }
  }

  if (research.wiki?.extract) {
    parts.push(`\n📖 Wikipedia — ${research.wiki.title}:`);
    parts.push(research.wiki.extract.slice(0, 350));
  }

  if (research.similarNews?.length) {
    parts.push(`\n📰 ${research.similarNews.length} titulares recientes en Google News.`);
    for (const item of research.similarNews.slice(0, 2)) {
      parts.push(`• ${item.title}`);
    }
  }

  if (!parts.length) {
    return "⚠️ Datos limitados en la web. Redactaré con cautela, sin inventar cifras ni fechas.";
  }

  return parts.join("\n");
}

export function isCasualMessage(text = "") {
  const t = text.trim().toLowerCase();
  if (t.length <= 2) return true;
  return /^(hola|hey|hi|hello|buenas|buenos d[ií]as|buenas tardes|buenas noches|gracias|ok|dale|listo|perfecto|thanks|saludos|qu[eé] tal|c[oó]mo est[aá]s|test|prueba|ey)[!.?\s]*$/i.test(
    t
  );
}

export function isHelpMessage(text = "") {
  return /^(ayuda|help|\?)$/i.test(text.trim());
}

/** Texto solo no se publica a WP salvo que sea claramente una noticia */
export function looksLikePublishableText(text = "") {
  const t = text.trim();
  if (t.length < 100) return false;
  if ((t.match(/[.!?]/g) || []).length >= 2) return true;
  return t.length >= 200;
}

export function wantsWriteNews(text = "") {
  return (
    /^\/escribir\b/i.test(text) ||
    /(?:escrib|redact|crea|genera)\w*\s+(?:me\s+)?(?:una\s+)?noticia/i.test(text) ||
    /(?:haz|prepara)\w*\s+(?:me\s+)?(?:una\s+)?noticia/i.test(text) ||
    /noticia\s+escrita/i.test(text) ||
    /^noticia\s+(?:sobre|de|acerca)/i.test(text)
  );
}

export function parseWriteTopic(text = "") {
  const patterns = [
    /^\/escribir\s+(.+)/i,
    /(?:escrib|redact|crea|genera)\w*\s+(?:me\s+)?(?:una\s+)?noticia\s+(?:escrita\s+)?(?:sobre|de|acerca de)\s+(.+)/i,
    /(?:escrib|redact|crea|genera)\w*\s+(?:me\s+)?(?:una\s+)?noticia\s*:\s*(.+)/i,
    /noticia\s+escrita\s+(?:sobre|de|acerca de)\s+(.+)/i,
    /^noticia\s+(?:sobre|de|acerca de)\s+(.+)/i,
    /(?:haz|prepara)\w*\s+(?:me\s+)?(?:una\s+)?noticia\s+(?:sobre|de|acerca de)\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return cleanWriteTopic(match[1].trim());
  }
  return null;
}

export function emptyWriteFlow() {
  return {
    source: "write",
    step: "topic",
    topic: "",
    titles: [],
    selectedTitle: "",
    excerpt: "",
    body_html: "",
    imageBuffer: null,
    imageMimeType: null,
    imageUrl: null,
    captureBuffer: null,
    captureMime: null,
    extraCategorySlugs: [],
    research: null,
  };
}
