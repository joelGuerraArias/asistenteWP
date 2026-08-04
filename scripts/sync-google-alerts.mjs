/**
 * Sync Google Alerts (Gmail) → Sheet Intrant.
 * Sin Tavily.
 *
 *   npm run alerts:sync
 *   npm run alerts:sync -- --replace
 *   npm run alerts:dry
 */
import { config } from "../src/config.mjs";
import { fetchGoogleAlertsForSheet } from "../src/gmail-alerts.mjs";
import { appendAlertsToSheet, replaceAlertsSheet } from "../src/sheets-alerts.mjs";

function parseArgs(argv) {
  const opts = { dryRun: false, replace: true, onlyToday: true };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    if (arg === "--replace") opts.replace = true;
    if (arg === "--append") opts.replace = false;
    if (arg === "--week") opts.onlyToday = false;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

try {
  console.log(
    `📬 Google Alerts Intrant desde Gmail (${opts.onlyToday ? "hoy" : "semana"})...`
  );
  console.log(
    `Filtros: ${(config.googleAlerts?.filters || []).join(", ") || "(default)"}`
  );

  const alerts = await fetchGoogleAlertsForSheet({
    onlyToday: opts.onlyToday,
    maxMessages: 100,
    mode: "intrant",
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
    ? await replaceAlertsSheet(alerts)
    : await appendAlertsToSheet(alerts);

  if (result.removedTodayNoise != null) {
    console.log(
      `✅ Sheet: ${result.added} filas hoy | quitadas previas auto: ${result.removedTodayNoise} | histórico: ${result.keptHistorical}`
    );
  } else {
    console.log(`✅ Sheet: +${result.added} (skip ${result.skipped})`);
  }
  console.log(`📄 https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`);
} catch (error) {
  console.error("❌", error.message);
  process.exit(1);
}
