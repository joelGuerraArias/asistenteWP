import { config } from "./config.mjs";
import { fetchOgImage } from "./news-fetch.mjs";

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";

const DR_DOMAINS = [
  "n.com.do",
  "listindiario.com",
  "diariolibre.com",
  "eldia.com.do",
  "acento.com.do",
  "elnacional.com.do",
  "hoy.com.do",
  "cdn.com.do",
];

export function isTavilyEnabled() {
  return Boolean(config.tavily.apiKey);
}

async function tavilyPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.tavily.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily ${res.status}: ${err.slice(0, 300)}`);
  }

  return res.json();
}

function buildQuery(topic) {
  const t = topic.trim();
  if (/república dominicana|dominicana|rd\b|santo domingo/i.test(t)) return t;
  return `${t} República Dominicana`;
}

function pickTavilyImage(data, results) {
  const fromSearch = (data.images || []).map((img) =>
    typeof img === "string" ? img : img?.url
  ).filter(Boolean);

  if (fromSearch[0]) return fromSearch[0];

  for (const item of results.slice(0, 3)) {
    if (item.image_url) return item.image_url;
  }

  return null;
}

async function resolveFeaturedImage(data, results, query, onStatus) {
  let imageUrl = pickTavilyImage(data, results);

  if (!imageUrl) {
    onStatus?.("🖼️ Buscando foto destacada en las fuentes...");
    for (const item of results.slice(0, 3)) {
      if (!item.url) continue;
      imageUrl = await fetchOgImage(item.url);
      if (imageUrl) break;
    }
  }

  if (!imageUrl) {
    onStatus?.("🖼️ Buscando foto destacada relacionada...");
    try {
      const imgSearch = await tavilyPost(SEARCH_URL, {
        query: `${query} foto imagen`,
        search_depth: "basic",
        topic: "general",
        max_results: 3,
        include_images: true,
        include_image_descriptions: true,
      });
      imageUrl = pickTavilyImage(imgSearch, imgSearch.results || []);
    } catch (error) {
      console.warn("tavily image search:", error.message);
    }
  }

  return imageUrl;
}

async function tavilyExtractUrls(urls, query) {
  if (!urls.length) return [];

  const data = await tavilyPost(EXTRACT_URL, {
    urls: urls.slice(0, 5),
    query,
    extract_depth: "advanced",
    format: "text",
    chunks_per_source: 4,
  });

  return data.results || [];
}

function mergeExtractedContent(results, extractions) {
  const byUrl = new Map(
    extractions
      .filter((e) => e.url && e.raw_content?.trim())
      .map((e) => [e.url, e.raw_content.trim()])
  );

  return results.map((item) => {
    const extracted = byUrl.get(item.url);
    if (!extracted) return item;
    return {
      ...item,
      content: extracted.slice(0, 4500),
      extracted: true,
    };
  });
}

/**
 * Búsqueda de noticias (sin extract completo) — para sync Intrant.
 */
export async function tavilyNewsSearch(query, {
  maxResults = 8,
  includeDomains = DR_DOMAINS,
  timeRange = config.tavily.timeRange,
} = {}) {
  if (!isTavilyEnabled()) {
    throw new Error("Tavily no está configurado (TAVILY_API_KEY)");
  }

  const data = await tavilyPost(SEARCH_URL, {
    query: buildQuery(query),
    search_depth: config.tavily.searchDepth,
    topic: "news",
    max_results: maxResults,
    time_range: timeRange,
    include_answer: false,
    include_domains: includeDomains?.length ? includeDomains : undefined,
  });

  return (data.results || []).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    content: (r.content || "").slice(0, 2500),
    score: r.score,
    publishedAt: r.published_date || r.publishedDate || "",
  }));
}

/**
 * Búsqueda + extracción Tavily (siempre cuando hay API key).
 */
export async function tavilyResearchTopic(topic, { onStatus } = {}) {
  if (!isTavilyEnabled()) return null;

  const query = buildQuery(topic);
  const base = {
    query,
    search_depth: config.tavily.searchDepth,
    topic: "news",
    max_results: config.tavily.maxResults,
    time_range: config.tavily.timeRange,
    include_answer: "advanced",
    include_images: true,
    include_image_descriptions: true,
    chunks_per_source: 4,
  };

  onStatus?.("🔍 Buscando en Tavily...");

  let data = await tavilyPost(SEARCH_URL, {
    ...base,
    include_domains: DR_DOMAINS,
  });

  const results = [...(data.results || [])];

  if (results.length < 3) {
    onStatus?.("🔍 Ampliando búsqueda en Tavily...");
    const broader = await tavilyPost(SEARCH_URL, {
      ...base,
      query: `${query} noticias datos cifras nombres`,
      include_domains: [],
    });
    for (const item of broader.results || []) {
      if (!results.some((r) => r.url === item.url)) {
        results.push(item);
      }
    }
    if (!data.answer && broader.answer) data.answer = broader.answer;
    if (!(data.images || []).length && broader.images?.length) {
      data.images = broader.images;
    }
  }

  const urls = results.map((r) => r.url).filter(Boolean);
  let extractions = [];

  if (urls.length) {
    onStatus?.("📄 Extrayendo contenido de las fuentes...");
    try {
      extractions = await tavilyExtractUrls(urls, query);
    } catch (error) {
      console.warn("tavilyExtractUrls:", error.message);
    }
  }

  const merged = mergeExtractedContent(results, extractions);
  const imageUrl = await resolveFeaturedImage(data, merged, query, onStatus);

  return formatTavilyResearch({ ...data, results: merged, imageUrl });
}

function formatTavilyResearch(data) {
  const results = (data.results || []).slice(0, config.tavily.maxResults);
  const parts = [];

  if (data.answer?.trim()) {
    parts.push(`RESUMEN FACTUAL (Tavily):\n${data.answer.trim()}`);
  }

  if (results.length) {
    parts.push("CONTENIDO EXTRAÍDO DE FUENTES (Tavily):");
    for (const item of results) {
      const chunk = (item.content || "").trim();
      if (!chunk) continue;
      const tag = item.extracted ? "texto completo" : "fragmento";
      parts.push(
        `--- ${item.title || "Sin título"} [${tag}] (${item.url || "sin url"}) ---\n${chunk}`
      );
    }
  }

  const articleBodies = results
    .filter((r) => r.content?.trim())
    .map((r) => ({
      title: r.title || r.url,
      body: r.content.trim().slice(0, 4500),
      url: r.url || "",
      imageUrl: null,
    }));

  return {
    answer: data.answer || "",
    results: results.map((r) => ({
      title: r.title || "",
      url: r.url || "",
      content: (r.content || "").slice(0, 4500),
      score: r.score,
      extracted: Boolean(r.extracted),
    })),
    articleBodies,
    researchText: parts.join("\n\n").trim(),
    imageUrl: data.imageUrl || null,
  };
}
