import { encuestasDailyLimit, runEncuestas, runEncuestasCheck } from "../src/encuestas.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const socialOnly = args.includes("--social-only");
const previewOnly = args.includes("--preview");
const check = args.includes("--check");
const skipTelegram = args.includes("--skip-telegram");
const limitArg = args.find((a) => a.startsWith("--limit="));
const idArg = args.find((a) => a.startsWith("--id="));
const onlyId = idArg ? idArg.split("=").slice(1).join("=") : "";
const limit = limitArg
  ? Number(limitArg.split("=")[1])
  : args.includes("--daily")
    ? encuestasDailyLimit()
    : undefined;

try {
  if (check) {
    const result = await runEncuestasCheck({ notify: !skipTelegram });
    console.log(result.message);
    process.exit(result.ok || !result.pending ? 0 : 2);
  }

  const result = await runEncuestas({
    dryRun,
    force,
    socialOnly,
    previewOnly,
    onlyId,
    limit,
    skipTelegram,
  });
  if (result?.noneNew) {
    console.log("Sin encuestas nuevas.");
    process.exit(0);
  }
  const n = result?.published?.length || 0;
  const skip = result?.skipped?.length || 0;
  const errs = result?.errors?.length || 0;
  console.log(
    dryRun
      ? `Dry-run OK: ${n} | omitidas: ${skip}`
      : previewOnly
        ? `Preview Telegram: ${n} | omitidas: ${skip} | errores: ${errs}`
        : `Publicadas: ${n} | omitidas: ${skip} | errores: ${errs}`
  );
  if (errs && !n) process.exit(1);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
