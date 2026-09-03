import { config } from "./config.mjs";
import { getSheetsApi, resolveAlertsSpreadsheetId } from "./google-auth.mjs";
import { parseSourceFromUrl } from "./news-format.mjs";
import { calendarYmd, extractDateFromUrl, todayYmd } from "./news-date.mjs";

/** Encabezados Intrant — ninguno puede quedar vacío en filas nuevas */
export const HEADERS = [
  "fecha",
  "periodista",
  "titulo",
  "texto",
  "medio",
  "sentimiento",
  "url",
  "desde",
];

/** Valor fijo columna "desde" para filas del agente */
export const DESDE_AGENTE = "firma agente";

const RANGE_COLS = "A:H";

/** Fecha legible dd/mm/yyyy (texto; no serial de Sheets). */
function formatFechaSheet(iso) {
  const d = iso ? new Date(iso) : new Date();
  const ymd = Number.isNaN(d.getTime()) ? todayYmd() : calendarYmd(d);
  const [y, m, day] = ymd.split("-");
  return `${day}/${m}/${y}`;
}

function ymdToSheetFecha(ymd = "") {
  const m = String(ymd).trim().match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Índice de fila legacy (#) — no es una fecha. */
function isRowIndex(value) {
  const s = String(value ?? "").trim();
  if (!/^\d{1,4}$/.test(s)) return false;
  const n = Number(s);
  // Seriales reales de Sheets para 2020+ son > ~44000
  return n >= 1 && n < 20000;
}

function isFechaCell(value) {
  return /^\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}$/.test(String(value ?? "").trim());
}

/**
 * Resuelve fecha de celda. Nunca deja un índice (#) en la columna fecha.
 * Prioridad: URL del artículo → fecha 20xx válida → hoy (solo si no hay nada).
 */
export function resolveFechaSheet(fecha = "", url = "") {
  const fromUrl = ymdToSheetFecha(extractDateFromUrl(url));
  const raw = String(fecha ?? "").trim();

  // Índice puro o serial pequeño = basura del legacy (#)
  // No usar "hoy": eso hace que --replace borre el histórico entero.
  if (isRowIndex(raw)) {
    return fromUrl || "";
  }

  // Serial moderno de Sheets (p. ej. 45854)
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      const utc = new Date(
        Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000
      );
      return formatFechaSheet(utc.toISOString());
    }
    return fromUrl || "";
  }

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) {
    return fromUrl || raw || "";
  }

  let day = Number(m[1]);
  let month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return fromUrl || "";
  }

  // 1900–1999: casi siempre índice/# formateado como fecha de Sheets
  if (year < 2000) {
    return fromUrl || "";
  }

  const cell = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  // Si la URL trae fecha fiable, manda la URL (corrige índices “reparados” a 2026)
  if (fromUrl) return fromUrl;
  return cell;
}

/** @deprecated usar resolveFechaSheet */
export function repairFechaSheet(fecha = "", url = "") {
  return resolveFechaSheet(fecha, url);
}

/** Normaliza "14/07/2026" y "14/7/2026" → misma clave. */
export function normalizeFechaKey(fecha = "") {
  const resolved = resolveFechaSheet(fecha);
  const m = String(resolved)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (!m) return String(fecha).trim();
  return `${Number(m[1])}/${Number(m[2])}/${m[3]}`;
}

function guessSourceFromUrl(url = "") {
  const parsed = parseSourceFromUrl(url);
  return parsed.name || parsed.host || "";
}

const EMPTY_MEDIO_RE =
  /^(medio-?no-?especificado|fuente|sin\s*medio|n\/?a|null|undefined|-|—|–)?$/i;

export function isMissingMedio(value = "") {
  return EMPTY_MEDIO_RE.test(String(value ?? "").trim());
}

const EMPTY_TITULO_RE =
  /^(\(sin t[ií]tulo\)|sin t[ií]tulo|titulo|título|n\/?a|null|undefined|-|—|–)?$/i;

