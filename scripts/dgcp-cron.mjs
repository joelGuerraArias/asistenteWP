/**
 * Cron local: lee licitaciones DGCP y envía resumen por correo.
 * Horarios configurables por .env DGCP_DIGEST_CRON_TIMES (por defecto 08:00 y 17:00).
 *
 *   npm run dgcp:cron
 *
 * En producción Windows preferir la tarea programada:
 *   npm run dgcp:cron:install
 */
import { config } from "../src/config.mjs";
import { scrapeDgcp } from "../src/dgcp-scraper.mjs";
import { sendDgcpDigest, getDefaultRecipient, isEmailConfigured } from "../src/dgcp-email.mjs";

const times = config.dgcp?.cronTimes?.length
  ? config.dgcp.cronTimes
  : [
      { hour: 8, minute: 0 },
      { hour: 17, minute: 0 },
    ];

const lastRunKeys = new Set();

function formatTime({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

console.log(
  `📅 Cron DGCP Digest activo — ${times.map(formatTime).join(" y ")} (hora local)`
);
console.log(`Destinatario: ${getDefaultRecipient()}`);
console.log(`Email configurado: ${isEmailConfigured() ? "Sí" : "No — revisa BREVO_*"}`);

async function runDigest(label) {
  const now = new Date();
  console.log(`\n[${now.toISOString()}] Ejecutando DGCP Digest (${label})...`);
  try {
    const scraped = await scrapeDgcp();
    console.log(`  → ${scraped.total} licitaciones revisadas · ${scraped.items.length} coincidencias`);

    const result = await sendDgcpDigest({
      ...scraped,
      to: getDefaultRecipient(),
      now,
    });

    console.log(`✅ Enviado → ${result.to} · ${result.count} coincidencias · id=${result.messageId || "n/a"}`);
    console.log(`   PDF: ${result.pdfPath}`);
  } catch (error) {
    console.error(`❌ Falló el envío: ${error.message}`);
  }
}

async function tick() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  for (const slot of times) {
    if (h !== slot.hour || m !== slot.minute) continue;

    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${slot.hour}-${slot.minute}`;
    if (lastRunKeys.has(key)) continue;
    lastRunKeys.add(key);

    // limpiar claves viejas (más de 2 días)
    if (lastRunKeys.size > 20) {
      for (const k of [...lastRunKeys]) {
        if (!k.startsWith(`${now.getFullYear()}-${now.getMonth()}-`)) {
          lastRunKeys.delete(k);
        }
      }
    }

    await runDigest(formatTime(slot));
  }
}

setInterval(tick, 20_000);
tick();
