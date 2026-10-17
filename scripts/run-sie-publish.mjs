import { runSiePublishCron } from "../src/sie-publish.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipTelegram = args.includes("--skip-telegram");

try {
  const result = await runSiePublishCron({
    dryRun,
    skipTelegram,
    onStatus: (msg) => console.log(msg),
  });
  if (result?.skipped) {
    console.log(`Omitido: ${result.reason}`);
    process.exit(0);
  }
  if (result?.dryRun) {
    console.log("--- dry-run ---");
    console.log("video:", result.name);
    console.log("stt:", result.fromCache ? "cache" : "nuevo");
    console.log("lang:", result.language, "translated:", result.translated);
    console.log("caption:\n", result.caption);
    process.exit(0);
  }
  console.log(
    `OK: ${result.name} → ${result.queued ? "encolado" : "enviado"} | quedan ${result.remainingAfter}`
  );
  console.log(result.videoUrl);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
