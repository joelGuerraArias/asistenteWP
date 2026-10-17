/**
 * Flujo /pic — foto + texto del usuario → preview → confirmar FV o F1RD.
 */

export function emptyPicFlow() {
  return {
    step: "awaiting_photo",
    photoBuffer: null,
    photoMimeType: null,
    headline: "",
    originalHeadline: "",
    spellingApplied: false,
    dest: null,
    previewCard: null,
  };
}

export function isPicFlowActive(session) {
  return Boolean(session?.picFlow);
}

export function cancelPicFlow(session) {
  if (session) session.picFlow = null;
}

export function picIntroText(hasText = false) {
  if (hasText) {
    return "📸 Modo /pic.\n\nTexto guardado. Envía la foto. Verás la vista previa antes de confirmar.";
  }
  return "📸 Modo /pic.\n\nEnvía foto + texto (o por separado). Solo corrijo ortografía (no reescribo el texto), genero la tarjeta y te la muestro. Luego confirmas.";
}

export function picAskTitleText() {
  return "¿Qué texto va en el lower-third?";
}

export function picAskDestText(headline) {
  const preview =
    headline.length > 120 ? `${headline.slice(0, 117)}…` : headline;
  return [`Texto: «${preview}»`, "", "Elige la marca para generar la vista previa:"].join(
    "\n"
  );
}

export function picPreviewReadyText(destLabel) {
  return `Vista previa (${destLabel}). ¿La envío a redes?`;
}

export function picAwaitingPhoto(session) {
  return session?.picFlow?.step === "awaiting_photo";
}

export function picAwaitingTitle(session) {
  return session?.picFlow?.step === "awaiting_title";
}

export function picAwaitingDest(session) {
  return session?.picFlow?.step === "awaiting_dest";
}

export function picAwaitingConfirm(session) {
  return session?.picFlow?.step === "awaiting_confirm";
}

export function picCancelText() {
  return "Modo /pic cancelado.";
}

export function setPicPhoto(session, buffer, mimeType) {
  if (!session?.picFlow) return;
  session.picFlow.photoBuffer = buffer;
  session.picFlow.photoMimeType = mimeType;
}

export function normalizePicText(text = "") {
  return String(text || "")
    .replace(/^\/pic\s*/i, "")
    .trim();
}

/**
 * @returns {{ handled: boolean, reply?: string, readyForDest?: boolean }}
 */
export function handlePicText(session, text) {
  if (!session?.picFlow) return { handled: false };

  const headline = normalizePicText(text);
  const flow = session.picFlow;

  if (flow.step === "awaiting_confirm") {
    return { handled: false };
  }

  if (flow.step === "awaiting_photo") {
    if (!headline) {
      return { handled: true, reply: "Envía el texto o la foto primero." };
    }
    flow.headline = headline;
    return {
      handled: true,
      reply: "Texto guardado. Ahora envía la foto.",
    };
  }

  if (flow.step !== "awaiting_title") {
    return { handled: false };
  }

  if (!headline) {
    return { handled: true, reply: picAskTitleText() };
  }

  flow.headline = headline;
  return { handled: true, readyForDest: true };
}

/**
 * @returns {{ handled: boolean, dest?: string, reply?: string }}
 */
export function handlePicDestText(session, text) {
  if (!session?.picFlow || session.picFlow.step !== "awaiting_dest") {
    return { handled: false };
  }

  const t = normalizePicText(text).toLowerCase();
  if (/^(fv|fv digital|fvdigital|fvdigital\.do)$/.test(t)) {
    return { handled: true, dest: "fvdigital" };
  }
  if (/^(f1|f1rd|formula1rd|formula 1 rd|formula1 rd)$/.test(t)) {
    return { handled: true, dest: "f1rd" };
  }

  return {
    handled: true,
    reply: "Elige FV Digital o F1RD con los botones, o escribe «fv» o «f1rd».",
  };
}

export function advancePicAfterPhoto(session, caption = "") {
  const flow = session?.picFlow;
  if (!flow?.photoBuffer) return null;

  const fromCaption = normalizePicText(caption);
  if (fromCaption) {
    flow.headline = fromCaption;
  }

  if (flow.headline) {
    return { readyForDest: true };
  }

  flow.step = "awaiting_title";
  return { reply: picAskTitleText() };
}

export function normalizeHeadlineCompare(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function headlineWasCorrected(original = "", corrected = "") {
  return normalizeHeadlineCompare(original) !== normalizeHeadlineCompare(corrected);
}
