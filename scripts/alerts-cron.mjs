/**
 * Cron: Google Alerts (Gmail) → Sheets Intrant + eléctrico
 * según GOOGLE_ALERTS_CRON_TIMES / ELECTRIC_ALERTS_CRON_TIMES
 *
 *   npm run alerts:cron
 *   npm run alerts:cron:install   (tarea Windows)
 */
import { config } from "../src/config.mjs";
import { fetchGoogleAlertsForSheet } from "../src/gmail-alerts.mjs";
import { replaceAlertsSheet } from "../src/sheets-alerts.mjs";

const times = config.googleAlerts?.cronTimes?.length
  ? config.googleAlerts.cronTimes
  : [
      { hour: 8, minute: 30 },
      { hour: 16, minute: 30 },
    ];

const lastRunKeys = new Set();

function formatSlot(s) {
  if (s.hour < 0) return `cada hora :${String(s.minute).padStart(2, "0")}`;
  return `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
}

const edesurOn = config.edesurEnabled !== false;
console.log(
  `📅 Cron Google Alerts (Gmail) → Sheets Intrant${edesurOn ? " + eléctrico" : " (Edesur OFF)"}`
);
console.log(`Horarios: ${times.map(formatSlot).join(", ")}`);

async function runOnce() {
  const now = new Date();
  console.log(
    `\n[${now.toISOString()}] Sync Intrant${edesurOn ? " + electrico" : ""} (Gmail)...`
  );
  try {
    const alerts = await fetchGoogleAlertsForSheet({
      onlyToday: true,
      maxMessages: 100,
      mode: "intrant",
      onStatus: (m) => console.log(m),
    });
    const result = await replaceAlertsSheet(alerts);
    console.log(
      `Intrant hoy ${result.added} | ruido ${result.removedTodayNoise} | historico ${result.keptHistorical}`
    );
  } catch (error) {
    console.error(`Intrant: ${error.message}`);
  }

  if (!edesurOn) {
    console.log("Electrico omitido (EDESUR_ENABLED=false)");
    return;
  }

  try {
    const electric = await fetchGoogleAlertsForSheet({
      onlyToday: true,
      maxMessages: 100,
      mode: "electric",
      onStatus: (m) => console.log(m),
    });
    const sheetId = config.electricAlerts?.sheetId;
    const sheetName = config.electricAlerts?.sheetName || "Hoja 1";
    if (!sheetId) throw new Error("Falta ELECTRIC_ALERTS_SHEET_ID");
    const result = await replaceAlertsSheet(electric, {
      spreadsheetId: sheetId,
      sheetName,
    });
    console.log(
      `Electrico hoy ${result.added} | ruido ${result.removedTodayNoise} | historico ${result.keptHistorical}`
    );
  } catch (error) {
    console.error(`Electrico: ${error.message}`);
  }
}

async function tick() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  for (const slot of times) {
    const matchHour = slot.hour < 0 || slot.hour === h;
    if (!matchHour || slot.minute !== m) continue;

    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${slot.hour < 0 ? h : slot.hour}-${slot.minute}`;
    if (lastRunKeys.has(key)) continue;
    lastRunKeys.add(key);
    await runOnce();
  }
}

setInterval(tick, 20_000);
tick();
