import { cleanWriteTopic } from "./news-write.mjs";

export function parseWpTopic(text = "") {
  const match = text.match(/^\/wp(?:@\w+)?\s+(.+)/is);
  if (match?.[1]?.trim()) return cleanWriteTopic(match[1].trim());
  return null;
}

export function wpIntroText() {
  return [
    "📝 Modo WordPress — artículo para FV Digital",
    "",
    "1. Me das el tema",
    "2. Redacto titular y contenido (con datos de la web)",
    "3. Te lo muestro para revisar",
    "4. Elegimos foto destacada",
    "5. Publicamos en WordPress",
    "",
    "/cancelar para salir.",
  ].join("\n");
}

export function formatWpPreview({ title, excerpt, bodyPlain }) {
  const snippet =
    bodyPlain.length > 700 ? `${bodyPlain.slice(0, 697)}...` : bodyPlain;

  return [
    "📰 Borrador del artículo",
    "",
    `*${title}*`,
    "",
    excerpt ? `${excerpt}\n` : "",
    snippet,
    "",
    "¿Todo correcto?",
    "• *sí* — continuar con la foto destacada",
    "• Escribe un titular nuevo para regenerar el texto",
    "• *cancelar*",
  ]
    .filter(Boolean)
    .join("\n");
}

export function isWpPreviewConfirm(text = "") {
  return /^(sí|si|ok|dale|correcto|continuar|publicar|siguiente)$/i.test(text.trim());
}
