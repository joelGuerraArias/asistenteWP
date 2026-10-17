import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";

const tmpBase = join(tmpdir(), "asistente-wp-audio");
if (!existsSync(tmpBase)) mkdirSync(tmpBase, { recursive: true });

/** Tras HTTP 402 / sin crédito: no reintentar Mistral en este proceso. */
let mistralBillingBlocked = "";
let mistralBillingNotified = false;

export function isMistralBillingError(error) {
  const msg = String(error?.message || error || "");
  return /\b402\b|payment.?required|insufficient.?quota|insufficient.?credit|billing|no credit|out of credit|saldo|exceeded.*quota/i.test(
    msg
  );
}

export function noteMistralFailure(error) {
  if (isMistralBillingError(error)) {
    mistralBillingBlocked =
      String(error?.message || "sin saldo").slice(0, 140) || "sin saldo";
  }
}

export function isMistralAvailable() {
  return Boolean(config.audio.mistralApiKey) && !mistralBillingBlocked;
}

function notifyOnceBilling(onStatus) {
  if (!mistralBillingBlocked || mistralBillingNotified) return;
  mistralBillingNotified = true;
  onStatus?.(
    `⚠️ Mistral sin saldo (${mistralBillingBlocked}). Usaré OpenAI como fallback en esta sesión.`
  );
}

function shortErr(error) {
  return String(error?.message || error || "error").slice(0, 160);
}

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

async function transcribeWithOpenAICompat(buffer, filename, provider, opts = {}) {
  const form = new FormData();
  const mime =
    filename.endsWith(".ogg") || filename.endsWith(".opus")
      ? "audio/ogg"
      : filename.endsWith(".webm")
        ? "audio/webm"
        : filename.endsWith(".wav")
          ? "audio/wav"
          : filename.endsWith(".mp4") || filename.endsWith(".m4a")
            ? "audio/mp4"
            : "audio/mpeg";
  form.append("file", new Blob([buffer], { type: mime }), filename);
  form.append("model", provider.model);

  const lang =
    opts.language === undefined ? config.audio.language : opts.language;
  if (lang) form.append("language", lang);

  if (opts.timestamps) {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  }

  const res = await fetch(provider.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error?.message || `Transcripción falló (${res.status})`
    );
  }

  if (opts.detailed || opts.timestamps) {
    const text = extractTranscript(data);
    if (!text) throw new Error("OpenAI STT: respuesta vacía");
    return {
      text,
      language: data.language || null,
      segments: data.segments || [],
      raw: data,
    };
  }

  return extractTranscript(data);
}

function openaiSttProvider() {
  return {
    apiKey: config.audio.openaiApiKey,
    url: "https://api.openai.com/v1/audio/transcriptions",
    model: config.audio.openaiSttModel || "whisper-1",
  };
}

function buildTranscribeProviders() {
  const providers = [];
  const seen = new Set();
  const want = config.audio.provider;

  const add = (name, fn) => {
    if (seen.has(name)) return;
    seen.add(name);
    providers.push({ name, fn });
  };

  // Primario: Mistral (si hay clave y no está bloqueado por 402)
  if (isMistralAvailable()) {
    add("mistral", async (buffer, filename, opts = {}) => {
      const r = await transcribeWithMistral(buffer, filename, opts);
      return opts.detailed ? r : r.text;
    });
  }

  if (config.audio.groqApiKey && (want === "groq" || want === "auto" || !isMistralAvailable())) {
    add("groq", async (buffer, filename, opts = {}) =>
      transcribeWithOpenAICompat(
        buffer,
        filename,
        {
          apiKey: config.audio.groqApiKey,
          url: "https://api.groq.com/openai/v1/audio/transcriptions",
          model: "whisper-large-v3-turbo",
        },
        opts
      )
    );
  }

  // Fallback final: OpenAI Whisper
  if (config.audio.openaiApiKey) {
    add("openai", async (buffer, filename, opts = {}) =>
      transcribeWithOpenAICompat(buffer, filename, openaiSttProvider(), opts)
    );
  }

  return providers;
}

