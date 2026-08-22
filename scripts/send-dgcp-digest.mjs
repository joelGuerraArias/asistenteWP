/**
 * Envía manualmente el resumen DGCP ahora mismo.
 * Útil para probar o ejecutar bajo demanda.
 *
 *   node scripts/send-dgcp-digest.mjs
 *   node scripts/send-dgcp-digest.mjs --dry-run
 *   node scripts/send-dgcp-digest.mjs --to=otro@email.com
 */
import { readFileSync } from "node:fs";
import { config } from "../src/config.mjs";
import { scrapeDgcp } from "../src/dgcp-scraper.mjs";
import { buildDgcpEmail, writeDgcpPdf } from "../src/dgcp-digest.mjs";
import { sendEmail } from "../src/informe-email.mjs";
import { getDefaultRecipient, isEmailConfigured } from "../src/dgcp-email.mjs";

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    to: getDefaultRecipient(),
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--to=")) opts.to = arg.slice(5).trim();
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const now = new Date();

(async () => {
  try {
    console.log(`Leyendo DGCP...`);
    const scraped = await scrapeDgcp();
    console.log(`  → ${scraped.total} licitaciones · ${scraped.items.length} coincidencias`);

    if (!scraped.items.length) {
      console.log("No hay coincidencias. No se envía correo.");
      return;
    }

    const email = buildDgcpEmail({ ...scraped, now });
    const pdf = await writeDgcpPdf({ items: scraped.items, subject: email.subject, now });

    if (opts.dryRun || !isEmailConfigured()) {
      console.log("\n--- MODO DRY-RUN ---");
      console.log(`Para: ${opts.to}`);
      console.log(`Asunto: ${email.subject}`);
      console.log(`PDF: ${pdf.path}`);
      console.log("\n--- TEXTO ---");
      console.log(email.text);
      return;
    }

    const result = await sendEmail({
      to: opts.to,
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
    });

    console.log(`✅ Enviado → ${opts.to} · id=${result.messageId}`);
    console.log(`   PDF: ${pdf.path}`);
  } catch (error) {
    console.error("❌", error.message);
    process.exit(1);
  }
})();
