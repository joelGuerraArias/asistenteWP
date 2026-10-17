import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
import { config } from "./config.mjs";
import { filterForClient, loadAnalisisHoy, todayStamp } from "./informe-parse.mjs";
import { writeInformePdf } from "./informe-pdf.mjs";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tonoLabel(tono) {
  if (tono === "positiva") return "positiva";
  if (tono === "negativa") return "negativa";
  return "neutral";
}

function tonoBadge(tono) {
  const map = {
    positiva: { bg: "#16a34a", text: "POSITIVA" },
    negativa: { bg: "#dc2626", text: "NEGATIVA" },
    neutral: { bg: "#64748b", text: "NEUTRAL" },
  };
  const { bg, text } = map[tono] || map.neutral;
  return `<span style="display:inline-block;background:${bg};color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;padding:3px 8px;border-radius:999px;">${text}</span>`;
}

function relevanceBadge(relevancia = "") {
  const label = escapeHtml(relevancia.split("—")[0].trim() || "N/D");
  let bg = "#64748b";
  if (/^alta/i.test(relevancia)) bg = "#0f766e";
  else if (/^media/i.test(relevancia)) bg = "#d97706";
  else if (/^baja/i.test(relevancia)) bg = "#64748b";
  return `<span style="display:inline-block;background:${bg};color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;padding:3px 8px;border-radius:999px;text-transform:uppercase;">${label}</span>`;
}

function buildMediaToneLines(items) {
  const byMedia = new Map();
  for (const item of items) {
    const name = (item.medioNombre || "Medio").trim();
    if (!byMedia.has(name)) {
      byMedia.set(name, { positiva: 0, negativa: 0, neutral: 0, total: 0 });
    }
    const row = byMedia.get(name);
    const tono = item.tono || "neutral";
    row[tono] = (row[tono] || 0) + 1;
    row.total += 1;
  }

  return [...byMedia.entries()].map(([name, stats]) => {
    const parts = [];
    if (stats.positiva) parts.push(`${stats.positiva} positiva${stats.positiva > 1 ? "s" : ""}`);
    if (stats.negativa) parts.push(`${stats.negativa} negativa${stats.negativa > 1 ? "s" : ""}`);
    if (stats.neutral) parts.push(`${stats.neutral} neutral${stats.neutral > 1 ? "es" : ""}`);
    return { name, summary: parts.join(", ") || "sin clasificar", stats };
  });
}

function monitorLabelOf(client) {
  return client?.monitorLabel || "MONITOREO TV";
}

/** Saludo según hora en República Dominicana. */
export function timeGreeting(date = new Date()) {
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

function shortTheme(text = "", max = 110) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > 40 ? cut.slice(0, at) : cut).trim()}…`;
}

function mentionWord(count) {
  return count === 1 ? "mención" : "menciones";
}

function summarizeIntro({ client, items, displayDate }) {
  const monitor = monitorLabelOf(client);
  const mediumWord = client?.channel === "radio" ? "radio" : "televisión";
  const count = items.length;
  const greeting = timeGreeting();
  if (!count) {
    return {
      paragraph: `${greeting}. Les compartimos el resumen diario de <strong>${escapeHtml(monitor)}</strong> correspondiente al ${escapeHtml(displayDate)}. En esta jornada no se detectaron menciones relevantes asociadas a ${escapeHtml(client.label)}.`,
      themeLines: [],
      mediaToneLines: [],
      toneCounts: { positiva: 0, negativa: 0, neutral: 0 },
    };
  }

  const themes = [];
  const seenTheme = new Set();
  for (const item of items) {
    const t = (item.tema || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seenTheme.has(key)) continue;
    seenTheme.add(key);
    themes.push(t);
  }

  const toneCounts = { positiva: 0, negativa: 0, neutral: 0 };
  for (const item of items) {
    const t = item.tono || "neutral";
    toneCounts[t] = (toneCounts[t] || 0) + 1;
  }

  const mediaToneLines = buildMediaToneLines(items);
  const mediaNames = mediaToneLines.map((m) => m.name);
  const mediaList = mediaNames.join(", ");

  const tonePhrase = [
    toneCounts.positiva ? `<strong>${toneCounts.positiva}</strong> positiva${toneCounts.positiva > 1 ? "s" : ""}` : "",
    toneCounts.negativa ? `<strong>${toneCounts.negativa}</strong> negativa${toneCounts.negativa > 1 ? "s" : ""}` : "",
    toneCounts.neutral ? `<strong>${toneCounts.neutral}</strong> neutral${toneCounts.neutral > 1 ? "es" : ""}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const paragraph = [
    `${greeting}.`,
    `Les enviamos el informe diario de <strong>${escapeHtml(monitor)}</strong> para <strong>${escapeHtml(client.label)}</strong>, correspondiente al <strong>${escapeHtml(displayDate)}</strong>.`,
    `Se identificaron <strong>${count}</strong> ${mentionWord(count)} en ${mediumWord}: ${tonePhrase || "sin clasificación de tono"}.`,
    mediaNames.length
      ? `Los medios que registraron menciones fueron: <strong>${escapeHtml(mediaList)}</strong>.`
      : "",
    `A continuación encontrará el detalle de cada segmento detectado, con su tono (positivo, negativo o neutral).`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    paragraph,
    themeLines: themes.map((t) => shortTheme(t, 140)),
    mediaToneLines,
    toneCounts,
  };
}

