/**
 * Completa "medio" vacío y normaliza formato de fecha (sin cambiar el día)
 * en Sheet Intrant.
 *
 *   node scripts/fill-intrant-medio.mjs
 *   node scripts/fill-intrant-medio.mjs --dry-run
 */
import { config } from "../src/config.mjs";
import { getSheetsApi, resolveAlertsSpreadsheetId } from "../src/google-auth.mjs";
import { parseSourceFromUrl } from "../src/news-format.mjs";
import {
  fillMissingMedioInSheet,
  isMissingMedio,
  padFechaFormatOnly,
} from "../src/sheets-alerts.mjs";

const dryRun = process.argv.includes("--dry-run");

try {
  if (dryRun) {
    const id = await resolveAlertsSpreadsheetId();
    const tab = config.googleAlerts?.sheetName || "Hoja 1";
    const sheets = getSheetsApi();
    const full = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${tab}!A:H`,
    });
    const values = full.data.values || [];
    let missing = 0;
    let fechaPad = 0;
    for (const row of values.slice(1)) {
      const fechaRaw = String(row[0] || "").trim();
      const padded = padFechaFormatOnly(fechaRaw);
      if (padded && padded !== fechaRaw) {
        fechaPad += 1;
        if (fechaPad <= 10) console.log(`fecha: ${fechaRaw} → ${padded}`);
      }
      const medio = String(row[4] || "").trim();
      const url = String(row[6] || "").trim();
      if (!isMissingMedio(medio) || !/^https?:\/\//i.test(url)) continue;
      const fromUrl = parseSourceFromUrl(url).name;
      if (!fromUrl) continue;
      missing += 1;
      if (missing <= 20) {
        console.log(
          `- ${String(row[2] || "").slice(0, 60)} → ${fromUrl}`
        );
      }
    }
    console.log(`Sin medio (con URL): ${missing} de ${Math.max(0, values.length - 1)}`);
    console.log(`Fechas a normalizar (solo formato): ${fechaPad}`);
    process.exit(0);
  }

  console.log("Revisando Sheet Intrant: medio vacío + formato de fecha…");
  const result = await fillMissingMedioInSheet();
  console.log(
    `Revisadas: ${result.checked} | Medio: ${result.filled} | Fecha formato: ${result.fechaNormalized || 0}`
  );
  for (const s of result.samples) {
    console.log(`  fila ${s.row}: ${s.titulo} → ${s.medio}`);
  }
  console.log(`https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`);
} catch (error) {
  console.error("❌", error.message);
  process.exit(1);
}
