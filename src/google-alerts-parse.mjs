/**
 * Parseo Google Alerts + filtros Intrant / eléctrico (keyword en título).
 */

function decodeHtml(text = "") {
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html = "") {
  return decodeHtml(html.replace(/<[^>]+>/g, " "));
}

/**
 * Extrae ítems de un correo HTML de Google Alerts.
 * @returns {{ title, snippet, url, source }[]}
 */
export function parseGoogleAlertsHtml(html = "") {
  const items = [];
  const seen = new Set();

  // Enlaces de noticia típicos: <a href="...">título</a>
  const linkRe =
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    let url = match[1]
      .replace(/&amp;/g, "&")
      .replace(/^https?:\/\/www\.google\.[^/]+\/url\?.*?[?&]url=([^&]+).*$/i, (_, u) =>
        decodeURIComponent(u)
      );
    try {
      const u = new URL(url);
      if (/google\./i.test(u.hostname) && u.pathname.includes("/url")) {
        const real = u.searchParams.get("url") || u.searchParams.get("q");
        if (real) url = real;
      }
    } catch {
      // keep url
    }

    if (/accounts\.google|support\.google|myaccount\.google|alerts\/feeds|google\.com\/alerts/i.test(url)) {
      continue;
    }
    if (!/^https?:\/\//i.test(url)) continue;

    const title = stripTags(match[2]);
    if (!title || title.length < 8) continue;
    if (/ver m[aá]s|see more|unsubscribe|cancelar|gestionar/i.test(title)) continue;

    const key = `${title.toLowerCase()}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // snippet aproximado: texto tras el enlace
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 400);
    const snippet = stripTags(after).slice(0, 280);

    let source = "";
    try {
      source = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      source = "";
    }

    items.push({ title, snippet, url, source });
  }

  return items;
}

export function parseAlertSubject(subject = "") {
  // "Google Alert - INTRANT" / "Alerta de Google: edesur"
  const m = subject.match(/(?:Google Alert|Alerta de Google)\s*[-–—:]\s*(.+)$/i);
  return (m?.[1] || subject || "").trim();
}

/** Keywords por defecto para noticias relevantes Intrant / tránsito */
export const DEFAULT_INTRANT_KEYWORDS = [
  "intrant",
  "digesett",
  "rdvial",
  "rd vial",
  "seguridad vial",
  "milton morrison",
  "miltton morrison",
  "transporte terrestre",
  "transporte público",
  "transporte publico",
  "pasaje",
  "motoconcho",
  "licencia de conducir",
  "licencias de conducir",
];

/**
 * ¿La noticia es relevante? La keyword DEBE estar en el TÍTULO.
 */
export function isRelevantIntrantAlert(item, keywords = DEFAULT_INTRANT_KEYWORDS) {
  const title = String(item.title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();

  if (!title) return false;

  const kws = (keywords?.length ? keywords : DEFAULT_INTRANT_KEYWORDS).map((k) =>
    String(k)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .trim()
  );

  const hit = kws.some((kw) => kw && title.includes(kw));
  if (!hit) return false;

  if (
    /\btransportes?\b/.test(title) &&
    !/(intrant|digesett|rd\s*vial|rdvial|seguridad vial|morrison|pasaje|licencia|motoconcho|transito|tr[aá]nsito|omnibus|autob|fenatrano|chofer)/i.test(
      title
    )
  ) {
    const hits = kws.filter((kw) => kw && title.includes(kw));
    if (hits.every((kw) => /^transportes?$/.test(kw))) return false;
  }

  return true;
}

export function matchesAlertFilter(text = "", filters = []) {
  if (!filters.length) return true;
  const hay = String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return filters.some((f) =>
    hay.includes(
      String(f)
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
    )
  );
}

/** Keywords sector eléctrico */
export const DEFAULT_ELECTRIC_KEYWORDS = [
  "edesur",
  "edeeste",
  "ede este",
  "egehid",
  "eted",
  "cued",
  "celso marranzini",
  "marranzini",
  "apagones",
  "apagon",
  "apagón",
  "punta catalina",
];

/** Entidades RD: bastan en el título (sin exigir dominio .do). */
const RD_ELECTRIC_ENTITIES = [
  "edesur",
  "edeeste",
  "ede este",
  "ede sur",
  "egehid",
  "eted",
  "cued",
  "cdeee",
  "celso marranzini",
  "marranzini",
  "punta catalina",
];

/** Solo “apagón/apagones” — requieren señal RD o dominio dominicano. */
const GENERIC_BLACKOUT = ["apagones", "apagon", "apagón"];

const FOREIGN_ELECTRIC_RE =
  /\b(cuba|cubano|cubanos|habana|guantanamo|guiteras|mexico|mexicano|yucatan|quintana roo|tapachula|los cabos|puerto rico|boricua|alicante|espana|spain|francia|france|italia|italy|tunez|tunisia|argentina|chile|peru|colombia|venezuela|ecuador|bolivia|uruguay|guatemala|honduras|salvador|nicaragua|panama|costa rica|cfe|europa|union europea)\b/i;

const RD_GEO_RE =
  /\b(republica dominicana|dominicana|dominicano|santo domingo|santiago|barahona|pedernales|la romana|san pedro|higüey|higuey|puerto plata|moca|bonao|azua|bani|nagua|cotui|sde\b|sdn\b|\brd\b)\b/i;

const RD_MEDIA_HOST_RE =
  /\.do\b|listindiario\.com|diariolibre\.com|deultimominuto\.net|almomento\.net|noticiassin\.com|cdn\.com\.do|elnuevodiario\.com|z101digital\.com|panorama\.com\.do|proceso\.com\.do|rccnoticias|ensegundos\.do|7dias\.com\.do|hoy\.com\.do|elcaribe\.com\.do|acento\.com\.do|elnacional\.com\.do|eldia\.com\.do|n\.com\.do|diarioazua\.com|arecoa\.com|remolacha\.net|ainoticias|elnacional\.com|cdn\.com\.do/i;

function normalizeAlertText(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** ¿Contexto eléctrico dominicano? (exportado para limpiar el Sheet). */
export function isDominicanElectricContext(item) {
  const title = normalizeAlertText(item.title || "");
  const snippet = normalizeAlertText(item.snippet || item.texto || "");
  const host = normalizeAlertText(
    item.source || hostFromUrl(item.url) || ""
  );
  const hay = `${title} ${snippet}`;

  // País extranjero en título/snippet → fuera (aunque el medio sea .do)
  if (FOREIGN_ELECTRIC_RE.test(hay)) return false;

  const hasRdEntity = RD_ELECTRIC_ENTITIES.some((e) =>
    title.includes(normalizeAlertText(e))
  );
  const isSocial =
    /youtube\.com|facebook\.com|twitter\.com|x\.com|instagram\.com/i.test(host);

  // YouTube/FB solo si hay entidad RD clara en el título
  if (isSocial) return hasRdEntity;

  if (RD_MEDIA_HOST_RE.test(host) || /\.do\b/i.test(host)) return true;
  if (RD_GEO_RE.test(title) || RD_GEO_RE.test(snippet)) return true;
  if (hasRdEntity) return true;
  return false;
}

/**
 * ¿Noticia del sector eléctrico RD?
 * Keyword en título + solo República Dominicana (bloquea Cuba/México/etc.).
 */
export function isRelevantElectricAlert(item, keywords = DEFAULT_ELECTRIC_KEYWORDS) {
  const title = normalizeAlertText(item.title || "");
  if (!title) return false;

  const kws = (keywords?.length ? keywords : DEFAULT_ELECTRIC_KEYWORDS).map((k) =>
    normalizeAlertText(k)
  );

  const hit = kws.filter((kw) => kw && title.includes(kw));
  if (!hit.length) return false;

  // Solo keyword genérica de apagón → exigir contexto RD
  const onlyGeneric =
    hit.length > 0 &&
    hit.every((kw) => GENERIC_BLACKOUT.some((g) => normalizeAlertText(g) === kw));

  if (onlyGeneric && !isDominicanElectricContext(item)) return false;
  if (!isDominicanElectricContext(item)) return false;

  return true;
}
