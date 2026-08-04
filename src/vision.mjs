import { config } from "./config.mjs";
import { fetchWithRetry } from "./fetch-retry.mjs";
import { prepareImageForOcr } from "./image.mjs";

function toDataUrl(buffer, mimeType = "image/jpeg") {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function mistralChat(messages, { json = false } = {}) {
  if (!config.audio.mistralApiKey) {
    throw new Error("Configura MISTRAL_API_KEY en .env");
  }

  const body = { model: config.vision.model, messages };
  if (json) body.response_format = { type: "json_object" };

  const res = await fetchWithRetry(
    "https://api.mistral.ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.audio.mistralApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    { label: "Mistral visión" }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Mistral vision ${res.status}`);
  }

  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function ocrWithMistralApi(buffer, mimeType) {
  const res = await fetchWithRetry(
    "https://api.mistral.ai/v1/ocr",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.audio.mistralApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.vision.ocrModel,
        document: {
          type: "image_url",
          image_url: toDataUrl(buffer, mimeType),
        },
      }),
    },
    { label: "Mistral OCR", retries: 3, delayMs: 1500 }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error?.message || `Mistral OCR ${res.status}`);
  }

  const markdown = (data.pages || [])
    .map((p) => p.markdown || "")
    .join("\n\n")
    .trim();

  if (!markdown) throw new Error("OCR no encontró texto en la imagen");
  return markdown;
}

async function ocrWithVisionFallback(buffer, mimeType) {
  const content = await mistralChat([
    {
      role: "user",
      content: [
        { type: "image_url", image_url: toDataUrl(buffer, mimeType) },
        {
          type: "text",
          text:
            "Extrae TODO el texto visible de esta captura de noticia (titular y cuerpo). " +
            "Devuelve solo el texto en español o idioma original, con párrafos separados. Sin comentarios.",
        },
      ],
    },
  ]);

  if (!content.trim()) {
    throw new Error("No se pudo extraer texto de la captura");
  }
  return content.trim();
}

export async function ocrImage(buffer, mimeType = "image/jpeg") {
  if (!config.audio.mistralApiKey) {
    throw new Error("Configura MISTRAL_API_KEY en .env");
  }

  const { buffer: prepared, mimeType: preparedMime } = await prepareImageForOcr(buffer);

  try {
    return await ocrWithMistralApi(prepared, preparedMime);
  } catch (primaryError) {
    console.warn("Mistral OCR falló, usando visión como respaldo:", primaryError.message);
    try {
      return await ocrWithVisionFallback(prepared, preparedMime);
    } catch (fallbackError) {
      throw new Error(
        `No pude leer la captura. OCR: ${primaryError.message}. Respaldo: ${fallbackError.message}`
      );
    }
  }
}

export async function detectCropBox(buffer, mimeType = "image/jpeg", hint = "") {
  const { buffer: prepared, mimeType: preparedMime } = await prepareImageForOcr(buffer);

  const prompt = `Analiza esta imagen (puede ser captura de noticia en móvil).
Devuelve SOLO JSON con el recorte del contenido principal, excluyendo barras del sistema, navegación del teléfono y bordes vacíos:
{"left":0-100,"top":0-100,"width":1-100,"height":1-100}
Valores en porcentaje de la imagen original.
${hint ? `Indicación del usuario: ${hint}` : "Enfócate en titular + cuerpo de la noticia."}`;

  const content = await mistralChat(
    [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: toDataUrl(prepared, preparedMime) },
          { type: "text", text: prompt },
        ],
      },
    ],
    { json: true }
  );

  try {
    const box = JSON.parse(content);
    return normalizeCropBox(box);
  } catch {
    return { left: 5, top: 8, width: 90, height: 84 };
  }
}

function normalizeCropBox(box) {
  const left = clamp(Number(box.left) || 0, 0, 95);
  const top = clamp(Number(box.top) || 0, 0, 95);
  const width = clamp(Number(box.width) || 90, 1, 100 - left);
  const height = clamp(Number(box.height) || 90, 1, 100 - top);
  return { left, top, width, height };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export async function describeImage(buffer, mimeType, question) {
  const { buffer: prepared, mimeType: preparedMime } = await prepareImageForOcr(buffer);
  return mistralChat([
    {
      role: "user",
      content: [
        { type: "image_url", image_url: toDataUrl(prepared, preparedMime) },
        { type: "text", text: question },
      ],
    },
  ]);
}
