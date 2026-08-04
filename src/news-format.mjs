import { config } from "./config.mjs";

export function extractOriginalTitle(ocrText, fallback = "Noticia") {
  const lines = ocrText
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const skip = /^(share|por |santo domingo|actualidad|nacionales|últimas|facebook|twitter)/i;
  for (const line of lines) {
    if (line.length < 20 || line.length > 200) continue;
    if (skip.test(line)) continue;
    return line;
  }

  return lines[0] || fallback;
}

export function parseSourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const names = {
      "n.com.do": "N Digital",
      "listindiario.com": "Listín Diario",
      "diariolibre.com": "Diario Libre",
      "elnacional.com.do": "El Nacional",
      "acento.com.do": "Acento",
      "hoy.com.do": "Hoy",
      "cdn.com.do": "CDN",
      "elcaribe.com.do": "elCaribe",
      "eldia.com.do": "El Día",
      "ensegundos.do": "En Segundos",
      "7dias.com.do": "7días",
      "deultimominuto.net": "De Último Minuto",
      "almomento.net": "AlMomento",
      "noticiassin.com": "Noticias SIN",
      "rccnoticias.com.do": "RCC Noticias",
      "elnuevodiario.com.do": "El Nuevo Diario",
      "z101digital.com": "Z101 Digital",
      "panorama.com.do": "Panorama",
      "proceso.com.do": "Proceso",
      "instagram.com": "Instagram",
      "facebook.com": "Facebook",
      "twitter.com": "X (Twitter)",
      "x.com": "X (Twitter)",
      "youtube.com": "YouTube",
    };
    return { name: names[host] || host, url, host };
  } catch {
    return { name: "", url, host: "" };
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function decodeHtmlEntities(text = "") {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;|&ndash;/g, "—")
    .replace(/\u2013|\u2014/g, "—");
}

export function cleanImportedText(text = "") {
  const skipLine =
    /^(por\s+|n\s*digital|list[ií]n|diario libre|acento|el nacional|te puede interesar|share:|compartir|síguenos|publicidad|relacionad|archivo|agencia efe|efe\b|ciudad de)/i;

  return decodeHtmlEntities(text)
    .split(/\n\n+/)
    .map((p) =>
      p
        .trim()
        .replace(/^por\s+[^.\n]+[.\-–—]\s*/i, "")
        .replace(/\s*n\s*digital\s*/gi, " ")
        .replace(/\b\d{2}\/\d{2}\/\d{4}(\s+\d{2}:\d{2})?(\s*\|\s*actualizado.*)?/gi, "")
        .replace(/\bARCHIVO\/\w+/gi, "")
        .replace(/\bAgencia EFE\b/gi, "")
        .trim()
    )
    .filter((p) => {
      if (p.length < 40) return false;
      if (skipLine.test(p)) return false;
      if (/^\d{2}\/\d{2}\/\d{4}/.test(p)) return false;
      return true;
    })
    .join("\n\n");
}

export function textToNewsHtml(text = "") {
  const paragraphs = decodeHtmlEntities(text)
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

export function buildSourceFooter(sourceName, sourceUrl) {
  const label = sourceName || "Fuente";
  if (sourceUrl) {
    return `<p><em>Fuente: <a href="${sourceUrl}" target="_blank" rel="noopener">${escapeHtml(label)}</a></em></p>`;
  }
  return `<p><em>Fuente: ${escapeHtml(label)}</em></p>`;
}

export function buildAuthorSignature(author = config.news.authorSignature) {
  return `<p><strong>${escapeHtml(author)}</strong></p>`;
}

export function finalizeNewsHtml(bodyHtml, { sourceName, sourceUrl, imageUrl, skipSource } = {}) {
  const parts = [(bodyHtml || "").trim()];

  if (imageUrl && !parts[0].includes(imageUrl)) {
    parts.push(`<p><img src="${imageUrl}" alt="" /></p>`);
  }

  if (!skipSource) {
    parts.push(buildSourceFooter(sourceName, sourceUrl));
  }
  parts.push(buildAuthorSignature());

  return parts.filter(Boolean).join("\n");
}
