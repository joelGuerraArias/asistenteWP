/**
 * /dub — doblaje ElevenLabs (Dubbing API project) → reel 9:16 + titular (como /trad).
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.mjs";
import { runDubbingToBuffer } from "./elevenlabs-dub.mjs";
import {
  buildSocialVideoR2Key,
  downloadSocialVideo,
} from "./social-video.mjs";
import {
  buildTypewriterAss,
  generateTradHeadline,
  renderReel916,
} from "./trad-video.mjs";

function voiceExt(contentType = "") {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";
  if (ct.includes("mp4") || ct.includes("m4a")) return ".m4a";
  return ".wav";
}

/**
 * Descarga video, dobla con ElevenLabs a ES, prepara titular y deja job listo
 * para confirmar headline (mismo patrón que /trad ask_headline).
 */
export async function prepareDubJob(sourceUrl, { onStatus } = {}) {
  if (!config.dub?.elevenApiKey) {
    throw new Error("Falta ELEVENLABS_API_KEY en .env para /dub.");
  }

  const originalVolume = Number(
    config.dub?.originalVolume ?? config.trad?.originalVolume ?? 0.05
  );
  const dubVolume = Number(config.dub?.dubVolume ?? config.trad?.dubVolume ?? 2);
  const width = Number(config.dub?.width || config.trad?.width || 1080);
  const height = Number(config.dub?.height || config.trad?.height || 1920);
  const headlineDelay = Number(
    config.dub?.headlineDelay ?? config.trad?.headlineDelay ?? 7
  );
  const headlineTypeSeconds = Number(
    config.dub?.headlineTypeSeconds ?? config.trad?.headlineTypeSeconds ?? 2
  );
  const headlineVisibleSeconds = Number(
    config.dub?.headlineVisibleSeconds ?? config.trad?.headlineVisibleSeconds ?? 10
  );

  const downloaded = await downloadSocialVideo(sourceUrl, { onStatus });
  const workDir = await mkdtemp(join(tmpdir(), "asistente-dub-"));
  const videoIn = join(workDir, "source.mp4");
  const videoOut = join(workDir, "dub-916.mp4");
  const voicePath = join(workDir, "dub-voice.wav");
  const assPath = join(workDir, "headline.ass");

  try {
    await writeFile(videoIn, downloaded.buffer);

    const dubbed = await runDubbingToBuffer({
      fileBuffer: downloaded.buffer,
      filename: "source.mp4",
      targetLanguage: "es",
      sourceLanguage: config.dub?.sourceLanguage || undefined,
      reference: `asistenteWP /dub ${downloaded.platform || ""}`.trim(),
      onStatus,
      pollMs: Number(config.dub?.pollMs || 5000),
      maxWaitMs: Number(config.dub?.maxWaitMs || 25 * 60 * 1000),
    });

    const ext = voiceExt(dubbed.contentType);
    const voiceFile = ext === ".wav" ? voicePath : join(workDir, `dub-voice${ext}`);
    await writeFile(voiceFile, dubbed.buffer);

    onStatus?.("📰 Generando titular del video…");
    let headline = await generateTradHeadline({
      transcript: downloaded.description || downloaded.title || "",
      title: downloaded.title,
      description: downloaded.description,
    });

    const ass = buildTypewriterAss(headline, {
      width,
      height,
      startDelaySec: headlineDelay,
      typeDurationSec: headlineTypeSeconds,
      visibleDurationSec: headlineVisibleSeconds,
    });
    if (ass) await writeFile(assPath, ass, "utf8");

    return {
      step: "ask_headline",
      kind: "dub",
      workDir,
      videoIn,
      videoOut,
      voicePath: voiceFile,
      assPath: ass ? assPath : null,
      originalVolume,
      dubVolume,
      mixOriginal: true,
      width,
      height,
      title: downloaded.title,
      description: downloaded.description,
      sourceUrl: downloaded.sourceUrl || sourceUrl,
      platform: downloaded.platform,
      headline,
      language: "es",
      socialCaptionSeed:
        downloaded.description || downloaded.title || headline || "",
      translation: "",
      projectId: dubbed.projectId,
      languageId: dubbed.languageId,
      r2KeyHint: buildSocialVideoR2Key(".mp4").replace("videos/fv-", "videos/dub-"),
    };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function discardDubJob(job) {
  if (job?.workDir) {
    await rm(job.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function finalizeDubJob(
  job,
  { includeHeadline = true, onStatus } = {}
) {
  if (!job?.videoIn || !job?.workDir) {
    throw new Error("No hay job /dub pendiente para montar.");
  }

  const assPath =
    includeHeadline && job.assPath && existsSync(job.assPath) ? job.assPath : null;

  onStatus?.(
    includeHeadline
      ? "🎬 Montando reel 9:16 (con titular)…"
      : "🎬 Montando reel 9:16 (sin titular)…"
  );

  await renderReel916({
    videoIn: job.videoIn,
    videoOut: job.videoOut,
    voicePath: job.voicePath && existsSync(job.voicePath) ? job.voicePath : null,
    originalVolume: job.originalVolume,
    dubVolume: job.dubVolume,
    mixOriginal: Boolean(job.mixOriginal && job.voicePath),
    assPath,
    width: job.width,
    height: job.height,
  });

  const buffer = await readFile(job.videoOut);
  const result = {
    buffer,
    contentType: "video/mp4",
    ext: ".mp4",
    title: job.title,
    description: job.description,
    sourceUrl: job.sourceUrl,
    platform: job.platform,
    filename: "dub-916.mp4",
    bytes: buffer.length,
    headline: job.headline,
    language: job.language,
    socialCaptionSeed: job.socialCaptionSeed || "",
    includeHeadline: Boolean(includeHeadline && assPath),
    r2KeyHint: job.r2KeyHint,
    projectId: job.projectId,
  };

  await discardDubJob(job);
  return result;
}
