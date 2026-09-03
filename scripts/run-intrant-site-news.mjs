/**
 * One-shot: monitor noticias oficiales INTRANT.
 *   node scripts/run-intrant-site-news.mjs
 *   node scripts/run-intrant-site-news.mjs --dry-run
 *   node scripts/run-intrant-site-news.mjs --force-latest
 *   node scripts/run-intrant-site-news.mjs --force-latest --to autosemana@gmail.com
 *   node scripts/run-intrant-site-news.mjs --force
 */
import {
  formatIntrantSiteNewsResult,
  runIntrantSiteNewsCheck,
} from "../src/intrant-site-news.mjs";

const dryRun = process.argv.includes("--dry-run");
const forceSendAll = process.argv.includes("--force");
const forceLatest =
  process.argv.includes("--force-latest") ||
  process.argv.includes("--latest");

const toIdx = process.argv.findIndex((a) => a === "--to");
const toOverride =
  toIdx >= 0 && process.argv[toIdx + 1] ? process.argv[toIdx + 1] : "";

try {
  const result = await runIntrantSiteNewsCheck({
    dryRun,
    forceSendAll,
    forceLatest,
    toOverride,
    skipCc: Boolean(toOverride),
    onStatus: (msg) => console.log(msg),
  });
  console.log(formatIntrantSiteNewsResult(result));
  if (result.mailResult?.accepted) {
    console.log("Accepted:", result.mailResult.accepted.join(", "));
  }
  process.exit(0);
} catch (error) {
  console.error("❌", error.message);
  process.exit(1);
}
