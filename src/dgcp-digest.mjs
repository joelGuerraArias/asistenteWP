/**
 * Genera el resumen (HTML/texto plano) y PDF para el digest de licitaciones DGCP.
 */

import PDFDocument from "pdfkit";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDoDate(date = new Date()) {
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: "America/Santo_Domingo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatDoTime(date = new Date()) {
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: "America/Santo_Domingo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function timeGreeting(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("es-DO", {
      timeZone: "America/Santo_Domingo",
      hour: "numeric",
      hour12: false,
    }).format(date)
  );
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function stampDateTime(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return { dateStamp: `${y}${m}${d}`, timeStamp: `${hh}${mm}${ss}`, display: `${d}/${m}/${y} ${hh}:${mm}` };
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function buildDgcpEmail({ url, keywords, total, items, now = new Date() }) {
  const displayDate = formatDoDate(now);
  const displayTime = formatDoTime(now);
  const greeting = timeGreeting(now);
  const count = items.length;

  const ampm = Number(
    new Intl.DateTimeFormat("es-DO", {
      timeZone: "America/Santo_Domingo",
      hour: "numeric",
      hour12: false,
    }).format(now)
  ) < 12
    ? "AM"
    : "PM";

  const subject = `Resumen DGCP — ${displayDate} (${ampm}) — ${count} licitación(es) coinciden`;

  // HTML body
  const htmlLines = [
    `<!DOCTYPE html>`,
    `<html lang="es">`,
    `<head>`,
    `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<style>`,
    `body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.45;max-width:720px;margin:0 auto;padding:24px;}`,
    `h1{font-size:20px;color:#0f766e;margin-bottom:4px;}`,
    `h2{font-size:16px;color:#334155;margin-top:24px;margin-bottom:8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;}`,
    `.meta{color:#64748b;font-size:13px;margin-bottom:18px;}`,
    `.intro{font-size:15px;margin-bottom:18px;}`,
    `.item{border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;background:#f8fafc;}`,
    `.item-title{font-weight:700;font-size:14px;color:#0f172a;margin-bottom:6px;}`,
    `.item-row{font-size:13px;color:#334155;margin-bottom:3px;}`,
    `.item-label{font-weight:600;color:#0f766e;}`,
    `.badge{display:inline-block;background:#0f766e;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;margin-right:4px;margin-top:4px;}`,
    `.empty{background:#fef3c7;color:#92400e;padding:14px;border-radius:8px;font-size:14px;}`,
    `.footer{margin-top:28px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px;}`,
    `a{color:#0f766e;text-decoration:none;}`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<h1>${greeting}</h1>`,
    `<p class="intro">Les compartimos el resumen de licitaciones publicadas en la <strong>Dirección General de Contrataciones Públicas (DGCP)</strong> que coinciden con las palabras clave configuradas.</p>`,
    `<div class="meta">`,
    `Fecha: <strong>${displayDate}</strong> · Hora: <strong>${displayTime}</strong><br>`,
    `Fuente: <a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a><br>`,
    `Total revisadas: <strong>${total}</strong> · Coincidencias: <strong>${count}</strong>`,
    `</div>`,
  ];

  if (count === 0) {
    htmlLines.push(
      `<div class="empty">No se encontraron licitaciones que mencionen las palabras clave en esta lectura.</div>`
    );
  } else {
    htmlLines.push(`<h2>Licitaciones encontradas (${count})</h2>`);
    for (const item of items) {
      htmlLines.push(`<div class="item">`);
      htmlLines.push(`<div class="item-title">${escapeHtml(item.description || "Sin descripción")}</div>`);
      htmlLines.push(`<div class="item-row"><span class="item-label">Entidad:</span> ${escapeHtml(item.authority || "—")}</div>`);
      htmlLines.push(`<div class="item-row"><span class="item-label">Referencia:</span> ${escapeHtml(item.reference || "—")}</div>`);
      htmlLines.push(`<div class="item-row"><span class="item-label">Fase:</span> ${escapeHtml(item.phase || "—")}</div>`);
      htmlLines.push(`<div class="item-row"><span class="item-label">Publicación:</span> ${escapeHtml(item.publishDate || "—")}</div>`);
      htmlLines.push(`<div class="item-row"><span class="item-label">Límite respuestas:</span> ${escapeHtml(item.deadline || "—")}</div>`);
      htmlLines.push(`<div class="item-row"><span class="item-label">Apertura:</span> ${escapeHtml(item.openDate || "—")}</div>`);
      htmlLines.push(
        `<div>${item.matchedKeywords.map((k) => `<span class="badge">${escapeHtml(k)}</span>`).join("")}</div>`
      );
      htmlLines.push(`</div>`);
    }
  }

  htmlLines.push(
    `<div class="footer">`,
    `Keywords monitorizadas: ${escapeHtml(keywords.join(", "))}<br>`,
    `Generado automáticamente por AsistenteWP — FV Digital`,
    `</div>`,
    `</body></html>`
  );

  // Plain text body
  const textLines = [
    `${greeting}`,
    ``,
    `Resumen DGCP — ${displayDate} (${ampm})`,
    `Fuente: ${url}`,
    `Total revisadas: ${total} · Coincidencias: ${count}`,
    ``,
  ];

  if (count === 0) {
    textLines.push("No se encontraron licitaciones que mencionen las palabras clave en esta lectura.");
  } else {
    textLines.push(`Licitaciones encontradas (${count}):`, "");
    for (const item of items) {
      textLines.push(`• ${item.description || "Sin descripción"}`);
      textLines.push(`  Entidad: ${item.authority || "—"}`);
      textLines.push(`  Referencia: ${item.reference || "—"}`);
      textLines.push(`  Fase: ${item.phase || "—"}`);
      textLines.push(`  Publicación: ${item.publishDate || "—"}`);
      textLines.push(`  Límite: ${item.deadline || "—"}`);
      textLines.push(`  Apertura: ${item.openDate || "—"}`);
      textLines.push(`  Keywords: ${item.matchedKeywords.join(", ")}`);
      textLines.push("");
    }
  }

  textLines.push("---");
  textLines.push(`Keywords monitorizadas: ${keywords.join(", ")}`);
  textLines.push("Generado automáticamente por AsistenteWP — FV Digital");

  return {
    subject,
    html: htmlLines.join("\n"),
    text: textLines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n"),
  };
}

/**
 * Genera un PDF adjunto con el resumen.
 * @returns {Promise<{path:string, filename:string, content:Buffer}>}
 */
export async function writeDgcpPdf({ items, subject, outDir = config.informes.dir, now = new Date() }) {
  ensureDir(outDir);
  const { dateStamp, timeStamp, display } = stampDateTime(now);
  const filename = `DGCP_Resumen_${dateStamp}_${timeStamp}.pdf`;
  const path = join(outDir, filename);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: "LETTER",
      info: {
        Title: subject,
        Author: "AsistenteWP — FV Digital",
        Subject: "Resumen de licitaciones DGCP",
      },
    });

    const stream = createWriteStream(path);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);

    doc
      .fillColor("#0f766e")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("Resumen de Licitaciones DGCP", { align: "left" });
    doc
      .fillColor("#0f172a")
      .fontSize(12)
      .font("Helvetica")
      .text(subject)
      .moveDown(0.3)
      .fontSize(10)
      .fillColor("#475569")
      .text(`Generado: ${display}`)
      .text(`Coincidencias: ${items.length}`)
      .moveDown(0.8);

    doc
      .moveTo(50, doc.y)
      .lineTo(562, doc.y)
      .strokeColor("#cbd5e1")
      .stroke()
      .moveDown(0.8);

    if (!items.length) {
      doc
        .fillColor("#64748b")
        .font("Helvetica")
        .fontSize(11)
        .text("No se encontraron licitaciones que coincidan con las palabras clave.");
    } else {
      items.forEach((item, index) => {
        if (doc.y > 700) doc.addPage();

        doc
          .fillColor("#0f766e")
          .font("Helvetica-Bold")
          .fontSize(12)
          .text(`${index + 1}. ${item.description || "Sin descripción"}`);
        doc.moveDown(0.25);

        doc
          .fillColor("#0f172a")
          .font("Helvetica")
          .fontSize(10)
          .text(`Entidad: ${item.authority || "—"}`)
          .text(`Referencia: ${item.reference || "—"}`)
          .text(`Fase: ${item.phase || "—"}`)
          .text(`Publicación: ${item.publishDate || "—"}`)
          .text(`Límite respuestas: ${item.deadline || "—"}`)
          .text(`Apertura: ${item.openDate || "—"}`)
          .text(`Keywords: ${item.matchedKeywords.join(", ") || "—"}`)
          .moveDown(0.6);
      });
    }

    doc.end();
  });

  const content = await import("node:fs").then((fs) => fs.promises.readFile(path));
  return { path, filename, content };
}
