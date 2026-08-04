/**
 * Cron local: envía MONITOREO TV + RADIO (Intrant + Edesur) a las horas configuradas.
 * Por defecto: 17:00 y 23:00 (hora local).
 *
 *   npm run informe:cron
 *
 * En producción en Windows preferir la tarea programada:
 *   npm run informe:cron:install
 */
import { config } from "../src/config.mjs";
import { sendDailyInformeEmails } from "../src/informe-email.mjs";

const times = config.informes.cronTimes?.length
  ? config.informes.cronTimes
  : [
      { hour: 17, minute: 0 },
      { hour: 23, minute: 0 },
    ];

const lastRunKeys = new Set();

function formatTime({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

console.log(
  `📅 Cron MONITOREO TV+RADIO activo — ${times.map(formatTime).join(" y ")} (hora local)`
);
console.log(`Carpeta: ${config.informes.dir}`);
console.log(`Intrant → ${config.informes.emailIntrant || "(sin destino)"}`);
console.log(`Edesur  → ${config.informes.emailEdesur || "(sin destino)"}`);

async function runSend(label) {
  const now = new Date();
  console.log(`\n[${now.toISOString()}] Ejecutando envío (${label})...`);
  try {
    const result = await sendDailyInformeEmails({
      date: now,
      channel: ["tv", "radio"],
    });
    for (const r of result.results) {
      console.log(`✅ [${r.channel || "tv"}] ${r.client} → ${r.to} (${r.count})`);
    }
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

    await runSend(formatTime(slot));
  }
}

setInterval(tick, 20_000);
tick();