export function isMissingTitulo(value = "") {
  return EMPTY_TITULO_RE.test(String(value ?? "").trim());
}

/** Normaliza a dd/mm/yyyy (ej. 17/07/2026). */
export function normalizeFechaDdMmYyyy(fecha = "", url = "") {
  const resolved = resolveFechaSheet(fecha, url);
  const m = String(resolved)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (!m) return resolved || "";
  return `${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[3]}`;
}

/** Arma un título corto a partir del texto/resumen. */
export function titleFromTexto(texto = "", maxLen = 120) {
  let t = String(texto || "")
    .replace(/\*\*|__/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  // Primera oración razonable
  const sentence = t.split(/(?<=[.!?…])\s+/)[0] || t;
  t = sentence.trim();
  if (t.length > maxLen) {
    const cut = t.slice(0, maxLen);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 40 ? cut.slice(0, sp) : cut).trim() + "…";
  }
  return t;
}

async function batchUpdateCells(sheets, spreadsheetId, updates) {
  if (!updates.length) return;
  // Sheets API: máx ~100 requests por batch práctico
  const chunk = 100;
  for (let i = 0; i < updates.length; i += chunk) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates.slice(i, i + chunk),
      },
    });
  }
}

/** Normaliza formato a dd/mm/yyyy SIN cambiar día/mes/año ni usar URL. */
export function padFechaFormatOnly(fecha = "") {
  const raw = String(fecha ?? "").trim();
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return "";
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Completa columna "medio" vacía en el Sheet Intrant usando el host/nombre de la URL.
 * También normaliza formato de fecha (dd/mm/yyyy) sin cambiar el valor del día.
 */
export async function fillMissingMedioInSheet({
  spreadsheetId,
  sheetName = config.googleAlerts?.sheetName || "Hoja 1",
} = {}) {
  const id = spreadsheetId || (await resolveAlertsSpreadsheetId());
  const sheets = getSheetsApi();
  const ensured = await ensureSheetHeaders(sheets, id, sheetName);
  const tab = ensured.sheetName;

  const full = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!${RANGE_COLS}`,
  });
  const values = full.data.values || [];
  if (values.length <= 1) {
    return {
      checked: 0,
      filled: 0,
      fechaNormalized: 0,
      spreadsheetId: id,
      sheetName: tab,
      samples: [],
    };
  }

  const updates = [];
  const samples = [];
  let fechaNormalized = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowNum = i + 1;
    const medio = String(row[4] || "").trim();
    const url = String(row[6] || "").trim();
    const fechaRaw = String(row[0] || "").trim();

    // Formato fecha únicamente (4/8/2026 → 04/08/2026). Nunca cambia el día.
    const fechaPad = padFechaFormatOnly(fechaRaw);
    if (fechaPad && fechaPad !== fechaRaw) {
      updates.push({
        range: `${tab}!A${rowNum}`,
        values: [[fechaPad]],
      });
      fechaNormalized += 1;
    }

    if (!isMissingMedio(medio)) continue;
    if (!/^https?:\/\//i.test(url)) continue;

    const fromUrl = guessSourceFromUrl(url);
    if (!fromUrl || isMissingMedio(fromUrl)) continue;

    updates.push({
      range: `${tab}!E${rowNum}`,
      values: [[fromUrl]],
    });
    if (samples.length < 15) {
      samples.push({
        row: rowNum,
        titulo: String(row[2] || "").slice(0, 70),
        medio: fromUrl,
        url,
      });
    }
  }

  await batchUpdateCells(sheets, id, updates);

  return {
    checked: values.length - 1,
    filled: updates.filter((u) => /!E\d+$/.test(u.range)).length,
    fechaNormalized,
    spreadsheetId: id,
    sheetName: tab,
    samples,
  };
}

/**
 * Mantiene Sheet eléctrico/Edesur:
 * - medio vacío → desde URL
 * - título vacío → desde texto
 * - fecha → dd/mm/yyyy (ej. 17/07/2026)
 */
export async function maintainElectricSheet({
  spreadsheetId = config.electricAlerts?.sheetId,
  sheetName = config.electricAlerts?.sheetName || "Hoja 1",
} = {}) {
  if (!spreadsheetId) throw new Error("Falta ELECTRIC_ALERTS_SHEET_ID");

  const sheets = getSheetsApi();
  const ensured = await ensureSheetHeaders(sheets, spreadsheetId, sheetName);
  const tab = ensured.sheetName;

  const full = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!${RANGE_COLS}`,
  });
  const values = full.data.values || [];
  if (values.length <= 1) {
    return {
      checked: 0,
      medioFilled: 0,
      tituloFilled: 0,
      fechaNormalized: 0,
      spreadsheetId,
      sheetName: tab,
      samples: [],
    };
  }

  const updates = [];
  const samples = [];
  let medioFilled = 0;
  let tituloFilled = 0;
  let fechaNormalized = 0;

  for (let i = 1; i < values.length; i++) {
    const row = [...(values[i] || [])];
    while (row.length < 8) row.push("");
    const rowNum = i + 1;
    const url = String(row[6] || "").trim();
    const changes = [];

    // Fecha → dd/mm/yyyy
    const fechaRaw = String(row[0] || "").trim();
    const fechaNorm = normalizeFechaDdMmYyyy(fechaRaw, url);
    if (fechaNorm && fechaNorm !== fechaRaw) {
      updates.push({ range: `${tab}!A${rowNum}`, values: [[fechaNorm]] });
      fechaNormalized += 1;
      changes.push(`fecha:${fechaRaw || "∅"}→${fechaNorm}`);
    }

    // Título vacío → desde texto
    const titulo = String(row[2] || "").trim();
    const texto = String(row[3] || "").trim();
    if (isMissingTitulo(titulo) && texto) {
      const fromTexto = titleFromTexto(texto);
      if (fromTexto) {
        updates.push({ range: `${tab}!C${rowNum}`, values: [[fromTexto]] });
        tituloFilled += 1;
        changes.push(`titulo←texto`);
      }
    }

    // Medio vacío → desde URL
    const medio = String(row[4] || "").trim();
    if (isMissingMedio(medio) && /^https?:\/\//i.test(url)) {
      const fromUrl = guessSourceFromUrl(url);
      if (fromUrl && !isMissingMedio(fromUrl)) {
        updates.push({ range: `${tab}!E${rowNum}`, values: [[fromUrl]] });
        medioFilled += 1;
        changes.push(`medio→${fromUrl}`);
      }
    }

    if (changes.length && samples.length < 20) {
      samples.push({
        row: rowNum,
        titulo: String(row[2] || titleFromTexto(texto) || "").slice(0, 70),
        changes,
      });
    }
  }

  await batchUpdateCells(sheets, spreadsheetId, updates);

  return {
    checked: values.length - 1,
    medioFilled,
    tituloFilled,
    fechaNormalized,
    spreadsheetId,
    sheetName: tab,
    samples,
  };
}

