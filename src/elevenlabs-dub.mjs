/**
 * Cliente REST Dubbing API (project) — ElevenLabs.
 * Docs: POST /v1/dubbing/project + language targets.
 */
import { config } from "./config.mjs";

const BASE = "https://api.elevenlabs.io/v1";

function apiKey() {
  const key = String(config.dub?.elevenApiKey || "").trim();
  if (!key) {
    throw new Error("Falta ELEVENLABS_API_KEY en .env para /dub.");
  }
  return key;
}

function headers(extra = {}) {
  return {
    "xi-api-key": apiKey(),
    ...extra,
  };
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.detail?.message ||
      data?.detail ||
      data?.message ||
      data?.error ||
      `HTTP ${res.status}`;
    throw new Error(
      typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 300)
    );
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Crea proyecto + opcionalmente el primer idioma (target_language).
 * @param {{ filePath?: string, fileBuffer?: Buffer, filename?: string, sourceUrl?: string, sourceLanguage?: string, targetLanguage?: string, reference?: string }} opts
 */
export async function createDubbingProject({
  filePath,
  fileBuffer,
  filename = "source.mp4",
  sourceUrl,
  sourceLanguage,
  targetLanguage = "es",
  reference = "asistenteWP /dub",
} = {}) {
  const form = new FormData();
  if (sourceUrl) {
    form.append("source_url", sourceUrl);
  } else if (fileBuffer) {
    form.append(
      "file",
      new Blob([Uint8Array.from(fileBuffer)], { type: "video/mp4" }),
      filename
    );
  } else if (filePath) {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(filePath);
    form.append(
      "file",
      new Blob([Uint8Array.from(buf)], { type: "video/mp4" }),
      filename
    );
  } else {
    throw new Error("ElevenLabs dub: falta file o source_url.");
  }
  if (reference) form.append("reference", String(reference).slice(0, 500));
  if (sourceLanguage) form.append("source_language", sourceLanguage);
  // /dub siempre a español
  form.append("target_language", "es");
  form.append("model_id", config.dub?.modelId || "dubbing_v2");

  const res = await fetch(`${BASE}/dubbing/project`, {
    method: "POST",
    headers: headers(),
    body: form,
  });
  return parseJson(res);
}

export async function getDubbingProject(projectId) {
  const res = await fetch(`${BASE}/dubbing/project/${encodeURIComponent(projectId)}`, {
    headers: headers(),
  });
  return parseJson(res);
}

export async function createDubbingLanguage(projectId, targetLanguage = "es") {
  const form = new FormData();
  form.append("target_language", "es");
  const res = await fetch(
    `${BASE}/dubbing/project/${encodeURIComponent(projectId)}/language`,
    {
      method: "POST",
      headers: headers(),
      body: form,
    }
  );
  return parseJson(res);
}

export async function getDubbingLanguage(projectId, languageId) {
  const res = await fetch(
    `${BASE}/dubbing/project/${encodeURIComponent(projectId)}/language/${encodeURIComponent(languageId)}`,
    { headers: headers() }
  );
  return parseJson(res);
}

/**
 * Espera proyecto ready; asegura language_id; espera dub completed; baja audio.
 */
export async function runDubbingToBuffer({
  filePath,
  fileBuffer,
  filename,
  sourceUrl,
  sourceLanguage,
  targetLanguage = "es",
  reference,
  onStatus,
  pollMs = 5000,
  maxWaitMs = 25 * 60 * 1000,
} = {}) {
  onStatus?.("🎧 ElevenLabs: creando proyecto de dubbing (→ ES)…");
  let project = await createDubbingProject({
    filePath,
    fileBuffer,
    filename,
    sourceUrl,
    sourceLanguage,
    targetLanguage: "es",
    reference,
  });
  const projectId = project.project_id || project.projectId;
  if (!projectId) throw new Error("ElevenLabs no devolvió project_id.");

  const deadline = Date.now() + maxWaitMs;
  onStatus?.(`🎧 Proyecto ${String(projectId).slice(0, 12)}… — preparando transcript…`);

  while (true) {
    if (Date.now() > deadline) {
      throw new Error("Timeout esperando transcript del proyecto ElevenLabs.");
    }
    project = await getDubbingProject(projectId);
    const status = String(project.status || "").toLowerCase();
    if (status === "ready") break;
    if (status === "failed") {
      const err =
        project.error?.error || project.error?.message || project.error || "failed";
      throw new Error(`ElevenLabs proyecto falló: ${err}`);
    }
    onStatus?.(`🎧 Preparando fuente (${status || "…" })…`);
    await sleep(pollMs);
  }

  let languageId =
    project.language_ids?.[0] ||
    project.languageIds?.[0] ||
    null;

  if (!languageId) {
    onStatus?.("🎧 Añadiendo idioma es…");
    const lang = await createDubbingLanguage(projectId, "es");
    languageId = lang.language_id || lang.languageId;
  }
  if (!languageId) {
    throw new Error("ElevenLabs no devolvió language_id.");
  }

  onStatus?.("🎧 Generando doblaje…");
  let language;
  while (true) {
    if (Date.now() > deadline) {
      throw new Error("Timeout esperando doblaje ElevenLabs.");
    }
    language = await getDubbingLanguage(projectId, languageId);
    const status = String(language.status || "").toLowerCase();
    if (status === "completed") break;
    if (status === "failed") {
      const err =
        language.error?.error || language.error?.message || language.error || "failed";
      throw new Error(`ElevenLabs doblaje falló: ${err}`);
    }
    onStatus?.(`🎧 Doblando (${status || "…" })…`);
    await sleep(pollMs);
  }

  const outputs = language.outputs || {};
  const audioUrl =
    outputs.lossless_audio ||
    outputs.losslessAudio ||
    outputs.audio ||
    outputs.mp3_audio ||
    outputs.mp3Audio;
  if (!audioUrl) {
    throw new Error(
      "Dub completado pero sin URL de audio (outputs.lossless_audio)."
    );
  }

  onStatus?.("⬇️ Descargando audio doblado…");
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`No pude descargar el audio doblado (HTTP ${audioRes.status}).`);
  }
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  if (!buffer.length) throw new Error("Audio doblado vacío.");

  return {
    projectId,
    languageId,
    targetLanguage: "es",
    buffer,
    contentType: audioRes.headers.get("content-type") || "audio/wav",
    project,
    language,
  };
}
