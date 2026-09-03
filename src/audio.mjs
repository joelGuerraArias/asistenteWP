import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";

const tmpBase = join(tmpdir(), "asistente-wp-audio");
if (!existsSync(tmpBase)) mkdirSync(tmpBase, { recursive: true });

function tempPath(ext) {
  return join(tmpBase, `${randomUUID()}.${ext}`);
}

export async function downloadTelegramFile(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar el audio (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = file.file_path?.split(".").pop() || "ogg";
  return { buffer, ext, mimeType: ext === "ogg" || ext === "oga" ? "audio/ogg" : "audio/mpeg" };
}

function extractTranscript(data) {
  if (!data) return "";
  if (typeof data.text === "string") return data.text.trim();
  if (typeof data.transcript === "string") return data.transcript.trim();
  if (Array.isArray(data.segments)) {
    return data.segments
      .map((s) => s.text || s.transcript || "")
      .join(" ")
      .trim();
  }
  return "";
}

async function transcribeWithMistral(
  buffer,
  filename,
  { language, timestamps = false } = {}
) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  form.append("model", config.audio.mistralTranscribeModel);
  const lang =
    language === undefined ? config.audio.language : language;
  if (lang) form.append("language", lang);
  if (timestamps) {
    form.append("timestamp_granularities[]", "segment");
  }

  const res = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.audio.mistralApiKey}` },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error?.message || JSON.stringify(data);
    throw new Error(`Mistral STT: ${msg}`);
  }

  const text = extractTranscript(data);
  if (!text) throw new Error("Mistral STT: respuesta vacía");
  return { text, language: data.language || null, segments: data.segments || [], raw: data };
}

const GROQ_ALLOWED_EXTS = new Set([
  "flac",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "ogg",
  "opus",
  "wav",
  "webm",
]);

/** Telegram voice = Ogg/Opus con extensión .oga; Groq solo acepta la allowlist. */
function normalizeSttFilename(ext = "ogg") {
  let e = String(ext || "ogg")
    .replace(/^\./, "")
    .toLowerCase()
    .trim();
  if (e === "oga") e = "ogg";
  if (!GROQ_ALLOWED_EXTS.has(e)) e = "ogg";
  return `telegram-audio.${e}`;
}

async function transcribeWithOpenAICompat(buffer, filename, provider) {
  const form = new FormData();
  const mime =
    filename.endsWith(".ogg") || filename.endsWith(".opus")
      ? "audio/ogg"
      : filename.endsWith(".webm")
        ? "audio/webm"
        : filename.endsWith(".wav")
          ? "audio/wav"
          : "audio/mpeg";
  form.append("file", new Blob([buffer], { type: mime }), filename);
  form.append("model", provider.model);
  form.append("language", config.audio.language);

  const res = await fetch(provider.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Transcripción falló (${res.status})`);
  }
  return extractTranscript(data);
}

function buildTranscribeProviders() {
  const providers = [];
  const want = config.audio.provider;

  if (
    config.audio.mistralApiKey &&
    (want === "mistral" || want === "auto")
  ) {
    providers.push({
      name: "mistral",
      fn: async (buffer, filename, opts = {}) => {
        const r = await transcribeWithMistral(buffer, filename, opts);
        return opts.detailed ? r : r.text;
      },
    });
  }

  if (config.audio.groqApiKey && (want === "groq" || want === "auto")) {
    providers.push({
      name: "groq",
      fn: async (buffer, filename) =>
        transcribeWithOpenAICompat(buffer, filename, {
          apiKey: config.audio.groqApiKey,
          url: "https://api.groq.com/openai/v1/audio/transcriptions",
          model: "whisper-large-v3-turbo",
        }),
    });
  }

  if (config.audio.openaiApiKey && (want === "openai" || want === "auto")) {
    providers.push({
      name: "openai",
      fn: async (buffer, filename) =>
        transcribeWithOpenAICompat(buffer, filename, {
          apiKey: config.audio.openaiApiKey,
          url: "https://api.openai.com/v1/audio/transcriptions",
          model: "whisper-1",
        }),
    });
  }

  return providers;
}

