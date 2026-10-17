/**
 * /trad — doblaje o solo overlay si ya es ES + titular typewriter 5s.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMistralAvailable,
  looksSpanishText,
  noteMistralFailure,
  synthesizeSpeechBuffer,
  transcribeAudioAuto,
  translateTextWithMistral,
} from "./audio.mjs";
import { config } from "./config.mjs";
import {
  buildSocialVideoR2Key,
  downloadSocialVideo,
} from "./social-video.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OVERLAY = join(__dirname, "..", "assets", "trad-overlay.png");
const FONTS_DIR = join(__dirname, "..", "assets", "fonts");

function resolveFfmpeg() {
  const fromEnv = String(config.trad?.ffmpegPath || "").trim();
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

function runFfmpeg(args, { timeoutMs = 300_000 } = {}) {
  const bin = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`No pude ejecutar ffmpeg (${bin}): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || `ffmpeg exit ${code}`).trim().slice(-600)));
        return;
      }
      resolve({ stderr });
    });
  });
}

function ffmpegEscapePath(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function escapeAssText(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function formatAssTime(seconds = 0) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** ¿El audio ya está en español? El idioma del STT manda; el texto solo si no hay idioma. */
export function isSpanishAudio(language, transcript = "") {
  const lang = String(language || "").toLowerCase().trim();
  if (/^es(-|$)/.test(lang) || lang === "spa" || lang === "spanish" || lang === "español") {
    return true;
  }
  if (lang) return false;
  return looksSpanishText(transcript);
}

function overlayPathResolved() {
  // Overlay de marca desactivado (TRAD_OVERLAY=false por defecto).
  if (config.trad?.overlayEnabled === false) return "";
  const custom = String(config.trad?.overlayPath || "").trim();
  return custom || DEFAULT_OVERLAY;
}

function wrapHeadline(text = "", maxChars = 38, maxLines = 3) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";

  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) {
        // No cortar la idea: si no cabe, preferir menos líneas largas en la última
        cur = [cur, ...words.slice(words.indexOf(w) + 1)].join(" ");
        break;
      }
    } else {
      cur = next;
    }
  }
  if (cur) {
    if (lines.length >= maxLines) {
      lines[maxLines - 1] = `${lines[maxLines - 1]} ${cur}`.trim();
    } else {
      lines.push(cur);
    }
  }
  return lines.slice(0, maxLines).join("\n");
}

/** Titular en español: frase completa con sujeto + verbo + idea cerrada. */
export async function generateTradHeadline({ transcript, title, description }) {
  const body = [title, description, transcript]
    .filter(Boolean)
    .join("\n")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .slice(0, 2800);

  const fallback = () => {
    const base = String(transcript || title || description || "Video").trim();
    const sentence =
      base.match(/[^.!?]+[.!?]/)?.[0]?.trim() ||
      base.split(/(?<=[.!?])\s/)[0] ||
      base;
    // Frase completa: no cortar a 90 caracteres a medias
    return sentence.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  };

  if (!body || body.length < 12) return fallback();

  const prompt = `Eres editor de FV Digital (República Dominicana). Redacta UN titular periodístico en español sobre este video.

Reglas OBLIGATORIAS:
1. Debe ser UNA FRASE COMPLETA con lógica clara (sujeto + verbo + complemento).
2. NUNCA cortes la idea a medias (mal: "Comunicadora denuncia falta de atención en hospital por no"; bien: "Comunicadora Fogón denuncia abandono en hospital Ney Arias").
3. Entre 6 y 12 palabras. MÁXIMO 12. Si hace falta, reescribe más corto pero cierra el sentido.
4. Debe reflejar el hecho o tema principal del audio.
5. Sin comillas, hashtags, emojis ni signos de admiración.
6. Conserva nombres propios relevantes.
7. No termines en: de, del, la, el, en, con, para, por, y, o, a, un, una, no, ni, que…
8. Devuelve SOLO el titular, nada más.

Contenido del video:
---
${body}
---`;

  async function chatHeadline(url, apiKey, model) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || data?.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return String(data?.choices?.[0]?.message?.content || "").trim();
  }

  let raw = "";
  try {
    if (isMistralAvailable()) {
      raw = await chatHeadline(
        "https://api.mistral.ai/v1/chat/completions",
        config.audio.mistralApiKey,
        config.audio.mistralChatModel || "mistral-small-latest"
      );
    } else if (config.audio.openaiApiKey) {
      raw = await chatHeadline(
        "https://api.openai.com/v1/chat/completions",
        config.audio.openaiApiKey,
        config.audio.openaiChatModel || "gpt-4o-mini"
      );
    } else {
      return fallback();
    }
  } catch (error) {
    noteMistralFailure(error);
    if (config.audio.openaiApiKey && !/openai/i.test(String(error.message))) {
      try {
        raw = await chatHeadline(
          "https://api.openai.com/v1/chat/completions",
          config.audio.openaiApiKey,
          config.audio.openaiChatModel || "gpt-4o-mini"
        );
      } catch {
        return fallback();
      }
    } else {
      return fallback();
    }
  }

  let headline = raw
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();

  // Evitar titulares truncados tipo "..." o cortados en preposición
  if (/(\.\.\.|…)$/.test(headline)) headline = headline.replace(/(\.\.\.|…)$/, "").trim();
  if (
    /\b(de|del|la|el|los|las|en|con|para|por|y|o|a|un|una|no|ni|que|se|su)$/i.test(
      headline.replace(/[¿?¡!.,;:]+$/g, "")
    )
  ) {
    return fallback();
  }

  let words = headline.split(/\s+/).filter(Boolean);
  if (words.length > 12) {
    const trimmed = words.slice(0, 12);
    while (
      trimmed.length > 4 &&
      /\b(de|del|la|el|los|las|en|con|para|por|y|o|a|un|una|no|ni|que|se|su)$/i.test(
        trimmed[trimmed.length - 1]
      )
    ) {
      trimmed.pop();
    }
    headline = trimmed.join(" ");
    words = headline.split(/\s+/).filter(Boolean);
  }
  if (!(headline && words.length >= 5 && words.length <= 12 && headline.length <= 120)) {
    headline = fallback();
  }

  // Lower-third: forzar ≤12 palabras e idea completa (reescritura si hace falta)
  try {
    const { composeCardHeadline } = await import("./deepseek.mjs");
    return await composeCardHeadline(headline, body, { lang: "es" });
  } catch {
    return headline;
  }
}

