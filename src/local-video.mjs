/**
 * /local — video del equipo → STT → español → logo arriba + titular rojo abajo.
 * Reutiliza el chrome de /ndigital (composeNdigitalBranded).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "./config.mjs";
import { transcribeAudioAuto } from "./audio.mjs";
import { translateToSpanish } from "./deepseek.mjs";
import {
  composeNdigitalBranded,
  discardNdigitalJob,
} from "./ndigital-video.mjs";
import { generateTradHeadline, isSpanishAudio } from "./trad-video.mjs";

function resolveFfmpeg() {
  const fromEnv = String(
    config.trad?.ffmpegPath || config.ndigital?.ffmpegPath || ""
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

function resolveFfprobe() {
  const ff = resolveFfmpeg();
  const probe = ff.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  if (probe !== ff && existsSync(probe)) return probe;
  return "ffprobe";
}

function runCmd(bin, args, { timeoutMs = 420_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
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
      resolve({ stdout, stderr });
    });
  });
}

function isEmptyTranscript(text = "") {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length < 8;
}

export function buildLocalR2Key(ext = ".mp4") {
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
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : ".mp4";
  return `videos/local-${stamp}${safeExt}`;
}

export async function discardLocalJob(job) {
  return discardNdigitalJob(job);
}

/** Imagen destacada WP: 16:9 exacto 1280×720. */
export async function toFeatured1280x720(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    throw new Error("Frame vacío");
  }
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(1280, 720, {
      fit: "cover",
      position: "attention",
      kernel: "lanczos3",
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

/**
 * Extrae un frame del video y lo deja en 1280×720.
 */
export async function extractVideoFrame1280x720(
  inputBuffer,
  { fileName = "video.mp4", seekSec = null, onStatus } = {}
) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length < 1000) {
    throw new Error("Video vacío para frame");
  }
  const workDir = await mkdtemp(join(tmpdir(), "asistente-frame-"));
  const safeExt = /\.(mp4|mov|mkv|webm|m4v)$/i.test(fileName)
    ? `.${fileName.split(".").pop().toLowerCase()}`
    : ".mp4";
  const videoIn = join(workDir, `in${safeExt}`);
  const framePath = join(workDir, "frame.jpg");
  try {
    await writeFile(videoIn, inputBuffer);
    let durationSec = 0;
    try {
      const { stdout: probeOut } = await runCmd(
        resolveFfprobe(),
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          videoIn,
        ],
        { timeoutMs: 60_000 }
      );
      durationSec = Number(JSON.parse(probeOut)?.format?.duration) || 0;
    } catch {
      durationSec = 0;
    }
    const seek =
      seekSec != null
        ? Number(seekSec)
        : durationSec > 3
          ? Math.min(Math.max(1, durationSec * 0.15), durationSec - 0.5)
          : Math.max(0.2, durationSec * 0.3 || 0.5);
    onStatus?.("🖼️ Sacando frame 1280×720…");
    await runCmd(resolveFfmpeg(), [
      "-y",
      "-ss",
      String(Number(seek).toFixed(2)),
      "-i",
      videoIn,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      framePath,
    ]);
    const raw = await readFile(framePath);
    return toFeatured1280x720(raw);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Guarda el video, extrae audio, transcribe y deja texto en español + frame.
 */
export async function prepareLocalVideoJob(inputBuffer, {
  fileName = "video.mp4",
  titleHint = "",
  descriptionHint = "",
  onStatus,
} = {}) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length < 1000) {
    throw new Error("El video está vacío o es demasiado corto.");
  }
  if (!config.audio?.mistralApiKey && !config.audio?.openaiApiKey) {
    throw new Error(
      "Falta MISTRAL_API_KEY o OPENAI_API_KEY para transcribir el video."
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "asistente-local-"));
  const safeExt = /\.(mp4|mov|mkv|webm|m4v)$/i.test(fileName)
    ? `.${fileName.split(".").pop().toLowerCase()}`
    : ".mp4";
  const videoIn = join(workDir, `in${safeExt}`);
  const audioOrig = join(workDir, "audio.mp3");

  try {
    await writeFile(videoIn, inputBuffer);

    // Validación + duración con ffprobe
    onStatus?.("📐 Leyendo video…");
    const { stdout: probeOut } = await runCmd(
      resolveFfprobe(),
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        videoIn,
      ],
      { timeoutMs: 60_000 }
    );
    let durationSec = 0;
    try {
      const meta = JSON.parse(probeOut);
      durationSec =
        Number(meta?.streams?.[0]?.duration || meta?.format?.duration) || 0;
    } catch {
      durationSec = 0;
    }

    onStatus?.("🎧 Extrayendo audio…");
    await runCmd(resolveFfmpeg(), [
      "-y",
      "-i",
      videoIn,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "4",
      audioOrig,
    ]);

    if (!existsSync(audioOrig)) {
      throw new Error("No pude extraer audio del video.");
    }
    const audioBuf = await readFile(audioOrig);
    if (audioBuf.length < 500) {
      throw new Error("El video no tiene audio usable para transcribir.");
    }

    onStatus?.("📝 Transcribiendo (detectando idioma)…");
    const stt = await transcribeAudioAuto(audioBuf, "mp3", { onStatus });
    const rawTranscript = String(stt?.text || "").trim();
    if (isEmptyTranscript(rawTranscript)) {
      throw new Error(
        "No pude obtener una transcripción usable. ¿El video tiene voz clara?"
      );
    }

    const language = stt?.language || null;
    const alreadyEs = isSpanishAudio(language, rawTranscript);
    let transcriptEs = rawTranscript;
    let translated = false;

    if (!alreadyEs) {
      onStatus?.(
        `🌐 Idioma detectado: ${language || "otro"} → traduciendo al español…`
      );
      transcriptEs = await translateToSpanish(rawTranscript, {
        context: "transcripción de video para redes",
      });
      translated = true;
    } else {
      onStatus?.("🇪🇸 Audio ya en español.");
    }

    onStatus?.("✍️ Generando titular…");
    const headline = await generateTradHeadline({
      transcript: transcriptEs,
      title: String(titleHint || "").trim() || fileName.replace(/\.[^.]+$/, ""),
      description:
        String(descriptionHint || "").trim() || transcriptEs.slice(0, 800),
    });

    // Frame para WordPress / tarjeta de redes (~1s o 15% de la duración)
    const framePath = join(workDir, "frame.jpg");
    const seek =
      durationSec > 3
        ? Math.min(Math.max(1, durationSec * 0.15), durationSec - 0.5)
        : Math.max(0.2, durationSec * 0.3 || 0.5);
    onStatus?.("🖼️ Sacando frame para la noticia…");
    let frameBuffer = null;
    try {
      await runCmd(resolveFfmpeg(), [
        "-y",
        "-ss",
        String(seek.toFixed(2)),
        "-i",
        videoIn,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        framePath,
      ]);
      if (existsSync(framePath)) {
        const rawFrame = await readFile(framePath);
        try {
          frameBuffer = await toFeatured1280x720(rawFrame);
        } catch {
          frameBuffer = rawFrame;
        }
      }
    } catch (err) {
      console.warn("local frame:", err.message);
    }

    return {
      kind: "local",
      workDir,
      localPath: videoIn,
      croppedPath: videoIn,
      buffer: inputBuffer,
      bytes: inputBuffer.length,
      fileName,
      sourceUrl: `local://${fileName}`,
      platform: "local",
      title: headline || fileName,
      headline: headline || "Video",
      transcript: rawTranscript,
      transcriptEs,
      language,
      translated,
      durationSec,
      frameBuffer,
      branded: false,
      dest: null,
    };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function brandLocalVideo(job, { headline, dest, onStatus } = {}) {
  return composeNdigitalBranded(job, {
    headline: headline || job.headline,
    dest: dest === "f1rd" ? "f1rd" : "fvdigital",
    onStatus,
  });
}
