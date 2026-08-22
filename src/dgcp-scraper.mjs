/**
 * Scraper de la página pública de avisos de licitación de la DGCP.
 * URL: https://comunidad.comprasdominicana.gob.do/Public/Tendering/ContractNoticeManagement/Index
 *
 * La primera página de resultados viene renderizada en el HTML inicial.
 * Extrae filas de la grilla con país, entidad, referencia, descripción,
 * fase, fechas de publicación, límite y apertura.
 */

const DEFAULT_URL =
  "https://comunidad.comprasdominicana.gob.do/Public/Tendering/ContractNoticeManagement/Index";

const DEFAULT_KEYWORDS = [
  "web",
  "aplicación",
  "aplicacion",
  "aplicaciones",
  "streaming",
  "monitoreo",
  "relaciones públicas",
  "relaciones publicas",
  "encuestas",
  "python",
  "react",
  "montaje",
  "eventos",
  "tecnología",
  "tecnologia",
  "zoom",
  "adobe",
  "fortinet",
  "openai",
  "claude",
  "inteligencia artificial",
  "plataforma",
  "informático",
  "informatico",
  "equipos informáticos",
  "accesorios informáticos",
  "licencia",
  "licencias",
  "antivirus",
  "suscripción",
  "suscripcion",
  "seguridad",
  "comunicaciones",
  "mantenimiento de vehículos",
  "mantenimiento de vehiculos",
];

/**
 * Devuelve true si la ejecución actual está en el horario AM (antes de mediodía
 * en hora de República Dominicana).
 */
export function isAmSlot() {
  const hour = Number(
    new Intl.DateTimeFormat("es-DO", {
      timeZone: "America/Santo_Domingo",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
  return hour < 12;
}


/** Normaliza texto para comparación: minúsculas, sin tildes, sin espacios extras. */
function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Determina si un texto coincide con alguna keyword configurada.
 *  Descarta falsos positivos de "react" cuando aparece como "reactivo(s)".
 */
function findMatches(text, keywords) {
  const normalized = normalizeText(text);
  const hits = [];
  for (const keyword of keywords) {
    const k = normalizeText(keyword);
    if (!k) continue;

    // Falso positivo: "react" en "reactivo" o "reactivos" no cuenta
    if (k === "react") {
      const withoutReactivos = normalized.replace(/reactivos?\b/g, " ");
      if (/\breact\b/.test(withoutReactivos)) {
        hits.push(keyword);
      }
      continue;
    }

    if (normalized.includes(k)) {
      hits.push(keyword);
    }
  }
  return hits;
}

/** Extrae el texto plano de un trozo HTML (descarta tags). */
function stripHtml(html) {
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parsea las filas de la grilla del HTML de la DGCP.
 * Cada fila tiene id grdResultList_tr{N} class gridLineLight.
 */
function parseRows(html) {
  const rows = [];
  const rowRegex =
    /<tr\s+id="tblMainTable_trRowMiddle_tdCell1_tblForm_trGridRow_tdCell1_grdResultList_tr(\d+)"[^>]*class="gridLineLight"[^>]*>([\s\S]*?)<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[2];

    // Extrae celdas con span VortalSpan o VortalTextBox
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      stripHtml(m[1]).trim()
    );

    // El orden de columnas es:
    // 0: Country (DO)
    // 1: Contracting Authority
    // 2: Unique Identifier / Reference
    // 3: Description
    // 4: Current Phase
    // 5: Official Publish Date
    // 6: Replies Deadline
    // 7: Open Date
    // 8: Actions (ignorar)
    if (cells.length < 5) continue;

    rows.push({
      country: cells[0] || "",
      authority: cells[1] || "",
      reference: cells[2] || "",
      description: cells[3] || "",
      phase: cells[4] || "",
      publishDate: cells[5] || "",
      deadline: cells[6] || "",
      openDate: cells[7] || "",
    });
  }

  return rows;
}

/**
 * Recupera el HTML de la URL y extrae licitaciones.
 * @param {Object} options
 * @param {string} [options.url] - URL a scrapear.
 * @param {string[]} [options.keywords] - Palabras clave para filtrar.
 * @param {boolean} [options.onlyToday=false] - Si true, filtra solo licitaciones publicadas hoy (AM/PM según hora actual).
 * @returns {Promise<{url:string, keywords:string[], total:number, items:Array}>}
 */
export async function scrapeDgcp(options = {}) {
  const url = options.url || process.env.DGCP_DIGEST_URL || DEFAULT_URL;
  const keywords = options.keywords ||
    (process.env.DGCP_DIGEST_KEYWORDS
      ? String(process.env.DGCP_DIGEST_KEYWORDS)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_KEYWORDS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "es-DO,es;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`DGCP respondió HTTP ${response.status} para ${url}`);
  }

  const html = await response.text();
  const allRows = parseRows(html);

  const amSlot = isAmSlot();
  const todayDo = new Intl.DateTimeFormat("es-DO", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  let candidateRows = allRows;
  if (options.onlyToday) {
    candidateRows = allRows.filter((row) => {
      if (!row.publishDate) return false;
      // publishDate viene como "10/08/2026 12:34" o similar
      const datePart = row.publishDate.split(" ")[0];
      return datePart === todayDo;
    });
  }

  const items = candidateRows
    .map((row) => {
      const haystack = [row.description, row.authority, row.reference, row.phase].join(" ");
      const matchedKeywords = findMatches(haystack, keywords);
      return { ...row, matchedKeywords };
    })
    .filter((row) => row.matchedKeywords.length > 0);

  return {
    url,
    keywords,
    total: allRows.length,
    filteredTotal: candidateRows.length,
    amSlot,
    todayDo,
    items,
  };
}
