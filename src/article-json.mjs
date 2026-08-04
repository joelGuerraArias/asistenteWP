import { decodeHtmlEntities } from "./news-format.mjs";

function stripJsonFence(text = "") {
  let t = String(text).trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return t;
}

function fixModelJson(text = "") {
  return String(text)
    .replace(/\\'/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

function extractJsonStringField(text, field) {
  const marker = `"${field}"`;
  const idx = text.indexOf(marker);
  if (idx < 0) return "";

  const colon = text.indexOf(":", idx + marker.length);
  if (colon < 0) return "";

  let i = colon + 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== '"') return "";

  i += 1;
  let out = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "n") {
        out += "\n";
        i += 2;
        continue;
      }
      if (next === "t") {
        out += "\t";
        i += 2;
        continue;
      }
      if (next === '"') {
        out += '"';
        i += 2;
        continue;
      }
      if (next === "\\") {
        out += "\\";
        i += 2;
        continue;
      }
      if (next === "/") {
        out += "/";
        i += 2;
        continue;
      }
      out += next || "";
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return out;
}

export function parseModelJson(content) {
  if (!content?.trim()) return null;

  const raw = stripJsonFence(content);
  const attempts = [raw, fixModelJson(raw)];

  const objectSlice = raw.match(/\{[\s\S]*\}/)?.[0];
  if (objectSlice) {
    attempts.push(objectSlice, fixModelJson(objectSlice));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // siguiente intento
    }
  }

  const contentHtml = extractJsonStringField(raw, "content_html");
  if (!contentHtml) return null;

  return {
    excerpt: extractJsonStringField(raw, "excerpt") || "",
    content_html: contentHtml,
  };
}

export function looksLikeArticleJson(text = "") {
  const t = String(text).trim();
  if (!t) return false;
  return (
    (t.startsWith("{") && /"content_html"\s*:/.test(t)) ||
    /"excerpt"\s*:\s*"/.test(t) ||
    /"content_html"\s*:\s*"/.test(t)
  );
}

export function coerceArticleFields(input = "") {
  const text = String(input).trim();
  if (!text) return { excerpt: "", content_html: "" };

  if (looksLikeArticleJson(text)) {
    const draft = parseModelJson(text);
    if (draft?.content_html) {
      return {
        excerpt: String(draft.excerpt || "").trim(),
        content_html: decodeHtmlEntities(String(draft.content_html).trim()),
      };
    }
    // JSON inválido: no publicar el blob crudo aunque tenga <p> dentro del string
    return { excerpt: "", content_html: "" };
  }

  if (text.includes("<p>") || text.includes("<strong>")) {
    return { excerpt: "", content_html: text };
  }

  return { excerpt: "", content_html: text };
}

export function coerceArticleHtml(input = "") {
  return coerceArticleFields(input).content_html;
}