function introBlock({ client, items, displayDate }) {
  const { paragraph, themeLines, mediaToneLines, toneCounts } = summarizeIntro({
    client,
    items,
    displayDate,
  });

  const toneSummaryHtml = `
    <p style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#134e4a;text-transform:uppercase;letter-spacing:.04em;">Balance de tono</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#334155;">
      ${tonoBadge("positiva")} ${toneCounts.positiva || 0}
      &nbsp;&nbsp; ${tonoBadge("negativa")} ${toneCounts.negativa || 0}
      &nbsp;&nbsp; ${tonoBadge("neutral")} ${toneCounts.neutral || 0}
    </p>`;

  const themeHtml = themeLines.length
    ? `<p style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#134e4a;text-transform:uppercase;letter-spacing:.04em;">Temas del día</p>
       <ul style="margin:0 0 12px;padding-left:20px;color:#334155;font-size:14px;line-height:1.55;">
         ${themeLines
           .slice(0, 8)
           .map((t) => `<li style="margin:0 0 4px;">${escapeHtml(t)}</li>`)
           .join("")}
       </ul>`
    : "";

  const mediaHtml = mediaToneLines.length
    ? `<p style="margin:10px 0 6px;font-size:13px;font-weight:700;color:#134e4a;text-transform:uppercase;letter-spacing:.04em;">Medios y tono de las menciones</p>
       <ul style="margin:0;padding-left:20px;color:#334155;font-size:14px;line-height:1.55;">
         ${mediaToneLines
           .map(
             (m) =>
               `<li style="margin:0 0 6px;"><strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(m.summary)}</li>`
           )
           .join("")}
       </ul>`
    : "";

  return `
  <tr>
    <td style="background:#ffffff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;padding:22px 28px;border-bottom:1px solid #e2e8f0;">
      <p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#0f172a;">${paragraph}</p>
      ${toneSummaryHtml}
      ${themeHtml}
      ${mediaHtml}
    </td>
  </tr>`;
}

