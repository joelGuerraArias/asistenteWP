import PDFDocument from "pdfkit";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";

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

/**
 * Genera un PDF del informe MONITOREO TV/RADIO y lo guarda en INFORMES_DIR.
 * @returns {Promise<{ path: string, filename: string }>}
 */
export async function writeInformePdf({
  client,
  items,
  displayDate,
  outDir = config.informes.dir,
  now = new Date(),
}) {
  ensureDir(outDir);
  const { dateStamp, timeStamp, display } = stampDateTime(now);
  const monitor = client.monitorLabel || "MONITOREO TV";
  const prefix = client.pdfPrefix || "MonitoreoTV";
  const filename = `${prefix}_${client.label}_${dateStamp}_${timeStamp}.pdf`;
  const path = join(outDir, filename);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: "LETTER",
      info: {
        Title: `${monitor} — ${client.label}`,
        Author: "FGJ Medios",
        Subject: `Informe ${displayDate}`,
      },
    });

    const stream = createWriteStream(path);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);

    // Header
    doc
      .fillColor("#0f766e")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text(monitor, { align: "left" });
    doc
      .fillColor("#0f172a")
      .fontSize(14)
      .text(client.label, { continued: false });
    doc
      .moveDown(0.3)
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#475569")
      .text(`Fecha del análisis: ${displayDate}`)
      .text(`Generado: ${display}`)
      .text(`Menciones: ${items.length}`)
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
        .text(`No se detectaron menciones relevantes de ${client.label} en esta jornada.`);
    } else {
      items.forEach((item, index) => {
        const blockHeight = estimateBlockHeight(doc, item);
        if (doc.y + blockHeight > 720) doc.addPage();

        doc
          .fillColor("#0f766e")
          .font("Helvetica-Bold")
          .fontSize(12)
          .text(`${index + 1}. ${item.tema || item.term || "Mención"}`);

        doc.moveDown(0.25);
        doc
          .fillColor("#0f172a")
          .font("Helvetica")
          .fontSize(10)
          .text(`Término: ${item.term || "—"}  |  Tono: ${(item.tono || "neutral").toUpperCase()}`);

        if (item.medioNombre) {
          doc.moveDown(0.15);
          doc.font("Helvetica").fillColor("#334155").text("Medio: ", { continued: true });
          doc
            .font("Helvetica-Bold")
            .fillColor("#0f172a")
            .text(item.medioNombre);
        }

        if (item.channel !== "radio" && item.motivo) {
          doc.moveDown(0.2);
          doc
            .font("Helvetica")
            .fillColor("#334155")
            .text(`Motivo: ${item.motivo}`, { align: "justify" });
        }
        if (item.contexto && item.contexto !== item.motivo) {
          doc.moveDown(0.2);
          doc
            .font("Helvetica")
            .fillColor("#334155")
            .text(`Contexto: ${item.contexto}`, { align: "justify" });
        }
        if (item.puntos) {
          doc.moveDown(0.15);
          doc.font("Helvetica").text(`Puntos clave: ${item.puntos}`, { align: "justify" });
        }
        if (item.channel !== "radio" && (item.transcripcionExcerpt || item.transcripcion)) {
          doc.moveDown(0.15);
          doc
            .font("Helvetica-Oblique")
            .fillColor("#334155")
            .text(
              `Transcripción (extracto): ${item.transcripcionExcerpt || item.transcripcion}`,
              { align: "justify" }
            );
        }
        if (item.relevancia) {
          doc.moveDown(0.15);
          doc.font("Helvetica").fillColor("#475569").text(`Relevancia: ${item.relevancia}`);
        }
        if (item.videoUrl) {
          doc.moveDown(0.15);
          const linkLabel = item.channel === "radio" ? "Audio" : "Clip";
          doc
            .fillColor("#0f766e")
            .font("Helvetica")
            .text(`${linkLabel}: ${item.videoUrl}`, {
              link: item.videoUrl,
              underline: true,
            });
        }
        if (item.txtUrl) {
          doc.moveDown(0.15);
          doc
            .fillColor("#0f766e")
            .font("Helvetica")
            .text(`TXT: ${item.txtUrl}`, { link: item.txtUrl, underline: true });
        }

        doc.moveDown(0.7);
        doc
          .moveTo(50, doc.y)
          .lineTo(562, doc.y)
          .strokeColor("#e2e8f0")
          .stroke()
          .moveDown(0.7);
      });
    }

    doc
      .fillColor("#94a3b8")
      .font("Helvetica")
      .fontSize(8)
      .text(`FGJ Medios — Sistema de Análisis · ${monitor}`, 50, 740, {
        align: "center",
        width: 512,
      });

    doc.end();
  });

  return { path, filename };
}

function estimateBlockHeight(doc, item) {
  let h = 60;
  if (item.channel !== "radio" && item.motivo) h += 40;
  if (item.contexto) h += 40;
  if (item.puntos) h += 40;
  if (item.channel !== "radio" && (item.transcripcionExcerpt || item.transcripcion)) h += 50;
  if (item.relevancia) h += 20;
  if (item.videoUrl) h += 20;
  return h;
}