export async function transcribeAudio(buffer, ext = "ogg", opts = {}) {
  const filename = normalizeSttFilename(ext);
  const onStatus = opts.onStatus;
  notifyOnceBilling(onStatus);
  const providers = buildTranscribeProviders();

  if (!providers.length) {
    throw new Error(
      "Configura GROQ_API_KEY, MISTRAL_API_KEY o OPENAI_API_KEY en .env"
    );
  }

  let lastError;
  let usedPrimary = false;
  for (const provider of providers) {
    try {
      if (provider.name === "mistral") {
        onStatus?.("📝 Transcribiendo con Mistral…");
      }
      const result = await provider.fn(buffer, filename, opts);
      if (usedPrimary && provider.name !== "mistral") {
        onStatus?.(
          `↩️ Fallback STT → ${provider.name === "openai" ? "OpenAI Whisper" : provider.name}`
        );
      }
      if (opts.detailed) return result;
      return typeof result === "string" ? result : result.text;
    } catch (error) {
      lastError = error;
      usedPrimary = true;
      if (provider.name === "mistral") noteMistralFailure(error);
      console.warn(`STT ${provider.name} falló:`, error.message);
      onStatus?.(`⚠️ STT ${provider.name} falló: ${shortErr(error)}`);
    }
  }

  throw lastError || new Error("No se pudo transcribir el audio");
}

/**
 * Transcripción con timestamps ( /trad, /local, SIE ).
 * Primario: Mistral. Fallback: Groq → OpenAI Whisper.
 */
