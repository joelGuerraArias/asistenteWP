/**
 * Envía el resumen de licitaciones DGCP por correo electrónico.
 * Reutiliza la configuración Brevo existente de AsistenteWP.
 */

import { readFileSync } from "node:fs";
import { config } from "./config.mjs";
import { sendEmail } from "./informe-email.mjs";
import { buildDgcpEmail, writeDgcpPdf } from "./dgcp-digest.mjs";

export async function sendDgcpDigest({ url, keywords, total, items, to, now = new Date() }) {
  const email = buildDgcpEmail({ url, keywords, total, items, now });
  const pdf = await writeDgcpPdf({ items, subject: email.subject, now });

  const payload = {
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [
      {
        filename: pdf.filename,
        content: readFileSync(pdf.path),
        contentType: "application/pdf",
      },
    ],
  };

  const result = await sendEmail(payload);
  return {
    ...result,
    pdfPath: pdf.path,
    to,
    count: items.length,
    subject: email.subject,
  };
}

export function getDefaultRecipient() {
  return process.env.DGCP_DIGEST_TO || "autosemana@gmail.com";
}

export function isEmailConfigured() {
  return config.brevo.enabled;
}
