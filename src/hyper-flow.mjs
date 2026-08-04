import { extractHyperframesPrompt } from "./video-intent.mjs";

export function emptyHyperFlow() {
  return { step: "action" };
}

export function parseHyperAction(text = "") {
  const t = text.trim().toLowerCase();
  if (/^4$|^cancelar$|^salir$|^no$/i.test(t)) return "cancel";
  if (/^3$|verificar|lint|revisar|estado|chequear/i.test(t)) return "check";
  if (/^2$|noticia|última|ultima|publicad/i.test(t)) return "render-last";
  if (/^1$|generar|render|video|texto|crear|haz/i.test(t)) return "render-text";
  return null;
}

export function hyperFlowMenuText() {
  return [
    "🎬 Modo HyperFrames",
    "",
    "¿Qué desea hacer?",
    "1. Generar video con texto personalizado",
    "2. Generar video con la última noticia publicada",
    "3. Verificar proyecto (lint)",
    "4. Cancelar",
    "",
    "Responda con el número o escríbame lo que necesita.",
    "Ejemplo: «genera un video diciendo hola FV Digital»",
    "/cancelar para salir.",
  ].join("\n");
}

export function extractHyperFlowPrompt(text = "") {
  return extractHyperframesPrompt(text) || text.trim();
}
