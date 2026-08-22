import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";

export const CHANNELS = {
  tv: {
    id: "tv",
    label: "MONITOREO TV",
    short: "TV",
    pdfPrefix: "MonitoreoTV",
  },
  radio: {
    id: "radio",
    label: "MONITOREO RADIO",
    short: "RADIO",
    pdfPrefix: "MonitoreoRadio",
  },
};

const CLIENTS = {
  edesur: {
    id: "edesur",
    label: "EDESUR",
    keywords: [
      "edesur",
      "ede sur",
      "apagones",
      "apagón",
      "apagon",
      "factura electrica",
      "factura eléctrica",
      "sistema electrico",
      "sistema eléctrico",
      "subestacion",
      "subestación",
      "energia solar",
      "energía solar",
      "eléctrica",
      "electrica",
    ],
  },
  intrant: {
    id: "intrant",
    label: "INTRANT",
    keywords: [
      "intrant",
      "pasaje",
      "pasajes",
      "transportistas",
      "transporte público",
      "transporte publico",
      "ley 63",
      "tarifa del pasaje",
      "morrison",
      "milton morrison",
      "miltton morrison",
      "digesett",
      "rdvial",
      "rd vial",
      "seguridad vial",
    ],
  },
};

export function resolveChannel(channel = "tv") {
  const id = String(channel || "tv").toLowerCase();
  const ch = CHANNELS[id];
  if (!ch) throw new Error(`Canal desconocido: ${channel} (use tv|radio)`);
  return ch;
}

export function clientForChannel(clientId, channel = "tv") {
  const client = CLIENTS[clientId];
  if (!client) throw new Error(`Cliente desconocido: ${clientId}`);
  const ch = resolveChannel(channel);
  return {
    ...client,
    channel: ch.id,
    monitorLabel: ch.label,
    pdfPrefix: ch.pdfPrefix,
    title: `${ch.label} — ${client.label}`,
  };
}

function todayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DIAS_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

