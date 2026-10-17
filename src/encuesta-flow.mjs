/**
 * Flujo /encuesta — foto + pregunta → tarjeta ALPHA → webhook.
 * Flujo /encuestadoble — N fotos (2–4) en círculos + pregunta → webhook.
 * Revisa ortografía de la pregunta y avisa, pero no la cambia.
 */

export function emptyEncuestaFlow() {
  return {
    mode: "simple",
    step: "awaiting_photo",
    photoBuffer: null,
    photoMimeType: null,
    photos: [],
    photoCount: 1,
    question: "",
    spellingNote: "",
    cardBuffer: null,
    imageUrl: null,
    r2Key: null,
  };
}

export function emptyEncuestaDobleFlow() {
  return {
    mode: "doble",
    step: "awaiting_count",
    photoBuffer: null,
    photoMimeType: null,
    photos: [],
    photoCount: 0,
    question: "",
    spellingNote: "",
    cardBuffer: null,
    imageUrl: null,
    r2Key: null,
  };
}

export function encuestaDobleIntroText() {
  return [
    "📊 Modo /encuestadoble",
    "",
    "¿De cuántas fotos será la encuesta?",
    "Responde: 2, 3 o 4",
    "",
    "Luego te pediré cada foto (rostros → círculos), la pregunta,",
    "reviso ortografía sin cambiar tu texto, monto la tarjeta y la envío al webhook.",
  ].join("\n");
}

export function parseEncuestaPhotoCount(text = "") {
  const t = String(text || "").trim().toLowerCase();
  const m = t.match(/\b([2-4])\b/);
  if (m) return Number(m[1]);
  if (/^dos\b/.test(t)) return 2;
  if (/^tres\b/.test(t)) return 3;
  if (/^cuatro\b/.test(t)) return 4;
  return 0;
}

export function encuestaAskNextPhotoText(flow) {
  const have = flow?.photos?.length || 0;
  const need = flow?.photoCount || 0;
  return `Envía la foto ${have + 1} de ${need} (rostro de la persona):`;
}

export function isEncuestaFlowActive(session) {
  return Boolean(session?.encuestaFlow);
}

export function cancelEncuestaFlow(session) {
  if (session) session.encuestaFlow = null;
}

export function encuestaIntroText() {
  return [
    "📊 Modo /encuesta",
    "",
    "1) Envía la foto",
    "2) Escribe la pregunta",
    "",
    "Reviso ortografía (te aviso si hay dudas) pero dejo tu texto tal cual.",
    "Luego monto la tarjeta ALPHA y la envío al webhook.",
  ].join("\n");
}

export function encuestaAskQuestionText() {
  return "Foto lista. Ahora escribe la pregunta de la encuesta:";
}

export function encuestaAwaitingPhoto(session) {
  return session?.encuestaFlow?.step === "awaiting_photo";
}

export function encuestaAwaitingQuestion(session) {
  return session?.encuestaFlow?.step === "awaiting_question";
}

export function encuestaCancelText() {
  return "Modo /encuesta cancelado.";
}

export function setEncuestaPhoto(session, buffer, mimeType) {
  if (!session?.encuestaFlow) return;
  session.encuestaFlow.photoBuffer = buffer;
  session.encuestaFlow.photoMimeType = mimeType;
  session.encuestaFlow.step = "awaiting_question";
}

export function normalizeEncuestaQuestion(text = "") {
  return String(text || "")
    .replace(/^\/encuesta\s*/i, "")
    .trim();
}

/** Compara original vs sugerencia ignorando espacios extremos. */
export function encuestaSpellingDiffers(original = "", suggested = "") {
  const a = String(original || "").trim().replace(/\s+/g, " ");
  const b = String(suggested || "").trim().replace(/\s+/g, " ");
  if (!a || !b) return false;
  return a.localeCompare(b, "es", { sensitivity: "accent" }) !== 0;
}
