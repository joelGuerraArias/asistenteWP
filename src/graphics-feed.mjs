/**
 * RSS 2.0 de gráficos por marca, para dlvr.it u otros lectores.
 * Cada marca es un feed aparte (FV Digital ≠ Formula 1 RD).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { isPublicR2Url, publicR2Url, uploadToR2 } from "./r2.mjs";

const STATE_FILE = join(config.root, ".graphics-feed.json");
const LOCAL_DIR = join(config.root, "feeds");
const MAX_ITEMS = 40;

export const GRAPHICS_FEEDS = {
  fvdigital: {
    id: "fvdigital",
    title: "FV Digital · gráficos",
    description: "Tarjetas de FV Digital listas para redes (dlvr.it)",
    site: "https://fvdigital.do/",
    file: "fvdigital.xml",
    hashtag: () => config.publishWebhook?.hashtag || "#fvdigital",
  },
  f1rd: {
    id: "f1rd",
    title: "Formula 1 RD · gráficos",
    description: "Tarjetas de Formula 1 RD listas para redes (dlvr.it)",
    site: "https://fvdigital.do/",
    file: "f1rd.xml",
    hashtag: () => config.f1rdWebhook?.hashtag || "#Formula1RD",
  },
};

export function normalizeGraphicsBrand(brand = "") {
  const raw = String(brand || "").toLowerCase().trim();
  if (raw === "f1rd" || raw === "formula1rd" || raw === "f1") return "f1rd";
  if (raw === "fvdigital" || raw === "fv" || raw === "fvdigital.do") return "fvdigital";
  return "";
}

export function graphicsFeedBrandFromPath(path = "") {
  const p = String(path || "").split("?")[0].replace(/\/+$/, "").toLowerCase();
  if (p === "/feed/fvdigital.xml" || p === "/feeds/fvdigital.xml" || p === "/feed/fv.xml") {
    return "fvdigital";
  }
  if (
    p === "/feed/f1rd.xml" ||
    p === "/feeds/f1rd.xml" ||
    p === "/feed/formula1rd.xml" ||
    p === "/feeds/formula1rd.xml"
  ) {
    return "f1rd";
  }
  return "";
}

function xmlText(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rfc822(iso = "") {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return { fvdigital: [], f1rd: [] };
  }
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return {
      fvdigital: Array.isArray(data.fvdigital) ? data.fvdigital : [],
      f1rd: Array.isArray(data.f1rd) ? data.f1rd : [],
    };
  } catch {
    return { fvdigital: [], f1rd: [] };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function graphicsFeedPublicUrl(brand) {
  const id = normalizeGraphicsBrand(brand);
  const meta = GRAPHICS_FEEDS[id];
  if (!meta) return "";
  if (config.r2?.publicBaseUrl) {
    try {
      return publicR2Url(`feeds/${meta.file}`);
    } catch {
      // fall through
    }
  }
  const port = config.server?.port || 9000;
  return `http://127.0.0.1:${port}/feed/${meta.file}`;
}

export function graphicsFeedUrls() {
  return {
    fvdigital: graphicsFeedPublicUrl("fvdigital"),
    f1rd: graphicsFeedPublicUrl("f1rd"),
  };
}

function itemGuid(brand, imageUrl, at) {
  return `${brand}:${at}:${String(imageUrl || "").slice(-48)}`;
}

export function renderGraphicsFeedXml(brand) {
  const id = normalizeGraphicsBrand(brand);
  const meta = GRAPHICS_FEEDS[id];
  if (!meta) return "";
  const items = loadState()[id] || [];
  const selfUrl = graphicsFeedPublicUrl(id);
  const rows = items
    .map((it) => {
      const caption = String(it.caption || it.title || "").trim();
      const title = xmlText(caption || it.title || "Gráfico");
      const img = xmlText(it.imageUrl || "");
      const guid = xmlText(it.guid || itemGuid(id, it.imageUrl, it.at));
      const text = xmlText(caption);
      return `    <item>
      <title>${title}</title>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${rfc822(it.at)}</pubDate>
      <description>${text}</description>
      ${
        img
          ? `<enclosure url="${img}" type="image/png" length="0"/>
      <media:content url="${img}" type="image/png" medium="image" width="1080" height="1080"/>`
          : ""
      }
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xmlText(meta.title)}</title>
    <link>${xmlText(meta.site)}</link>
    <description>${xmlText(meta.description)}</description>
    <language>es-do</language>
    <lastBuildDate>${rfc822(items[0]?.at)}</lastBuildDate>
    ${selfUrl ? `<atom:link href="${xmlText(selfUrl)}" rel="self" type="application/rss+xml"/>` : ""}
${rows}
  </channel>
</rss>
`;
}

async function persistFeedXml(brand) {
  const id = normalizeGraphicsBrand(brand);
  const meta = GRAPHICS_FEEDS[id];
  if (!meta) return "";
  const xml = renderGraphicsFeedXml(id);
  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(join(LOCAL_DIR, meta.file), xml, "utf8");
  if (config.r2?.enabled) {
    const url = await uploadToR2(
      Buffer.from(xml, "utf8"),
      `feeds/${meta.file}`,
      "application/rss+xml; charset=utf-8"
    );
    return url;
  }
  return graphicsFeedPublicUrl(id);
}

/**
 * Agrega un gráfico al feed de esa marca y republica el XML.
 * @returns {Promise<string>} URL pública del RSS de esa marca
 */
