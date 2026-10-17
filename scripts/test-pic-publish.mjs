/**
 * Prueba E2E del mismo camino que /pic → redes (sendSocialCard / sendCardToWebhook).
 * Uso: node scripts/test-pic-publish.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.mjs";
import { generateNewsCard } from "../src/social-card.mjs";
import { uploadToR2 } from "../src/r2.mjs";
import {
  assertDestWebhooksReady,
  publishToWebhook,
  destLabel,
  webhookTargets,
  captionForTarget,
} from "../src/publish-webhook.mjs";
import { composeCardHeadline, generateSocialCaption } from "../src/deepseek.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, ".last-pic");

function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH26AAAAAElFTkSuQmCC",
    "base64"
  );
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("OK:", msg);
}

async function main() {
  const title = `Prueba /pic JARVIS ${new Date().toISOString().slice(11, 19)}`;
  const dest = "fvdigital";
  const bodyText = title;

  console.log("--- 1) Config ---");
  if (!config.socialCard?.enabled) fail("SOCIAL_CARD deshabilitado");
  ok("socialCard enabled");
  if (!config.r2?.enabled) fail("R2 deshabilitado");
  ok("R2 enabled");
  assertDestWebhooksReady(dest);
  ok(`webhooks listos: ${webhookTargets(dest).join(", ")}`);

  console.log("--- 2) Generar tarjeta (mismo generateNewsCard) ---");
  const bg = tinyPng();
  const cardTitle = await composeCardHeadline(title, bodyText, { lang: "es" }).catch(
    () => title
  );
  ok(`titular tarjeta: ${cardTitle}`);
  const card = await generateNewsCard({
    backgroundBuffer: bg,
    title: cardTitle,
  });
  if (!Buffer.isBuffer(card) || card.length < 1000) fail("tarjeta inválida");
  ok(`tarjeta PNG ${card.length} bytes`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "bg.bin"), bg);
  writeFileSync(join(outDir, "card.png"), card);
  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      { title, dest, pending: true, at: new Date().toISOString(), test: true },
      null,
      2
    )
  );
  ok("guardado en .last-pic/");

  console.log("--- 3) Caption + upload R2 + webhook (mismo sendCardToWebhook) ---");
  const results = [];
  for (const target of webhookTargets(dest)) {
    const hashtag =
      target === "f1rd"
        ? config.f1rdWebhook?.hashtag || "#Formula1RD"
        : config.publishWebhook?.hashtag || "#fvdigital";

    const captionSeed = await generateSocialCaption(title, bodyText, {
      hashtag,
      lang: "es",
    }).catch(() => `${title}\n\n${hashtag}`.trim());

    const publicUrl = await uploadToR2(
      card,
      `cards/pic-e2e-${Date.now()}.png`,
      "image/png"
    );
    if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) {
      fail(`URL R2 inválida: ${publicUrl}`);
    }
    ok(`R2: ${publicUrl}`);

    const published = await publishToWebhook({
      caption: captionSeed,
      title: cardTitle,
      imageUrl: publicUrl,
      mediaType: "IMAGE",
      target,
    });
    results.push(published);
    console.log("webhook result:", JSON.stringify(published));
    if (!published.ok) {
      fail(`webhook ${target}: ${published.error || published.status}`);
    }
    ok(
      `${destLabel(target)} → ${published.queued ? "encolado" : "enviado"} (HTTP ${published.status || "ok"})`
    );
    ok(`caption:\n${captionForTarget(published.caption || captionSeed, target)}`);
  }

  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      {
        title,
        dest,
        pending: false,
        sentAt: new Date().toISOString(),
        test: true,
        results,
      },
      null,
      2
    )
  );

  console.log("--- 4) Health bot ---");
  try {
    const health = await fetch("http://127.0.0.1:9000/health").then((r) => r.json());
    if (!health.ok || !health.telegramOk) fail(`health: ${JSON.stringify(health)}`);
    ok(`bot online uptime=${health.uptimeSec}s`);
  } catch (e) {
    fail(`bot health: ${e.message}`);
  }

  console.log("\n=== PASS 100% — /pic → redes (R2 + n8n) OK ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