function classifyAlertSentiment(text = "") {
  const t = String(text).toLowerCase();
  const neg =
    /accidente|herid|muert|detenid|exigen|queja|crítica|critica|alza|caos|danger|peligro|violencia|protest|denuncia|ilegal|genocida|delincuencial/;
  const pos =
    /respaldan|apoyan|garantiza|mejora|abre|inaugur|promueve|éxito|exito|beneficio|avance/;
  if (pos.test(t) && !neg.test(t)) return "positivo";
  if (neg.test(t) && !pos.test(t)) return "negativo";
  if (pos.test(t) && neg.test(t)) return "mixto";
  return "neutral";
}

const BAD_TEXTO =
  /todas las noticias del acontecer|enterate de las últimas|your browser|cookie|javascript/i;

/**
 * Fila Intrant con las 8 columnas de encabezado (nada vacío).
 */
export function alertToIntrantRow(a) {
  const titulo = String(a.title || a.titulo || "").trim() || "(sin título)";
  let texto = String(a.snippet || a.texto || "").trim();
  if (!texto || BAD_TEXTO.test(texto) || texto.length < 40) {
    texto =
      String(a.fallbackTexto || "").trim() ||
      `Resumen pendiente: ${titulo}`;
  }
  const medio =
    String(a.source || a.medio || "").trim() ||
    guessSourceFromUrl(a.url) ||
    "medio-no-especificado";
  const sentimiento = String(
    a.sentimiento ||
      classifyAlertSentiment(`${titulo} ${texto} ${a.alertQuery || ""}`)
  )
    .trim()
    .toLowerCase();
  const periodista = String(a.periodista || "").trim() || "Redacción";
  const url = String(a.url || "").trim() || "https://example.com/sin-url";
  const [y, m, day] = todayYmd().split("-");
  const urlFecha = `${day}/${m}/${y}`;
  return [
    urlFecha,
    periodista,
    titulo,
    texto,
    medio,
    sentimiento || "neutral",
    url,
    DESDE_AGENTE,
  ];
}

