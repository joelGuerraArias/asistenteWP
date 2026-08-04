import { config, wpAuthHeader } from "./config.mjs";
import { prepareImageForWordPress } from "./image.mjs";
import { coerceArticleHtml, looksLikeArticleJson } from "./article-json.mjs";
import { downloadImageFromUrl } from "./featured-image.mjs";
import { suggestTopicCategory } from "./topic-category.mjs";
import { suggestPostTags } from "./post-tags.mjs";

import { decodeHtmlEntities } from "./news-format.mjs";
function wpUrl(path) {
  return `${config.wp.siteUrl}/wp-json/wp/v2${path}`;
}

async function wpRequest(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(wpUrl(path), {
    method,
    headers: {
      ...wpAuthHeader(),
      ...headers,
    },
    body,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data?.message
        ? data.message.replace(/<[^>]+>/g, "")
        : text;
    throw new Error(`WordPress ${res.status}: ${msg}`);
  }

  return data;
}

function resolveSlug(slug) {
  const alias = config.categoryAliases[slug] || slug;
  const known =
    config.categoryResolved[slug] || config.categoryResolved[alias] || null;
  return { requested: slug, slug: alias, cached: known };
}

export async function resolveCategoryIds(slugs, { skipMissing = false } = {}) {
  const ids = [];
  const names = [];

  for (const requested of slugs) {
    const { slug, cached } = resolveSlug(requested);
    if (cached?.id) {
      ids.push(cached.id);
      names.push(cached.name);
      continue;
    }

    const found = await wpRequest(`/categories?slug=${encodeURIComponent(slug)}`);
    if (!found?.length) {
      if (skipMissing) {
        console.warn(`Categoría no encontrada (omitida): ${requested}`);
        continue;
      }
      throw new Error(`Categoría no encontrada: ${requested}`);
    }
    ids.push(found[0].id);
    names.push(found[0].name);
  }

  return { ids: [...new Set(ids)], names };
}

export async function getDefaultCategoryIds(extraSlugs = []) {
  const defaults = await resolveCategoryIds(config.defaultCategorySlugs);
  const extras = extraSlugs?.length
    ? await resolveCategoryIds(extraSlugs, { skipMissing: true })
    : { ids: [], names: [] };
  return {
    ids: [...new Set([...defaults.ids, ...extras.ids])],
    names: [...defaults.names, ...extras.names.filter((n) => !defaults.names.includes(n))],
  };
}

/**
 * Busca o crea tags por nombre. Devuelve ids + nombres (máx. los pedidos).
 */
export async function resolveTagIds(tagNames = []) {
  const ids = [];
  const names = [];

  for (const raw of tagNames) {
    const name = String(raw || "").trim();
    if (!name) continue;

    try {
      const search = await wpRequest(
        `/tags?search=${encodeURIComponent(name)}&per_page=10`
      );
      const exact = Array.isArray(search)
        ? search.find(
            (t) =>
              String(t.name).toLowerCase() === name.toLowerCase() ||
              String(t.slug).toLowerCase() ===
                name
                  .toLowerCase()
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9]+/g, "-")
          )
        : null;

      if (exact?.id) {
        ids.push(exact.id);
        names.push(exact.name);
        continue;
      }

      const created = await wpRequest("/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ name }),
      });
      if (created?.id) {
        ids.push(created.id);
        names.push(created.name || name);
      }
    } catch (error) {
      // term_exists u otro conflicto: rebuscar
      try {
        const again = await wpRequest(
          `/tags?search=${encodeURIComponent(name)}&per_page=5`
        );
        const hit = Array.isArray(again)
          ? again.find(
              (t) => String(t.name).toLowerCase() === name.toLowerCase()
            ) || again[0]
          : null;
        if (hit?.id) {
          ids.push(hit.id);
          names.push(hit.name || name);
          continue;
        }
      } catch {
        // ignore
      }
      console.warn(`Tag omitido (${name}):`, error.message);
    }
  }

  return { ids: [...new Set(ids)], names };
}

export async function uploadImageFromBuffer(
  buffer,
  filename,
  mimeType = "image/jpeg",
  { postId, title, altText } = {}
) {
  const prepared = await prepareImageForWordPress(buffer, filename);

  const media = await wpRequest("/media", {
    method: "POST",
    headers: {
      "Content-Type": prepared.mimeType,
      "Content-Disposition": `attachment; filename="${prepared.filename}"`,
    },
    body: prepared.buffer,
  });

  const ready = await waitForMediaMetadata(media.id);

  if (postId || title || altText) {
    return linkMediaToPost(ready.id, postId, { title, altText });
  }

  return ready;
}

