/**
 * Limpieza Intrant: filas del día con noticia >24h (verificando URL).
 *
 *   node scripts/purge-stale-intrant.mjs
 *   node scripts/purge-stale-intrant.mjs --dry-run
 *   node scripts/purge-stale-intrant.mjs --dry-run --no-telegram
 */
import { purgeStaleIntrantDayRows } from "../src/purge-stale-intrant.mjs";

function parseArgs(argv) {
  const opts = { dryRun: false, notify: true };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    if (arg === "--no-telegram") opts.notify = false;
    if (arg === "--telegram") opts.notify = true;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

try {
  console.log(
    opts.dryRun
      ? "Dry-run: revisar filas Intrant del día (>24h vía URL)…"
      : "Limpiando Intrant: filas del día con noticia >24h (verificando URL)…"
  );
  const result = await purgeStaleIntrantDayRows({
    dryRun: opts.dryRun,
    notify: opts.notify,
  });
  console.log(
    `Revisadas: ${result.checked} | Borrar: ${result.deleted} | Fallos URL: ${result.failed} | Conservadas total: ${result.kept}`
  );
  for (const r of result.removed || []) {
    console.log(
      `  🗑️  ${(r.titulo || "").slice(0, 70)} | ${r.ageHours}h | ${r.url}`
    );
  }
  for (const e of result.errors || []) {
    console.log(`  ⚠️  ${(e.titulo || e.url || "").slice(0, 60)} — ${e.error}`);
  }
  console.log(`📄 https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`);
} catch (error) {
  console.error("❌", error.message);
  process.exit(1);
}
