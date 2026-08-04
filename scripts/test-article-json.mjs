import {
  coerceArticleHtml,
  looksLikeArticleJson,
  parseModelJson,
} from "../src/article-json.mjs";

const samples = [
  String.raw`{"excerpt": "Resumen", "content_html": "<p>Gol al 79\' del partido</p>"}`,
  `{"excerpt": "test", "content_html": "<p>Argentina ganó</p>"}`,
  "```json\n{\"excerpt\": \"x\", \"content_html\": \"<p>HTML</p>\"}\n```",
  // JSON inválido: comilla sin escapar dentro de content_html (antes se publicaba el blob entero)
  `{"excerpt": "x", "content_html": "<p>Dijo "hola" al público</p>"}`,
];

for (const s of samples) {
  const html = coerceArticleHtml(s);
  console.log("INPUT:", s.slice(0, 80));
  console.log("looksLike:", looksLikeArticleJson(s));
  console.log("parse:", parseModelJson(s)?.content_html?.slice(0, 60));
  console.log("HTML:", html.slice(0, 120));
  console.log("still json?", looksLikeArticleJson(html));
  console.log("---");
}