/** Fecha en español fijo (nunca "July"). Ej: jueves, 23 de julio de 2026 */
function formatDisplayDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${DIAS_ES[d.getDay()]}, ${d.getDate()} de ${MESES_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** july/July → julio, etc. (el analizador a veces deja meses en inglés). */
function spanishMonthsInText(text = "") {
  const map = {
    january: "enero",
    february: "febrero",
    march: "marzo",
    april: "abril",
    may: "mayo",
    june: "junio",
    july: "julio",
    august: "agosto",
    september: "septiembre",
    october: "octubre",
    november: "noviembre",
    december: "diciembre",
  };
  return String(text).replace(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
    (m) => map[m.toLowerCase()] || m
  );
}

export function resolveAnalisisHoyPath(date = new Date(), channel = "tv") {
  const dir = config.informes.dir;
  const stamp = todayStamp(date);
  const ch = resolveChannel(channel);

  const candidates =
    ch.id === "radio"
      ? [
          join(dir, `AnalisisHoyRadio_${stamp}.md`),
          join(dir, `AnalisishoyRadio_${stamp}.md`),
          join(dir, `analisishoyradio_${stamp}.md`),
          join(dir, `AnalisisHoy_Radio_${stamp}.md`),
        ]
      : [
          join(dir, `Analisishoy_${stamp}.md`),
          join(dir, `analisishoy_${stamp}.md`),
          join(dir, `AnalisisHoy_${stamp}.md`),
        ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  // Sin fallback a días anteriores: evita reenviar análisis viejos.
  return null;
}

/** Extrae YYYYMMDD del nombre de archivo Analisis*.md */
export function stampFromAnalisisPath(path = "") {
  const m = String(path).match(/(\d{8})(?:\.md)?$/i);
  return m ? m[1] : "";
}

function field(block, name) {
  const re = new RegExp(`-\\s*\\*\\*${name}:\\*\\*\\s*(.+)`, "i");
  const m = block.match(re);
  return m?.[1]?.trim() || "";
}

const WEEKDAYS =
  "lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo";
const MONTHS =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";

/** Nombres cortos conocidos (evita basura de archivo/stream). */
const MEDIO_ALIASES = [
  [/telemicro/i, "Telemicro"],
  [/teleantillas/i, "Teleantillas"],
  [/color\s*visi[oó]n/i, "Color Visión"],
  [/digital\s*15/i, "Digital 15"],
  [/\bcdn\b(?!\s*\d)/i, "CDN"],
  [/telesistema/i, "Telesistema"],
  [/antena\s*latina/i, "Antena Latina"],
  [/certv|canal\s*4\b/i, "CERTV"],
  [/ritmo\s*96/i, "Ritmo 96"],
  [/rumba\s*98\.?5|rumba\s*985/i, "Rumba 98.5 FM"],
  [/z\s*101|z101/i, "Z101"],
  [/esquina\s*caliente/i, "Esquina Caliente"],
  [/n\s*digital|ndigital/i, "N Digital"],
  [/list[ií]n\s*diario/i, "Listín Diario"],
  [/diario\s*libre/i, "Diario Libre"],
  [/\bel\s*caribe\b/i, "El Caribe"],
  [/\bacento\b/i, "Acento"],
];

/**
 * Limpia el medio: solo el nombre del canal/emisora (ej. "Telemicro").
 * Quita fechas, horas, .m4a, 720p, seg###, "del", etc.
 */
export function cleanMedio(raw = "") {
  let s = spanishMonthsInText(String(raw || ""))
    .replace(/_/g, " ")
    .replace(/^en\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Alias conocidos → nombre corto fijo
  for (const [re, name] of MEDIO_ALIASES) {
    if (re.test(s)) {
      return { nombre: name, fecha: "", display: name };
    }
  }

  s = s
    .replace(/\[[A-Za-z0-9_-]{6,}\]/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\bclip\s*\d+\b/gi, " ")
    .replace(/\.(m4a|mp3|mp4|wav|aac|mkv|webm)\b/gi, " ")
    .replace(/\bseg\d+\b/gi, " ")
    .replace(/\b\d{3,4}p\b/gi, " ")
    .replace(/\b\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(?:rep\.?\s*dom\.?|república\s+dominicana|republica\s+dominicana)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let fecha = "";
  let hora = "";

  // "a las 18:11" / "las 9:57 pm"
  const timeMatch = s.match(
    /\b(?:a\s+)?las\s+(\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)/i
  );
  if (timeMatch) {
    hora = timeMatch[1].replace(/\s+/g, " ").trim();
    s = s.replace(timeMatch[0], " ").replace(/\s+/g, " ").trim();
  } else {
    const parenTime = s.match(/\((\d{1,2}:\d{2}\s*[ap]\.?m\.?)/i);
    if (parenTime) {
      hora = parenTime[1].replace(/\s+/g, " ").trim();
      s = s.replace(parenTime[0], "(").replace(/\s+/g, " ").trim();
    }
  }

  // "del 03 de agosto de 2026" / "viernes 24 de julio de 2026"
  const dayMonthYear = new RegExp(
    `\\b(?:del\\s+)?(?:(${WEEKDAYS})\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS})\\s+(?:de\\s+)?(\\d{4})\\b`,
    "i"
  );
  const dmy = s.match(dayMonthYear);
  if (dmy) {
    const weekday = dmy[1] ? `${capitalizeWord(dmy[1])} ` : "";
    fecha = `${weekday}${dmy[2]} de ${capitalizeWord(dmy[3])} de ${dmy[4]}`;
    s = s.replace(dmy[0], " ").replace(/\s+/g, " ").trim();
  } else {
    const alt = s.match(
      new RegExp(`\\b((?:${MONTHS})\\s+\\d{1,2}\\s*[-–—]?\\s*\\d{4})\\b`, "i")
    );
    if (alt) {
      fecha = capitalizePhrase(alt[1].replace(/\s*[-–—]\s*/, " de ").replace(/\s+/g, " "));
      const flip = fecha.match(
        new RegExp(`^(${MONTHS})\\s+(\\d{1,2})\\s+de\\s+(\\d{4})$`, "i")
      );
      if (flip) {
        fecha = `${flip[2]} de ${capitalizeWord(flip[1])} de ${flip[3]}`;
      }
      s = s.replace(alt[0], " ").replace(/\s+/g, " ").trim();
    }
  }

  if (hora && fecha) fecha = `${fecha}, ${hora}`;
  else if (hora && !fecha) fecha = hora;

  // basura residual
  s = s
    .replace(/[()[\]]+/g, " ")
    .replace(/\s*[,;|]+\s*/g, " ")
    .replace(/\s*[-–—]+\s*/g, " ")
    .replace(/\b\d{4}\b/g, " ") // años sueltos
    .replace(/\b\d{1,2}\s+\d{1,2}\s+\d{1,2}\b/g, " ") // hh mm ss
    .replace(/\s{2,}/g, " ")
    .trim();

  // quitar preposiciones colgantes: "Telemicro del", "Digital 15 a"
  s = s
    .replace(/^(?:en|de|del|la|el|a|al|por|para)\s+/i, "")
    .replace(/\s+(?:en|de|del|la|el|a|al|por|para|am|pm)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // frecuencias sin punto: 985 → 98.5
  s = s.replace(/\b(\d{2,3})(\d)\b/g, (full, a, b) => {
    const n = Number(full);
    if (n >= 880 && n <= 1080) return `${a}.${b}`;
    return full;
  });

  // Solo el nombre del medio (sin fecha/hora en display)
  const nombre = titleCaseMedia(s);
  const display = nombre || "Medio no especificado";

  return { nombre: display, fecha, display };
}

function capitalizeWord(w = "") {
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
}

function capitalizePhrase(text = "") {
  return text
    .split(/\s+/)
    .map((w) => {
      if (/^(de|del|la|el|en|y)$/i.test(w)) return w.toLowerCase();
      return capitalizeWord(w);
    })
    .join(" ");
}

function titleCaseMedia(text = "") {
  if (!text) return "";
  const small = new Set(["de", "del", "la", "el", "en", "y", "a"]);
  const upper = new Set(["fm", "am", "tv", "rd", "cdn", "certv", "nd"]);
  return text
    .split(/\s+/)
    .map((w, i) => {
      if (/^\d+(\.\d+)?$/.test(w)) return w;
      if (upper.has(w.toLowerCase())) return w.toUpperCase();
      if (i > 0 && small.has(w.toLowerCase())) return w.toLowerCase();
      return capitalizeWord(w);
    })
    .join(" ");
}

function stripMdLink(text = "") {
  const m = text.match(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/);
  if (m) return { label: m[1] || m[2], url: m[2] };
  if (/^https?:\/\//i.test(text) && !/^No disponible/i.test(text)) {
    return { label: text, url: text };
  }
  return null;
}

function sectionBody(block) {
  const parts = {
    tema: "",
    contexto: "",
    puntos: "",
    relevancia: "",
    motivo: "",
    transcripcion: "",
  };
  const tema = block.match(/Tema principal:\s*(.+)/i);
  const contexto = block.match(/Contexto:\s*([\s\S]*?)(?=\nPuntos clave:|\nRelevancia:|\nMotivo:|\n##\s|$)/i);
  const puntos = block.match(/Puntos clave:\s*([\s\S]*?)(?=\nRelevancia:|\nMotivo:|\n##\s|$)/i);
  const relevancia = block.match(/Relevancia:\s*(.+)/i);
  const motivo =
    block.match(/Motivo:\s*([\s\S]*?)(?=\nContexto:|\nPuntos clave:|\nRelevancia:|\n##\s|$)/i) ||
    block.match(/-\s*\*\*Motivo:\*\*\s*(.+)/i);
  const transcripcion = block.match(
    /##\s*📝?\s*Transcripci[oó]n\s+Completa\s*\n+([\s\S]*?)(?=\n---|\n#\s|\n###\s|$)/i
  );

  if (tema) parts.tema = tema[1].trim();
  if (contexto) parts.contexto = contexto[1].trim().replace(/\s+/g, " ");
  if (puntos) parts.puntos = puntos[1].trim().replace(/\s+/g, " ");
  if (relevancia) parts.relevancia = relevancia[1].trim();
  if (motivo) parts.motivo = motivo[1].trim().replace(/\s+/g, " ");
  if (transcripcion) {
    parts.transcripcion = transcripcion[1]
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^["']|["']$/g, "");
  }

  // Si no hay Motivo explícito: texto tras "—" en Relevancia, o Contexto
  if (!parts.motivo && parts.relevancia) {
    const m = parts.relevancia.match(/^(.+?)\s*[—–]\s*(.+)$/);
    if (m && m[2].trim().length > 20) {
      parts.motivo = m[2].trim().replace(/^["']|["']$/g, "");
      parts.relevancia = m[1].trim(); // solo nivel (Media / Alta / …)
    }
  }
  if (!parts.motivo && parts.contexto) parts.motivo = parts.contexto;

  return parts;
}

/** Recorte de transcripción: prioriza ventana alrededor del término. */
export function excerptTranscription(text = "", term = "", maxLen = 420) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (raw.length <= maxLen) return raw;

  const lower = raw.toLowerCase();
  const needle = String(term || "").trim().toLowerCase();
  let idx = -1;
  if (needle.length >= 3) {
    idx = lower.indexOf(needle);
    // plural → singular (motoristas → motorista)
    if (idx < 0 && needle.endsWith("s") && needle.length > 4) {
      idx = lower.indexOf(needle.slice(0, -1));
    }
  }
  let start = 0;
  if (idx >= 0) {
    start = Math.max(0, idx - Math.floor(maxLen * 0.35));
  }
  let slice = raw.slice(start, start + maxLen);
  if (start > 0) {
    const sp = slice.indexOf(" ");
    if (sp > 0 && sp < 40) slice = slice.slice(sp + 1);
    slice = `…${slice}`;
  }
  if (start + maxLen < raw.length) {
    const cut = slice.lastIndexOf(" ");
    if (cut > maxLen * 0.6) slice = slice.slice(0, cut);
    slice = `${slice.trim()}…`;
  }
  return slice.trim();
}

const NEGATIVE_RE =
  /cr[ií]tica|malestar|cansad|crisis|queja|denuncia|injusticia|parcialidad|favoritismo|apagon|apagones|aumento|amenaza|rechazo|protest|fallo|falla|deterior|problem|negativ|presi[oó]n|esc[aá]ndalo|pol[eé]mica|daño|control de dañ|cansancio|dif[ií]cil|expulsi[oó]n|trato desigual|sospech|carg(a|ar) a la poblaci|sin subsid|falt(a|an)/i;

const POSITIVE_RE =
  /benefici|moderniz|mejor(a|ar)|soluci[oó]n|avance|positi|elogi|reconoc|agradec|coherencia|sin variaci[oó]n|sin aumento|no aumentar|reducci[oó]n|silencio|tranquilidad|independencia energ|financiamiento|proyectos de modernizaci[oó]n|mejorar el servicio|manten(dr[aá]n|er) sin/i;

/**
 * Clasifica el tono de la mención.
 * @returns {"positiva"|"negativa"|"neutral"}
 */
export function classifySentiment(item) {
  const text = `${item.tema || ""} ${item.contexto || ""} ${item.puntos || ""} ${item.relevancia || ""}`;
  const neg = NEGATIVE_RE.test(text);
  const pos = POSITIVE_RE.test(text);

  // Anuncios / soluciones (ej. energía solar) se cuentan como positivas
  if (/soluci[oó]n a apagones|se acabaron los apagones|plantas? (fotovoltaicas|solares)|benefici(?:o|ados)|modernizaci[oó]n/i.test(text)) {
    return "positiva";
  }

  if (/\bapagon|\bapagones\b/i.test(item.term || "")) {
    return "negativa";
  }

  if (pos && !neg) return "positiva";
  if (neg && !pos) return "negativa";
  if (pos && neg) {
    if (/benefici|moderniz|mejorar el servicio|sin variaci[oó]n|no aumentar|coherencia/i.test(text)) {
      return "positiva";
    }
    return "negativa";
  }
  return "neutral";
}

function parseSections(markdown) {
  const chunks = markdown.split(/\n(?=# 📊 ANÁLISIS COMPLETO:)/);
  const items = [];

  for (const chunk of chunks) {
    if (!/Término detectado:/i.test(chunk)) continue;
    const termMatch = chunk.match(/\*\*Término detectado:\*\*\s*\*\*([^*]+)\*\*/i);
    const term = (termMatch?.[1] || "").trim().toLowerCase();
    if (!term) continue;

    const body = sectionBody(chunk);
    const r2 = stripMdLink(field(chunk, "Video Cloudflare R2"));
    const cloudinary = stripMdLink(field(chunk, "Video Cloudinary"));
    const video = r2 || cloudinary;
    const medioClean = cleanMedio(field(chunk, "Medio"));
    const transcriptExcerpt = excerptTranscription(body.transcripcion, term);

    const base = {
      term,
      medio: medioClean.display,
      medioNombre: medioClean.nombre,
      medioFecha: medioClean.fecha,
      analyzedAt: field(chunk, "Fecha de análisis"),
      tema: body.tema,
      contexto: body.contexto,
      puntos: body.puntos,
      motivo: body.motivo,
      transcripcion: body.transcripcion,
      transcripcionExcerpt: transcriptExcerpt,
      relevancia: body.relevancia,
      videoUrl: video?.url || "",
      videoLabel: video?.label || "",
      channel: "tv",
    };
    base.tono = classifySentiment(base);
    items.push(base);
  }

  return items;
}

function radioField(block, name) {
  const re = new RegExp(`-\\s*\\*\\*${name}:\\*\\*\\s*(.+)`, "i");
  const m = block.match(re);
  return m?.[1]?.trim() || "";
}

function radioTipoRank(tipo = "") {
  if (/coinciden/i.test(tipo)) return "Alta — coincidencia directa";
  if (/tangencial/i.test(tipo)) return "Media — mención tangencial";
  return tipo || "N/D";
}

/** Parsea AnalisisHoyRadio_YYYYMMDD.md (tabla + secciones ###). */
function parseRadioSections(markdown) {
  const items = [];

  const sections = String(markdown || "").split(/\n(?=###\s+)/);
  for (const section of sections) {
    const header = section.match(
      /^###\s*(Coincidencia|Tangencial)\s*:\s*(.+?)\s*$/im
    );
    if (!header) continue;

    const tipo = header[1].trim();
    const term = header[2].trim().toLowerCase();
    if (!term) continue;

    const audio = stripMdLink(radioField(section, "Link audio"));
    const txt = stripMdLink(radioField(section, "Link TXT"));
    const medioRaw = radioField(section, "Medio");
    const medioClean = cleanMedio(medioRaw);
    const motivo = radioField(section, "Motivo");
    const contexto = radioField(section, "Contexto");
    const evidencia =
      radioField(section, "Evidencia/Transcripción") ||
      radioField(section, "Evidencia") ||
      radioField(section, "Transcripción");
    const momento =
      radioField(section, "Momento en audio") || radioField(section, "Momento");
    const hora = radioField(section, "Hora");

    const base = {
      term,
      tipo,
      medio: medioClean.display || medioRaw || "Radio",
      medioNombre: medioClean.nombre || medioRaw || "Radio",
      medioFecha: medioClean.fecha || "",
      analyzedAt: hora,
      tema: motivo || `Mención ${tipo}: ${term}`,
      contexto,
      puntos: [momento ? `Momento: ${momento}` : "", evidencia]
        .filter(Boolean)
        .join(" — "),
      relevancia: radioTipoRank(tipo),
      videoUrl: audio?.url || "",
      videoLabel: audio?.label || "Audio",
      txtUrl: txt?.url || "",
      momento,
      channel: "radio",
    };
    base.tono = classifySentiment(base);
    items.push(base);
  }

  // Filas de tabla si no hubo secciones detalladas suficientes
  if (!items.length) {
    const rowRe =
      /^\|\s*([^|]+)\|\s*(Coincidencia|Tangencial)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/gim;
    let m;
    while ((m = rowRe.exec(markdown)) !== null) {
      if (/^\s*-+\s*$/.test(m[1]) || /hora/i.test(m[1])) continue;
      const tipo = m[2].trim();
      const term = m[3].trim().toLowerCase();
      const medioRaw = m[4].trim();
      const momento = m[5].trim();
      const audio = stripMdLink(m[7].trim());
      const txt = stripMdLink(m[8].trim());
      const medioClean = cleanMedio(medioRaw);
      const base = {
        term,
        tipo,
        medio: medioClean.display || medioRaw,
        medioNombre: medioClean.nombre || medioRaw,
        medioFecha: "",
        analyzedAt: m[1].trim(),
        tema: `Mención ${tipo}: ${term}`,
        contexto: "",
        puntos: momento ? `Momento: ${momento}` : "",
        relevancia: radioTipoRank(tipo),
        videoUrl: audio?.url || "",
        videoLabel: audio?.label || "Audio",
        txtUrl: txt?.url || "",
        momento,
        channel: "radio",
      };
      base.tono = classifySentiment(base);
      items.push(base);
    }
  }

  return items;
}

/** Keywords cortos/ambiguos: solo cuentan en el campo `term`, no en el cuerpo. */
const BODY_UNSAFE_KEYWORDS = new Set([
  "pasaje",
  "pasajes",
  "eléctrica",
  "electrica",
]);

function termMatchesClient(term, client) {
  const t = String(term || "").toLowerCase().trim();
  if (!t) return false;
  return client.keywords.some((kw) => {
    const k = kw.toLowerCase();
    return t === k || t.includes(k) || k.includes(t);
  });
}

function bodyMatchesClient(item, client) {
  const hay = `${item.tema || ""} ${item.contexto || ""} ${item.puntos || ""}`.toLowerCase();
  return client.keywords.some((kw) => {
    const k = kw.toLowerCase();
    if (BODY_UNSAFE_KEYWORDS.has(k)) return false;
    return hay.includes(k);
  });
}

/**
 * Asigna ítems al cliente sin mezclar Intrant ↔ Edesur:
 * 1) Si el `term` es claramente del otro cliente → no entra.
 * 2) Si el `term` es de este cliente → entra.
 * 3) Solo entonces, keywords seguros en tema/contexto/puntos.
 */
function matchesClient(item, client) {
  const other =
    CLIENTS[client.id === "intrant" ? "edesur" : "intrant"];
  const term = item.term || "";

  if (termMatchesClient(term, other) && !termMatchesClient(term, client)) {
    return false;
  }
  if (termMatchesClient(term, client)) return true;
  return bodyMatchesClient(item, client);
}

function normalizeDedupeText(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text = "") {
  const stop = new Set([
    "el", "la", "los", "las", "de", "del", "un", "una", "unos", "unas",
    "y", "o", "en", "a", "al", "por", "para", "con", "se", "su", "sus",
    "que", "como", "sobre", "sin", "mas", "muy", "es", "son", "fue",
    "este", "esta", "estos", "estas", "hay", "the", "and", "of",
    "termino", "mencion", "segmento", "contexto",
  ]);
  return new Set(
    normalizeDedupeText(text)
      .split(" ")
      .filter((t) => t.length > 2 && !stop.has(t))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Texto que define la noticia (contenido), no el clip ni el término. */
function newsContentText(item) {
  return [
    item.tema,
    item.contexto,
    item.motivo,
    item.puntos,
    item.transcripcionExcerpt,
    item.transcripcion,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ");
}

function contentFingerprint(item) {
  const body = normalizeDedupeText(newsContentText(item)).slice(0, 220);
  return body || normalizeDedupeText(item.tema || item.term || "");
}

function transcriptText(item) {
  return normalizeDedupeText(
    item.transcripcionExcerpt || item.transcripcion || item.puntos || ""
  );
}

/**
 * Misma noticia = mismo contenido (tema/contexto/transcripción).
 * Un clip puede tener varias noticias distintas → se conservan si el contenido difiere.
 */
function itemsAreSameContent(a, b) {
  const ca = contentFingerprint(a);
  const cb = contentFingerprint(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;

  if (ca.length >= 40 && cb.length >= 40) {
    const n = Math.min(80, ca.length, cb.length);
    if (ca.slice(0, n) === cb.slice(0, n)) return true;
  }

  // Misma transcripción / evidencia → mismo contenido (aunque el término cambie)
  const txA = transcriptText(a);
  const txB = transcriptText(b);
  if (txA.length >= 50 && txB.length >= 50) {
    const txSim = jaccard(tokenSet(txA), tokenSet(txB));
    if (txSim >= 0.55) return true;
    const probe = Math.min(70, txA.length, txB.length);
    if (
      txA.includes(txB.slice(0, probe)) ||
      txB.includes(txA.slice(0, probe))
    ) {
      return true;
    }
  }

  const temaSim = jaccard(tokenSet(a.tema), tokenSet(b.tema));
  const bodySim = jaccard(tokenSet(newsContentText(a)), tokenSet(newsContentText(b)));

  const medioA = normalizeDedupeText(a.medioNombre || a.medio || "");
  const medioB = normalizeDedupeText(b.medioNombre || b.medio || "");
  const sameMedio = Boolean(medioA && medioB && medioA === medioB);

  if (sameMedio) {
    if (temaSim >= 0.4 && bodySim >= 0.35) return true;
    if (bodySim >= 0.5) return true;
  }

  if (temaSim >= 0.55 && bodySim >= 0.5) return true;
  if (bodySim >= 0.65) return true;

  const ta = normalizeDedupeText(a.tema);
  const tb = normalizeDedupeText(b.tema);
  if (ta.length >= 25 && tb.length >= 25) {
    if ((ta.includes(tb) || tb.includes(ta)) && bodySim >= 0.4) return true;
  }

  return false;
}

function preferNewsItem(a, b) {
  const rank = (x) => relevanceRank(x.relevancia);
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? a : b;
  return newsContentText(a).length >= newsContentText(b).length ? a : b;
}

/** No repetir el mismo contenido; clips con varias noticias distintas se conservan. */
function dedupeItems(items) {
  const out = [];
  for (const item of items) {
    const dupIdx = out.findIndex((prev) => itemsAreSameContent(prev, item));
    if (dupIdx >= 0) {
      out[dupIdx] = preferNewsItem(out[dupIdx], item);
      continue;
    }
    out.push(item);
  }
  return out;
}

function relevanceRank(text = "") {
  if (/^alta/i.test(text)) return 0;
  if (/^media/i.test(text)) return 1;
  if (/^baja/i.test(text)) return 2;
  return 3;
}

export function loadAnalisisHoy(date = new Date(), channel = "tv") {
  const ch = resolveChannel(channel);
  const path = resolveAnalisisHoyPath(date, ch.id);
  if (!path) {
    const hint =
      ch.id === "radio"
        ? `AnalisisHoyRadio_${todayStamp(date)}.md`
        : `Analisishoy_${todayStamp(date)}.md`;
    throw new Error(`No encontré ${hint} en ${config.informes.dir}`);
  }
  const markdown = readFileSync(path, "utf8");
  const items =
    ch.id === "radio" ? parseRadioSections(markdown) : parseSections(markdown);
  return {
    path,
    date,
    channel: ch.id,
    monitorLabel: ch.label,
    displayDate: formatDisplayDate(date),
    stamp: todayStamp(date),
    items,
  };
}

export function filterForClient(analisis, clientId, channel) {
  const ch = resolveChannel(channel || analisis.channel || "tv");
  const client = clientForChannel(clientId, ch.id);

  const matched = dedupeItems(
    analisis.items.filter((item) => matchesClient(item, client))
  ).sort((a, b) => relevanceRank(a.relevancia) - relevanceRank(b.relevancia));

  return { client, items: matched };
}

export { CLIENTS, todayStamp, formatDisplayDate };