/** ASS: typewriter — delay, escribe en N s, visible al menos M s en pantalla. */
export function buildTypewriterAss(
  headline,
  {
    width = 1080,
    height = 1920,
    startDelaySec = 5,
    typeDurationSec = 2,
    visibleDurationSec = 10,
  } = {}
) {
  const wrapped = wrapHeadline(headline, 38, 3);
  const chars = [...wrapped];
  if (!chars.length) return "";

  const marginLeft = 44;
  const marginBottom = Math.round(height * 0.25);
  const fontSize = width >= 1080 ? 53 : Math.round(36 * 1.2);

  const appearAt = startDelaySec;
  const hideAt = startDelaySec + visibleDurationSec;
  const typeEnd = startDelaySec + typeDurationSec;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Headline,Montserrat,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H008A3A1E,-1,0,0,0,100,100,0,0,3,10,0,1,${marginLeft},48,${marginBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = [];
  const perChar = (typeDurationSec * 1000) / Math.max(chars.length, 1);
  let shown = "";

  for (let i = 0; i < chars.length; i++) {
    shown += chars[i];
    const start = appearAt + (i * perChar) / 1000;
    const end = i === chars.length - 1 ? hideAt : appearAt + ((i + 1) * perChar) / 1000;
    const display = escapeAssText(shown);
    events.push(
      `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Headline,,0,0,0,,${display}`
    );
  }

  return [...header, ...events, ""].join("\n");
}

/** Títulos que pone yt-dlp/plataforma ("Video by x", "Reel de x", "123 views · …"), no del autor. */
function isGenericPlatformTitle(title = "") {
  const t = String(title || "").trim();
  if (!t) return true;
  return (
    /^(video|vídeo|reel|reels|post|clip|short|publicación|publicacion)\b/i.test(t) ||
    /\b(instagram|facebook|tiktok|youtube)\b.*\b(video|reel|post)\b/i.test(t) ||
    /^[\d.,]+\s*[kmb]?\s*(views|reactions|vistas|reproducciones|me gusta)\b/i.test(t)
  );
}

/** Texto narrable: sin hashtags, menciones, links ni emojis. */
function cleanForNarration(text = "") {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(^|\s)[#@][\p{L}\p{N}_.]+/gu, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function captionFromMeta({ title, description }) {
  const desc = cleanForNarration(description);
  const tit = isGenericPlatformTitle(title) ? "" : cleanForNarration(title);
  if (!desc && !tit) return "";
  if (desc && tit) {
    if (desc.toLowerCase().startsWith(tit.toLowerCase().slice(0, 24))) return desc;
    return `${tit}. ${desc}`;
  }
  return desc || tit;
}

function isEmptyTranscript(text = "") {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return !t || t.length < 8;
}

async function probeHasAudio(filePath) {
  const bin = resolveFfmpeg().replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  const probeBin = existsSync(bin) ? bin : "ffprobe";
  return new Promise((resolve) => {
    const child = spawn(
      probeBin,
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", () => resolve(/audio/i.test(out)));
    child.on("error", () => resolve(false));
  });
}

async function probeDurationSec(filePath) {
  const bin = resolveFfmpeg().replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  const probeBin = existsSync(bin) ? bin : "ffprobe";
  return new Promise((resolve) => {
    const child = spawn(
      probeBin,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", () => {
      const n = Number.parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
    child.on("error", () => resolve(0));
  });
}

export async function renderReel916({
  videoIn,
  videoOut,
  voicePath = null,
  originalVolume = 0.05,
  dubVolume = 2,
  mixOriginal = true,
  assPath = null,
  width,
  height,
}) {
  const overlayPath = overlayPathResolved();
  const useOverlay = existsSync(overlayPath);
  const dub = Boolean(voicePath);
  const useAss = assPath && existsSync(assPath);

  // Voz más larga que el video: el video se repite hasta que termine la voz.
  let loopUntilSec = 0;
  if (dub) {
    const [videoSec, voiceSec] = await Promise.all([
      probeDurationSec(videoIn),
      probeDurationSec(voicePath),
    ]);
    if (videoSec > 0 && voiceSec > videoSec + 0.2) loopUntilSec = voiceSec + 0.4;
  }

  const inputs = ["-y"];
  if (loopUntilSec) inputs.push("-stream_loop", "-1");
  inputs.push("-i", videoIn);
  if (dub) inputs.push("-i", voicePath);
  if (useOverlay) inputs.push("-i", overlayPath);

  // Video íntegro: encaja en 9:16 SIN recortar (letterbox/pillarbox si hace falta).
  const parts = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[vb]`,
  ];

  let vLabel = "vb";
  if (useOverlay) {
    const ovIdx = dub ? 2 : 1;
    parts.push(
      `[${ovIdx}:v]scale=${width}:${height},format=rgba,colorkey=0x000000:0.12:0.08[ov]`,
      `[vb][ov]overlay=0:0:format=auto[vo]`
    );
    vLabel = "vo";
  }

  if (useAss) {
    const assEsc = ffmpegEscapePath(assPath);
    const fontsEsc = ffmpegEscapePath(FONTS_DIR);
    parts.push(`[${vLabel}]ass='${assEsc}':fontsdir='${fontsEsc}'[vout]`);
  } else {
    parts.push(`[${vLabel}]null[vout]`);
  }

  if (dub && mixOriginal) {
    parts.push(
      `[0:a]volume=${originalVolume}[a0]`,
      `[1:a]volume=${dubVolume}[a1]`,
      `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`
    );
  } else if (dub) {
    parts.push(`[1:a]volume=${dubVolume}[aout]`);
  }

  const args = [
    ...inputs,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    "-map",
    dub ? "[aout]" : "0:a",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
  ];
  if (loopUntilSec) args.push("-t", loopUntilSec.toFixed(2));
  else if (dub) args.push("-shortest");
  args.push(videoOut);

  await runFfmpeg(args, { timeoutMs: 420_000 });
}

/**
 * Fase 1: descarga + STT + caption. No traduce ni genera TTS.
 */
export async function inspectTradVideo(sourceUrl, { onStatus } = {}) {
  const originalVolume = Number(config.trad?.originalVolume ?? 0.05);
  const dubVolume = Number(config.trad?.dubVolume ?? 2);
  const width = Number(config.trad?.width || 1080);
  const height = Number(config.trad?.height || 1920);

  const downloaded = await downloadSocialVideo(sourceUrl, { onStatus });
  const workDir = await mkdtemp(join(tmpdir(), "asistente-trad-"));
  const videoIn = join(workDir, `in${downloaded.ext || ".mp4"}`);
  const audioOrig = join(workDir, "orig.mp3");
  const voicePath = join(workDir, "voice.mp3");
  const assPath = join(workDir, "headline.ass");
  const videoOut = join(workDir, "out-916.mp4");

  try {
    await writeFile(videoIn, downloaded.buffer);

    let transcript = "";
    let stt = { text: "", language: null, segments: [] };
    const hasAudioTrack = await probeHasAudio(videoIn);
    const caption = captionFromMeta(downloaded);

    if (hasAudioTrack) {
      onStatus?.("🎧 Extrayendo audio…");
      try {
        await runFfmpeg([
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
        const audioBuf = await readFile(audioOrig);
        if (audioBuf.length >= 500) {
          try {
            stt = await transcribeAudioAuto(audioBuf, "mp3", { onStatus });
            transcript = stt.text || "";
            if (!transcript.trim()) {
              onStatus?.(
                "⚠️ STT no devolvió texto. Puedes usar caption o pegar un guion."
              );
            }
          } catch (error) {
            onStatus?.(
              `⚠️ No pude transcribir el audio (${String(error.message || error).slice(0, 140)}). Usa caption o pega texto.`
            );
          }
        } else {
          onStatus?.("⚠️ Audio extraído demasiado corto / vacío.");
        }
      } catch (error) {
        onStatus?.(
          `⚠️ No pude extraer/transcribir audio (${String(error.message || error).slice(0, 120)}).`
        );
      }
    }

    const hasTranscript = !isEmptyTranscript(transcript);
    const hasCaption = !isEmptyTranscript(caption);

    if (!hasTranscript && !hasCaption) {
      throw new Error(
        "El video no tiene audio usable ni caption/descripción para generar la voz."
      );
    }

    return {
      step: "await_source_mode",
      workDir,
      videoIn,
      voicePath,
      assPath,
      videoOut,
      width,
      height,
      originalVolume,
      dubVolume,
      hasAudioTrack,
      hasTranscript,
      hasCaption,
      transcript: hasTranscript ? transcript : "",
      caption: hasCaption ? caption : "",
      sttLanguage: stt.language || null,
      title: downloaded.title,
      description: downloaded.description,
      sourceUrl: downloaded.sourceUrl,
      platform: downloaded.platform,
      r2KeyHint: buildSocialVideoR2Key(".mp4").replace("videos/fv-", "videos/trad-"),
    };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Fase 2: según modo elegido por el usuario.
 * - translate_audio: dobla desde STT (o overlayOnly si ya es ES)
 * - from_caption: SIEMPRE traduce caption a español y luego TTS
 * - from_text: texto pegado → traduce a ES → TTS + seed de caption
 */
export async function continueTradJob(
  job,
  { mode, customText: customTextOpt, onStatus } = {}
) {
  if (!job?.videoIn || !job?.workDir) {
    throw new Error("No hay inspección /trad pendiente.");
  }

  const voiceId =
    config.trad?.voiceId ||
    config.audio.mistralTtsVoiceId ||
    "cccea7b3-4ebc-42af-92a6-f4ac3ba8215d";
  const headlineDelay = Number(config.trad?.headlineDelay ?? 7);
  const headlineTypeSeconds = Number(config.trad?.headlineTypeSeconds ?? 2);
  const headlineVisibleSeconds = Number(config.trad?.headlineVisibleSeconds ?? 10);

  const chosen = String(mode || "").trim();
  const customText = String(customTextOpt || job.customText || "").trim();
  if (
    chosen !== "translate_audio" &&
    chosen !== "from_caption" &&
    chosen !== "from_text"
  ) {
    throw new Error(
      'Modo inválido. Usa "translate_audio", "from_caption" o "from_text".'
    );
  }

  try {
    let sourceText = "";
    let captionFallback = false;
    let overlayOnly = false;
    let needsVoice = false;
    let mixOriginal = false;
    let translation = "";
    let language = job.sttLanguage || null;
    let socialCaptionSeed = "";

    if (chosen === "from_text") {
      if (customText.length < 8) {
        throw new Error("El texto pegado es muy corto. Envía un párrafo completo.");
      }
      sourceText = customText;
      onStatus?.("🌐 Traduciendo tu texto al español…");
      translation = await translateTextWithMistral(sourceText, {
        context: "guión pegado por el usuario para narración y caption en español",
        onStatus,
      });
      if (!translation) {
        throw new Error("No pude traducir el texto al español.");
      }
      needsVoice = true;
      mixOriginal = Boolean(job.hasAudioTrack);
      language = "es";
      captionFallback = true;
      socialCaptionSeed = translation;
    } else if (chosen === "from_caption") {
      if (isEmptyTranscript(job.caption)) {
        throw new Error("Este video no tiene caption/descripción para narrar.");
      }
      captionFallback = true;
      sourceText = job.caption;
      onStatus?.("🌐 Traduciendo caption al español…");
      translation = await translateTextWithMistral(sourceText, {
        context: "caption de video para narración en español",
        onStatus,
      });
      if (!translation) {
        throw new Error("No pude traducir el caption al español.");
      }
      needsVoice = true;
      mixOriginal = Boolean(job.hasAudioTrack);
      language = "es";
      socialCaptionSeed = translation;
    } else {
      if (isEmptyTranscript(job.transcript)) {
        throw new Error(
          "No hay audio usable para traducir. Elige caption o pega un texto."
        );
      }
      sourceText = job.transcript;
      const alreadySpanish = isSpanishAudio(job.sttLanguage, sourceText);
      if (alreadySpanish) {
        overlayOnly = true;
        translation = "";
        language = job.sttLanguage || "es";
        onStatus?.("🇪🇸 Audio ya en español — solo reel 9:16…");
        socialCaptionSeed = sourceText;
      } else {
        onStatus?.("🌐 Traduciendo audio al español…");
        translation = await translateTextWithMistral(sourceText, {
          context: "guión de video para doblaje",
          onStatus,
        });
        if (!translation) throw new Error("Traducción vacía.");
        needsVoice = true;
        mixOriginal = true;
        language = "es";
        socialCaptionSeed = translation;
      }
    }

    const headlineSeed = translation || sourceText || job.caption || job.title;
    onStatus?.("📰 Generando titular del video…");
    let headline = await generateTradHeadline({
      transcript: headlineSeed,
      title: isGenericPlatformTitle(job.title) ? "" : job.title,
      description: job.description,
    });
    if (headline) {
      headline = await translateTextWithMistral(headline, {
        context: "titular de video en español",
        onStatus,
      });
    }

    const ass = buildTypewriterAss(headline, {
      width: job.width,
      height: job.height,
      startDelaySec: headlineDelay,
      typeDurationSec: headlineTypeSeconds,
      visibleDurationSec: headlineVisibleSeconds,
    });
    if (ass) await writeFile(job.assPath, ass, "utf8");

    if (needsVoice) {
      onStatus?.("🗣️ Generando narración…");
      const voiceBuf = await synthesizeSpeechBuffer(translation, {
        voiceId,
        preferMistral: true,
        onStatus,
      });
      await writeFile(job.voicePath, voiceBuf);
    }

    return {
      ...job,
      step: "ask_headline",
      sourceMode: chosen,
      customText: chosen === "from_text" ? customText : job.customText || "",
      socialCaptionSeed,
      voicePath: needsVoice ? job.voicePath : null,
      assPath: ass ? job.assPath : null,
      mixOriginal,
      overlayOnly,
      captionFallback,
      transcript: sourceText,
      translation,
      headline,
      language,
    };
  } catch (error) {
    await rm(job.workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Compat: inspecciona y continúa con el mejor modo disponible. */
export async function prepareTradJob(sourceUrl, { onStatus } = {}) {
  const inspected = await inspectTradVideo(sourceUrl, { onStatus });
  const mode =
    inspected.hasTranscript && !inspected.hasCaption
      ? "translate_audio"
      : inspected.hasCaption && !inspected.hasTranscript
        ? "from_caption"
        : inspected.hasTranscript
          ? "translate_audio"
          : "from_caption";
  return continueTradJob(inspected, { mode, onStatus });
}

export async function discardTradJob(job) {
  if (job?.workDir) {
    await rm(job.workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Monta el reel final. includeHeadline=false omite el titular typewriter.
 */
export async function finalizeTradJob(
  job,
  { includeHeadline = true, onStatus } = {}
) {
  if (!job?.videoIn || !job?.workDir) {
    throw new Error("No hay job /trad pendiente para montar.");
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
    filename: "trad-916.mp4",
    bytes: buffer.length,
    transcript: job.transcript,
    translation: job.translation,
    headline: job.headline,
    language: job.language,
    overlayOnly: job.overlayOnly,
    captionFallback: job.captionFallback,
    sourceMode: job.sourceMode,
    socialCaptionSeed: job.socialCaptionSeed || "",
    includeHeadline: Boolean(includeHeadline && assPath),
    r2KeyHint: job.r2KeyHint,
  };

  await discardTradJob(job);
  return result;
}

/** Flujo completo (titular incluido). */
export async function buildTranslatedReel(sourceUrl, { onStatus, includeHeadline = true } = {}) {
  const job = await prepareTradJob(sourceUrl, { onStatus });
  return finalizeTradJob(job, { includeHeadline, onStatus });
}
