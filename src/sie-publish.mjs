/**
 * Cron SIE 06:00 — toma un .mp4 de la carpeta sie (rotación propia),
 * transcribe → español si hace falta → caption → R2 → webhook FV.
 * Sin logo ni lower-third / titular sobre el video.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Telegraf } from "telegraf";
import { config } from "./config.mjs";
import { transcribeAudioAuto } from "./audio.mjs";
import { generateSocialCaption, translateToSpanish } from "./deepseek.mjs";
import { isPublicR2Url, uploadToR2 } from "./r2.mjs";
import { publishToDestinations } from "./publish-webhook.mjs";
import { listSieVideos } from "./sie-bumper.mjs";
import { isSpanishAudio } from "./trad-video.mjs";
import { archiveProcessedVideoSafe } from "./video-archive.mjs";

function resolveFfmpeg() {
  const fromEnv = String(
    config.siePublish?.ffmpegPath ||
      config.sieBumper?.ffmpegPath ||
      config.trad?.ffmpegPath ||
      ""
  ).trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    process.env.FFMPEG_PATH,
    "C:\\Users\\Joel Guerra\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe",
    "ffmpeg",
    "ffmpeg.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (p === "ffmpeg" || p === "ffmpeg.exe") return p;
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

function runCmd(bin, args, { timeoutMs = 420_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`No pude ejecutar ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || `${bin} exit ${code}`).trim().slice(-600)));
        return;
      }
      resolve({ stderr });
    });
  });
}

function sieDir() {
  return String(
    config.siePublish?.dir ||
      config.sieBumper?.dir ||
      "C:\\Users\\Joel Guerra\\Desktop\\VideoCreator\\sie"
  ).trim();
}

function publishStatePath() {
  return (
    config.siePublish?.statePath ||
    join(config.root, ".sie-publish-rotation.json")
  );
}

function transcriptsPath() {
  return (
    config.siePublish?.transcriptsPath ||
    join(config.root, ".sie-transcripts.json")
  );
}

function loadPublishState() {
  const path = publishStatePath();
  if (!existsSync(path)) return { used: [] };
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return { used: Array.isArray(data.used) ? data.used.map(String) : [] };
  } catch {
    return { used: [] };
  }
}

function savePublishState(state) {
  writeFileSync(
    publishStatePath(),
    JSON.stringify(
      { used: state.used || [], updatedAt: new Date().toISOString() },
      null,
      2
    ),
    "utf8"
  );
}

function loadTranscripts() {
  const path = transcriptsPath();
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveTranscripts(map) {
  writeFileSync(
    transcriptsPath(),
    JSON.stringify({ ...map, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

function getCachedTranscript(fileName) {
  const all = loadTranscripts();
  const entry = all[basename(String(fileName || ""))];
  if (!entry || typeof entry !== "object") return null;
  const text = String(entry.transcriptEs || entry.transcript || "").trim();
  if (text.length < 8) return null;
  return entry;
}

function setCachedTranscript(fileName, entry) {
  const name = basename(String(fileName || ""));
  if (!name) return;
  const all = loadTranscripts();
  // No guardar campos meta sueltos en la entrada del archivo
  const { updatedAt: _u, ...rest } = all;
  rest[name] = {
    language: entry.language || null,
    transcript: entry.transcript || "",
    transcriptEs: entry.transcriptEs || entry.transcript || "",
    translated: Boolean(entry.translated),
    transcribedAt: new Date().toISOString(),
  };
  saveTranscripts(rest);
}

/** Rotación aparte del bumper de concatenación. */
export function pickNextSiePublishVideo(dir = sieDir()) {
  const all = listSieVideos(dir);
  if (!all.length) {
    throw new Error(`No hay videos .mp4 en la carpeta SIE:\n${dir || "(vacía)"}`);
  }
  let state = loadPublishState();
  let unused = all.filter((p) => !state.used.includes(basename(p)));
  if (!unused.length) {
    state = { used: [] };
    savePublishState(state);
    unused = all;
  }
  const chosen = unused[0];
  return {
    path: chosen,
    name: basename(chosen),
    remainingAfter: unused.length - 1,
    total: all.length,
  };
}

export function markSiePublishUsed(fileName) {
  const name = basename(String(fileName || ""));
  if (!name) return;
  const state = loadPublishState();
  if (!state.used.includes(name)) {
    state.used.push(name);
    savePublishState(state);
  }
}

function buildSieR2Key(name = "sie.mp4") {
  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "-",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join("");
  const safe = String(name)
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60);
  return `videos/sie-${stamp}-${safe}`;
}

function resolveChatId() {
  const allowed = config.telegram?.allowedChatIds || [];
  if (allowed.length) return String(allowed[0]);
  const last = join(config.root, ".last-chat.json");
  if (!existsSync(last)) return "";
  try {
    const data = JSON.parse(readFileSync(last, "utf8"));
    return data.chatId ? String(data.chatId) : "";
  } catch {
    return "";
  }
}

async function notifyTelegram(lines) {
  const token = config.telegram?.token;
  const chatId = resolveChatId();
  if (!token || !chatId) return;
  const bot = new Telegraf(token);
  await bot.telegram.sendMessage(chatId, lines.filter(Boolean).join("\n"), {
    disable_web_page_preview: true,
  });
}

function isEmptyTranscript(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim().length < 8;
}