export async function appendGraphicsFeedItem({
  brand = "fvdigital",
  title = "",
  caption = "",
  imageUrl = "",
  link = "",
} = {}) {
  const id = normalizeGraphicsBrand(brand);
  if (!id) return "";
  const img = String(imageUrl || "").trim();
  if (!img || (config.r2?.enabled && !isPublicR2Url(img) && !/^https?:\/\//i.test(img))) {
    return graphicsFeedPublicUrl(id);
  }
  const at = new Date().toISOString();
  const item = {
    guid: itemGuid(id, img, at),
    title: String(title || "Gráfico").trim().slice(0, 180),
    caption: String(caption || title || "").trim().slice(0, 2000),
    imageUrl: img,
    link: img,
    at,
  };
  const state = loadState();
  const prev = state[id] || [];
  if (prev.some((p) => p.imageUrl === img)) {
    return persistFeedXml(id);
  }
  state[id] = [item, ...prev].slice(0, MAX_ITEMS);
  saveState(state);
  return persistFeedXml(id);
}

const REPOST_STATE = join(config.root, ".feed-repost-sent.json");
const ENCUESTAS_STATE = join(config.root, ".encuestas-sent.json");

function collectHistoryItems() {
  const byBrand = { fvdigital: new Map(), f1rd: new Map() };

  const add = (brand, rec) => {
    const id = normalizeGraphicsBrand(brand);
    if (!id || !rec?.cardUrl) return;
    const img = String(rec.cardUrl).trim();
    if (!img) return;
    const at = rec.at || new Date().toISOString();
    const title = String(rec.title || "Gráfico").trim();
    const hashtag = GRAPHICS_FEEDS[id].hashtag();
    const caption = rec.caption
      ? String(rec.caption)
      : title.includes(hashtag)
        ? title
        : `${title}\n\n${hashtag}`;
    const prev = byBrand[id].get(img);
    if (prev && new Date(prev.at) >= new Date(at)) return;
    byBrand[id].set(img, {
      guid: itemGuid(id, img, at),
      title: title.slice(0, 180),
      caption: String(caption).trim().slice(0, 2000),
      imageUrl: img,
      link: img,
      at,
    });
  };

  if (existsSync(REPOST_STATE)) {
    try {
      const data = JSON.parse(readFileSync(REPOST_STATE, "utf8"));
      for (const [key, rec] of Object.entries(data.sent || {})) {
        const brand = rec?.brand || (key.startsWith("f1rd::") ? "f1rd" : "fvdigital");
        add(brand, rec);
      }
    } catch {
      /* ignore */
    }
  }

  if (existsSync(ENCUESTAS_STATE)) {
    try {
      const data = JSON.parse(readFileSync(ENCUESTAS_STATE, "utf8"));
      for (const rec of Object.values(data.sent || {})) {
        add(rec?.dest || "fvdigital", rec);
      }
    } catch {
      /* ignore */
    }
  }

  const out = { fvdigital: [], f1rd: [] };
  for (const id of Object.keys(out)) {
    out[id] = [...byBrand[id].values()]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, MAX_ITEMS);
  }
  return out;
}

export async function rebuildGraphicsFeeds() {
  const urls = {};
  for (const id of Object.keys(GRAPHICS_FEEDS)) {
    urls[id] = await persistFeedXml(id);
  }
  return urls;
}

/** Carga gráficos ya enviados (feed-repost / encuestas) para que el RSS no quede vacío. */
export async function seedGraphicsFeedsFromHistory() {
  const history = collectHistoryItems();
  const state = loadState();
  for (const id of Object.keys(GRAPHICS_FEEDS)) {
    const incoming = history[id] || [];
    const existing = state[id] || [];
    const seen = new Set(existing.map((it) => it.imageUrl));
    const merged = [
      ...existing,
      ...incoming.filter((it) => it.imageUrl && !seen.has(it.imageUrl)),
    ]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, MAX_ITEMS);
    state[id] = merged;
  }
  saveState(state);
  return rebuildGraphicsFeeds();
}

export function formatGraphicsFeedHelp() {
  const urls = graphicsFeedUrls();
  return [
    "Feeds RSS de gráficos (uno por marca, para dlvr.it):",
    "",
    `FV Digital: ${urls.fvdigital}`,
    `Formula 1 RD: ${urls.f1rd}`,
    "",
    "En dlvr.it crea dos Social Flows distintos, cada uno con su RSS.",
    "El ítem lleva enclosure/imagen PNG + caption.",
  ].join("\n");
}
