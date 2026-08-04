import { listRecentPosts, getPost, updatePost } from "../src/wordpress.mjs";
import { coerceArticleFields, looksLikeArticleJson } from "../src/article-json.mjs";
import { finalizeNewsHtml } from "../src/news-format.mjs";

const posts = await listRecentPosts({ perPage: 10, status: "any" });

for (const p of posts) {
  const full = await getPost(p.id);
  const raw = full.content?.raw || full.content?.rendered || "";
  const isJson = looksLikeArticleJson(raw) || /"content_html"\s*:/.test(raw);
  console.log(`\n--- ID ${p.id} | ${p.status} | ${p.title?.rendered?.slice(0, 60)}`);
  console.log("JSON bug?", isJson);
  if (isJson) {
    console.log("RAW preview:", raw.slice(0, 200));
  }
}