/**
 * Legacy A: [#, fecha, periodista, texto, medio, sentimiento, url]
 * Legacy B: [#, periodista, titulo, texto, medio, sentimiento, url]  ← índice en "fecha"
 */
function remapLegacyRow(row = []) {
  const r = [...row];
  if (!isRowIndex(r[0])) return r;

  // A: segunda col es fecha real
  if (isFechaCell(r[1])) {
    return [
      r[1],
      r[2],
      r[3],
      r[3],
      r[4],
      r[5],
      r[6],
      r[4] || "",
    ];
  }

  // B: segunda col es periodista (el # ocupaba la fecha)
  return [
    "", // fecha se resuelve luego desde URL
    r[1],
    r[2],
    r[3] || r[2],
    r[4],
    r[5],
    r[6],
    r[7] || r[4] || "",
  ];
}

function isLegacyNumberedRow(row = []) {
  return isRowIndex(row[0]);
}

/** Completa filas antiguas (7 cols) hasta 8, rellenando huecos.
 *  Por defecto NO cambia la fecha ya insertada (preserveFecha=true).
 */
function normalizeStoredRow(row = [], { preserveFecha = true } = {}) {
  let r = remapLegacyRow(row);

  while (r.length < HEADERS.length) r.push("");
  const out = r.slice(0, HEADERS.length);
  const url = String(out[6] || "").trim();
  if (preserveFecha) {
    const raw = String(out[0] || "").trim();
    out[0] = raw || "sin-fecha";
  } else {
    out[0] = resolveFechaSheet(out[0], url) || String(out[0] || "").trim();
    // Histórico sin fecha recuperable: no inventar "hoy"
    if (!out[0]) out[0] = "sin-fecha";
  }
  if (!String(out[1] || "").trim()) out[1] = "Redacción";
  if (!String(out[2] || "").trim()) out[2] = "(sin título)";
  if (!String(out[3] || "").trim() || BAD_TEXTO.test(out[3])) {
    out[3] = `Resumen pendiente: ${out[2]}`;
  }
  if (!String(out[4] || "").trim()) {
    out[4] = guessSourceFromUrl(out[6]) || "medio-no-especificado";
  }
  if (!String(out[5] || "").trim()) out[5] = "neutral";
  if (!String(out[6] || "").trim()) out[6] = "https://example.com/sin-url";
  if (!String(out[7] || "").trim()) out[7] = out[4] || guessSourceFromUrl(out[6]) || "web";
  return out;
}

