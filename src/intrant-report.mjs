/**
 * Orquesta el REPORTE Intrant: fuentes → brief ejecutivo → Word → email.
 */
import { formatDisplayDate } from "./informe-parse.mjs";
import { mergeFixedCc, sendEmail } from "./informe-email.mjs";
import { collectReporteSources } from "./intrant-report-sources.mjs";
import { buildExecutiveStats, CHANNEL_META } from "./intrant-report-pdf.mjs";
import { writeReporteDocx } from "./intrant-report-docx.mjs";
import {
  generateExecutiveBrief,
  markdownToEmailHtml,
  wrapExecutiveEmailHtml,
  prioritizeMendezItems,
} from "./intrant-report-brief.mjs";
import { config } from "./config.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function executiveCountsLine(counts = {}) {
  const groups = { prensa: 0, redes: 0, video: 0, broadcast: 0 };
  for (const [src, n] of Object.entries(counts)) {
    const g = CHANNEL_META[src]?.group;
    if (g) groups[g] += n || 0;
  }
  return `Prensa ${groups.prensa} · Redes ${groups.redes} · Video ${groups.video} · TV/Radio ${groups.broadcast}`;
}

export function formatReporteTelegram(result) {
  const { counts, errors, skipped, email, docx, dryRun, displayDate, items } = result;
  const stats = buildExecutiveStats(items || []);
  const lines = [
    dryRun ? "REPORTE Intrant (dry-run)" : "REPORTE Intrant enviado",
    displayDate,
    `Menciones: ${stats.total} · Sentimiento neto: ${stats.net >= 0 ? `+${stats.net}` : stats.net}`,
    executiveCountsLine(counts),
  ];
  if (docx?.filename) lines.push(`Word: ${docx.filename}`);
  if (email?.to) lines.push(`Para: ${email.to}`);
  for (const s of skipped || []) {
    if (s.source === "tv" || s.source === "radio") continue;
    lines.push(`Omitido ${s.source}: ${s.reason}`);
  }
  for (const e of errors || []) lines.push(`Error ${e.source}: ${e.error}`);
  return lines.join("\n");
}

function buildReporteEmail({ displayDate, markdown, attachmentFilename, stats = null }) {
  const bodyHtml = markdownToEmailHtml(markdown);
  return {
    subject: `REPORTE EJECUTIVO INTRANT — Monitoreo, reputación y conversación digital — ${displayDate}`,
    html: wrapExecutiveEmailHtml({
      displayDate,
      bodyHtml,
      attachmentFilename,
      stats,
    }),
    text: markdown,
  };
}

export async function runIntrantReport({
  date = new Date(),
  dryRun = false,
  noEmail = false,
  refreshInstagram = false,
  refreshFacebook = false,
  onStatus,
} = {}) {
  const displayDate = formatDisplayDate(date);
  const collected = await collectReporteSources({
    date,
    refreshInstagram,
    refreshFacebook,
    onStatus,
  });

  // Siempre: noticias/videos de Juan Manuel Méndez primero
  const items = prioritizeMendezItems(collected.items);
  const bySource = { ...collected.bySource };
  for (const key of Object.keys(bySource)) {
    bySource[key] = prioritizeMendezItems(bySource[key] || []);
  }

  const brief = await generateExecutiveBrief({
    displayDate,
    dateYmd: collected.dateYmd,
    counts: collected.counts,
    items,
    onStatus,
  });

  try {
    const { existsSync, mkdirSync } = await import("node:fs");
    if (!existsSync(config.informes.dir)) mkdirSync(config.informes.dir, { recursive: true });
    const mdName = `REPORTE_INTRANT_${collected.dateYmd?.replace(/-/g, "") || "hoy"}_brief.md`;
    writeFileSync(join(config.informes.dir, mdName), brief.markdown, "utf8");
  } catch {
    /* no bloquear envío */
  }

  onStatus?.("Generando Word ejecutivo…");
  const docx = await writeReporteDocx({
    items,
    displayDate,
    dateYmd: collected.dateYmd,
    now: date,
    executiveMarkdown: brief.markdown,
  });

  const emailBody = buildReporteEmail({
    displayDate,
    markdown: brief.markdown,
    attachmentFilename: docx.filename,
    stats: docx.stats || buildExecutiveStats(items),
  });

  const to = config.informes.emailIntrant;
  const cc = mergeFixedCc(config.informes.emailIntrantCc);
  let sent = null;

  if (!dryRun && !noEmail) {
    if (!to) throw new Error("Configura INFORME_EMAIL_INTRANT en .env");
    onStatus?.("Enviando correo…");
    sent = await sendEmail({
      to,
      cc,
      subject: emailBody.subject,
      html: emailBody.html,
      text: emailBody.text,
      attachments: [
        {
          filename: docx.filename,
          content: readFileSync(docx.path),
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
    });
  }

  return {
    ...collected,
    items,
    bySource,
    displayDate,
    docx,
    brief,
    email: { to, cc, subject: emailBody.subject },
    sent,
    dryRun,
    noEmail,
  };
}
