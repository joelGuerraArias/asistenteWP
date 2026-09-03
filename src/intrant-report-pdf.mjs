/**
 * PDF ejecutivo INTRANT: header (foto + KPIs) + mismo brief del correo.
 * Layout cuidadoso: textos en posición absoluta NO deben avanzar el flujo
 * (eso generaba páginas en blanco con PDFKit).
 */
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MENDEZ_PHOTO = join(ROOT, "assets", "mendez.jpg");

const C = {
  navy: "#0B1F3A",
  navyMid: "#123056",
  ink: "#0F172A",
  mute: "#64748B",
  line: "#E2E8F0",
  page: "#FFFFFF",
  green: "#16A34A",
  greenBg: "#DCFCE7",
  orange: "#D97706",
  orangeBg: "#FEF3C7",
  red: "#DC2626",
  white: "#FFFFFF",
};

/** Canales ejecutivos — nunca jerga interna. */
export const CHANNEL_META = {
  gmail: { label: "Medios digitales", group: "prensa" },
  x: { label: "X", group: "redes" },
  youtube: { label: "YouTube", group: "video" },
  instagram: { label: "Instagram", group: "redes" },
  facebook: { label: "Facebook", group: "redes" },
  tv: { label: "Televisión", group: "broadcast" },
  radio: { label: "Radio", group: "broadcast" },
};

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