function hasTagdivSizes(media) {
  const sizes = media?.media_details?.sizes || {};
  return Object.keys(sizes).some((key) => key.startsWith("td_"));
}

async function waitForMediaMetadata(mediaId, { attempts = 8, delayMs = 1500 } = {}) {
  let last = null;

  for (let i = 0; i < attempts; i += 1) {
    last = await wpRequest(`/media/${mediaId}?context=edit`);
    const width = last.media_details?.width;
    const height = last.media_details?.height;

    if (width && height && hasTagdivSizes(last)) {
      return last;
    }

    if (width && height && i >= 2) {
      return last;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!last?.media_details?.width) {
    console.warn(
      `WordPress no generó miniaturas completas para media ${mediaId}; continúo igual.`
    );
    return last || { id: mediaId };
  }

  return last;
}

export async function linkMediaToPost(mediaId, postId, { title, altText } = {}) {
  const payload = {};
  if (postId) payload.post = postId;
  if (title) payload.title = title;
  if (altText) payload.alt_text = altText;

  if (!Object.keys(payload).length) {
    return wpRequest(`/media/${mediaId}`);
  }

  return wpRequest(`/media/${mediaId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

export async function assignFeaturedImage(postId, mediaId, { title, altText } = {}) {
  if (!postId || !mediaId) {
    throw new Error("Se requiere postId y mediaId para asignar imagen destacada");
  }

  await linkMediaToPost(mediaId, postId, { title, altText });

  const post = await wpRequest(`/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ featured_media: mediaId }),
  });

  if (post.featured_media !== mediaId) {
    throw new Error(
      `WordPress no guardó la imagen destacada (esperado ${mediaId}, recibido ${post.featured_media || 0})`
    );
  }

  return post;
}

export async function uploadImageFromUrl(url, filename = "telegram-image.jpg", options = {}) {
  const { buffer, mimeType } = await downloadImageFromUrl(url);
  return uploadImageFromBuffer(buffer, filename, mimeType, options);
}

function buildContent(text) {
  const paragraphs = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");

  return paragraphs;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function guessTitle(text) {
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean);
  if (!firstLine) return "Post desde Telegram";
  return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
}

