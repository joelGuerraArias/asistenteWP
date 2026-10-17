/**
 * «Así va el día» — digest de alertas Intrant del día (sheet) → correo.
 * Horarios típicos: 12:00 y 16:00.
 */
import { config } from "./config.mjs";
import { fetchGoogleAlertsForSheet } from "./gmail-alerts.mjs";
import { mergeFixedCc, sendEmail } from "./informe-email.mjs";
import {
  readTodayAlertRows,
  replaceAlertsSheet,
} from "./sheets-alerts.mjs";
import {
  calendarYmd,
  extractDateFromUrl,
  isFreshIntrantAlert,
  looksLikeStaleIntrantAppointment,
} from "./news-date.mjs";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDisplayDate(date = new Date()) {
  const ymd = calendarYmd(date);
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function formatHm(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sentimentColor(s = "") {
  const t = String(s).toLowerCase();
  if (/negat|cr[ií]tic/.test(t)) return "#dc2626";
  if (/posit|favor/.test(t)) return "#16a34a";
  return "#64748b";
}

function sentimentLabel(s = "") {
  const t = String(s || "neutral").toLowerCase();
  if (/negat|cr[ií]tic/.test(t)) return "NEGATIVA";
  if (/posit|favor/.test(t)) return "POSITIVA";
  return "NEUTRAL";
}

/** Pastilla color + letras blancas (igual que /busca). */
function colorPill(label, bg, { upper = false, size = 11 } = {}) {
  const raw = String(label || "").trim();
  const safe = escapeHtml(raw).replace(/\./g, ".\u200B");
  const transform = upper
    ? "text-transform:uppercase;letter-spacing:.04em;"
    : "letter-spacing:.03em;";
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bg};color:#ffffff !important;font-size:${size}px;font-weight:800;${transform}mso-style-textfill-fill-color:#ffffff;"><font color="#ffffff" style="color:#ffffff !important;">${safe}</font></span>`;
}

function medioBrandColor(medio = "") {
  const palette = [
    "#0f766e",
    "#1d4ed8",
    "#7c3aed",
    "#b45309",
    "#be123c",
    "#0369a1",
    "#15803d",
    "#4338ca",
  ];
  const s = String(medio || "medio");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function newsCardHtml(r, index) {
  const rank = index + 1;
  const title = escapeHtml(r.titulo || "(sin título)");
  const medioRaw = String(r.medio || "Medio").trim() || "Medio";
  const medioBg = medioBrandColor(medioRaw);
  const sentBg = sentimentColor(r.sentimiento);
  const sentText = sentimentLabel(r.sentimiento);
  const urlRaw = String(r.url || "").trim();
  const url = escapeHtml(urlRaw);
  const texto = escapeHtml(String(r.texto || "").slice(0, 220));
  const urlBlock = urlRaw
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:10px;">
        <tr>
          <td style="vertical-align:middle;">
            <a href="${url}" style="display:inline-block;padding:8px 14px;border-radius:10px;background:#0f766e;color:#ffffff !important;font-size:12px;font-weight:700;text-decoration:none;"><font color="#ffffff">Abrir nota →</font></a>
          </td>
        </tr>
        <tr>
          <td style="padding-top:8px;font-size:11px;line-height:1.4;word-break:break-all;">
            <a href="${url}" style="color:#0369a1;text-decoration:none;">${url}</a>
          </td>
        </tr>
      </table>`
    : `<p style="margin:10px 0 0;font-size:12px;color:#b91c1c;">(sin URL)</p>`;

  return `
  <tr>
    <td style="padding:0 0 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="width:52px;background:${medioBg};color:#ffffff !important;text-align:center;vertical-align:middle;font-size:18px;font-weight:800;padding:16px 8px;">
            <font color="#ffffff">#${rank}</font>
          </td>
          <td style="padding:14px 16px 12px;vertical-align:top;">
            <div style="margin:0 0 8px;">
              ${colorPill(medioRaw, medioBg)}
              &nbsp;${colorPill(sentText, sentBg, { upper: true, size: 10 })}
            </div>
            <p style="margin:0 0 8px;font-size:15px;line-height:1.35;color:#0f172a;font-weight:700;">${title}</p>
            ${texto ? `<p style="margin:0;font-size:12px;line-height:1.45;color:#64748b;">${texto}${String(r.texto || "").length > 220 ? "…" : ""}</p>` : ""}
            ${urlBlock}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export function buildAsiVaElDiaEmail({ rows = [], now = new Date(), sample = false } = {}) {
  const displayDate = formatDisplayDate(now);
  const hm = formatHm(now);
  const subject = sample
    ? `Así va el día — Intrant · ${displayDate} · muestra`
    : `Así va el día — Intrant · ${displayDate} · ${hm}`;

  const count = rows.length;
  const intro = count
    ? `Resumen de ${count} noticia${count === 1 ? "" : "s"} del monitoreo de alertas Intrant del día ${displayDate}.`
    : `Sin novedades en alertas del día ${displayDate}.`;

  const itemsHtml = count
    ? rows.map((r, i) => newsCardHtml(r, i)).join("\n")
    : `<tr><td style="padding:28px;background:#fff;border:1px dashed #cbd5e1;border-radius:14px;text-align:center;color:#64748b;">No hay filas de hoy en el sheet de alertas Intrant.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;">
        <tr>
          <td style="background:#0f766e;border-radius:18px 18px 0 0;padding:28px 28px 22px;color:#fff;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#99f6e4;font-weight:700;">Monitoreo Intrant</div>
            <div style="font-size:24px;font-weight:800;color:#ffffff;margin-top:4px;">Así va el día</div>
            <div style="font-size:13px;color:#ccfbf1;margin-top:6px;">${escapeHtml(displayDate)} · ${escapeHtml(hm)}${sample ? " · muestra" : ""}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;padding:18px 18px 6px;">
            <p style="margin:0 8px 14px;font-size:14px;color:#334155;line-height:1.5;">${escapeHtml(intro)}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 18px 18px;padding:8px 18px 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              ${itemsHtml}
            </table>
            <p style="margin:8px 8px 0;font-size:11px;color:#94a3b8;">Fuente: Google Alerts → sheet Intrant · FV Digital</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    `Así va el día — Intrant · ${displayDate} · ${hm}${sample ? " · muestra" : ""}`,
    intro,
    "",
  ];
  if (!count) {
    textLines.push("Sin novedades.");
  } else {
    rows.forEach((r, i) => {
      textLines.push(`${i + 1}. ${r.titulo || "(sin título)"}`);
      textLines.push(`   ${r.medio || ""} · ${r.sentimiento || "neutral"}`);
      if (r.url) textLines.push(`   ${r.url}`);
      textLines.push("");
    });
  }

  return { subject, html, text: textLines.join("\n"), count, displayDate, hm };
}

/**
 * @param {{ dryRun?: boolean, toOverride?: string, skipCc?: boolean, skipSync?: boolean, sample?: boolean, onStatus?: (s: string)=>void }} opts
 */
export async function runAsiVaElDia({
  dryRun = false,
  toOverride = "",
  skipCc = false,
  skipSync = false,
  sample = false,
  onStatus,
} = {}) {
  const now = new Date();

  if (!skipSync) {
    onStatus?.("🔄 Sync Google Alerts Intrant (hoy) → sheet…");
    const alerts = await fetchGoogleAlertsForSheet({
      onlyToday: true,
      maxMessages: 100,
      mode: "intrant",
      onStatus,
    });
    const sheetResult = await replaceAlertsSheet(alerts);
    onStatus?.(
      `Sheet: ${sheetResult.added ?? alerts.length} hoy | histórico ${sheetResult.keptHistorical ?? "?"}`
    );
  }

  onStatus?.("📖 Leyendo filas de hoy del sheet…");
  const { rows: rawRows, spreadsheetId, sheetName, todayKey } = await readTodayAlertRows({
    date: now,
  });
  // Sync ya validó ≤24h abriendo el artículo. Aquí solo refuerzo con fecha en URL / Méndez.
  const rows = rawRows.filter((r) => {
    const title = r.titulo || "";
    const url = r.url || "";
    const publishedAt = extractDateFromUrl(url);
    if (looksLikeStaleIntrantAppointment(title)) {
      return isFreshIntrantAlert({ url, publishedAt, title }, { now });
    }
    if (publishedAt) {
      return isFreshIntrantAlert({ url, publishedAt, title }, { now });
    }
    return true;
  });
  onStatus?.(
    `Hoy (${todayKey}): ${rows.length} noticia(s)${
      rawRows.length !== rows.length ? ` (${rawRows.length - rows.length} filtrada(s))` : ""
    }`
  );


  const email = buildAsiVaElDiaEmail({
    rows,
    now,
    sample: sample || Boolean(toOverride),
  });

  const to = String(toOverride || config.informes.emailIntrant || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  if (!to) throw new Error("Falta destinatario (INFORME_EMAIL_INTRANT o --to=)");

  const cc =
    toOverride || skipCc
      ? ""
      : mergeFixedCc(config.informes.emailIntrantCc || "belgicajr@gmail.com");

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      to,
      cc,
      subject: email.subject,
      count: email.count,
      rows,
      spreadsheetId,
      sheetName,
      previewText: email.text.slice(0, 800),
    };
  }

  onStatus?.(`📤 Enviando a ${to}${cc ? ` (CC ${cc})` : ""}…`);
  const result = await sendEmail({
    to,
    ...(cc ? { cc } : {}),
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  return {
    ok: true,
    to,
    cc,
    subject: email.subject,
    count: email.count,
    spreadsheetId,
    sheetName,
    messageId: result.messageId,
  };
}
