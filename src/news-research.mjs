import { fetchArticleFromUrl } from "./news-fetch.mjs";
import { cleanImportedText } from "./news-format.mjs";
import {
  isTavilyEnabled,
  tavilyResearchTopic,
} from "./tavily.mjs";
import { searchTopicImage } from "./news-write.mjs";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; FVDigitalBot/1.0; +https://fvdigital.do)",
  Accept: "text/html,application/xhtml+xml,application/xml",
  "Accept-Language": "es-ES,es;q=0.9",
};

const NEWS_SITES = [
  { host: "n.com.do", search: "https://n.com.do/" },
  { host: "listindiario.com", search: "https://listindiario.com/" },
  { host: "diariolibre.com", search: "https://www.diariolibre.com/" },
];

function stripTags(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(text = "") {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pickXmlValue(block, tag) {
  const cdata = block.match(
    new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i")
  );
  if (cdata?.[1]) return decodeXml(cdata[1].trim());
  const plain = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return plain?.[1] ? decodeXml(plain[1].trim()) : "";
}

async function fetchGoogleNewsRss(query, { limit = 6 } = {}) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=DO&ceid=DO:es-419`;
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) return [];

  const xml = await res.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = pickXmlValue(block, "title");
    const link = pickXmlValue(block, "link");
    const snippet = stripTags(pickXmlValue(block, "description"));
    const pubDate = pickXmlValue(block, "pubDate");
    if (title && link) {
      items.push({ title, link, snippet, pubDate });
    }
  }

  return items;
}

async function fetchWikipediaSummary(topic) {
  const searchRes = await fetch(
    `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&srlimit=1&origin=*`,
    { headers: FETCH_HEADERS }
  );
  if (!searchRes.ok) return null;

  const searchData = await searchRes.json();
  const pageTitle = searchData.query?.search?.[0]?.title;
  if (!pageTitle) return null;

  const summaryRes = await fetch(
    `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`,
    { headers: FETCH_HEADERS }
  );
  if (!summaryRes.ok) return null;

  const summary = await summaryRes.json();
  return {
    title: summary.title,
    extract: summary.extract || "",
    thumbnail: summary.thumbnail?.source || null,
  };
}

function extractArticleLinks(html, host, limit = 3) {
  const links = new Set();
  const patterns = [
    new RegExp(`href="(https?:\\/\\/(?:www\\.)?${host.replace(".", "\\.")}[^"]*?\\/\\d{4}\\/[^"]+)"`, "gi"),
    new RegExp(`href="(\\/\\d{4}\\/[^"]+)"`, "gi"),
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && links.size < limit) {
      let link = match[1];
      if (link.startsWith("/")) {
        link = `https://${host}${link}`;
      }
      if (!link.includes("/tag/") && !link.includes("/category/")) {
        links.add(link);
      }
    }
  }

  return [...links];
}

async function searchSiteArticles(site, topic, limit = 1) {
  const searchUrl = `${site.search}?s=${encodeURIComponent(topic)}`;
  const res = await fetch(searchUrl, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!res.ok) return [];

  const html = await res.text();
  const links = extractArticleLinks(html, site.host, limit + 2);
  const articles = [];

  for (const link of links) {
    if (articles.length >= limit) break;
    try {
      const article = await fetchArticleFromUrl(link);
      articles.push({
        title: article.title,
        body: cleanImportedText(article.bodyText).slice(0, 3000),
        url: link,
        imageUrl: article.imageUrl || null,
      });
    } catch {
      // siguiente enlace
    }
  }

  return articles;
}

function buildResearchText({ wiki, similarNews, articleBodies, tavily }) {
  const parts = [];

  if (tavily?.researchText) {
    parts.push(tavily.researchText);
  }

  if (wiki?.extract) {
    parts.push(`CONTEXTO VERIFICADO (Wikipedia — ${wiki.title}):\n${wiki.extract}`);
  }

  if (articleBodies.length) {
    parts.push("NOTICIAS PARECIDAS (texto de referencia, sin copiar literal):");
    for (const article of articleBodies) {
      parts.push(`--- ${article.title} ---\n${article.body}`);
    }
  }

  if (similarNews.length) {
    parts.push("OTROS TITULARES RECIENTES EN LA WEB:");
    for (const item of similarNews) {
      const line = item.snippet
        ? `- ${item.title}: ${item.snippet}`
        : `- ${item.title}`;
      parts.push(line);
    }
  }

  return parts.join("\n\n").trim();
}

function topicKeywords(topic = "") {
  return topic
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(sobre|para|como|este|esta|investiga|escribe|articulo|noticia)$/.test(w));
}

function isRelevantToTopic(article, topic) {
  const keywords = topicKeywords(topic);
  if (!keywords.length) return true;

  const haystack = `${article.title || ""} ${article.body || ""} ${article.snippet || ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const hits = keywords.filter((k) => haystack.includes(k));
  return hits.length >= Math.min(2, keywords.length);
}

export async function researchTopic(topic, { onStatus } = {}) {
  const emit = (msg) => onStatus?.(msg);

  if (isTavilyEnabled()) {
    emit("🔍 Buscando en Tavily...");
  } else {
    emit("🔍 Buscando en la web...");
  }

  const tavilyPromise = isTavilyEnabled()
    ? tavilyResearchTopic(topic, { onStatus: emit }).catch((error) => {
        console.warn("tavilyResearchTopic:", error.message);
        return null;
      })
    : Promise.resolve(null);

  const [similarNews, wiki, siteResults, tavily] = await Promise.all([
    fetchGoogleNewsRss(topic),
    fetchWikipediaSummary(topic).catch(() => null),
    Promise.all(
      NEWS_SITES.map((site) => searchSiteArticles(site, topic, 1).catch(() => []))
    ),
    tavilyPromise,
  ]);

  const articleBodies = [];
  const seenTitles = new Set();
  const seenUrls = new Set();

  if (tavily?.articleBodies?.length) {
    for (const article of tavily.articleBodies) {
      const key = (article.url || article.title).toLowerCase();
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      seenTitles.add(article.title.toLowerCase());
      articleBodies.push(article);
    }
  }

  for (const batch of siteResults) {
    for (const article of batch) {
      if (!isRelevantToTopic(article, topic)) continue;
      const key = article.title.toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      articleBodies.push(article);
      if (articleBodies.length >= 5) break;
    }
  }

  const filteredNews = similarNews.filter((item) => isRelevantToTopic(item, topic));
  const newsList = (filteredNews.length ? filteredNews : similarNews).slice(0, 6);

  const researchText = buildResearchText({
    wiki: tavily ? null : wiki,
    similarNews: tavily ? newsList.slice(0, 3) : newsList,
    articleBodies,
    tavily,
  });

  let imageUrl =
    tavily?.imageUrl ||
    articleBodies.find((a) => a.imageUrl)?.imageUrl ||
    wiki?.thumbnail ||
    null;

  if (!imageUrl) {
    emit("🖼️ Buscando foto destacada...");
    imageUrl = await searchTopicImage(topic).catch(() => null);
  }

  return {
    wiki,
    similarNews: newsList,
    articleBodies,
    tavily,
    researchText,
    imageUrl,
  };
}
