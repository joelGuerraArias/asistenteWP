/**
 * Detecta pedidos en lenguaje natural para herramientas de video.
 * @returns {{ tool: string, prompt: string, render?: boolean } | null}
 */
export function parseVideoIntent(text = "") {
  const raw = String(text).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const wantsRender = wantsVideoRender(lower);

  if (
    /^\/video\b/i.test(raw) ||
    /^(video|herramientas de video)\b/i.test(raw) ||
    /estado de (las )?herramientas de video/i.test(lower) ||
    /qué (herramientas|tools) de video/i.test(lower)
  ) {
    return { tool: "status", prompt: "" };
  }

  if (
    /^\/heygen\b/i.test(raw) ||
    /\bheygen\b/i.test(lower) ||
    /video\s+con\s+(presentador|avatar)/i.test(lower) ||
    /presentador\s+(en\s+)?video/i.test(lower) ||
    /genera(r)?\s+un\s+video\s+(con\s+)?(heygen|presentador|avatar)/i.test(lower) ||
    /haz(me)?\s+un\s+video\s+(con\s+)?(heygen|presentador|avatar)/i.test(lower) ||
    /usa(r)?\s+heygen/i.test(lower)
  ) {
    return { tool: "heygen", prompt: extractHeyGenPrompt(raw), render: true };
  }

  if (
    /^\/hyperframes\b/i.test(raw) ||
    /\bhyperframes\b/i.test(lower) ||
    /\bhypeframes\b/i.test(lower) ||
    /grafico\s+html/i.test(lower) ||
    /video\s+html/i.test(lower) ||
    /render(iza)?\s+con\s+hyperframes/i.test(lower)
  ) {
    const render =
      wantsRender ||
      /genera(r)?\s+un\s+video/i.test(lower) ||
      /haz(me)?\s+un\s+video/i.test(lower) ||
      /crea(r)?\s+un\s+video/i.test(lower) ||
      /video\s+con\s+hyperframes/i.test(lower);
    return {
      tool: "hyperframes",
      prompt: extractHyperframesPrompt(raw),
      render,
    };
  }

  if (
    /^\/remotion\b/i.test(raw) ||
    /\bremotion\b/i.test(lower) ||
    /composiciones?\s+remotion/i.test(lower) ||
    /studio\s+remotion/i.test(lower)
  ) {
    const render =
      wantsRender ||
      /genera(r)?\s+un\s+video/i.test(lower) ||
      /haz(me)?\s+un\s+video/i.test(lower) ||
      /crea(r)?\s+un\s+video/i.test(lower) ||
      /video\s+con\s+remotion/i.test(lower);
    return { tool: "remotion", prompt: extractRemotionPrompt(raw), render };
  }

  // "genera un video" genérico → HeyGen si no es redacción de noticia
  if (
    /genera(r)?\s+un\s+video/i.test(lower) ||
    /haz(me)?\s+un\s+video/i.test(lower) ||
    /crea(r)?\s+un\s+video/i.test(lower)
  ) {
    if (!/noticia|art[ií]culo|post/i.test(lower)) {
      return { tool: "heygen", prompt: extractHeyGenPrompt(raw), render: true };
    }
  }

  return null;
}

function wantsVideoRender(lower) {
  return /render(iza|ar|e)?|exporta(r)?|genera(r)?\s+(?:un\s+|el\s+)?video|haz(me)?\s+un\s+video|crea(r)?\s+un\s+video|saca(r)?\s+el\s+video/i.test(
    lower
  );
}

export function extractHyperframesPrompt(text) {
  const patterns = [
    /hyperframes\s+(?:\w+\s+)*?(?:diciendo|que\s+diga|con|sobre|de)\s+(.+)/i,
    /video\s+(?:con\s+)?hyperframes\s+(?:\w+\s+)*?(?:diciendo|que\s+diga|con|sobre|de)\s+(.+)/i,
    /genera(?:r)?\s+un\s+video\s+con\s+hyperframes\s+(?:\w+\s+)*?(?:diciendo|que\s+diga|con|sobre|de)\s+(.+)/i,
    /diciendo\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].replace(/[.…]+$/u, "").trim();
  }
  return "";
}

function extractRemotionPrompt(text) {
  const match = text.match(/diciendo\s+(.+)/i);
  return match?.[1]?.replace(/[.…]+$/u, "").trim() || "";
}

function extractHeyGenPrompt(text) {
  const stripped = text
    .replace(/^\/heygen(@\w+)?\s*/i, "")
    .replace(/^\/video\s+/i, "")
    .trim();

  const patterns = [
    /heygen\s+(?:para\s+)?(?:que\s+)?(?:diga|diciendo|con)\s+(.+)/i,
    /video\s+(?:heygen\s+)?(?:diciendo|sobre|de|con|que)\s+(.+)/i,
    /genera(?:r)?\s+un\s+video\s+(?:heygen\s+)?(?:diciendo|sobre|de|que)\s+(.+)/i,
    /haz(?:me)?\s+un\s+video\s+(?:heygen\s+)?(?:diciendo|sobre|de|que)\s+(.+)/i,
    /usa(?:r)?\s+heygen\s+(?:para\s+)?(.+)/i,
    /presentador\s+(?:que\s+)?(?:diga|diciendo)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  // Si el mensaje es largo y no matcheó, puede ser el guión directo
  if (stripped.length > 40 && !/^(genera|haz|crea|usa)/i.test(stripped)) {
    return stripped;
  }

  return "";
}

export function isVideoIntent(text = "") {
  return Boolean(parseVideoIntent(text));
}