export async function transcribeAudio(buffer, ext = "ogg", opts = {}) {
  const filename = normalizeSttFilename(ext);
  const providers = buildTranscribeProviders();

  if (!providers.length) {
    throw new Error(
      "Configura GROQ_API_KEY o MISTRAL_API_KEY en .env (SPEECH_PROVIDER=groq|mistral)"
    );
  }

  let lastError;
  for (const provider of providers) {
    try {
      const result = await provider.fn(buffer, filename, opts);
      if (opts.detailed) return result;
      return typeof result === "string" ? result : result.text;
    } catch (error) {
      lastError = error;
      console.warn(`STT ${provider.name} falló:`, error.message);
    }
  }

  throw lastError || new Error("No se pudo transcribir el audio");
}

/** Transcripción Mistral sin forzar idioma (útil para /trad). */
export async function transcribeAudioAuto(buffer, ext = "mp3") {
  const filename = `trad-audio.${ext}`;
  if (!config.audio.mistralApiKey) {
    throw new Error("Configura MISTRAL_API_KEY en .env");
  }
  return transcribeWithMistral(buffer, filename, {
    language: null,
    timestamps: true,
  });
}

function splitText(text, maxLen) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return [clean];

  const parts = [];
  let rest = clean;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function synthesizeWithMistral(text, voiceId = "") {
  const body = {
    model: config.audio.mistralTtsModel,
    input: text,
    response_format: "mp3",
  };

  const voice = voiceId || config.audio.mistralTtsVoiceId;
  if (voice) body.voice_id = voice;

  const res = await fetch("https://api.mistral.ai/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.audio.mistralApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("audio/") || contentType.includes("octet-stream")) {
    if (!res.ok) throw new Error(`Mistral TTS HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Mistral TTS: ${msg}`);
  }

  if (!data.audio_data) throw new Error("Mistral TTS: sin audio_data");
  return Buffer.from(data.audio_data, "base64");
}

/** Traduce texto al español con Mistral (chat). */
export async function translateTextWithMistral(text, { context = "guión de video" } = {}) {
  const input = String(text || "").trim();
  if (!input) return "";
  if (!config.audio.mistralApiKey) {
    throw new Error("Configura MISTRAL_API_KEY en .env");
  }

  const model =
    config.audio.mistralChatModel || "mistral-small-latest";
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.audio.mistralApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: `Traduce al español (claro, natural, estilo redes) este ${context}.
Reglas:
- Devuelve SOLO la traducción, sin comillas ni explicación
- Conserva nombres propios, cifras y marcas
- Si ya está en español, devuélvelo igual (puedes pulir gramática menor)

Texto:
${input.slice(0, 12000)}`,
        },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Mistral translate: ${msg}`);
  }
  const out = data?.choices?.[0]?.message?.content?.trim() || "";
  return out.replace(/^["']|["']$/g, "") || input;
}

async function synthesizeWithGoogle(text) {
  const googleTTS = (await import("google-tts-api")).default;
  const chunks = splitText(text, 180);
  const buffers = [];

  for (const chunk of chunks) {
    const url = await googleTTS(chunk, config.audio.ttsLang, 1);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Google TTS HTTP ${res.status}`);
    }
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }

  return Buffer.concat(buffers);
}

