import { decodeHtmlEntities } from "./news-format.mjs";
import { fetchWithRetry } from "./fetch-retry.mjs";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

const MOBILE_HEADERS = {
  ...FETCH_HEADERS,
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const PLATFORM_LABELS = {
  twitter: "X (Twitter)",
  instagram: "Instagram",
  facebook: "Facebook",
};

export function detectSocialPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|mobile|web)\./, "");
    if (host === "twitter.com" || host === "x.com" || host === "t.co") return "twitter";
    if (host === "instagram.com" || host === "instagr.am") return "instagram";
    if (host === "facebook.com" || host === "fb.com" || host === "fb.watch") return "facebook";
    return null;
  } catch {
    return null;
  }
}

export function socialPlatformLabel(platform) {
  return PLATFORM_LABELS[platform] || "red social";
}

function stripTags(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

async function fetchHtml(url, headers = FETCH_HEADERS) {
  const res = await fetchWithRetry(url, { headers, redirect: "follow" }, { label: "red social" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function normalizeSocialUrl(url, platform) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (platform === "instagram") {
      const path = parsed.pathname.replace(/\/$/, "");
      const postMatch = path.match(/\/(p|reel|tv)\/([^/]+)/i);
      if (postMatch) {
        return `https://www.instagram.com/${postMatch[1]}/${postMatch[2]}/`;
      }
    }
    if (platform === "twitter") {
      parsed.hostname = "x.com";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function titleFromText(text, fallback) {
  const line = text.split(/\n/).map((l) => l.trim()).find(Boolean) || "";
  if (line.length >= 15) {
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
  }
  return fallback;
}

function buildSocialBody({ text, author, platform }) {
  const label = socialPlatformLabel(platform);
  const parts = [];
  if (author) parts.push(`Publicación de ${author} en ${label}.`);
  if (text) parts.push(text);
  return parts.join("\n\n").trim();
}

async function fetchTwitterPost(url) {
  const normalized = normalizeSocialUrl(url, "twitter");
  const oembedUrl = `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(normalized)}`;

  const res = await fetchWithRetry(oembedUrl, { headers: FETCH_HEADERS }, { label: "X/Twitter" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `oEmbed ${res.status}`);
  }

  const html = data.html || "";
  const paragraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const tweetText = decodeHtmlEntities(stripTags(paragraph?.[1] || html));

  if (!tweetText || tweetText.length < 5) {
    throw new Error("No pude leer el texto del post en X/Twitter");
  }

  let imageUrl = "";
  try {
    const pageHtml = await fetchHtml(normalized);
    imageUrl =
      metaContent(pageHtml, "og:image") ||
      metaContent(pageHtml, "twitter:image") ||
      "";
  } catch {
    // sin imagen en la tarjeta
  }

  const author = data.author_name ? `@${data.author_name.replace(/^@/, "")}` : "";
  const bodyText = buildSocialBody({
    text: tweetText,
    author,
    platform: "twitter",
  });

  return {
    title: titleFromText(tweetText, `Publicación en X${author ? ` de ${author}` : ""}`),
    imageUrl,
    bodyText,
    sourceUrl: normalized,
    sourceName: "X (Twitter)",
    platform: "twitter",
    author,
  };
}

async function fetchInstagramPost(url) {
  const normalized = normalizeSocialUrl(url, "instagram");
  const html = await fetchHtml(normalized, MOBILE_HEADERS);

  const caption =
    metaContent(html, "og:description") ||
    metaContent(html, "description") ||
    extractInstagramCaptionJson(html);

  const text = cleanInstagramCaption(caption);
  if (!text || text.length < 5) {
    throw new Error(
      "No pude leer la publicación de Instagram (puede ser privada o requerir inicio de sesión)"
    );
  }

  const imageUrl =
    metaContent(html, "og:image") ||
    metaContent(html, "og:image:url") ||
    "";

  const author = extractInstagramAuthor(html, caption);
  const bodyText = buildSocialBody({ text, author, platform: "instagram" });

  return {
    title: titleFromText(text, `Publicación en Instagram${author ? ` de ${author}` : ""}`),
    imageUrl,
    bodyText,
    sourceUrl: normalized,
    sourceName: "Instagram",
    platform: "instagram",
    author,
  };
}

function extractInstagramCaptionJson(html) {
  const patterns = [
    /"caption"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"text"\s*:\s*"((?:\\.|[^"\\])*)"/,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1] && match[1].length > 10) {
      try {
        return JSON.parse(`"${match[1]}"`);
      } catch {
        return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
    }
  }
  return "";
}

function extractInstagramAuthor(html, caption = "") {
  const userMatch =
    html.match(/"username"\s*:\s*"([a-zA-Z0-9._]+)"/) ||
    caption.match(/^([a-zA-Z0-9._]+)\s+en\s+Instagram/i);
  if (userMatch?.[1]) return `@${userMatch[1].replace(/^@/, "")}`;
  return "";
}

function cleanInstagramCaption(caption = "") {
  let text = decodeHtmlEntities(caption).trim();

  text = text
    .replace(/^\s*[\d.,]+\s+(likes?|me gusta),?\s*[\d.,]+\s+comments?\s*[-–—:]\s*/i, "")
    .replace(/^[A-Za-z0-9._]+\s+on Instagram:\s*"?/i, "")
    .replace(/^[^:]+:\s*"/, "")
    .replace(/"\s*$/g, "")
    .trim();

  const quoted = text.match(/^"([^"]+)"$/);
  if (quoted) text = quoted[1];

  return text;
}

async function fetchFacebookPost(url) {
  const normalized = normalizeSocialUrl(url, "facebook");

  try {
    const oembedUrl = `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(normalized)}`;
    const res = await fetchWithRetry(oembedUrl, { headers: FETCH_HEADERS }, { label: "Facebook" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.html) {
      const text = decodeHtmlEntities(stripTags(data.html));
      if (text.length >= 10) {
        const author = data.author_name || "";
        const bodyText = buildSocialBody({
          text,
          author: author ? author : "",
          platform: "facebook",
        });
        return {
          title: titleFromText(text, `Publicación en Facebook${author ? ` de ${author}` : ""}`),
          imageUrl: data.thumbnail_url || "",
          bodyText,
          sourceUrl: normalized,
          sourceName: "Facebook",
          platform: "facebook",
          author,
        };
      }
    }
  } catch {
    // fallback a Open Graph
  }

  const html = await fetchHtml(normalized);
  const text =
    metaContent(html, "og:description") ||
    metaContent(html, "description") ||
    "";

  if (!text || text.length < 10) {
    throw new Error(
      "No pude leer la publicación de Facebook (puede ser privada o requerir inicio de sesión)"
    );
  }

  const imageUrl = metaContent(html, "og:image") || "";
  const author = metaContent(html, "og:site_name") || "";
  const bodyText = buildSocialBody({ text, author, platform: "facebook" });

  return {
    title:
      metaContent(html, "og:title") ||
      titleFromText(text, `Publicación en Facebook`),
    imageUrl,
    bodyText,
    sourceUrl: normalized,
    sourceName: "Facebook",
    platform: "facebook",
    author,
  };
}

export async function fetchSocialPost(url) {
  const platform = detectSocialPlatform(url);
  if (!platform) return null;

  switch (platform) {
    case "twitter":
      return fetchTwitterPost(url);
    case "instagram":
      return fetchInstagramPost(url);
    case "facebook":
      return fetchFacebookPost(url);
    default:
      return null;
  }
}

export function isSocialMediaUrl(url) {
  return Boolean(detectSocialPlatform(url));
}
