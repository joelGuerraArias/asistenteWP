/**
 * Así va el día — Intrant
 *   node scripts/run-asi-va-el-dia.mjs
 *   node scripts/run-asi-va-el-dia.mjs --dry-run
 *   node scripts/run-asi-va-el-dia.mjs --to=autosemana@gmail.com
 *   node scripts/run-asi-va-el-dia.mjs --to=autosemana@gmail.com --skip-sync
 */
import { runAsiVaElDia } from "../src/asi-va-el-dia.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipSync = args.includes("--skip-sync");
const skipCc = args.includes("--skip-cc");
const toArg = args.find((a) => a.startsWith("--to="));
const toOverride = toArg ? toArg.slice(5).trim() : "";

try {
  const result = await runAsiVaElDia({
    dryRun,
    toOverride,
    skipCc: skipCc || Boolean(toOverride),
    skipSync,
    sample: Boolean(toOverride),
    onStatus: (m) => console.log(m),
  });
  if (result.dryRun) {
    console.log("--- dry-run ---");
    console.log("to:", result.to);
    console.log("cc:", result.cc || "(ninguno)");
    console.log("subject:", result.subject);
    console.log("count:", result.count);
    console.log(result.previewText);
    process.exit(0);
  }
  console.log(
    `OK: ${result.subject} → ${result.to} (${result.count} noticias) id=${result.messageId || "?"}`
  );
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
