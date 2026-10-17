/**
 * Prueba a autosemana: MD completo + término más mencionado + anexo TV/audio
 * (mismo bloque que irá en el correo del REPORTE ejecutivo).
 */
import { collectReporteSources } from "../src/intrant-report-sources.mjs";
import { formatDisplayDate } from "../src/informe-parse.mjs";
import { sendEmail } from "../src/informe-email.mjs";
import {
  topMentionedTerms,
  buildBroadcastAnnexHtml,
  wrapExecutiveEmailHtml,
  buildRawMonitoringDump,
} from "../src/intrant-report-brief.mjs";
import { buildExecutiveStats } from "../src/intrant-report-pdf.mjs";

const date = new Date();
const displayDate = formatDisplayDate(date);

console.log("Recolectando fuentes (incl. Analisishoy MD completo)…");
const collected = await collectReporteSources({
  date,
  onStatus: (m) => console.log(" ", m),
});

const tv = collected.bySource.tv || [];
const radio = collected.bySource.radio || [];
const broadcast = [...tv, ...radio];
const topTerms = topMentionedTerms(collected.items);
const topBroadcast = topMentionedTerms(broadcast) || topTerms;

const stats = buildExecutiveStats(collected.items);
const annex = buildBroadcastAnnexHtml({
  tv,
  radio,
  topTerms: topBroadcast,
});

const dumpPreview = buildRawMonitoringDump({
  displayDate,
  dateYmd: collected.dateYmd,
  counts: collected.counts,
  items: broadcast,
  topTerms: topBroadcast,
}).slice(0, 1800);

const bodyHtml = `
  <div style="padding:12px 0 4px;">
    <p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#334155;">
      Prueba del bloque que se adjunta al <strong>REPORTE ejecutivo</strong>:
      se lee el <strong>MD Analisishoy completo</strong> (Video .mp4 + Audio .wav/.mp3),
      se calcula el <strong>término más mencionado</strong> del ciclo y se detalla tono + enlaces.
    </p>
    <p style="margin:0 0 14px;font-size:13px;color:#0f172a;">
      Totales ciclo: TV <strong>${tv.length}</strong> · Audio <strong>${radio.length}</strong>
      · Todas las fuentes <strong>${collected.items.length}</strong>
      ${
        topBroadcast
          ? `· Dominante: <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#F59E0B;color:#111;font-weight:800;">${topBroadcast.term}</span> (${topBroadcast.count})`
          : ""
      }
    </p>
    <pre style="white-space:pre-wrap;font-size:11px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;color:#475569;max-height:220px;overflow:auto;">${dumpPreview.replace(/</g, "&lt;")}…</pre>
  </div>
  ${annex}
`;

const html = wrapExecutiveEmailHtml({
  displayDate,
  bodyHtml,
  stats,
  bySource: collected.bySource,
  topTerms: topBroadcast,
  broadcastHtml: "", // annex already in bodyHtml
});

const subject = topBroadcast
  ? `PRUEBA REPORTE · término dominante «${topBroadcast.term}» (${topBroadcast.count}) · TV ${tv.length} · Audio ${radio.length} · ${collected.dateYmd}`
  : `PRUEBA REPORTE · TV/Audio Analisishoy · ${collected.dateYmd}`;

const sent = await sendEmail({
  to: "autosemana@gmail.com",
  subject,
  html,
  text: [
    subject,
    topBroadcast
      ? `Término más mencionado: ${topBroadcast.term} (${topBroadcast.count})`
      : "",
    `TV: ${tv.length} | Audio: ${radio.length} | Total fuentes: ${collected.items.length}`,
    "",
    ...broadcast.map(
      (it, i) =>
        `#${i + 1} [${it.term || "-"}][${it.tono || "neutral"}] ${it.medio} — ${it.title}\n${it.url || ""}`
    ),
  ]
    .filter(Boolean)
    .join("\n"),
});

console.log(
  JSON.stringify(
    {
      ok: true,
      dateYmd: collected.dateYmd,
      totals: collected.counts,
      topTerms: topBroadcast,
      topAllSources: topTerms,
      tv: tv.length,
      radio: radio.length,
      sampleTerms: Object.fromEntries(
        broadcast.reduce((m, it) => {
          const t = it.term || "?";
          m.set(t, (m.get(t) || 0) + 1);
          return m;
        }, new Map())
      ),
      sent,
    },
    null,
    2
  )
);
