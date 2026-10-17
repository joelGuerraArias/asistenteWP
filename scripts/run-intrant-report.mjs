/**
 * REPORTE Intrant — fuentes del día → Word + correo (07:30 / 17:00) o a demanda.
 *
 *   node scripts/run-intrant-report.mjs
 *   node scripts/run-intrant-report.mjs --dry-run
 *   node scripts/run-intrant-report.mjs --date=20260830
 *   node scripts/run-intrant-report.mjs --refresh=instagram
 *   node scripts/run-intrant-report.mjs --refresh=facebook
 *   node scripts/run-intrant-report.mjs --no-email
 *   node scripts/run-intrant-report.mjs --to=autosemana@gmail.com   # prueba: solo ese correo, sin CC
 */
import { runIntrantReport, formatReporteTelegram } from "../src/intrant-report.mjs";

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    noEmail: false,
    refreshInstagram: false,
    refreshFacebook: false,
    date: new Date(),
  };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--to=")) opts.toOverride = arg.slice(5).trim();
    else if (arg === "--no-email") opts.noEmail = true;
    else if (arg === "--refresh=instagram" || arg === "--refresh=ig") {
      opts.refreshInstagram = true;
    } else if (arg === "--refresh=facebook" || arg === "--refresh=fb") {
      opts.refreshFacebook = true;
    } else if (arg.startsWith("--date=")) {
      const stamp = arg.slice(7).trim();
      if (!/^\d{8}$/.test(stamp)) throw new Error(`Fecha inválida: ${stamp}`);
      opts.date = new Date(
        Number(stamp.slice(0, 4)),
        Number(stamp.slice(4, 6)) - 1,
        Number(stamp.slice(6, 8))
      );
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const result = await runIntrantReport({
  ...opts,
  onStatus: (msg) => console.log(msg),
});
console.log(formatReporteTelegram(result));
if (result.docx?.path) console.log(`Word: ${result.docx.path}`);
