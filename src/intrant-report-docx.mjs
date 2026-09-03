/**
 * REPORTE Intrant en Word (.docx): portada Méndez + brief ejecutivo del correo.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import sharp from "sharp";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { buildExecutiveStats } from "./intrant-report-pdf.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MENDEZ_PHOTO = join(ROOT, "assets", "mendez.jpg");

const NAVY = "0B1F3A";
const NAVY_MID = "123056";
const GREEN = "15803D";
const GREEN_BG = "DCFCE7";
const ORANGE = "B45309";
const ORANGE_BG = "FEF3C7";
const RED = "B91C1C";
const RED_BG = "FEE2E2";
const MUTE = "64748B";
const INK = "0F172A";
const LINE = "E2E8F0";
const WHITE = "FFFFFF";
const PAGE_BG = "F8FAFC";

const THIN = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: WHITE };
const borders = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const noBorders = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

function stampDateTime(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return { dateStamp: `${y}${m}${d}`, timeStamp: `${hh}${mm}${ss}` };
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function semaforoFromStats(stats) {
  if (stats.net < -2 || (stats.bySentiment.negativo || 0) >= (stats.total || 1) * 0.55) {
    return { label: "Riesgo", color: RED, bg: RED_BG };
  }
  if (stats.net > 2) {
    return { label: "Favorable", color: GREEN, bg: GREEN_BG };
  }
  return { label: "Atención", color: ORANGE, bg: ORANGE_BG };
}

function extractPanorama(md = "") {
  const m = String(md).match(/\*\*Panorama general:\*\*\s*(.+?)(?:\n\n|\n---|\n## )/s);
  if (m) return m[1].replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const m2 = String(md).match(/Panorama general[:\s]+(.+?)(?:\n\n|\n---|\n## )/s);
  if (m2) return m2[1].replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return "";
}

function bodyMarkdown(md = "") {
  let t = String(md).replace(/\r\n/g, "\n").trim();
  t = t.replace(/^#\s+REPORTE EJECUTIVO[^\n]*\n+/i, "");
  t = t.replace(/^\*\*Institución:\*\*[^\n]*\n+/i, "");
  t = t.replace(/^\*\*Fecha del monitoreo:\*\*[^\n]*\n+/i, "");
  t = t.replace(/^\*\*Período analizado:\*\*[^\n]*\n+/i, "");
  t = t.replace(/^\*\*Total de menciones:\*\*[^\n]*\n+/i, "");
  t = t.replace(/^\*\*Plataformas monitoreadas:\*\*[^\n]*\n+/i, "");
  t = t.replace(/^\*\*Panorama general:\*\*[^\n]*\n+/i, "");
  t = t.replace(/^Institución:[^\n]*\n+/i, "");
  t = t.replace(/^---\n+/g, "");
  return t.trim();
}

function stripMd(s = "") {
  return String(s)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function isTableSep(line) {
  const t = line.trim();
  return /^(\|\s*:?-{3,}\s*)+\|?$/.test(t) || /^\|?\s*-{3,}/.test(t);
}

function parseTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => stripMd(c.trim()));
}

function cellTone(text = "") {
  const t = text.toLowerCase();
  if (/favor|positiv|🟢/.test(t)) return { fill: GREEN_BG, color: GREEN };
  if (/cr[ií]tic|negativ|riesgo|🔴/.test(t)) return { fill: RED_BG, color: RED };
  if (/neut|atenci|🟡/.test(t)) return { fill: ORANGE_BG, color: ORANGE };
  if (/^alto$|^alta$/.test(t.trim())) return { fill: RED_BG, color: RED };
  if (/^medio$|^media$/.test(t.trim())) return { fill: "FFEDD5", color: "C2410C" };
  if (/^bajo$|^baja$/.test(t.trim())) return { fill: "DBEAFE", color: "1D4ED8" };
  return null;
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: opts.line ?? 276 },
    alignment: opts.align,
    children: [
      new TextRun({
        text: String(text ?? ""),
        bold: opts.bold,
        size: opts.size ?? 20,
        font: "Calibri",
        color: opts.color ?? INK,
      }),
    ],
  });
}

function heading(text, level = HeadingLevel.HEADING_2) {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text: stripMd(text),
        bold: true,
        font: "Calibri",
        color: NAVY,
        size: level === HeadingLevel.HEADING_1 ? 28 : level === HeadingLevel.HEADING_2 ? 24 : 22,
      }),
    ],
  });
}

function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [
      new TextRun({ text: stripMd(text), font: "Calibri", size: 20, color: INK }),
    ],
  });
}

function kpiCell(value, label, fill) {
  return new TableCell({
    width: { size: 1800, type: WidthType.DXA },
    borders: noBorders,
    shading: { type: ShadingType.CLEAR, fill },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: String(value), bold: true, size: 28, font: "Calibri", color: WHITE }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: label, size: 14, font: "Calibri", color: "CBD5E1" }),
        ],
      }),
    ],
  });
}

function mdTable(rows) {
  if (!rows.length) return [];
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const colW = Math.floor(9000 / cols);
  const tableRows = rows.map((cells, ri) => {
    const padded = [...cells];
    while (padded.length < cols) padded.push("");
    return new TableRow({
      children: padded.map((cell) => {
        const tone = ri > 0 ? cellTone(cell) : null;
        const fill = ri === 0 ? NAVY : tone?.fill || (ri % 2 ? PAGE_BG : WHITE);
        const color = ri === 0 ? WHITE : tone?.color || INK;
        return new TableCell({
          width: { size: colW, type: WidthType.DXA },
          borders,
          shading: { type: ShadingType.CLEAR, fill },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: cell,
                  bold: ri === 0 || Boolean(tone),
                  size: 16,
                  font: "Calibri",
                  color,
                }),
              ],
            }),
          ],
        });
      }),
    });
  });
  return [
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      columnWidths: Array(cols).fill(colW),
      rows: tableRows,
    }),
    p("", { after: 80 }),
  ];
}

function semaforoBox(paragraphs = [], kind = "atencion") {
  const map = {
    riesgo: { fill: RED_BG, title: "SEMÁFORO · RIESGO REPUTACIONAL", titleFill: RED },
    favorable: { fill: GREEN_BG, title: "SEMÁFORO · FAVORABLE", titleFill: GREEN },
    atencion: { fill: ORANGE_BG, title: "SEMÁFORO · ATENCIÓN", titleFill: ORANGE },
  };
  const cfg = map[kind] || map.atencion;
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [9000],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders,
            shading: { type: ShadingType.CLEAR, fill: cfg.titleFill },
            width: { size: 9000, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: cfg.title,
                    bold: true,
                    color: WHITE,
                    size: 20,
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            borders,
            shading: { type: ShadingType.CLEAR, fill: cfg.fill },
            width: { size: 9000, type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: paragraphs.length
              ? paragraphs
              : [p("Sin justificación en el brief.", { size: 20 })],
          }),
        ],
      }),
    ],
  });
}

function detectSemaforoKind(text = "") {
  if (/🔴|riesgo reputacional/i.test(text)) return "riesgo";
  if (/🟡|atenci[oó]n/i.test(text)) return "atencion";
  if (/🟢|favorable/i.test(text)) return "favorable";
  return "atencion";
}

function markdownToDocxChildren(md = "") {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let inSemaforo = false;
  let semaforoParas = [];
  let semaforoText = "";

  const flushSemaforo = () => {
    if (!inSemaforo) return;
    out.push(semaforoBox(semaforoParas, detectSemaforoKind(semaforoText)));
    out.push(p("", { after: 80 }));
    inSemaforo = false;
    semaforoParas = [];
    semaforoText = "";
  };

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed || trimmed === "---") {
      if (inSemaforo && trimmed === "---") flushSemaforo();
      i += 1;
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.includes("|")) {
      flushSemaforo();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        if (!isTableSep(row)) rows.push(parseTableRow(row));
        i += 1;
      }
      out.push(...mdTable(rows));
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushSemaforo();
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.replace(/^#{1,3}\s+/, "");
      if (/sem[aá]foro/i.test(text)) {
        inSemaforo = true;
        semaforoParas = [];
        semaforoText = text;
        i += 1;
        continue;
      }
      const hl =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      out.push(heading(text, hl));
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (inSemaforo) {
        const t = stripMd(trimmed.replace(/^[-*]\s+/, ""));
        semaforoParas.push(bullet(t));
        semaforoText += ` ${t}`;
      } else {
        out.push(bullet(trimmed.replace(/^[-*]\s+/, "")));
      }
      i += 1;
      continue;
    }

    const plain = stripMd(trimmed);
    if (inSemaforo) {
      semaforoParas.push(p(plain, { size: 20, after: 80 }));
      semaforoText += ` ${plain}`;
      i += 1;
      continue;
    }

    const isLabel =
      /^(ACCIÓN|JUSTIFICACIÓN|PRIORIDAD|Descripción|Origen|Tono|Nivel de impacto|Implicación|Fuente|Autor|Resumen|Relevancia|Enlace)\s*:/i.test(
        plain
      );
    out.push(
      p(plain, {
        bold: isLabel,
        color: isLabel ? NAVY : INK,
        size: 20,
        after: 100,
      })
    );
    i += 1;
  }
  flushSemaforo();
  return out;
}

async function loadPortraitBytes() {
  if (!existsSync(MENDEZ_PHOTO)) return null;
  return sharp(MENDEZ_PHOTO)
    .resize(220, 220, { fit: "cover", position: "top" })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function buildHeaderChildren({ displayDate, stats, panorama, portrait }) {
  const sem = semaforoFromStats(stats);
  const kids = [];

  const photoCellChildren = [];
  if (portrait) {
    photoCellChildren.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: "jpg",
            data: portrait,
            transformation: { width: 90, height: 90 },
            altText: { title: "Méndez", description: "Juan Manuel Méndez", name: "mendez" },
          }),
        ],
      })
    );
  }

  photoCellChildren.push(
    new Paragraph({
      spacing: { before: 80 },
      children: [
        new TextRun({
          text: "INTRANT · INTELIGENCIA REPUTACIONAL",
          size: 14,
          font: "Calibri",
          color: "93C5FD",
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Juan Manuel Méndez",
          bold: true,
          size: 28,
          font: "Calibri",
          color: WHITE,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Director ejecutivo",
          size: 16,
          font: "Calibri",
          color: "CBD5E1",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: displayDate, size: 16, font: "Calibri", color: "94A3B8" }),
      ],
    })
  );

  kids.push(
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      columnWidths: [3600, 5400],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 3600, type: WidthType.DXA },
              borders: noBorders,
              shading: { type: ShadingType.CLEAR, fill: NAVY },
              margins: { top: 140, bottom: 140, left: 140, right: 100 },
              verticalAlign: VerticalAlign.CENTER,
              children: photoCellChildren,
            }),
            new TableCell({
              width: { size: 5400, type: WidthType.DXA },
              borders: noBorders,
              shading: { type: ShadingType.CLEAR, fill: NAVY },
              margins: { top: 140, bottom: 140, left: 80, right: 140 },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  spacing: { after: 120 },
                  children: [
                    new TextRun({
                      text: "Reporte ejecutivo de monitoreo, reputación y conversación digital",
                      bold: true,
                      size: 22,
                      font: "Calibri",
                      color: WHITE,
                    }),
                  ],
                }),
                new Table({
                  width: { size: 5000, type: WidthType.DXA },
                  columnWidths: [1250, 1250, 1250, 1250],
                  rows: [
                    new TableRow({
                      children: [
                        kpiCell(sem.label, "Semáforo", NAVY_MID),
                        kpiCell(stats.total, "Menciones", "B91C1C"),
                        kpiCell(stats.byGroup.prensa || 0, "Medios", "1D4ED8"),
                        kpiCell(
                          (stats.byGroup.redes || 0) + (stats.byGroup.video || 0),
                          "Redes / video",
                          "7C3AED"
                        ),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  if (panorama) {
    kids.push(
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        columnWidths: [9000],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                shading: { type: ShadingType.CLEAR, fill: NAVY_MID },
                width: { size: 9000, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 140, right: 140 },
                children: [
                  p(panorama, { size: 17, color: "CBD5E1", after: 0 }),
                ],
              }),
            ],
          }),
        ],
      })
    );
  }

  kids.push(p("", { after: 160 }));
  kids.push(
    heading(
      "REPORTE EJECUTIVO DE MONITOREO, REPUTACIÓN Y CONVERSACIÓN DIGITAL",
      HeadingLevel.HEADING_1
    )
  );
  return kids;
}

/**
 * @returns {Promise<{ path: string, filename: string, stats: object }>}
 */
