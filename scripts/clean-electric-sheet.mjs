/**
 * Quita filas internacionales del Sheet eléctrico (solo RD).
 *   node scripts/clean-electric-sheet.mjs
 *   node scripts/clean-electric-sheet.mjs --dry-run
 */
import { config } from "../src/config.mjs";
import { isDominicanElectricContext } from "../src/google-alerts-parse.mjs";
import { getSheetsApi } from "../src/google-auth.mjs";
import { HEADERS } from "../src/sheets-alerts.mjs";

const dryRun = process.argv.includes("--dry-run");
const sheetId = config.electricAlerts?.sheetId;
const sheetName = config.electricAlerts?.sheetName || "Hoja 1";

if (!sheetId) {
  console.error("Falta ELECTRIC_ALERTS_SHEET_ID");
  process.exit(1);
}

const sheets = getSheetsApi();
const range = `'${sheetName.replace(/'/g, "''")}'!A:H`;
const full = await sheets.spreadsheets.values.get({
  spreadsheetId: sheetId,
  range,
});
const values = full.data.values || [];
if (!values.length) {
  console.log("Sheet vacío.");
  process.exit(0);
}

const header = values[0];
const rows = values.slice(1);
const kept = [];
const removed = [];

for (const row of rows) {
  const item = {
    title: row[2] || "",
    snippet: row[3] || "",
    source: row[4] || "",
    url: row[6] || "",
  };
  if (isDominicanElectricContext(item)) {
    kept.push(row);
  } else {
    removed.push(item);
  }
}

console.log(`Total filas: ${rows.length}`);
console.log(`Mantener (RD): ${kept.length}`);
console.log(`Quitar (internacional/sin señal RD): ${removed.length}`);
for (const r of removed.slice(0, 40)) {
  console.log(`  - ${String(r.title).slice(0, 90)} | ${r.source}`);
}
if (removed.length > 40) console.log(`  … y ${removed.length - 40} más`);

if (dryRun) {
  console.log("(dry-run — no se escribió nada)");
  process.exit(0);
}

const next = [
  header?.length >= 8 ? header.slice(0, 8) : HEADERS,
  ...kept.map((r) => {
    const out = [...r];
    while (out.length < 8) out.push("");
    return out.slice(0, 8);
  }),
];

await sheets.spreadsheets.values.clear({
  spreadsheetId: sheetId,
  range,
});
await sheets.spreadsheets.values.update({
  spreadsheetId: sheetId,
  range: `'${sheetName.replace(/'/g, "''")}'!A1`,
  valueInputOption: "RAW",
  requestBody: { values: next },
});

console.log(`✅ Sheet limpio: ${kept.length} filas RD`);
console.log(`https://docs.google.com/spreadsheets/d/${sheetId}`);
