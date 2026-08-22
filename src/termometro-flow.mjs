/**
 * Flujo conversacional para /foto — video "Termómetro".
 *
 * Estados:
 * - awaiting_name: esperando nombre del funcionario
 * - awaiting_institution: esperando institución
 * - awaiting_photo: esperando foto de Telegram
 *
 * El resto de la lógica de renderizado vive en termometro-video.mjs.
 */

export function emptyTermometroFlow() {
  return {
    step: "awaiting_name",
    name: "",
    institution: "",
    photoBuffer: null,
    photoMimeType: null,
  };
}

export function termometroIntroText() {
  return "🌡️ Modo Termómetro FV Digital.\n\n¿Nombre del funcionario?";
}

export function termometroAskInstitution() {
  return "¿Institución?";
}

export function termometroAskPhoto() {
  return "Ahora envía la foto del funcionario. La recortaré automáticamente.";
}

export function isTermometroActive(session) {
  return Boolean(session?.termometroFlow);
}

export function cancelTermometroFlow(session) {
  if (session) session.termometroFlow = null;
}

/**
 * Procesa un mensaje de texto dentro del flujo /foto.
 * @returns {object|null} null si no manejó el mensaje; de lo contrario { done: boolean, reply: string }
 */
export function handleTermometroText(session, text) {
  if (!isTermometroActive(session)) return null;
  const flow = session.termometroFlow;

  if (flow.step === "awaiting_name") {
    const name = String(text || "").trim();
    if (!name) {
      return { done: false, reply: "Necesito el nombre del funcionario. ¿Cuál es?" };
    }
    flow.name = name;
    flow.step = "awaiting_institution";
    return { done: false, reply: termometroAskInstitution() };
  }

  if (flow.step === "awaiting_institution") {
    const institution = String(text || "").trim();
    if (!institution) {
      return { done: false, reply: "Necesito la institución. ¿Cuál es?" };
    }
    flow.institution = institution;
    flow.step = "awaiting_photo";
    return { done: false, reply: termometroAskPhoto() };
  }

  return null;
}

/**
 * Verifica si el flujo está esperando una foto.
 */
export function termometroAwaitingPhoto(session) {
  return session?.termometroFlow?.step === "awaiting_photo";
}

/**
 * Guarda la foto recibida en el flujo.
 */
export function setTermometroPhoto(session, buffer, mimeType) {
  if (!session?.termometroFlow) return;
  session.termometroFlow.photoBuffer = buffer;
  session.termometroFlow.photoMimeType = mimeType;
}

export function getTermometroData(session) {
  return session?.termometroFlow || null;
}

export function termometroCancelText() {
  return "Modo Termómetro cancelado.";
}
