import { Markup } from "telegraf";
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

export function articlePreviewOptionsText({ lockTitle = false } = {}) {
  const lines = [
    "¿Todo correcto?",
    "• *sí* / Continuar — foto destacada",
    "• *reescribir* — otra versión del artículo",
    "• *opinión* — me dices qué cambiar y lo reescribo",
    "• *cancelar*",
  ];
  if (!lockTitle) {
    lines.splice(3, 0, "• O escribe un titular nuevo para regenerar");
  }
  return lines.join("\n");
}

export function formatWpPreview({ title, excerpt, bodyPlain, lockTitle = false }) {
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
    articlePreviewOptionsText({ lockTitle }),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatPeriodistaPreview({ title, excerpt, bodyPlain }) {
  const snippet =
    bodyPlain.length > 900 ? `${bodyPlain.slice(0, 897)}…` : bodyPlain;

  return [
    `Titular (intacto): ${title}`,
    excerpt ? `\n${excerpt}` : "",
    "",
    snippet,
    "",
    articlePreviewOptionsText({ lockTitle: true }),
  ]
    .filter(Boolean)
    .join("\n");
}

export function articlePreviewKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Continuar", "write:continue"),
      Markup.button.callback("🔄 Reescribir", "write:rewrite"),
    ],
    [
      Markup.button.callback("💬 Opinión", "write:opinion"),
      Markup.button.callback("❌ Cancelar", "write:cancel"),
    ],
  ]);
}

export function isWpPreviewConfirm(text = "") {
  return /^(sí|si|ok|dale|correcto|continuar|publicar|siguiente)$/i.test(
    text.trim()
  );
}

export function isWpPreviewRewrite(text = "") {
  return /^(reescribir|rehaz|otra\s*versi[oó]n|regenerar)$/i.test(text.trim());
}

export function isWpPreviewOpinion(text = "") {
  return /^(opini[oó]n|feedback|comentario|cambiar)$/i.test(text.trim());
}

export function askRewriteOpinionText() {
  return [
    "¿Qué quieres cambiar del artículo?",
    "Escribe tu opinión o indicaciones (tono, datos, enfoque, longitud…).",
    "O /cancelar.",
  ].join("\n");
}
