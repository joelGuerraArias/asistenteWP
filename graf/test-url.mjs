import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchArticleFromUrl } from "../src/news-fetch.mjs";
import { suggestNewsTag } from "../src/deepseek.mjs";
import { generateNewsCard, fetchImageBuffer } from "../src/social-card.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2];

const article = await fetchArticleFromUrl(url);
console.log("Título:", article.title);
console.log("Imagen:", article.imageUrl || "(ninguna)");

const tag = await suggestNewsTag(article.title, article.bodyText);
console.log("Tag:", tag);

if (!article.imageUrl) {
  console.log("Sin imagen destacada; no se genera tarjeta.");
  process.exit(0);
}

const bg = await fetchImageBuffer(article.imageUrl);
const card = await generateNewsCard({
  backgroundBuffer: bg,
  title: article.title,
  tag,
});

const outPath = join(__dirname, "salida-url.png");
writeFileSync(outPath, card);
console.log("OK ->", outPath);
