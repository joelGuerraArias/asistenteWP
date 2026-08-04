/**
 * Mantiene Sheet Edesur/eléctrico:
 * - medio vacío ← URL
 * - título vacío ← texto
 * - fecha → dd/mm/yyyy (17/07/2026)
 *
 *   node scripts/maintain-electric-sheet.mjs
 */
import { config } from "../src/config.mjs";
import { maintainElectricSheet } from "../src/sheets-alerts.mjs";

try {
  if (config.edesurEnabled === false) {
    console.log("Edesur pausado (EDESUR_ENABLED=false). Nada que mantener.");
    process.exit(0);
  }
  console.log("Mantenimiento Sheet Edesur (medio / título / fecha)…");
  const result = await maintainElectricSheet();
  console.log(`Revisadas: ${result.checked}`);
  console.log(`Medio completado: ${result.medioFilled}`);
  console.log(`Título desde texto: ${result.tituloFilled}`);
  console.log(`Fechas normalizadas: ${result.fechaNormalized}`);
  for (const s of result.samples) {
    console.log(`  fila ${s.row}: ${s.titulo}`);
    console.log(`    ${s.changes.join(" | ")}`);
  }
  console.log(`https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`);
} catch (error) {
  console.error("❌", error.message);
  process.exit(1);
}
