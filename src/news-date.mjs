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
