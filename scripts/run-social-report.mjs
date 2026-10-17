/**
 * Estado de redes (Instagram / X / YouTube) → correo a los registrados del Intrant.
 *   node scripts/run-social-report.mjs                      # ambos canales, envía
 *   node scripts/run-social-report.mjs --channel=instagram  # solo Instagram
 *   node scripts/run-social-report.mjs --channel=x          # solo X
 *   node scripts/run-social-report.mjs --dry-run            # no envía; guarda vista previa en logs/
 *   node scripts/run-social-report.mjs --to=autosemana@gmail.com   # prueba a un solo correo
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import { runInstagramReport } from "../src/instagram-report.mjs";
import { runXReport } from "../src/x-report.mjs";
import { runYoutubeReport, youtubeKey } from "../src/youtube-report.mjs";

const args = process.argv.slice(2);
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") || "";
const dryRun = args.includes("--dry-run");
const to = arg("to");
const channel = (arg("channel") || "all").toLowerCase();
const log = (m) => console.log(m);
const logsDir = join(config.root, "logs");
mkdirSync(logsDir, { recursive: true });

const jobs = [];
if (channel === "all" || channel === "instagram" || channel === "ig") jobs.push(["instagram", runInstagramReport]);
if (channel === "all" || channel === "x" || channel === "twitter") jobs.push(["x", runXReport]);
if (channel === "youtube" || channel === "yt" || (channel === "all" && youtubeKey())) jobs.push(["youtube", runYoutubeReport]);
if (channel === "all" && !youtubeKey()) console.log("ℹ️ YouTube omitido: falta YOUTUBE_API_KEY en .env");

let failed = 0;
for (const [name, fn] of jobs) {
  console.log(`\n══ ${name.toUpperCase()} ══`);
  try {
    const r = await fn({ dryRun, to, onStatus: log });
    console.log(`Menciones: ${r.items.length}`);
    // Control de frescura: ninguna publicación puede superar 24 h
    const ages = r.items.map((it) => {
      const t = new Date(it.publishedAt || it.postedAt || "").getTime();
      return Number.isFinite(t) ? (Date.now() - t) / 3600000 : null;
    });
    const sinHora = ages.filter((a) => a === null).length;
    const maxAge = Math.max(0, ...ages.filter((a) => a !== null));
    console.log(`⏱️ Frescura: más antigua ${maxAge.toFixed(1)} h · sin hora ${sinHora}`);
    if (maxAge > 24 || sinHora) {
      console.error(`❌ ${name}: hay publicaciones fuera de 24 h o sin hora — NO se envía`);
      failed++;
      continue;
    }
    for (const it of r.items) console.log(` · ${it.medio} (${it.hora || it.at || ""}) ${it.title}\n   ${it.url}`);
    const sinUrl = r.items.filter((it) => !String(it.url || "").trim()).length;
    if (sinUrl) console.log(`⚠️ ${sinUrl} ítem(s) sin URL de fuente (el correo indicará "no disponible")`);
    if (name === "youtube") {
      const c = r.client;
      console.log(c?.ok ? `Último video ${c.channelTitle}: ${c.video.url} · comentarios: ${c.comments.length}` : `Último video: no disponible (${c?.error || ""})`);
    }
    if (name === "instagram") {
      const c = r.client;
      console.log(c?.ok && c.latest ? `Último post @${c.username}: ${c.latest.url} · comentarios: ${c.comments?.comments?.length ?? 0}` : `Último post: no disponible (${String(c?.error || "").slice(0, 100)})`);
    }
    console.log(`\nResumen:\n${r.summaryMd}`);
    const preview = join(logsDir, `estado-${name}-preview.html`);
    // En la vista previa local, los íconos CID se muestran desde assets/redes
    writeFileSync(preview, r.html.replace(/cid:icon-(\w+)/g, (_, n) => `../assets/redes/${n}.png`), "utf8");
    console.log(dryRun ? `(dry-run) Asunto: ${r.subject}\nVista previa: ${preview}` : `✅ Enviado: ${r.subject} → ${r.recipients?.to}${r.recipients?.cc ? ` (CC ${r.recipients.cc})` : ""}`);
  } catch (e) {
    failed++;
    console.error(`❌ ${name}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