function hay(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function inferSentiment(it = {}) {
  const t = hay(`${it.title || ""} ${it.summary || ""} ${it.medio || ""}`);
  if (
    /critica|escandalo|denuncia|caos|corrupcion|rechazo|protesta|falla grave|indign|pol[eé]mica|recurso contra|rompe el silencio/.test(
      t
    )
  ) {
    return "negativo";
  }
  if (
    /avanza|coordina|mejora|logro|reconoc|inaugur|planifica|educacion vial|favorable|exito|alianza|compromiso|avances/.test(
      t
    )
  ) {
    return "positivo";
  }
  return "neutro";
}

function channelLabel(source) {
  return CHANNEL_META[source]?.label || "Medio";
}

function enrichItems(items = []) {
  return items.map((it) => {
    const sentiment = inferSentiment(it);
    return {
      ...it,
      sentiment,
      channel: channelLabel(it.source),
      group: CHANNEL_META[it.source]?.group || "prensa",
    };
  });
}

export function buildExecutiveStats(items = []) {
  const enriched = enrichItems(items);
  const bySentiment = { positivo: 0, neutro: 0, negativo: 0 };
  const byGroup = { prensa: 0, redes: 0, video: 0, broadcast: 0 };
  const byChannel = {};
  for (const it of enriched) {
    bySentiment[it.sentiment] = (bySentiment[it.sentiment] || 0) + 1;
    byGroup[it.group] = (byGroup[it.group] || 0) + 1;
    byChannel[it.channel] = (byChannel[it.channel] || 0) + 1;
  }
  const net = bySentiment.positivo - bySentiment.negativo;
  return { enriched, bySentiment, byGroup, byChannel, net, total: enriched.length };
}

function semaforoFromStats(stats) {
  if (stats.net < -2 || (stats.bySentiment.negativo || 0) >= (stats.total || 1) * 0.55) {
    return { emoji: "🔴", label: "Riesgo", color: C.red, bg: "#FEE2E2" };
  }
  if (stats.net > 2) {
    return { emoji: "🟢", label: "Favorable", color: C.green, bg: C.greenBg };
  }
  return { emoji: "🟡", label: "Atención", color: C.orange, bg: C.orangeBg };
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

async function loadPortraitPng() {
  if (!existsSync(MENDEZ_PHOTO)) return null;
  const size = 220;
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  return sharp(MENDEZ_PHOTO)
    .resize(size, size, { fit: "cover", position: "top" })
    .composite([{ input: circle, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Dibuja texto en (x,y) sin mover el cursor ni crear páginas nuevas. */
function paint(doc, str, x, y, opts = {}) {
  const y0 = doc.y;
  const x0 = doc.x;
  const pagesBefore = doc.bufferedPageRange().count;
  const pageIndex = pagesBefore - 1;
  doc.text(String(str ?? ""), x, y, {
    width: opts.width,
    align: opts.align,
    ellipsis: true,
    lineBreak: false, // una línea: no salta de página
    height: opts.height,
  });
  // Si PDFKit igual creó página, volver
  const pagesAfter = doc.bufferedPageRange().count;
  if (pagesAfter > pagesBefore) {
    doc.switchToPage(pageIndex);
  }
  doc.x = x0;
  doc.y = y0;
}

function drawKpi(doc, x, y, w, h, value, label) {
  doc.roundedRect(x, y, w, h, 8).fill(C.navyMid);
  doc.fillColor(C.white).font("Helvetica-Bold").fontSize(16);
  paint(doc, String(value), x + 10, y + 12, { width: w - 20 });
  doc.fillColor("#94A3B8").font("Helvetica").fontSize(8);
  paint(doc, String(label), x + 10, y + 36, { width: w - 20 });
}

function ensureSpace(doc, need, marginBottom = 56) {
  if (doc.y + need <= doc.page.height - marginBottom) return;
  doc.addPage();
  doc.x = doc.page.margins.left;
  doc.y = doc.page.margins.top;
}

function stripMd(s = "") {
  return String(s)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function parseTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => stripMd(c.trim()));
}

function isTableSep(line) {
  const t = line.trim();
  return /^(\|\s*:?-{3,}\s*)+\|?$/.test(t) || /^\|?\s*-{3,}/.test(t);
}

function renderTable(doc, rows, left, contentW) {
  if (!rows.length) return;
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const colW = contentW / cols;
  const pad = 4;
  const rowH = 18;

  for (let ri = 0; ri < rows.length; ri++) {
    const cells = rows[ri];
    ensureSpace(doc, rowH + 4);
    const y0 = doc.y;
    for (let ci = 0; ci < cols; ci++) {
      const x = left + ci * colW;
      const cell = cells[ci] || "";
      if (ri === 0) {
        doc.rect(x, y0, colW, rowH).fill(C.navy);
        doc.fillColor(C.white).font("Helvetica-Bold").fontSize(7.5);
      } else {
        doc.rect(x, y0, colW, rowH).fill(ri % 2 ? "#F8FAFC" : C.white);
        doc.strokeColor(C.line).lineWidth(0.4).rect(x, y0, colW, rowH).stroke();
        doc.fillColor(C.ink).font("Helvetica").fontSize(7.5);
      }
      paint(doc, cell, x + pad, y0 + 5, { width: colW - pad * 2 });
    }
    doc.y = y0 + rowH;
  }
  doc.moveDown(0.15);
}

function flowText(doc, str, { left, contentW, font = "Helvetica", size = 9.5, color = "#334155", align = "left" }) {
  // Solo exigir espacio para 1 línea; el wrap lo maneja PDFKit
  ensureSpace(doc, size * 1.4 + 2);
  doc.fillColor(color).font(font).fontSize(size);
  doc.text(str, left, doc.y, {
    width: contentW,
    align,
    lineGap: 1,
  });
}

function renderMarkdownPdf(doc, md, { left, contentW }) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let blankRun = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed || trimmed === "---") {
      blankRun += 1;
      if (blankRun === 1) doc.moveDown(0.15);
      i += 1;
      continue;
    }
    blankRun = 0;

    if (trimmed.startsWith("|") && trimmed.includes("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        if (!isTableSep(row)) rows.push(parseTableRow(row));
        i += 1;
      }
      renderTable(doc, rows, left, contentW);
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const level = trimmed.match(/^#+/)[0].length;
      const text = stripMd(trimmed.replace(/^#{1,3}\s+/, ""));
      ensureSpace(doc, 26);
      doc.moveDown(level === 1 ? 0.35 : 0.25);
      flowText(doc, text, {
        left,
        contentW,
        font: "Helvetica-Bold",
        size: level === 1 ? 12 : level === 2 ? 11 : 10,
        color: C.navy,
      });
      const lineY = doc.y + 1;
      if (lineY < doc.page.height - 56) {
        doc
          .moveTo(left, lineY)
          .lineTo(left + contentW, lineY)
          .strokeColor(C.line)
          .lineWidth(0.5)
          .stroke();
        doc.y = lineY + 6;
      }
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flowText(doc, `•  ${stripMd(trimmed.replace(/^[-*]\s+/, ""))}`, {
        left: left + 4,
        contentW: contentW - 4,
        size: 9.5,
        color: C.ink,
      });
      i += 1;
      continue;
    }

    const plain = stripMd(trimmed);
    const isLabel =
      /^(ACCIÓN|JUSTIFICACIÓN|PRIORIDAD|Descripción|Origen|Tono|Nivel de impacto|Implicación|Fuente|Autor|Resumen|Relevancia|Enlace)\s*:/i.test(
        plain
      );
    flowText(doc, plain, {
      left,
      contentW,
      font: isLabel ? "Helvetica-Bold" : "Helvetica",
      size: 9.5,
      color: isLabel ? C.navy : "#334155",
      align: isLabel ? "left" : "justify",
    });
    i += 1;
  }
}

export async function writeReportePdf({
  items = [],
  bySource = {},
  displayDate,
  dateYmd,
  outDir = config.informes.dir,
  now = new Date(),
  executiveMarkdown = "",
}) {
  ensureDir(outDir);
  const { dateStamp, timeStamp } = stampDateTime(now);
  const filename = `REPORTE_INTRANT_${dateStamp}_${timeStamp}.pdf`;
  const path = join(outDir, filename);
  const stats = buildExecutiveStats(items);
  const portrait = await loadPortraitPng();
  const sem = semaforoFromStats(stats);
  const panorama = extractPanorama(executiveMarkdown);
  const briefBody = bodyMarkdown(executiveMarkdown);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 42,
      size: "LETTER",
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `REPORTE Ejecutivo INTRANT — ${displayDate}`,
        Author: "Asistente Virtual INTRANT",
        Subject: "Monitoreo, reputación y conversación digital",
      },
    });
    const stream = createWriteStream(path);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);

    const pageW = doc.page.width;
    const left = 42;
    const contentW = pageW - 84;
    const flowStart = doc.y;

    // —— Header (todo con paint / sin avanzar flujo) ——
    const headerH = panorama ? 148 : 112;
    doc.roundedRect(left, 28, contentW, headerH, 12).fill(C.navy);

    const photoSize = 70;
    const photoX = left + 16;
    const photoY = 40;
    if (portrait) {
      doc.save();
      doc.circle(photoX + photoSize / 2, photoY + photoSize / 2, photoSize / 2).clip();
      doc.image(portrait, photoX, photoY, { width: photoSize, height: photoSize });
      doc.restore();
      doc
        .circle(photoX + photoSize / 2, photoY + photoSize / 2, photoSize / 2)
        .lineWidth(1.5)
        .strokeColor("#E2E8F0")
        .stroke();
    }

    const textX = photoX + photoSize + 14;
    doc.fillColor("#94A3B8").font("Helvetica").fontSize(7.5);
    paint(doc, "INTRANT · INTELIGENCIA REPUTACIONAL", textX, 42, { lineBreak: false });
    doc.fillColor(C.white).font("Helvetica-Bold").fontSize(14);
    paint(doc, "Juan Manuel Méndez", textX, 54, { width: 190, lineBreak: false });
    doc.fillColor("#CBD5E1").font("Helvetica").fontSize(8);
    paint(doc, "Director ejecutivo", textX, 72, { lineBreak: false });
    doc.fillColor("#94A3B8").fontSize(8);
    paint(doc, displayDate, textX, 86, { lineBreak: false });

    const kpiW = 68;
    const kpiH = 54;
    const kpiGap = 7;
    const kpiStart = left + contentW - 16 - (kpiW * 4 + kpiGap * 3);
    const kpiY = 42;
    drawKpi(doc, kpiStart, kpiY, kpiW, kpiH, sem.label, "Semáforo");
    drawKpi(doc, kpiStart + (kpiW + kpiGap), kpiY, kpiW, kpiH, stats.total, "Menciones");
    drawKpi(
      doc,
      kpiStart + (kpiW + kpiGap) * 2,
      kpiY,
      kpiW,
      kpiH,
      stats.byGroup.prensa || 0,
      "Medios"
    );
    drawKpi(
      doc,
      kpiStart + (kpiW + kpiGap) * 3,
      kpiY,
      kpiW,
      kpiH,
      (stats.byGroup.redes || 0) + (stats.byGroup.video || 0),
      "Redes / video"
    );

    if (panorama) {
      doc.fillColor("#CBD5E1").font("Helvetica").fontSize(8);
      paint(doc, panorama, left + 16, 118, {
        width: contentW - 32,
        height: 44,
        ellipsis: true,
      });
    }

    // Restaurar flujo debajo del header (una sola página de inicio)
    doc.x = left;
    doc.y = Math.max(flowStart, 28 + headerH + 16);

    doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(11);
    doc.text("REPORTE EJECUTIVO DE MONITOREO, REPUTACIÓN Y CONVERSACIÓN DIGITAL", left, doc.y, {
      width: contentW,
    });
    doc.moveDown(0.45);

    if (briefBody) {
      renderMarkdownPdf(doc, briefBody, { left, contentW });
    } else {
      doc.fillColor(C.mute).font("Helvetica").fontSize(10);
      doc.text("No se generó el brief ejecutivo para este envío.", left, doc.y, { width: contentW });
    }

    // Pie
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      paint(
        doc,
        `Asistente Virtual INTRANT · Uso Departamento de Comunicaciones · ${displayDate} · ${p + 1}/${range.count}`,
        left,
        doc.page.height - 32,
        { width: contentW, align: "center", lineBreak: false }
      );
    }

    doc.end();
  });

  return { path, filename, stats };
}