export async function synthesizeSpeechBuffer(text, { voiceId = "", preferMistral = true } = {}) {
  let audioBuffer;
  const voice = voiceId || config.audio.mistralTtsVoiceId;

  if (preferMistral && config.audio.mistralApiKey && voice) {
    try {
      const chunks = splitText(text, 2200);
      if (chunks.length === 1) {
        audioBuffer = await synthesizeWithMistral(chunks[0], voice);
      } else {
        // Concatenar MP3s vía ffmpeg (Buffer.concat rompe frames)
        const { spawn } = await import("node:child_process");
        const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const dir = await mkdtemp(join(tmpdir(), "tts-parts-"));
        try {
          const listLines = [];
          for (let i = 0; i < chunks.length; i++) {
            const part = await synthesizeWithMistral(chunks[i], voice);
            const p = join(dir, `p${i}.mp3`);
            await writeFile(p, part);
            listLines.push(`file '${p.replace(/\\/g, "/")}'`);
          }
          const listPath = join(dir, "list.txt");
          const outPath = join(dir, "out.mp3");
          await writeFile(listPath, listLines.join("\n"), "utf8");
          const ffmpeg =
            config.trad?.ffmpegPath ||
            process.env.FFMPEG_PATH ||
            "ffmpeg";
          await new Promise((resolve, reject) => {
            const child = spawn(
              ffmpeg,
              ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath],
              { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
            );
            let err = "";
            child.stderr.on("data", (d) => {
              err += d.toString();
            });
            child.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg ${code}`))
            );
            child.on("error", reject);
          });
          audioBuffer = await readFile(outPath);
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch (error) {
      console.warn("Mistral TTS falló, usando Google TTS:", error.message);
    }
  }

  if (!audioBuffer) {
    try {
      audioBuffer = await synthesizeWithGoogle(text);
    } catch (error) {
      throw new Error(`TTS no disponible: ${error.message}`);
    }
  }

  if (!audioBuffer?.length) {
    throw new Error("TTS devolvió audio vacío");
  }
  return audioBuffer;
}

export async function synthesizeSpeech(text, opts = {}) {
  const audioBuffer = await synthesizeSpeechBuffer(text, opts);
  if (!existsSync(tmpBase)) mkdirSync(tmpBase, { recursive: true });
  const outPath = tempPath("mp3");
  writeFileSync(outPath, audioBuffer);
  return outPath;
}

function resolveFfmpegBin() {
  return (
    config.trad?.ffmpegPath ||
    process.env.FFMPEG_PATH ||
    "ffmpeg"
  );
}

/**
 * Convierte MP3 a OGG/Opus para nota de voz de Telegram
 * (sin carátula / player de música).
 */
export async function mp3ToVoiceOgg(mp3BufferOrPath) {
  const { spawn } = await import("node:child_process");
  const mp3Path =
    typeof mp3BufferOrPath === "string"
      ? mp3BufferOrPath
      : (() => {
          const p = tempPath("mp3");
          writeFileSync(p, mp3BufferOrPath);
          return p;
        })();
  const outPath = tempPath("ogg");
  const ffmpeg = resolveFfmpegBin();
  const wroteTemp = typeof mp3BufferOrPath !== "string";

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          "-y",
          "-i",
          mp3Path,
          "-c:a",
          "libopus",
          "-b:a",
          "48k",
          "-vbr",
          "on",
          "-application",
          "voip",
          "-f",
          "ogg",
          outPath,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      let err = "";
      child.stderr.on("data", (d) => {
        err += d.toString();
      });
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg ${code}`))
      );
      child.on("error", reject);
    });
    return outPath;
  } finally {
    if (wroteTemp) cleanupTemp(mp3Path);
  }
}

export function cleanupTemp(path) {
  try {
    if (path && existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

export async function readTempFile(path) {
  return readFileSync(path);
}

export function getSpeechProviderLabel() {
  if (config.audio.provider === "groq" && config.audio.groqApiKey) {
    return "Groq (whisper-large-v3-turbo)";
  }
  if (config.audio.mistralApiKey && config.audio.provider === "mistral") {
    return `Mistral (${config.audio.mistralTranscribeModel})`;
  }
  if (config.audio.mistralApiKey) return "Mistral + fallbacks";
  if (config.audio.groqApiKey) return "Groq";
  if (config.audio.openaiApiKey) return "OpenAI";
  return "sin configurar";
}
