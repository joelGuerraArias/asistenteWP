import { parseSourceFromUrl } from "./news-format.mjs";
import { fetchSocialPost, isSocialMediaUrl, socialPlatformLabel, detectSocialPlatform } from "./social-fetch.mjs";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "es-ES,es;q=0.9",
};

export function extractFirstUrl(text = "") {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)]+$/, "");
}

/** Extrae URL del texto o de entidades de Telegram (enlaces en preview, text_link, etc.) */
export function extractUrlFromMessage(ctx) {
  const text = ctx.message?.text || ctx.message?.caption || "";
  const entities = ctx.message?.entities || ctx.message?.caption_entities || [];

  for (const entity of entities) {
    if (entity.type === "url") {
      const url = text.slice(entity.offset, entity.offset + entity.length);
      if (url) return url.replace(/[.,;:!?)]+$/, "");
    }
    if (entity.type === "text_link" && entity.url) {
      return entity.url;
    }
  }

  return extractFirstUrl(text);
}

function decodeHtmlEntities(text = "") {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function metaContent(html, property) {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return "";
}

function tagContent(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match?.[1]) return "";
  return decodeHtmlEntities(stripTags(match[1]).trim());
}

function stripTags(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractJsonLdBody(html) {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const [, raw] of scripts) {
    try {
      const data = JSON.parse(raw.trim());
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const type = String(node["@type"] || "").toLowerCase();
        if (!type.includes("article") && !type.includes("news")) continue;
        const body = node.articleBody || node.description;
        if (typeof body === "string" && body.trim().length > 80) {
          return stripTags(body);
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return "";
}

function extractArticleBlock(html) {
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]+class=["'][^"']*(?:entry-content|article-body|post-content|single-content|nota-contenido|content-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+id=["'][^"']*(?:content|article|nota)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1] && stripTags(match[1]).length > 120) {
      return match[1];
    }
  }
  return "";
}

function extractParagraphs(block) {
  const paragraphs = [];
  const regex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = regex.exec(block)) !== null) {
    const text = stripTags(match[1]);
    if (text.length < 40) continue;
    if (/^(compartir|síguenos|publicidad|relacionad|tags?|más noticias)/i.test(text)) {
      continue;
    }
    paragraphs.push(text);
  }
  return paragraphs;
}

function extractBodyText(html) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "");

  const jsonLd = extractJsonLdBody(cleaned);
  if (jsonLd) return jsonLd;

  const block = extractArticleBlock(cleaned);
  if (block) {
    const paragraphs = extractParagraphs(block);
    if (paragraphs.length) return paragraphs.join("\n\n");
  }

  const description = metaContent(cleaned, "og:description") || metaContent(cleaned, "description");
  if (description.length > 80) return description;

  return "";
}

export { isSocialMediaUrl, socialPlatformLabel, detectSocialPlatform } from "./social-fetch.mjs";

export async function fetchOgImage(url) {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
    if (!res.ok) return null;
    const html = await res.text();
    return (
      metaContent(html, "og:image") ||
      metaContent(html, "og:image:url") ||
      metaContent(html, "twitter:image") ||
      null
    );
  } catch {
    return null;
  }
}

export async function fetchArticleFromUrl(url) {
  const platform = detectSocialPlatform(url);
  if (platform) {
    const social = await fetchSocialPost(url);
    if (social) return social;
  }

  const res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!res.ok) {
    throw new Error(`No pude leer la URL (${res.status})`);
  }

  const html = await res.text();
  const source = parseSourceFromUrl(url);

  const title =
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    tagContent(html, "title") ||
    "Noticia";

  const imageUrl =
    metaContent(html, "og:image") ||
    metaContent(html, "og:image:url") ||
    metaContent(html, "twitter:image") ||
    "";

  const bodyText = extractBodyText(html);
  if (!bodyText) {
    throw new Error(
      "No pude extraer el texto de esa URL. Envía una captura con /noticia."
    );
  }

  return {
    title: title.replace(/\s*[-|–]\s*[^-|–]+$/, "").trim(),
    imageUrl,
    bodyText,
    sourceUrl: url,
    sourceName: source.name,
    author: extractAuthor(html),
    publishedAt: extractPublishedAt(html),
  };
}

function extractPublishedAt(html = "") {
  const fromMeta =
    metaContent(html, "article:published_time") ||
    metaContent(html, "og:published_time") ||
    metaContent(html, "publish-date") ||
    metaContent(html, "pubdate") ||
    metaContent(html, "date") ||
    metaContent(html, "DC.date.issued") ||
    metaContent(html, "cXenseParse:recs:publishtime");
  if (fromMeta) return fromMeta;

  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const [, raw] of scripts) {
    try {
      const data = JSON.parse(raw.trim());
      const nodes = Array.isArray(data)
        ? data
        : [data, ...(data["@graph"] || [])];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const d =
          node.datePublished ||
          node.dateCreated ||
          node.uploadDate;
        if (typeof d === "string" && d.trim()) return d.trim();
      }
    } catch {
      // ignore
    }
  }

  const time = html.match(
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i
  );
  return time?.[1]?.trim() || "";
}

function extractAuthor(html = "") {
  const fromMeta =
    metaContent(html, "author") ||
    metaContent(html, "article:author") ||
    metaContent(html, "byl") ||
    metaContent(html, "parsely-author") ||
    metaContent(html, "cXenseParse:author");
  if (fromMeta && fromMeta.length < 80 && !/^https?:/i.test(fromMeta)) {
    return cleanAuthorName(fromMeta);
  }

  const jsonLdAuthor = extractJsonLdAuthor(html);
  if (jsonLdAuthor) return cleanAuthorName(jsonLdAuthor);

  const patterns = [
    /<span[^>]+class=["'][^"']*author[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,80})/i,
    /<(?:a|span|div|p)[^>]+class=["'][^"']*(?:byline|author-name|by-author|entry-author)[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,80})/i,
    /(?:escrito por|por)\s*[:\-]?\s*<[^>]+>\s*([^<]{3,60})/i,
    /(?:escrito por|redactado por|por)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñ.]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñ.]+){0,4})/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const name = cleanAuthorName(stripTags(m[1]));
      if (name) return name;
    }
  }
  return "";
}

function extractJsonLdAuthor(html) {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const [, raw] of scripts) {
    try {
      const data = JSON.parse(raw.trim());
      const nodes = Array.isArray(data) ? data : [data, ...(data["@graph"] || [])];
      for (const node of nodes) {
        const a = node?.author;
        if (!a) continue;
        if (typeof a === "string") return a;
        if (a.name) return a.name;
        if (Array.isArray(a) && a[0]?.name) return a[0].name;
      }
    } catch {
      // ignore
    }
  }
  return "";
}

function cleanAuthorName(name = "") {
  let n = decodeHtmlEntities(String(name))
    .replace(/\s+/g, " ")
    .replace(/^por\s+/i, "")
    .replace(/[,|].*$/, "")
    .trim();
  if (n.length < 3 || n.length > 70) return "";
  if (/redacci[oó]n|staff|admin|http|www\.|@/i.test(n) && n.length < 12) {
    if (/^redacci/i.test(n)) return "Redacción";
  }
  if (/^(home|inicio|news|twitter|facebook)$/i.test(n)) return "";
  return n;
}