export async function transcribeAudioAuto(buffer, ext = "mp3", opts = {}) {
  const onStatus = opts.onStatus;
  notifyOnceBilling(onStatus);
  const filename = `trad-audio.${String(ext || "mp3").replace(/^\./, "")}`;
  const attempts = [];

  if (isMistralAvailable()) {
    attempts.push({
      name: "mistral",
      label: "Mistral",
      fn: () =>
        transcribeWithMistral(buffer, filename, {
          language: null,
          timestamps: true,
        }),
    });
  }

  if (config.audio.groqApiKey) {
    attempts.push({
      name: "groq",
      label: "Groq",
      fn: () =>
        transcribeWithOpenAICompat(
          buffer,
          filename,
          {
            apiKey: config.audio.groqApiKey,
            url: "https://api.groq.com/openai/v1/audio/transcriptions",
            model: "whisper-large-v3-turbo",
          },
          { language: null, timestamps: true, detailed: true }
        ),
    });
  }

  if (config.audio.openaiApiKey) {
    attempts.push({
      name: "openai",
      label: "OpenAI Whisper",
      fn: () =>
        transcribeWithOpenAICompat(buffer, filename, openaiSttProvider(), {
          language: null,
          timestamps: true,
          detailed: true,
        }),
    });
  }

  if (!attempts.length) {
    throw new Error("Configura MISTRAL_API_KEY o OPENAI_API_KEY en .env");
  }

  let lastError;
  let failedPrimary = false;
  for (const attempt of attempts) {
    try {
      if (attempt.name === "mistral") {
        onStatus?.("📝 Detectando idioma (Mistral STT)…");
      } else if (failedPrimary) {
        onStatus?.(`↩️ Fallback STT → ${attempt.label}…`);
      } else {
        onStatus?.(`📝 Transcribiendo con ${attempt.label}…`);
      }
      const result = await attempt.fn();
      if (failedPrimary) {
        onStatus?.(`✅ STT OK con ${attempt.label}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      failedPrimary = true;
      if (attempt.name === "mistral") noteMistralFailure(error);
      console.warn(`STT auto ${attempt.name} falló:`, error.message);
      onStatus?.(`⚠️ ${attempt.label} STT falló: ${shortErr(error)}`);
    }
  }

  throw lastError || new Error("No se pudo transcribir el audio");
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

/**
 * OpenAI Speech API — fallback TTS (voz cedar por defecto).
 * @see https://developers.openai.com/api/docs/guides/text-to-speech
 */
async function synthesizeWithOpenAI(text, { voice = "" } = {}) {
  if (!config.audio.openaiApiKey) {
    throw new Error("Falta OPENAI_API_KEY para TTS OpenAI");
  }
  const model = config.audio.openaiTtsModel || "gpt-4o-mini-tts";
  const voiceName = voice || config.audio.openaiTtsVoice || "cedar";
  const body = {
    model,
    voice: voiceName,
    input: String(text || "").trim(),
    response_format: "mp3",
  };
  const instructions = String(config.audio.openaiTtsInstructions || "").trim();
  if (instructions && model.includes("gpt-4o")) {
    body.instructions = instructions;
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.audio.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(errBody);
      msg = j?.error?.message || j?.message || msg;
    } catch {
      if (errBody) msg = errBody.slice(0, 200);
    }
    throw new Error(`OpenAI TTS: ${msg}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("OpenAI TTS: audio vacío");
  return buf;
}

/** Concatena varios MP3 con ffmpeg (Buffer.concat rompe frames). */
async function concatMp3Buffers(buffers = []) {
  if (!buffers.length) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];

  const { spawn } = await import("node:child_process");
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "tts-parts-"));
  try {
    const listLines = [];
    for (let i = 0; i < buffers.length; i++) {
      const p = join(dir, `p${i}.mp3`);
      await writeFile(p, buffers[i]);
      listLines.push(`file '${p.replace(/\\/g, "/")}'`);
    }
    const listPath = join(dir, "list.txt");
    const outPath = join(dir, "out.mp3");
    await writeFile(listPath, listLines.join("\n"), "utf8");
    const ffmpeg =
      config.trad?.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
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
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function synthesizeChunked(text, maxLen, synthOne) {
  const chunks = splitText(text, maxLen);
  if (chunks.length === 1) return synthOne(chunks[0]);
  const parts = [];
  for (const chunk of chunks) {
    parts.push(await synthOne(chunk));
  }
  return concatMp3Buffers(parts);
}

const ES_WORDS = new Set(
  "el los las del que por con para pero muy también tambien cuando donde porque desde según segun está están estan tiene tienen hacer dijo ellos ella aquí aqui ahora todos todas mismo otro otra gobierno gente hoy fue son hay sus nos les año años y la de en un una es se lo".split(
    " "
  )
);
const OTHER_WORDS = new Set(
  [
    // inglés
    "the and is are was were this that with you have what of to in it for on be",
    // portugués
    "o os as do da dos das em é não nao você voce uma muito isso então entao tem foi disse hoje ao aos pelo pela já mais ele eles seu sua vai governo pessoas",
    // italiano
    "il della delle che sono questo questa anche perché perche molto gli dei nel è",
    // francés
    "et est une des pour avec dans nous vous je pas au aux ce qui",
    // alemán
    "der die und ist nicht ein eine ich",
  ]
    .join(" ")
    .split(" ")
);

/** Heurística: ¿el texto está en español? (portugués/italiano/francés/inglés no cuentan). */
export function looksSpanishText(text = "") {
  const t = String(text || "").toLowerCase();
  if (/[ãõ]/.test(t)) return false;
  const words = t.match(/[\p{L}']+/gu) || [];
  if (words.length < 6) return false;
  let es = 0;
  let other = 0;
  for (const w of words) {
    if (ES_WORDS.has(w)) es += 1;
    if (OTHER_WORDS.has(w)) other += 1;
  }
  return es / words.length >= 0.15 && es > other * 2;
}

/** Traduce texto al español: Mistral → OpenAI chat. Reintenta si no vuelve en español. */
export async function translateTextWithMistral(
  text,
  { context = "guión de video", onStatus } = {}
) {
  const input = String(text || "").trim();
  if (!input) return "";

  const basePrompt = `Traduce al español (claro, natural, estilo redes) este ${context}.
Reglas:
- Detecta tú el idioma de origen (puede ser inglés, portugués, italiano, francés, criollo haitiano u otro) y traduce TODO al español
- Devuelve SOLO la traducción, sin comillas, sin explicación y sin indicar el idioma
- Conserva nombres propios, cifras y marcas
- Si ya está en español, devuélvelo igual (puedes pulir gramática menor)

Texto:
${input.slice(0, 12000)}`;

  const out = await translateOnce(basePrompt, input, onStatus);
  const wordCount = input.split(/\s+/).filter(Boolean).length;
  if (wordCount < 6 || looksSpanishText(out)) return out;

  onStatus?.("🔁 La traducción no salió en español, reintentando…");
  const strictPrompt = `El siguiente texto NO está en español. Tradúcelo de forma completa y fiel al español neutro.
Devuelve únicamente el texto traducido al español, sin comillas ni comentarios. Ninguna frase puede quedar en el idioma original (salvo nombres propios).

Texto:
${input.slice(0, 12000)}`;
  const retry = await translateOnce(strictPrompt, input, onStatus);
  return looksSpanishText(retry) || !looksSpanishText(out) ? retry : out;
}

async function translateOnce(prompt, input, onStatus) {
  notifyOnceBilling(onStatus);

  if (isMistralAvailable()) {
    try {
      onStatus?.("🌐 Traduciendo con Mistral…");
      const model = config.audio.mistralChatModel || "mistral-small-latest";
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.audio.mistralApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error?.message || `HTTP ${res.status}`;
        throw new Error(`Mistral translate: ${msg}`);
      }
      const out = data?.choices?.[0]?.message?.content?.trim() || "";
      return out.replace(/^["']|["']$/g, "") || input;
    } catch (error) {
      noteMistralFailure(error);
      onStatus?.(`⚠️ Traducción Mistral falló: ${shortErr(error)}`);
      console.warn("Mistral translate falló:", error.message);
    }
  }

  if (!config.audio.openaiApiKey) {
    throw new Error(
      "Traducción no disponible: Mistral falló y falta OPENAI_API_KEY"
    );
  }

  onStatus?.("↩️ Fallback traducción → OpenAI…");
  const model = config.audio.openaiChatModel || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.audio.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`OpenAI translate: ${msg}`);
  }
  const out = data?.choices?.[0]?.message?.content?.trim() || "";
  onStatus?.("✅ Traducción OK con OpenAI");
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

export async function synthesizeSpeechBuffer(
  text,
  { voiceId = "", preferMistral = true, onStatus } = {}
) {
  let audioBuffer;
  const voice = voiceId || config.audio.mistralTtsVoiceId;
  let mistralError = null;
  notifyOnceBilling(onStatus);

  const tryMistral =
    preferMistral && isMistralAvailable() && Boolean(voice);

  if (tryMistral) {
    try {
      onStatus?.("🗣️ Generando voz con Mistral (pabmatos)…");
      audioBuffer = await synthesizeChunked(text, 2200, (chunk) =>
        synthesizeWithMistral(chunk, voice)
      );
    } catch (error) {
      mistralError = error;
      noteMistralFailure(error);
      onStatus?.(`⚠️ TTS Mistral falló: ${shortErr(error)}`);
      console.warn("Mistral TTS falló, probando OpenAI cedar…", error.message);
    }
  }

  if (!audioBuffer && config.audio.openaiApiKey) {
    try {
      const openaiVoice = config.audio.openaiTtsVoice || "cedar";
      onStatus?.(
        mistralError || tryMistral
          ? `↩️ Fallback TTS → OpenAI (${openaiVoice})…`
          : `🗣️ Generando voz con OpenAI (${openaiVoice})…`
      );
      audioBuffer = await synthesizeChunked(text, 2000, (chunk) =>
        synthesizeWithOpenAI(chunk, { voice: openaiVoice })
      );
      if (mistralError) {
        onStatus?.(`✅ TTS OK con OpenAI (${openaiVoice})`);
      }
    } catch (error) {
      onStatus?.(`⚠️ TTS OpenAI falló: ${shortErr(error)}`);
      console.warn("OpenAI TTS falló, usando Google TTS:", error.message);
    }
  }

  if (!audioBuffer) {
    try {
      onStatus?.("↩️ Fallback TTS → Google…");
      audioBuffer = await synthesizeWithGoogle(text);
    } catch (error) {
      const prior = mistralError ? ` (Mistral: ${mistralError.message})` : "";
      throw new Error(`TTS no disponible: ${error.message}${prior}`);
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