/** Fecha literal de la celda (sin reescribir desde URL). */
function rowFecha(row = []) {
  const mapped = remapLegacyRow(row);
  return normalizeFechaKey(String(mapped[0] || "").trim());
}

function rowFechaRaw(row = []) {
  return String(remapLegacyRow(row)[0] || "").trim();
}

function rowUrl(row = []) {
  return String(remapLegacyRow(row)[6] || "").trim();
}

function rowPeriodista(row = []) {
  return String(remapLegacyRow(row)[1] || "").trim().toLowerCase();
}

export async function ensureSheetHeaders(sheets, spreadsheetId, sheetName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabs = meta.data.sheets || [];
  let name = sheetName;
  const exists = tabs.some((s) => s.properties?.title === name);
  if (!exists) {
    name = tabs[0]?.properties?.title || sheetName;
  }

  const range = `${name}!A1:H1`;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const row = existing.data.values?.[0] || [];
  const looksLikeIntrant =
    /fecha/i.test(row[0] || "") && /titulo|título/i.test(row[2] || "");
  const needsHeaderFix =
    !row.length ||
    !/desde|fuente/i.test(row[7] || "") ||
    row.slice(0, 8).join("|") !== HEADERS.join("|");

  if (needsHeaderFix) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${name}!A1:H1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    // limpia encabezado huérfano "fuente" en P y huecos H–O viejos
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${name}!I1:P1`,
    });
  }
  return { sheetName: name, looksLikeIntrant: looksLikeIntrant || !row.length };
}

export async function getExistingAlertKeys(sheets, spreadsheetId, sheetName) {
  const full = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${RANGE_COLS}`,
  });
  const keys = new Set();
  for (const row of full.data.values || []) {
    const title = (row[2] || "").toLowerCase().trim();
    const url = (row[6] || "").trim();
    if (title || url) keys.add(`${title}|${url}`);
  }
  return keys;
}

