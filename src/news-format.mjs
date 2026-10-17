import { config } from "./config.mjs";

/** Solo este nombre: periodista, no protagonista. No borrar fuentes ni el resto del dato. */
export const NEVER_NAME_MILTON_JEREZ_RULE = `NUNCA menciones a Milton Jerez (es periodista; no es parte de la noticia).
- Conserva fuentes, medios, instituciones, cifras y hechos.
- NO lo confundas con Milton Morrison (Intrant), que sí puede ir en la nota.
- Si el material dice “según Milton Jerez”, usa el dato y omite su nombre.`;

export function scrubMiltonJerez(text = "") {
  let t = String(text || "");
  if (!t || !/\bmilton\s+jerez\b/i.test(t)) return t;
  t = t.replace(/\bsegún\s+(el\s+periodista\s+)?milton\s+jerez,?\s*/gi, "");
  t = t.replace(/\b(el\s+periodista\s+)?milton\s+jerez\b/gi, "");
  t = t.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.;:])/g, "$1");
  return t.trim();
}

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
    /^(por\s+|n\s*digital|list[ií]n|diario libre|acento|el nacional|te puede interesar|share:|compartir|síguenos|publicidad|relacionad|archivo|agencia efe|efe\b|ciudad de|agenda\s*56)/i;

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

/** Quita nombre de medio + bajada tipo “AGENDA56, SANTO DOMINGO ESTE.- …” */
export function stripMediaDateline(text = "") {
  let t = decodeHtmlEntities(String(text || ""))
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";

  t = t.replace(
    /^(AGENDA\s*56|LIST[IÍ]N(?:\s+DIARIO)?|DIARIO\s+LIBRE|EL\s+NACIONAL|N\s*DIGITAL|CDN(?:37)?|ACENTO|EL\s+CARIBE|HOY|REMOLACHA|AL\s+MOMENTO|PROCESO|RC\s*NOTICIAS|SINMIEDE|EL\s+D[IÍ]A|METRO|SIN\s*CORTAPISA)[,\s.\-–—:]*/i,
    ""
  );
  // “MEDIO, CIUDAD.- resto” o “CIUDAD.- resto”
  t = t.replace(
    /^[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9.& ]{0,36},\s*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,40}\.?\s*[-–—]\s*/u,
    ""
  );
  t = t.replace(
    /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,40}\.?\s*[-–—]\s*/u,
    ""
  );
  t = t.replace(/^\s*[-–—:,]\s*/, "").replace(/\s+/g, " ").trim();
  return t;
}

/** ¿Parece lead crudo de medio y no un titular FV? */
export function looksLikeRawNewsLead(text = "") {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (
    /AGENDA\s*56|LIST[IÍ]N|DIARIO\s+LIBRE|EL\s+NACIONAL|N\s*DIGITAL|CDN37|ACENTO/i.test(
      t
    )
  ) {
    return true;
  }
  if (/,\s*(SANTO DOMINGO|SANTIAGO|DISTRITO NACIONAL|LA VEGA)\b/i.test(t)) {
    return true;
  }
  if (/\b(SANTO DOMINGO|SANTIAGO)\b.{0,20}\.\s*[-–—]/i.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 14) return true;
  return false;
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

/** ID de YouTube para iframe (watch, youtu.be, shorts, embed, live). */
export function youtubeVideoId(url = "") {
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.replace(/^www\./i, "");
    if (/^youtu\.be$/i.test(host)) {
      return u.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (!/youtube\.com|youtube-nocookie\.com/i.test(host)) return "";
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#]+)/i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

const PLAYER_SHELL =
  "margin:28px 0;padding:0;border-radius:18px;overflow:hidden;background:#0B1F3A;border:1px solid #1e3a5f;box-shadow:0 14px 36px rgba(11,31,58,.28);";
const PLAYER_STAGE =
  "position:relative;width:100%;aspect-ratio:16/9;background:#07111f;";
const PLAYER_MEDIA =
  "position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:contain;background:#000;";

/** Player elegante 16:9 (HTML5 / YouTube) para el cuerpo WP. */
export function videoPlayerHtml(url = "") {
  const src = String(url || "").trim();
  if (!/^https?:\/\//i.test(src)) return "";
  const safe = escapeHtml(src);
  const yt = youtubeVideoId(src);
  const media =
    yt && /^[\w-]{6,20}$/.test(yt)
      ? `<iframe src="https://www.youtube.com/embed/${escapeHtml(yt)}" title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="${PLAYER_MEDIA}"></iframe>`
      : `<video controls playsinline preload="metadata" src="${safe}" style="${PLAYER_MEDIA}"></video>`;
  return `<figure class="wp-block-video fv-video-player" style="${PLAYER_SHELL}">
<div class="fv-video-stage" style="${PLAYER_STAGE}">${media}</div>
</figure>`;
}

/** Inserta HTML después del n-ésimo párrafo de contenido (ignora fuente/firma). */
export function insertAfterNthParagraph(html, insert, n = 2) {
  const body = String(html || "");
  const chunk = String(insert || "").trim();
  if (!chunk) return body;
  const re = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  let count = 0;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(body))) {
    const inner = match[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!inner) continue;
    if (/^fuente:/i.test(inner)) continue;
    if (/<strong>/i.test(match[0]) && inner.length < 80) continue;
    count += 1;
    lastIndex = match.index + match[0].length;
    if (count === n) break;
  }
  if (count === 0) return `${chunk}\n${body}`;
  return `${body.slice(0, lastIndex)}\n${chunk}\n${body.slice(lastIndex)}`;
}

export function withNewsVideoPlayer(html, videoUrl) {
  const url = String(videoUrl || "").trim();
  const body = String(html || "");
  if (!url || /fv-video-player/.test(body) || body.includes(url)) return body;
  const player = videoPlayerHtml(url);
  if (!player) return body;
  return insertAfterNthParagraph(body, player, 2);
}

export function finalizeNewsHtml(bodyHtml, { sourceName, sourceUrl, imageUrl, skipSource, videoUrl } = {}) {
  let body = (bodyHtml || "").trim();
  if (videoUrl) body = withNewsVideoPlayer(body, videoUrl);
  const parts = [body];

  if (imageUrl && !parts.join("").includes(imageUrl)) {
    parts.push(`<p><img src="${imageUrl}" alt="" /></p>`);
  }

  if (!skipSource) {
    parts.push(buildSourceFooter(sourceName, sourceUrl));
  }
  parts.push(buildAuthorSignature());

  return parts.filter(Boolean).join("\n");
}