export async function writeReporteDocx({
  items = [],
  displayDate,
  outDir = config.informes.dir,
  now = new Date(),
  executiveMarkdown = "",
} = {}) {
  ensureDir(outDir);
  const { dateStamp, timeStamp } = stampDateTime(now);
  const filename = `REPORTE_INTRANT_${dateStamp}_${timeStamp}.docx`;
  const path = join(outDir, filename);
  const stats = buildExecutiveStats(items);
  const panorama = extractPanorama(executiveMarkdown);
  const briefBody = bodyMarkdown(executiveMarkdown);
  const portrait = await loadPortraitBytes();

  const children = [
    ...(await buildHeaderChildren({ displayDate, stats, panorama, portrait })),
    ...markdownToDocxChildren(briefBody),
    p(""),
    p("Asistente Virtual INTRANT · Uso Departamento de Comunicaciones", {
      size: 14,
      color: MUTE,
      align: AlignmentType.CENTER,
      after: 0,
    }),
  ];

  const doc = new Document({
    creator: "Asistente Virtual INTRANT",
    title: `REPORTE Ejecutivo INTRANT — ${displayDate}`,
    description: "Monitoreo, reputación y conversación digital",
    styles: {
      default: {
        document: {
          styles: [
            {
              id: "Normal",
              run: { font: "Calibri", size: 20, color: INK },
            },
          ],
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(path, buffer);
  return { path, filename, stats };
}
