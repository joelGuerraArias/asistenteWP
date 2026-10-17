/**
 * Encuestas temáticas (markdown + fotos/ + tarjeta ALPHA).
 * Estado propio: .encuestas-tema-sent.json (no mezcla con TXT de personas).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { config } from "./config.mjs";

const TEMA_STATE_FILE = join(config.root, ".encuestas-tema-sent.json");
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function slugifyName(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/gi, "c")
    .replace(/ñ/gi, "n")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

const THEME_RULES = [
  {
    id: "carolina",
    stems: ["carolina-mejia-secretaria-general-del-prm", "carolina-mejia"],
    test: (t) => /carolina\s+mej[ií]a/i.test(t),
  },
  {
    id: "collado",
    stems: ["david-collado"],
    test: (t) => /david\s+collado|collado/i.test(t),
  },
  {
    id: "prm",
    stems: ["prm"],
    test: (t) => /\bprm\b|partido\s+revolucionario\s+moderno/i.test(t),
  },
  {
    id: "abinader",
    stems: ["abinader", "abinader2", "abiander3", "abinader-3"],
    test: (t) => /abinader|presiden|gobierno\s+de\s+luis/i.test(t),
  },
  {
    id: "gobierno",
    stems: ["gobierno"],
    test: (t) => /gobierno|funcionari|ministr|corrupci|pensiones|veh[ií]culos\s+de\s+lujo/i.test(t),
  },
  {
    id: "policia",
    stems: ["policia"],
    test: (t) => /polic[ií]a|patrullaje|reforma\s+policial|«?29»?|poner\s+en\s+29/i.test(t),
  },
  {
    id: "delincuencia",
    stems: ["delincuencia"],
    test: (t) => /delincuencia|violencia|seguridad|robos|narcotr[aá]fico|extorsi[oó]n/i.test(t),
  },
  {
    id: "apagones",
    stems: ["apagones", "apagones2"],
    test: (t) => /apagones|el[eé]ctric|luz\b|servicio\s+el[eé]ctrico/i.test(t),
  },
  {
    id: "agua",
    stems: ["agua"],
    test: (t) => /\bagua\b/i.test(t),
  },
  {
    id: "educacion",
    stems: ["educacion"],
    test: (t) => /educaci[oó]n|escuelas?/i.test(t),
  },
  {
    id: "obras",
    stems: ["obras", "obras2"],
    test: (t) => /obras?\s+p[uú]blic|calles|drenaje|hospital|infraestructura|transporte\s+p[uú]blico/i.test(t),
  },
  {
    id: "salario",
    stems: ["salario"],
    test: (t) => /salario|sueldo|poder\s+adquisitivo|aumento\s+salarial/i.test(t),
  },
  {
    id: "economia",
    stems: ["economia", "gasto"],
    test: (t) => /econom[ií]a|impuestos|alimentos|bolsillo|desempleo|deudas|alquiler/i.test(t),
  },
  {
    id: "familia",
    stems: ["familia", "familia2"],
    test: (t) => /familia|desintegraci[oó]n\s+familiar|hogares?/i.test(t),
  },
  {
    id: "migracion",
    stems: ["migracion", "migracion2"],
    test: (t) => /migrat|fronter|hait/i.test(t),
  },
  {
    id: "candidatos",
    stems: ["candidatos"],
    test: (t) => /elecciones|candidato|2028|leonel|raquel\s+pe[nñ]a|presidencia/i.test(t),
  },
];

function encuestasDir() {
  return config.encuestas?.dir || join(config.root, "encuestas");
}

function fotosDir() {
  return join(encuestasDir(), "fotos");
}

export function loadTemaState() {
  if (!existsSync(TEMA_STATE_FILE)) return { sent: {}, themeCursor: {} };
  try {
    const data = JSON.parse(readFileSync(TEMA_STATE_FILE, "utf8"));
    return {
      sent: data.sent && typeof data.sent === "object" ? data.sent : {},
      themeCursor:
        data.themeCursor && typeof data.themeCursor === "object" ? data.themeCursor : {},
    };
  } catch {
    return { sent: {}, themeCursor: {} };
  }
}

export function saveTemaState(state) {
  writeFileSync(TEMA_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function resetTemaState() {
  const empty = { sent: {}, themeCursor: {} };
  saveTemaState(empty);
  return empty;
}

function listThemeImages(dir = fotosDir()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
    .map((f) => ({
      file: f,
      path: join(dir, f),
      stem: slugifyName(basename(f, extname(f))),
    }));
}

function findMdFile(dir = encuestasDir()) {
  const preferred = [
    "68_encuestas_gobierno_dominicano.md",
    "encuestas-tema.md",
    "encuestas.md",
  ];
  for (const name of preferred) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".md") && !f.toLowerCase().includes("readme"))
    .sort();
  return files.length ? join(dir, files[0]) : null;
}

/**
 * Parsea markdown tipo 68_encuestas_gobierno_dominicano.md
 */
