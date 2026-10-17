/** Zona horaria de operación para “hoy” en noticias RD. */
export const NEWS_TZ = "America/Santo_Domingo";

/** YYYY-MM-DD en la zona dada. */
export function calendarYmd(date = new Date(), timeZone = NEWS_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date instanceof Date ? date : new Date(date));
}

export function todayYmd(timeZone = NEWS_TZ) {
  return calendarYmd(new Date(), timeZone);
}

/** Normaliza ISO / Date / YYYY-MM-DD / DD/MM/YYYY → YYYY-MM-DD o "". */
export function toYmd(value, timeZone = NEWS_TZ) {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return calendarYmd(value, timeZone);
  }
  const s = String(value).trim();
  if (!s) return "";

  const isoDay = s.match(/^(20\d{2})-(\d{2})-(\d{2})/);
  if (isoDay) return `${isoDay[1]}-${isoDay[2]}-${isoDay[3]}`;

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (slash) {
    return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return calendarYmd(d, timeZone);
}

/** Extrae fecha de publicación típica en URLs de medios RD. */
export function extractDateFromUrl(url = "") {
  const u = String(url);
  // /2026/06/20/ o /2026/6/20
  const m1 = u.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$|\?)/);
  if (m1) {
    return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
  }
  // listindiario: /20250916/
  const compact = u.match(/\/(20\d{2})(\d{2})(\d{2})(?:\/|_)/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  const m2 = u.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  // /2026/06/titulo… (solo año-mes)
  const ym = u.match(/\/(20\d{2})\/(\d{1,2})(?:\/|$)/);
  if (ym) {
    return `${ym[1]}-${ym[2].padStart(2, "0")}-01`;
  }
  return "";
}

/**
 * ¿La noticia es del día calendario actual (RD)?
 * Si no hay fecha fiable → false (nunca se asume “hoy”).
 */
export function isNewsFromToday(
  { url = "", publishedAt = "" } = {},
  now = new Date(),
  timeZone = NEWS_TZ
) {
  const today = calendarYmd(now, timeZone);
  const candidates = [toYmd(publishedAt, timeZone), extractDateFromUrl(url)].filter(
    Boolean
  );
  if (!candidates.length) return false;
  // Si alguna señal es hoy, vale; si todas son otro día, fuera.
  return candidates.some((ymd) => ymd === today);
}

const MS_HOUR = 60 * 60 * 1000;

/**
 * Fecha de publicación más fiable (publishedAt o URL) → Date, o null.
 * Día sin hora → mediodía UTC de ese día (aprox. para edad).
 */
export function resolvePublishedDate({ url = "", publishedAt = "" } = {}) {
  if (publishedAt) {
    const d = new Date(publishedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const ymd = toYmd(publishedAt) || extractDateFromUrl(url);
  if (!ymd) return null;
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 16, 0, 0));
}

/** Edad en horas desde la fecha de la noticia; null si no hay fecha. */
export function newsAgeHours(meta = {}, now = new Date()) {
  const published = resolvePublishedDate(meta);
  if (!published) return null;
  return (now.getTime() - published.getTime()) / MS_HOUR;
}

/**
 * True solo si hay fecha de noticia y tiene ≤ maxAgeHours.
 * Sin fecha fiable → false (no se asume fresca).
 */
export function isNewsWithinHours(
  { url = "", publishedAt = "" } = {},
  maxAgeHours = 24,
  now = new Date()
) {
  const age = newsAgeHours({ url, publishedAt }, now);
  if (age == null) return false;
  if (age < -1) return false; // futuro absurdo
  return age <= maxAgeHours;
}

/**
 * Titulares del nombramiento Méndez / “Abinader designa…” que recirculan años después.
 */
export function looksLikeStaleIntrantAppointment(title = "") {
  const t = String(title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!t) return false;
  if (/abinader\s+designa/.test(t) && /mendez|intrant/.test(t)) return true;
  if (/designa(?:do)?\s+(?:al\s+)?(?:general\s+)?juan\s+manuel\s+mendez/.test(t))
    return true;
  if (
    /nombr(?:a|amiento|ado)/.test(t) &&
    /juan\s+manuel\s+mendez/.test(t) &&
    /intrant|director/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * ¿Se puede incluir en alertas Intrant del día?
 * Requiere fecha de la noticia (URL, publishedAt o cuerpo) ≤ maxAgeHours.
 * Sin fecha → fuera. Titulares de nombramiento Méndez recirculado → fuera.
 */
export function isFreshIntrantAlert(
  { url = "", publishedAt = "", title = "" } = {},
  { maxAgeHours = 24, now = new Date() } = {}
) {
  if (looksLikeStaleIntrantAppointment(title)) {
    const age = newsAgeHours({ url, publishedAt }, now);
    // Solo pasa si hay fecha verificada ≤24h
    return age != null && age >= -1 && age <= maxAgeHours;
  }
  const age = newsAgeHours({ url, publishedAt }, now);
  if (age == null) return false;
  return age >= -1 && age <= maxAgeHours;
}
