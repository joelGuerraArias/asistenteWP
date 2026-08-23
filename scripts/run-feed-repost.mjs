import { runFeedRepost } from "../src/feed-repost.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const countArg = args.find((a) => a.startsWith("--count="));
const count = countArg ? Number(countArg.split("=")[1]) : undefined;
const brand = args.includes("--f1")
  ? "f1rd"
  : args.includes("--fv")
    ? "fvdigital"
    : "all";

try {
  const result = await runFeedRepost({ dryRun, count, brand });
  if (result?.skipped) {
    console.log(`Omitido: ${result.reason || "skipped"}`);
    process.exit(0);
  }
  if (result?.noneNew) {
    console.log("Sin noticias nuevas.");
    process.exit(0);
  }
  const n = result?.published?.length || 0;
  const errs = result?.errors?.length || 0;
  console.log(
    dryRun
      ? `Dry-run OK: ${n} ítem(s)`
      : `Publicadas: ${n} | errores: ${errs}`
  );
  if (errs && !n) process.exit(1);
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