export async function createPost({
  text,
  title,
  featuredMediaId,
  extraCategorySlugs = [],
  status = config.defaultPostStatus,
  htmlContent,
  autoTopic = true,
  autoTags = true,
}) {
  const postTitle = title || guessTitle(text || "Post desde Telegram");
  const extras = [...extraCategorySlugs];
  const plain =
    String(text || "").trim() ||
    String(htmlContent || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  if (autoTopic !== false) {
    try {
      const topicSlug = await suggestTopicCategory(postTitle, plain);
      if (topicSlug) {
        const already = extras.some(
          (s) =>
            s === topicSlug ||
            config.categoryAliases[s] === topicSlug ||
            config.categoryAliases[topicSlug] === s
        );
        if (!already) extras.push(topicSlug);
      }
    } catch (error) {
      console.warn("autoTopic:", error.message);
    }
  }

  const { ids: categories, names } = await getDefaultCategoryIds(extras);

  let tagIds = [];
  let tagNames = [];
  if (autoTags !== false) {
    try {
      const suggested = await suggestPostTags(postTitle, plain);
      if (suggested.length) {
        const resolved = await resolveTagIds(suggested);
        tagIds = resolved.ids;
        tagNames = resolved.names;
      }
    } catch (error) {
      console.warn("autoTags:", error.message);
    }
  }

  let content = coerceArticleHtml(htmlContent || "");
  if (!content.trim() || looksLikeArticleJson(content)) {
    content = buildContent(text || "");
  }
  const payload = {
    title: postTitle,
    content,
    status,
    categories,
    format: "standard",
  };

  if (tagIds.length) {
    payload.tags = tagIds;
  }

  if (featuredMediaId) {
    payload.featured_media = featuredMediaId;
  }

  let post = await wpRequest("/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  if (featuredMediaId && post.featured_media !== featuredMediaId) {
    try {
      post = await assignFeaturedImage(post.id, featuredMediaId, {
        title: postTitle,
        altText: postTitle,
      });
    } catch (error) {
      console.warn("Imagen destacada no asignada:", error.message);
    }
  }

  return {
    post,
    categories: names,
    tags: tagNames,
    editUrl: `${config.wp.siteUrl}/wp-admin/post.php?post=${post.id}&action=edit`,
  };
}

export function formatPostForCopy({ text, title, extraCategorySlugs = [] }) {
  const postTitle = title || guessTitle(text || "Post desde Telegram");
  const slugs = [...config.defaultCategorySlugs, ...extraCategorySlugs];
  const content = buildContent(text || "");

  return [
    "📋 POST PARA COPIAR",
    "",
    `Título: ${postTitle}`,
    `Categorías: ${slugs.join(", ")}`,
    "",
    "Contenido HTML:",
    content,
    "",
    `Admin: ${config.wp.siteUrl}/wp-admin/post-new.php`,
  ].join("\n");
}

export async function updatePostStatus(postId, status) {
  return wpRequest(`/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ status }),
  });
}

export async function getPost(postId) {
  return wpRequest(`/posts/${postId}?context=edit`);
}

export function postEditUrl(postId) {
  return `${config.wp.siteUrl}/wp-admin/post.php?post=${postId}&action=edit`;
}

function stripHtml(html = "") {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

export function formatUploadedPost(post, { categories = [], tags = [] } = {}) {
  const title = decodeHtmlEntities(
    post.title?.rendered || post.title?.raw || "(sin título)"
  );
  const status = post.status || "?";
  const body = stripHtml(post.content?.rendered || post.content?.raw || "");
  const cats = categories.length ? categories.join(", ") : "(sin categorías)";
  const tagLine = tags.length ? tags.join(", ") : "(sin tags)";

  return [
    "✅ Noticia subida a WordPress",
    "",
    `Título: ${title}`,
    `ID: ${post.id}`,
    `Estado: ${status}`,
    "",
    `📂 Categorías enviadas: ${cats}`,
    `🏷️ Tags enviados: ${tagLine}`,
    "",
    "——— NOTICIA ———",
    "",
    body || "(sin contenido)",
    "",
    "———",
    `Editar: ${postEditUrl(post.id)}`,
    post.link ? `Ver: ${post.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Mensaje corto solo de taxonomías (categorías + tags). */
export function formatTaxonomyNotice({ categories = [], tags = [] } = {}) {
  const cats = categories.length ? categories.join(", ") : "(ninguna)";
  const tagLine = tags.length ? tags.join(", ") : "(ninguno)";
  return [
    "📂 Categorías enviadas:",
    cats,
    "",
    "🏷️ Tags enviados (máx. 5):",
    tagLine,
  ].join("\n");
}

export function formatPostSummary(post) {
  const title = decodeHtmlEntities(
    post.title?.rendered || post.title?.raw || "(sin título)"
  );
  const status = post.status || "?";
  const content = stripHtml(post.content?.rendered || post.content?.raw || "");
  const preview = content.length > 280 ? `${content.slice(0, 277)}...` : content;

  return [
    `ID: ${post.id}`,
    `Título: ${title}`,
    `Estado: ${status}`,
    preview ? `Contenido: ${preview}` : "",
    `Editar: ${postEditUrl(post.id)}`,
    post.link ? `Link: ${post.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function updatePost(postId, { title, text, htmlContent, status }) {
  const payload = {};

  if (title !== undefined) payload.title = title;
  if (status !== undefined) payload.status = status;

  if (htmlContent !== undefined) {
    payload.content = htmlContent;
  } else if (text !== undefined) {
    payload.content = buildContent(text);
  }

  if (!Object.keys(payload).length) {
    throw new Error("Nada que actualizar");
  }

  const post = await wpRequest(`/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  return {
    post,
    editUrl: postEditUrl(post.id),
  };
}

export async function deletePost(postId, { force = false } = {}) {
  const query = force ? "?force=true" : "";
  return wpRequest(`/posts/${postId}${query}`, { method: "DELETE" });
}

export async function listRecentPosts({ perPage = 5, status = "any" } = {}) {
  return wpRequest(`/posts?per_page=${perPage}&status=${status}&orderby=date&order=desc`);
}