function itemCard(item, index) {
  const isRadio = item.channel === "radio";
  const mediaLink = item.videoUrl
    ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(item.videoUrl)}" style="color:#0f766e;font-weight:600;text-decoration:none;">${
        isRadio ? "🎧 Escuchar audio" : "▶ Ver clip del segmento"
      }</a></p>`
    : "";
  const txtLink =
    isRadio && item.txtUrl
      ? `<p style="margin:6px 0 0;"><a href="${escapeHtml(item.txtUrl)}" style="color:#0f766e;font-weight:600;text-decoration:none;">📄 Ver transcripción (TXT)</a></p>`
      : "";

  const medioLabel = (item.medioNombre || "").trim();
  const medioLine = medioLabel
    ? `<p style="margin:0 0 8px;font-size:14px;color:#0f172a;"><strong>Medio:</strong> <strong style="color:#0f172a;">${escapeHtml(medioLabel)}</strong></p>`
    : "";

  return `
  <tr>
    <td style="padding:0 0 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:18px 20px;border-left:4px solid #0f766e;">
            <p style="margin:0 0 8px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">
              ${isRadio ? "Mención" : "Noticia"} ${index + 1} · término: <strong style="color:#0f172a;">${escapeHtml(item.term)}</strong>
            </p>
            <h3 style="margin:0 0 10px;font-size:18px;line-height:1.35;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
              ${escapeHtml(item.tema || "Sin tema principal")}
            </h3>
            <div style="margin:0 0 12px;">${tonoBadge(item.tono || "neutral")}&nbsp;${relevanceBadge(item.relevancia)}</div>
            ${medioLine}
            ${
              !isRadio && item.motivo
                ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#334155;"><strong>Motivo:</strong> ${escapeHtml(item.motivo)}</p>`
                : ""
            }
            ${
              item.contexto && item.contexto !== item.motivo
                ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#334155;"><strong>Contexto:</strong> ${escapeHtml(item.contexto)}</p>`
                : ""
            }
            ${
              item.puntos
                ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#334155;"><strong>${
                    isRadio ? "Detalle:" : "Puntos clave:"
                  }</strong> ${escapeHtml(item.puntos)}</p>`
                : ""
            }
            ${
              !isRadio && (item.transcripcionExcerpt || item.transcripcion)
                ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#334155;"><strong>Transcripción (extracto):</strong> <em>${escapeHtml(
                    item.transcripcionExcerpt || item.transcripcion
                  )}</em></p>`
                : ""
            }
            ${
              item.relevancia
                ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#475569;"><strong>Relevancia:</strong> ${escapeHtml(item.relevancia)}</p>`
                : ""
            }
            ${mediaLink}
            ${txtLink}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export function buildInformeEmail({ client, items, displayDate, stamp, pdfFilename = "" }) {
  const count = items.length;
  const monitor = monitorLabelOf(client);
  const subject = `${monitor} · ${client.label} · ${stamp.slice(6, 8)}/${stamp.slice(4, 6)}/${stamp.slice(0, 4)} · ${count} ${mentionWord(count)}`;
  const intro = summarizeIntro({ client, items, displayDate });

  const cards =
    count > 0
      ? items.map((item, i) => itemCard(item, i)).join("\n")
      : `
  <tr>
    <td style="padding:24px;background:#fff;border:1px dashed #cbd5e1;border-radius:12px;text-align:center;color:#64748b;font-size:15px;">
      No se detectaron menciones relevantes de <strong>${escapeHtml(client.label)}</strong> en el ${escapeHtml(monitor)} de hoy.
    </td>
  </tr>`;

  const pdfNote = pdfFilename
    ? `<p style="margin:0 8px 12px;font-size:13px;color:#334155;line-height:1.5;">📎 Adjunto: <strong>${escapeHtml(pdfFilename)}</strong></p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;">
          <tr>
            <td style="background:linear-gradient(135deg,#0f766e,#115e59);border-radius:16px 16px 0 0;padding:28px 28px 24px;color:#fff;">
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">FGJ Medios · Sistema de Análisis</p>
              <h1 style="margin:0 0 8px;font-size:24px;line-height:1.25;font-weight:700;">${escapeHtml(client.title)}</h1>
              <p style="margin:0;font-size:14px;opacity:.92;">${escapeHtml(monitor)} · ${escapeHtml(displayDate)}</p>
            </td>
          </tr>
          ${introBlock({ client, items, displayDate })}
          <tr>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px;padding:22px 20px 10px;">
              <p style="margin:0 8px 8px;font-size:13px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:.06em;">Detalle de menciones</p>
              ${pdfNote}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${cards}
              </table>
              <p style="margin:8px 12px 20px;font-size:12px;line-height:1.5;color:#94a3b8;text-align:center;">
                Correo generado automáticamente por FGJ Medios — ${escapeHtml(monitor)}.<br>
                No responda a este mensaje si es solo informativo.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    `${client.title}`,
    `${monitor} · ${displayDate}`,
    `Menciones: ${count}`,
    "",
    intro.paragraph.replace(/<[^>]+>/g, ""),
    "",
    `Tono: ${intro.toneCounts.positiva} positivas, ${intro.toneCounts.negativa} negativas, ${intro.toneCounts.neutral} neutrales`,
    "",
    intro.themeLines.length ? "Temas del día:" : "",
    ...intro.themeLines.map((t) => `• ${t}`),
    "",
    intro.mediaToneLines.length ? "Medios y tono:" : "",
    ...intro.mediaToneLines.map((m) => `• ${m.name} — ${m.summary}`),
    "",
    ...items.flatMap((item, i) => [
      `--- ${i + 1}. ${item.tema || item.term} ---`,
      `Término: ${item.term}`,
      `Tono: ${tonoLabel(item.tono)}`,
      item.medioNombre ? `Medio: ${item.medioNombre}` : "",
      !item.channel || item.channel !== "radio"
        ? item.motivo
          ? `Motivo: ${item.motivo}`
          : ""
        : "",
      item.contexto ? `Contexto: ${item.contexto}` : "",
      item.puntos ? `Detalle: ${item.puntos}` : "",
      !item.channel || item.channel !== "radio"
        ? item.transcripcionExcerpt || item.transcripcion
          ? `Transcripción (extracto): ${item.transcripcionExcerpt || item.transcripcion}`
          : ""
        : "",
      item.relevancia ? `Relevancia: ${item.relevancia}` : "",
      item.videoUrl ? `${item.channel === "radio" ? "Audio" : "Clip"}: ${item.videoUrl}` : "",
      item.txtUrl ? `TXT: ${item.txtUrl}` : "",
      "",
    ]),
  ].filter((l, idx, arr) => !(l === "" && arr[idx - 1] === ""));

  return { subject, html, text: textLines.join("\n") };
}

function createTransport() {
  const { brevo } = config;
  if (!brevo.enabled) {
    throw new Error(
      "Brevo no está configurado (BREVO_SMTP_USER, BREVO_API_KEY, BREVO_SENDER_EMAIL)"
    );
  }

  return nodemailer.createTransport({
    host: brevo.smtpServer,
    port: brevo.smtpPort,
    secure: brevo.smtpPort === 465,
    auth: {
      user: brevo.smtpUser,
      pass: brevo.apiKey,
    },
    // Fallar rápido: si la red bloquea SMTP no queremos esperar 2 minutos
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

function addressList(list = "") {
  return String(list)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

function attachmentToApi(a = {}) {
  try {
    const content = a.content ?? (a.path ? readFileSync(a.path) : null);
    if (!content) return null;
    return {
      name: a.filename || "adjunto",
      content: Buffer.from(content).toString("base64"),
    };
  } catch {
    return null;
  }
}

/**
 * Envío por la API HTTPS de Brevo (puerto 443).
 * Se usa cuando el SMTP está bloqueado por la red (VPN/ISP: 25/465/587/2525 sin salida).
 */
async function sendViaBrevoApi({ to, cc, subject, html, text, attachments = [] }) {
  const { brevo } = config;
  if (!brevo.apiV3Key) {
    throw new Error(
      "Falta BREVO_API_V3_KEY en .env (clave de API v3 de Brevo, empieza por xkeysib-). " +
        "La clave SMTP (xsmtpsib-) no sirve para la API."
    );
  }

  const body = {
    sender: { email: brevo.senderEmail, name: brevo.senderName },
    to: addressList(to),
    subject,
    htmlContent: html,
    textContent: text,
  };
  if (cc && String(cc).trim()) body.cc = addressList(cc);
  const files = (attachments || []).map(attachmentToApi).filter(Boolean);
  if (files.length) body.attachment = files;

  const res = await fetch(`${brevo.apiUrl}/smtp/email`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": brevo.apiV3Key,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.message || data?.error || JSON.stringify(data).slice(0, 200);
    throw new Error(`Brevo API ${res.status}: ${detail}`);
  }
  return {
    messageId: data?.messageId || "",
    accepted: body.to.map((t) => t.email),
    rejected: [],
    transport: "brevo-api",
  };
}

async function sendViaSmtp({ to, cc, subject, html, text, attachments = [] }) {
  const transport = createTransport();
  const payload = {
    from: `"${config.brevo.senderName}" <${config.brevo.senderEmail}>`,
    to,
    subject,
    html,
    text,
  };
  if (cc && String(cc).trim()) {
    payload.cc = cc;
  }
  if (attachments?.length) {
    payload.attachments = attachments;
  }
  const info = await transport.sendMail(payload);
  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    transport: "smtp",
  };
}

export async function sendEmail({ to, cc, subject, html, text, attachments = [] }) {
  try {
    return await sendViaSmtp({ to, cc, subject, html, text, attachments });
  } catch (error) {
    if (!config.brevo.apiV3Key) {
      throw new Error(
        `${error.message} | Alternativa: define BREVO_API_V3_KEY para enviar por HTTPS (443) ` +
          "cuando la red bloquea el SMTP (VPN/ISP)."
      );
    }
    console.warn(
      `⚠️ SMTP falló (${String(error.message).slice(0, 120)}) → reenvío por API Brevo (443)…`
    );
    return sendViaBrevoApi({ to, cc, subject, html, text, attachments });
  }
}

export async function prepareClientEmail(
  clientId,
  date = new Date(),
  { channel = "tv" } = {}
) {
  const analisis = loadAnalisisHoy(date, channel);
  const { client, items } = filterForClient(analisis, clientId, channel);

  const pdf = await writeInformePdf({
    client,
    items,
    displayDate: analisis.displayDate,
    now: new Date(),
  });

  const email = buildInformeEmail({
    client,
    items,
    displayDate: analisis.displayDate,
    stamp: analisis.stamp,
    pdfFilename: pdf.filename,
  });

  const attachments = [
    {
      filename: pdf.filename,
      content: readFileSync(pdf.path),
      contentType: "application/pdf",
    },
  ];

  return { analisis, client, items, email, pdf, attachments, channel };
}

const FIXED_MONITORING_CC = "belgicajr@gmail.com";

export function mergeFixedCc(cc = "") {
  const existing = String(cc || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((e) => e.toLowerCase() !== FIXED_MONITORING_CC.toLowerCase());
  return [FIXED_MONITORING_CC, ...existing].join(", ");
}

async function sendClientPair({
  channel,
  date,
  destIntrant,
  destEdesur,
  destIntrantCc,
  destEdesurCc,
  dryRun,
}) {
  const intrantCc = mergeFixedCc(destIntrantCc);
  const edesurCc = mergeFixedCc(destEdesurCc);
  const edesurOn = config.edesurEnabled !== false;
  const intrant = await prepareClientEmail("intrant", date, { channel });
  const edesur = edesurOn
    ? await prepareClientEmail("edesur", date, { channel })
    : null;

  if (dryRun) {
    const results = [
      {
        client: "intrant",
        channel,
        to: destIntrant,
        cc: intrantCc,
        count: intrant.items.length,
        subject: intrant.email.subject,
        pdf: intrant.pdf.path,
      },
    ];
    if (edesur) {
      results.push({
        client: "edesur",
        channel,
        to: destEdesur,
        cc: edesurCc,
        count: edesur.items.length,
        subject: edesur.email.subject,
        pdf: edesur.pdf.path,
      });
    } else {
      results.push({
        client: "edesur",
        channel,
        skipped: true,
        reason: "EDESUR_ENABLED=false",
      });
    }
    return {
      channel,
      dryRun: true,
      file: intrant.analisis.path,
      results,
      intrant: {
        to: destIntrant,
        cc: intrantCc,
        count: intrant.items.length,
        subject: intrant.email.subject,
        pdf: intrant.pdf.path,
      },
      edesur: edesur
        ? {
            to: destEdesur,
            cc: edesurCc,
            count: edesur.items.length,
            subject: edesur.email.subject,
            pdf: edesur.pdf.path,
          }
        : { skipped: true, reason: "EDESUR_ENABLED=false" },
    };
  }

  const results = [];
  const sentIntrant = await sendEmail({
    to: destIntrant,
    cc: intrantCc,
    ...intrant.email,
    attachments: intrant.attachments,
  });
  results.push({
    client: "intrant",
    channel,
    to: destIntrant,
    cc: destIntrantCc || null,
    count: intrant.items.length,
    pdf: intrant.pdf.path,
    ...sentIntrant,
  });

  if (edesur && destEdesur) {
    const sentEdesur = await sendEmail({
      to: destEdesur,
      cc: edesurCc,
      ...edesur.email,
      attachments: edesur.attachments,
    });
    results.push({
      client: "edesur",
      channel,
      to: destEdesur,
      cc: destEdesurCc || null,
      count: edesur.items.length,
      pdf: edesur.pdf.path,
      ...sentEdesur,
    });
  } else {
    console.log(`[${channel}] Edesur omitido (EDESUR_ENABLED=false)`);
    results.push({
      client: "edesur",
      channel,
      skipped: true,
      reason: "EDESUR_ENABLED=false",
    });
  }

  return {
    channel,
    dryRun: false,
    file: intrant.analisis.path,
    results,
  };
}

/**
 * Envía informes Intrant + Edesur.
 * @param {object} opts
 * @param {"tv"|"radio"|string[]} [opts.channel="tv"]  canal o lista (ej. ["tv","radio"])
 */
export async function sendDailyInformeEmails({
  date = new Date(),
  toIntrant,
  toEdesur,
  ccIntrant,
  ccEdesur,
  dryRun = false,
  channel = "tv",
} = {}) {
  const destIntrant = toIntrant || config.informes.emailIntrant;
  const destEdesur = toEdesur || config.informes.emailEdesur;
  const destIntrantCc = toIntrant
    ? ""
    : ccIntrant !== undefined
      ? ccIntrant
      : config.informes.emailIntrantCc;
  const destEdesurCc = toEdesur
    ? ""
    : ccEdesur !== undefined
      ? ccEdesur
      : config.informes.emailEdesurCc;

  if (!destIntrant) {
    throw new Error("Falta INFORME_EMAIL_INTRANT en .env");
  }
  if (config.edesurEnabled !== false && !destEdesur) {
    throw new Error("Falta INFORME_EMAIL_EDESUR en .env (o pon EDESUR_ENABLED=false)");
  }

  const channels = Array.isArray(channel)
    ? channel
    : String(channel || "tv")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  const allResults = [];
  const files = [];
  let drySummary = null;

  for (const ch of channels) {
    try {
      const part = await sendClientPair({
        channel: ch,
        date,
        destIntrant,
        destEdesur,
        destIntrantCc,
        destEdesurCc,
        dryRun,
      });
      files.push(part.file);
      allResults.push(...part.results);
      if (dryRun && ch === channels[0]) {
        drySummary = {
          dryRun: true,
          file: part.file,
          files,
          intrant: part.intrant,
          edesur: part.edesur,
          results: allResults,
        };
      }
    } catch (error) {
      // Si falta el MD de radio (o TV), no tumba el otro canal
      if (/No encontré/i.test(error.message)) {
        console.warn(`⚠️  Canal ${ch}: ${error.message}`);
        allResults.push({
          client: "intrant",
          channel: ch,
          skipped: true,
          reason: error.message,
          to: "(sin archivo del día)",
          count: 0,
        });
        continue;
      }
      throw error;
    }
  }

  const sentOk = allResults.filter((r) => !r.skipped);
  if (!sentOk.length) {
    throw new Error(
      `No hay análisis del día ${todayStamp(date)} (canales: ${channels.join(", ")}). ` +
        `Falta el MD de hoy en ${config.informes.dir} — no se reenvía uno viejo.`
    );
  }

  if (dryRun) {
    return (
      drySummary || {
        dryRun: true,
        file: files[0],
        files,
        results: allResults,
      }
    );
  }

  return {
    dryRun: false,
    file: files[0],
    files,
    results: allResults,
  };
}