/**
 * @param {{ dryRun?: boolean, skipTelegram?: boolean, onStatus?: (s: string) => void }} opts
 */
export async function runSiePublishCron({
  dryRun = false,
  skipTelegram = false,
  onStatus,
} = {}) {
  if (config.siePublish?.enabled === false) {
    return { ok: false, skipped: true, reason: "SIE_PUBLISH_ENABLED=false" };
  }
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado (necesario para publicar el video).");
  }
  if (!config.audio?.mistralApiKey) {
    throw new Error("Falta MISTRAL_API_KEY para transcribir.");
  }
  if (!config.publishWebhook?.enabled || !config.publishWebhook?.url) {
    throw new Error("Webhook FV no configurado.");
  }

  const pick = pickNextSiePublishVideo();
  onStatus?.(`🎬 SIE cron: ${pick.name} (${pick.remainingAfter} quedan en ciclo)`);

  const workDir = await mkdtemp(join(tmpdir(), "asistente-sie-pub-"));
  const audioPath = join(workDir, "audio.mp3");

  try {
    const videoBuf = await readFile(pick.path);

    let language = null;
    let transcriptEs = "";
    let translated = false;
    let fromCache = false;

    const cached = getCachedTranscript(pick.name);
    if (cached) {
      fromCache = true;
      language = cached.language || null;
      transcriptEs = String(cached.transcriptEs || cached.transcript || "").trim();
      translated = Boolean(cached.translated);
      onStatus?.(`📝 Transcripción en caché (${pick.name}) — no re-transcribo.`);
    } else {
      onStatus?.("🎧 Extrayendo audio…");
      await runCmd(resolveFfmpeg(), [
        "-y",
        "-i",
        pick.path,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        audioPath,
      ]);
      const audioBuf = await readFile(audioPath);
      if (audioBuf.length < 500) {
        throw new Error(`Sin audio usable en ${pick.name}`);
      }

      onStatus?.("📝 Transcribiendo (primera vez; se guarda)…");
      const stt = await transcribeAudioAuto(audioBuf, "mp3", { onStatus });
      const raw = String(stt?.text || "").trim();
      if (isEmptyTranscript(raw)) {
        throw new Error(`Transcripción vacía: ${pick.name}`);
      }

      language = stt?.language || null;
      transcriptEs = raw;
      if (!isSpanishAudio(language, raw)) {
        onStatus?.(`🌐 ${language || "otro"} → español…`);
        transcriptEs = await translateToSpanish(raw, {
          context: "transcripción de video SIE para caption de redes",
        });
        translated = true;
      }

      setCachedTranscript(pick.name, {
        language,
        transcript: raw,
        transcriptEs,
        translated,
      });
      onStatus?.(`💾 Transcripción guardada en .sie-transcripts.json`);
    }

    if (isEmptyTranscript(transcriptEs)) {
      throw new Error(`Sin texto usable para caption: ${pick.name}`);
    }

    const hashtag = config.publishWebhook?.hashtag || "#fvdigital";
    onStatus?.("✍️ Generando caption…");
    const caption = await generateSocialCaption(
      pick.name.replace(/\.mp4$/i, "").replace(/[_-]+/g, " "),
      transcriptEs,
      { hashtag, stickToSource: true }
    ).catch(() => `${transcriptEs.slice(0, 400)}\n\n${hashtag}`);

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        name: pick.name,
        language,
        translated,
        fromCache,
        transcriptEs,
        caption,
        remainingAfter: pick.remainingAfter,
      };
    }

    onStatus?.("📦 Subiendo a R2…");
    const key = buildSieR2Key(pick.name);
    const videoUrl = await uploadToR2(videoBuf, key, "video/mp4");
    if (!isPublicR2Url(videoUrl)) {
      throw new Error("URL R2 no pública. Revisa R2_PUBLIC_BASE_URL.");
    }
    await archiveProcessedVideoSafe({
      buffer: videoBuf,
      caption,
      url: videoUrl,
      nameHint: key.match(/(\d{8}-\d{6})/)?.[1] || "",
    });

    onStatus?.("📤 Enviando a webhook FV…");
    const results = await publishToDestinations("fvdigital", {
      caption,
      title: pick.name,
      videoUrl,
      r2Key: key,
      mediaType: "VIDEO",
    });
    const failed = results.filter((r) => !r.ok);
    const ok = results.filter((r) => r.ok);
    if (!ok.length) {
      throw new Error(failed[0]?.error || `HTTP ${failed[0]?.status}`);
    }

    markSiePublishUsed(pick.name);

    const queued = ok.some((r) => r.queued);
    if (!skipTelegram) {
      await notifyTelegram([
        "🌅 SIE cron 06:00",
        `Video: ${pick.name}`,
        fromCache
          ? "STT: caché (ya transcrito)"
          : "STT: nuevo (guardado)",
        translated
          ? `Idioma: ${language || "otro"} → ES`
          : `Idioma: español (${language || "es"})`,
        queued ? "Webhook: encolado" : "Webhook: ok",
        videoUrl,
        "",
        caption,
      ]).catch((err) => console.warn("SIE notify:", err.message));
    }

    return {
      ok: true,
      name: pick.name,
      language,
      translated,
      fromCache,
      transcriptEs,
      caption,
      videoUrl,
      r2Key: key,
      queued,
      remainingAfter: pick.remainingAfter,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
