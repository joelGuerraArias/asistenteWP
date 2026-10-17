/**
 * Regla única de frescura para TODOS los reportes: nada con más de MAX_AGE_HOURS (default 24 h),
 * contado con la hora exacta de publicación. Sin hora comprobable → fuera.
 */

export function maxAgeHours() {
  return Math.max(1, Number(process.env.MAX_AGE_HOURS) || 24);
}

/** Inicio de la ventana móvil (ahora − 24 h). */
export function windowStart(now = new Date()) {
  return new Date(now.getTime() - maxAgeHours() * 3600 * 1000);
}

/** ¿La fecha/hora está dentro de las últimas 24 h? (tolera 10 min de reloj adelantado) */
export function isFresh(date, now = new Date()) {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  if (!Number.isFinite(t)) return false;
  return t >= windowStart(now).getTime() && t <= now.getTime() + 10 * 60 * 1000;
}

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function norm(s = "") {
  return String(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function hm(str) {
  const m = norm(str).match(/\b(\d{1,2})[:h.](\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || "").replace(/[\s.]/g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function drDate(y, mo, d, h = 0, min = 0) {
  const pad = (n) => String(n).padStart(2, "0");
  return new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(min)}:00-04:00`);
}

/**
 * Fecha+hora (hora dominicana) desde textos variados:
 *  "2026-09-25 14:32", "2026-09-25_07-30-10", "25 de septiembre de 2026, 9:57 pm", "9:57 pm" (+ fallbackYmd).
 * Devuelve null si no hay HORA comprobable.
 */
export function parseLooseDateTime(str = "", fallbackYmd = "") {
  const s = String(str || "");
  if (!s.trim()) return null;
  // ISO completo con zona
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})/.test(s)) {
    const d = new Date(s.match(/\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})/)[0]);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  // 2026-09-25 14:32 / 2026-09-25_07-30-10 / 20260925_073010
  let m = s.match(/(\d{4})-?(\d{2})-?(\d{2})[ _T-](\d{2})[-:.h]?(\d{2})/);
  if (m) return drDate(+m[1], +m[2], +m[3], +m[4], +m[5]);
  // 25/09/2026 14:32
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}:\d{2}.*)/);
  if (m) {
    const t = hm(m[4]);
    if (t) return drDate(+m[3], +m[2], +m[1], t.h, t.min);
  }
  // 25 de septiembre de 2026, 9:57 pm
  const n = norm(s);
  m = n.match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) {
    const t = hm(n.slice(m.index + m[0].length)) || hm(n);
    if (t) return drDate(+m[3], MESES[m[2]], +m[1], t.h, t.min);
    return null;
  }
  // solo hora + fecha del archivo
  if (fallbackYmd) {
    const t = hm(s);
    const f = fallbackYmd.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (t && f) return drDate(+f[1], +f[2], +f[3], t.h, t.min);
  }
  return null;
}

/** Fecha desde número (unix s/ms) o texto ISO. */
export function parseStamp(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" || /^\d{10,13}$/.test(String(raw))) {
    const n = Number(raw);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d : null;
}