export function parseEncuestasTemaMd(raw = "") {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const seriesTitle =
    text.match(/^#\s+(.+)$/m)?.[1]?.replace(/🇩🇴/g, "").trim() ||
    "Encuestas gobierno dominicano";

  const items = [];
  let section = "";
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(/^##\s+\d+\.\s+(.+)$/);
    if (sec) {
      section = sec[1].trim();
      continue;
    }
    const qm = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*\s*$/);
    if (!qm) continue;
    const number = Number(qm[1]);
    const question = qm[2].trim();
    let optionsLine = "";
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (/^[A-Z]\)/.test(lines[j].trim())) {
        optionsLine = lines[j].trim();
        break;
      }
      if (/^\d+\.\s+\*\*/.test(lines[j]) || /^##\s+/.test(lines[j])) break;
    }
    const options = optionsLine
      ? optionsLine
          .split(/\s*·\s*/)
          .map((part) => part.replace(/^[A-Z]\)\s*/, "").trim())
          .filter(Boolean)
      : ["Sí", "No"];

    items.push({
      id: `tema-${number}-${slugifyName(question).slice(0, 48)}`,
      number,
      kind: "tema",
      name: `Encuesta ${number}`,
      section,
      question,
      title: question,
      options,
      seriesTitle,
      bodyText: [question, "", options.map((o, idx) => `${String.fromCharCode(65 + idx)}) ${o}`).join(" · ")].join(
        "\n"
      ),
      scale: options.join(" · "),
    });
  }

  return { seriesTitle, items };
}

function matchThemeId(item) {
  const blob = `${item.section || ""}\n${item.question || ""}\n${(item.options || []).join(" ")}`;
  for (const rule of THEME_RULES) {
    if (rule.test(blob)) return rule;
  }
  return THEME_RULES.find((r) => r.id === "gobierno") || THEME_RULES[0];
}

export function resolveThemeImage(item, images, themeCursor = {}) {
  if (!images?.length) return null;
  const rule = matchThemeId(item);
  const pool = images.filter((img) =>
    rule.stems.some(
      (stem) =>
        img.stem === stem ||
        img.stem.startsWith(`${stem}-`) ||
        img.stem.includes(stem)
    )
  );
  const list = pool.length ? pool : images;
  const key = rule.id;
  const idx = Number(themeCursor[key] || 0) % list.length;
  return { image: list[idx], themeId: key, nextCursor: (idx + 1) % list.length };
}

/**
 * Carga cola temática pendiente (MD + fotos/).
 */
export function loadPendingEncuestasTema({ force = false, onlyId = "" } = {}) {
  const dir = encuestasDir();
  const mdPath = findMdFile(dir);
  if (!mdPath) {
    throw new Error(`No hay markdown de encuestas temáticas en ${dir}`);
  }
  const raw = readFileSync(mdPath, "utf8");
  const parsed = parseEncuestasTemaMd(raw);
  const images = listThemeImages(fotosDir());
  const state = loadTemaState();

  let items = parsed.items.slice().sort((a, b) => a.number - b.number);
  if (!force) {
    items = items.filter((it) => !state.sent[it.id]);
  }
  if (onlyId) {
    items = items.filter((it) => it.id === onlyId || String(it.number) === String(onlyId));
  }

  const cursor = { ...(state.themeCursor || {}) };
  items = items.map((item) => {
    const resolved = resolveThemeImage(item, images, cursor);
    if (resolved) {
      cursor[resolved.themeId] = resolved.nextCursor;
      return {
        ...item,
        image: resolved.image,
        themeId: resolved.themeId,
      };
    }
    return { ...item, image: null, themeId: null };
  });

  return {
    mdPath,
    seriesTitle: parsed.seriesTitle,
    allCount: parsed.items.length,
    items,
    images,
    state,
  };
}
