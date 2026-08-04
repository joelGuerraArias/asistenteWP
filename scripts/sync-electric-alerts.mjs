/**
 * Sync Google Alerts (Gmail) → Sheet eléctrico.
 * Sin Tavily.
 *
 *   npm run electric:sync
 *   npm run electric:sync -- --replace
 *   npm run electric:sync -- --repair-dates
 *   npm run electric:dry
 */
import { config } from "../src/config.mjs";
import { fetchGoogleAlertsForSheet } from "../src/gmail-alerts.mjs";
import {
  appendAlertsToSheet,
  replaceAlertsSheet,
  repairSheetFechas,
} from "../src/sheets-alerts.mjs";

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    replace: true,
    onlyToday: true,
    repairDates: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    if (arg === "--replace") opts.replace = true;
    if (arg === "--append") opts.replace = false;
    if (arg === "--week") opts.onlyToday = false;
    if (arg === "--repair-dates") opts.repairDates = true;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const sheetId = config.electricAlerts?.sheetId;
const sheetName = config.electricAlerts?.sheetName || "Hoja 1";

try {
  if (config.edesurEnabled === false) {
    console.log("Edesur/eléctrico desactivado (EDESUR_ENABLED=false). Nada que sincronizar.");
    process.exit(0);
  }
  if (!sheetId) throw new Error("Falta ELECTRIC_ALERTS_SHEET_ID");

  if (opts.repairDates) {
    console.log(`Reparando fechas corruptas (1901, etc.) en sheet electrico...`);
    console.log(`Sheet: ${sheetId}`);
    const result = await repairSheetFechas({
      spreadsheetId: sheetId,
      sheetName,
    });
    console.log(
      `Fechas reparadas: ${result.repaired} de ${result.total} filas`
    );
    console.log(
      `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`
    );
    process.exit(0);
  }

  console.log(
    `📬 Google Alerts eléctricas desde Gmail (${opts.onlyToday ? "hoy" : "semana"})...`
  );
  console.log(`Filtros: ${(config.electricAlerts?.filters || []).join(", ")}`);
  console.log(`Sheet: ${sheetId}`);

  const alerts = await fetchGoogleAlertsForSheet({
    onlyToday: opts.onlyToday,
    maxMessages: 100,
    mode: "electric",
    onStatus: (m) => console.log(m),
  });

  console.log(`Encontradas ${alerts.length} alerta(s).`);

  if (opts.dryRun) {
    for (const a of alerts.slice(0, 20)) {
      console.log(`- ${a.title}`);
      console.log(`  Medio: ${a.source} | Query: ${a.alertQuery}`);
      console.log(`  ${a.url}`);
      console.log("");
    }
    process.exit(0);
  }

  const result = opts.replace
    ? await replaceAlertsSheet(alerts, { spreadsheetId: sheetId, sheetName })
    : await appendAlertsToSheet(alerts, { spreadsheetId: sheetId, sheetName });

  if (result.removedTodayNoise != null) {
    console.log(
      `Sheet electrico: ${result.added} hoy | quitadas: ${result.removedTodayNoise} | historico: ${result.keptHistorical}`
    );
  } else {
    console.log(`Sheet electrico: +${result.added} (skip ${result.skipped})`);
  }
  console.log(`https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