export async function appendAlertsToSheet(alerts, {
  spreadsheetId,
  sheetName = config.googleAlerts?.sheetName || "Hoja 1",
} = {}) {
  const id = spreadsheetId || (await resolveAlertsSpreadsheetId());
  const sheets = getSheetsApi();
  const ensured = await ensureSheetHeaders(sheets, id, sheetName);
  const tab = ensured.sheetName;
  const existing = await getExistingAlertKeys(sheets, id, tab);

  const rows = [];
  for (const a of alerts) {
    const key = `${(a.title || "").toLowerCase()}|${a.url || ""}`;
    if (existing.has(key)) continue;
    existing.add(key);
    rows.push(alertToIntrantRow(a));
  }

  if (!rows.length) {
    return { added: 0, skipped: alerts.length, spreadsheetId: id, sheetName: tab };
  }

  // RAW: evita que Sheets interprete "11/06/2026" como serial/epoch (→ 1901)
  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: `${tab}!${RANGE_COLS}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  return {
    added: rows.length,
    skipped: alerts.length - rows.length,
    spreadsheetId: id,
    sheetName: tab,
  };
}

/**
 * Reemplaza filas de hoy y garantiza encabezados A–H sin huecos.
 */
export async function refreshTodaysGoogleAlertRows(alerts, {
  spreadsheetId,
  sheetName = config.googleAlerts?.sheetName || "Hoja 1",
} = {}) {
  const id = spreadsheetId || (await resolveAlertsSpreadsheetId());
  const sheets = getSheetsApi();
  const ensured = await ensureSheetHeaders(sheets, id, sheetName);
  const tab = ensured.sheetName;

  const today = normalizeFechaKey(formatFechaSheet(new Date().toISOString()));
  const full = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A:P`,
  });
  const values = full.data.values || [];
  if (!values.length) {
    return appendAlertsToSheet(alerts, { spreadsheetId: id, sheetName: tab });
  }

  const newUrlSet = new Set(alerts.map((a) => a.url).filter(Boolean));
  const previous = values.slice(1);

  // Fechas ya insertadas por URL — nunca se pisan al reinsertar la misma noticia
  const fechaByUrl = new Map();
  for (const row of previous) {
    const u = rowUrl(row);
    const f = rowFechaRaw(row);
    if (u && f && !fechaByUrl.has(u)) fechaByUrl.set(u, f);
  }

  const kept = previous.filter((row) => {
    const fecha = rowFecha(row);
    const periodista = rowPeriodista(row);
    const url = rowUrl(row);
    if (fecha && fecha === today) return false;
    if (/google\s*alerts?/i.test(periodista)) return false;
    if (url && newUrlSet.has(url)) return false;
    return true;
  });

  // Seguridad: no reescribir el sheet si se perdería casi todo el histórico
  if (previous.length >= 20 && kept.length < previous.length * 0.3) {
    console.warn(
      `refreshTodays abortado: kept=${kept.length}/${previous.length}. Uso append.`
    );
    return appendAlertsToSheet(alerts, { spreadsheetId: id, sheetName: tab });
  }

  const newRows = alerts.map((a) => {
    const row = alertToIntrantRow(a);
    const prevFecha = a.url ? fechaByUrl.get(a.url) : "";
    // Misma URL ya existía → conservar su fecha insertada
    if (prevFecha) row[0] = prevFecha;
    else if (!String(row[0] || "").trim()) row[0] = formatFechaSheet();
    return row;
  });
  const next = [
    HEADERS,
    // Histórico: fechas intactas
    ...kept.map((row) => normalizeStoredRow(row, { preserveFecha: true })),
    ...newRows,
  ];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${tab}!A:P`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: next },
  });

  return {
    added: newRows.length,
    removedTodayNoise: previous.length - kept.length,
    keptHistorical: kept.length,
    spreadsheetId: id,
    sheetName: tab,
  };
}

/**
 * Repara SOLO fechas claramente corruptas (índice #, años <2000 tipo 1901).
 * Nunca cambia una fecha 20xx ya insertada.
 */
export async function repairSheetFechas({
  spreadsheetId,
  sheetName = config.googleAlerts?.sheetName || "Hoja 1",
} = {}) {
  const id = spreadsheetId || (await resolveAlertsSpreadsheetId());
  const sheets = getSheetsApi();
  const ensured = await ensureSheetHeaders(sheets, id, sheetName);
  const tab = ensured.sheetName;

  const full = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A:P`,
  });
  const values = full.data.values || [];
  if (values.length <= 1) {
    return { repaired: 0, total: 0, spreadsheetId: id, sheetName: tab };
  }

  let repaired = 0;
  const next = [HEADERS];
  for (const row of values.slice(1)) {
    const before = String(row[0] || "").trim();
    const url = rowUrl(row);
    const preserved = normalizeStoredRow(row, { preserveFecha: true });
    const yearMatch = before.match(/^\d{1,2}\/\d{1,2}\/(\d{4})$/);
    const corrupt =
      isRowIndex(before) ||
      (yearMatch && Number(yearMatch[1]) < 2000);

    if (corrupt) {
      let fechaFixed = resolveFechaSheet(before, url);
      if (!fechaFixed) {
        const ymd = extractDateFromUrl(url);
        if (ymd) {
          const [y, m, d] = ymd.split("-");
          fechaFixed = `${d}/${m}/${y}`;
        }
      }
      if (fechaFixed && fechaFixed !== before) {
        preserved[0] = fechaFixed;
        repaired += 1;
      }
    }
    next.push(preserved);
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${tab}!A:P`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: next },
  });

  return {
    repaired,
    total: values.length - 1,
    spreadsheetId: id,
    sheetName: tab,
  };
}

/**
 * --replace refresca filas de hoy (sin tocar histórico de otros días).
 */
export async function replaceAlertsSheet(alerts, options = {}) {
  return refreshTodaysGoogleAlertRows(alerts, options);
}
