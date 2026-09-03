/**
 * Fuentes del REPORTE Intrant: Gmail, X, YouTube, Instagram, Facebook, TV, radio.
 */
import { config } from "./config.mjs";
import { fetchWithRetry } from "./fetch-retry.mjs";
import { fetchGoogleAlertsForSheet } from "./gmail-alerts.mjs";
import {
  DEFAULT_INTRANT_KEYWORDS,
  isRelevantIntrantAlert,
} from "./google-alerts-parse.mjs";
import { filterForClient, loadAnalisisHoy } from "./informe-parse.mjs";
import { calendarYmd, toYmd } from "./news-date.mjs";

export const SOURCE_LABELS = {
  gmail: "Gmail / Google Alerts",
  x: "X / Twitter",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tv: "TV",
  radio: "Radio",
};

function keywords() {
  return config.googleAlerts?.filters?.length
    ? config.googleAlerts.filters
    : DEFAULT_INTRANT_KEYWORDS;
}

function hay(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function isSpanishTitle(title = "") {
  const t = String(title || "").trim();
  if (!t) return false;
  if (/[áéíóúüñ¿¡]/i.test(t)) return true;
  const n = hay(t);
  const enHits = (
    n.match(
      /\b(the|and|with|from|this|that|for|are|was|were|been|have|not|you|your|into|about)\b/g
    ) || []
  ).length;
  const esHits = (
    n.match(
      /\b(de|la|el|en|del|que|por|para|con|los|las|un|una|se|al|es|su|hoy|dice|sobre|responsable|accidentes|viales)\b/g
    ) || []
  ).length;
  if (enHits >= 3 && esHits === 0) return false;
  if (esHits >= 2) return true;
  if (
    /\b(digesett|intrant|rd|santo domingo|nagua|sfm|morrison)\b/i.test(n) &&
    esHits >= 1
  ) {
    return true;
  }
  if (enHits > esHits) return false;
  return esHits > 0;
}

function mobilityHit(text = "") {
  const n = hay(text);
  return keywords().some((kw) => {
    const k = hay(kw);
    if (!k) return false;
    if (k.length <= 4) {
      return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeReg(k)}(?:$|[^\\p{L}\\p{N}])`, "iu").test(
        n
      );
    }
    // evita "transito" dentro de "transcurrido"
    if (k === "transporte" || k === "transportes") {
      return /\btransportes?\b/.test(n);
    }
    // evita "pasaje" dentro de "pasajeros"
    if (k === "pasaje" || k === "pasajes") {
      return /\bpasajes?\b/.test(n);
    }
    return n.includes(k);
  });
}

function escapeReg(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KNOWN_INTRANT_ACCOUNTS = [
  "intrant_rd",
  "intrantrd",
  "digesettrd",
  "digesett",
  "rdvial",
  "rd_vial",
];

function isKnownIntrantAccount(name = "") {
  const n = hay(String(name).replace(/^@/, ""));
  return KNOWN_INTRANT_ACCOUNTS.some((a) => n === a || n.includes(a));
}

/** Ventana social para reporte matutino: hoy + ayer (DO). */
function socialDateWindow(dateYmd) {
  if (!dateYmd) return null;
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const prev = new Date(dt);
  prev.setDate(prev.getDate() - 1);
  const py = prev.getFullYear();
  const pm = String(prev.getMonth() + 1).padStart(2, "0");
  const pd = String(prev.getDate()).padStart(2, "0");
  return new Set([dateYmd, `${py}-${pm}-${pd}`]);
}

function inSocialWindow(atYmd, dateYmd) {
  if (!dateYmd) return true;
  if (!atYmd) return true; // sin fecha: no descartar de golpe
  const win = socialDateWindow(dateYmd);
  return win.has(atYmd);
}

function isSocialRelevant(blob = "", account = "") {
  if (isKnownIntrantAccount(account)) return true;
  if (/intrant|digesett|rd\s*vial|rdvial/i.test(blob)) return true;
  return mobilityHit(blob);
}

function pickDate(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return toYmd(new Date(ms));
  }
  const s = String(raw).trim();
  // unix seconds / ms como string
  if (/^\d{10}$/.test(s)) return toYmd(new Date(Number(s) * 1000));
  if (/^\d{13}$/.test(s)) return toYmd(new Date(Number(s)));
  return toYmd(s);
}

function relevanceFromText(text = "", explicit = "") {
  const raw = String(explicit || "");
  if (/^alta/i.test(raw)) return "alta";
  if (/^media/i.test(raw)) return "media";
  if (/^baja/i.test(raw)) return "baja";
  const n = hay(text);
  if (/\b(intrant|digesett|milton morrison|rdvial|rd vial)\b/.test(n)) return "alta";
  if (mobilityHit(text)) return "media";
  return "baja";
}

function clip(text = "", max = 220) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
}

function item({ source, medio, title, summary, url, at, relevance }) {
  return {
    source,
    medio: String(medio || "").trim() || SOURCE_LABELS[source] || source,
    title: String(title || "").trim() || "(sin título)",
    summary: clip(summary || title || ""),
    relevance: relevance || "media",
    url: String(url || "").trim(),
    at: String(at || "").trim(),
  };
}

function sameDay(at, ymd) {
  const d = pickDate(at);
  return d && d === ymd;
}

function withToken(url) {
  const token = config.reporte?.apifyToken;
  if (!token) throw new Error("Configura APIFY_TOKEN en .env");
  const u = new URL(url);
  if (!u.searchParams.get("token")) u.searchParams.set("token", token);
  return u.toString();
}

async function fetchJson(url, { method = "GET", body, label = "API" } = {}) {
  const res = await fetchWithRetry(
    url,
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    { label }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`${label}: ${msg}`);
  }
  return data;
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.tweets)) return data.tweets;
  if (Array.isArray(data?.timeline)) return data.timeline;
  return [];
}

export async function fetchGmailItems({ dateYmd, onStatus } = {}) {
  const alerts = await fetchGoogleAlertsForSheet({
    onlyToday: true,
    maxMessages: 80,
    mode: "intrant",
    onStatus,
  });
  return alerts.map((a) =>
    item({
      source: "gmail",
      medio: a.source || a.medio,
      title: a.title,
      summary: a.snippet || a.texto,
      url: a.url,
      at: dateYmd,
      relevance: relevanceFromText(`${a.title} ${a.snippet || ""}`),
    })
  );
}

export async function fetchXItems({ dateYmd } = {}) {
  const key = config.reporte?.twitterRapidApiKey;
  if (!key) {
    return { items: [], skipped: "sin RAPIDAPI_KEY" };
  }
  const host = config.reporte.twitterRapidApiHost;
  const query = config.reporte.twitterQuery || "@INTRANT_RD";
  const type = process.env.INTRANT_TWITTER_TYPE || "Latest";
  const url = `https://${host}/v3/search?query=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`;
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": host,
      },
    },
    { label: "Twitter RapidAPI" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `Twitter RapidAPI ${res.status}`);
  }
  const rows = asArray(data);
  const items = [];
  for (const tw of rows) {
    const text =
      tw.full_text ||
      tw.text ||
      tw.content ||
      tw.tweet ||
      tw.legacy?.full_text ||
      "";
    const created =
      tw.created_at ||
      tw.createdAt ||
      tw.date ||
      tw.timestamp ||
      tw.time ||
      tw.createdAt;
    if (dateYmd && created && !sameDay(created, dateYmd) && pickDate(created)) {
      continue;
    }
    const user =
      tw.author?.username ||
      tw.user?.screen_name ||
      tw.user?.name ||
      tw.username ||
      tw.author?.name ||
      tw.author ||
      "X";
    const blob = `${text} ${user}`;
    if (!mobilityHit(blob) && !/@intrant_rd/i.test(blob) && !/intrant/i.test(blob)) {
      continue;
    }
    const id = tw.id || tw.id_str;
    const link =
      tw.url ||
      tw.tweet_url ||
      (id
        ? `https://x.com/${String(user).replace(/^@/, "")}/status/${id}`
        : "");
    items.push(
      item({
        source: "x",
        medio: `@${String(user).replace(/^@/, "")}`,
        title: clip(text, 120),
        summary: text,
        url: link,
        at: pickDate(created) || dateYmd,
        relevance: relevanceFromText(text),
      })
    );
  }
  return { items };
}

export async function fetchYoutubeItems({ dateYmd } = {}) {
  const data = await fetchJson(withToken(config.reporte.youtubeLastUrl), {
    label: "YouTube Apify",
  });
  const items = [];
  for (const v of asArray(data)) {
    const title = v.title || "";
    if (!isSpanishTitle(title)) continue;
    const at = pickDate(v.date || v.uploadDate || v.publishedAt);
    if (dateYmd && at && at !== dateYmd) continue;
    const blob = `${title} ${v.text || ""} ${v.channelName || ""} ${v.input || ""}`;
    if (!mobilityHit(blob) && !/intrant|digesett/i.test(blob)) continue;
    items.push(
      item({
        source: "youtube",
        medio: v.channelName || v.channelUsername || "YouTube",
        title,
        summary: v.text || title,
        url: v.url || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : ""),
        at: at || dateYmd,
        relevance: relevanceFromText(blob),
      })
    );
  }
  return items;
}

function igCaption(p) {
  return (
    p.caption ||
    p.text ||
    p.description ||
    p.firstComment ||
    p.latestComments?.[0]?.text ||
    ""
  );
}

export async function fetchInstagramItems({ dateYmd } = {}) {
  const data = await fetchJson(withToken(config.reporte.instagramLastUrl), {
    label: "Instagram Apify",
  });
  const items = [];
  for (const p of asArray(data)) {
    const caption = igCaption(p);
    const owner = p.ownerUsername || p.ownerFullName || "";
    const title =
      clip(caption || "", 120) ||
      (owner ? `@${String(owner).replace(/^@/, "")} — publicación` : "Post Instagram");
    const at = pickDate(
      p.timestamp || p.takenAt || p.date || p.time || p.createdAt
    );
    if (dateYmd && at && !inSocialWindow(at, dateYmd)) continue;
    const blob = `${caption} ${owner}`;
    if (!isSocialRelevant(blob, owner)) continue;
    items.push(
      item({
        source: "instagram",
        medio: owner || "Instagram",
        title,
        summary: caption || title,
        url: p.url || p.displayUrl || "",
        at: at || dateYmd,
        relevance: isKnownIntrantAccount(owner)
          ? "alta"
          : relevanceFromText(blob),
      })
    );
  }
  return items;
}

export async function refreshInstagramDataset() {
  const urls = config.reporte.instagramStartUrls;
  const body = urls.length
    ? { directUrls: urls, resultsLimit: 30 }
    : undefined;
  const data = await fetchJson(withToken(config.reporte.instagramRefreshUrl), {
    method: "POST",
    body,
    label: "Instagram refresh",
  });
  return asArray(data);
}

function fbText(p) {
  return (
    p.text ||
    p.message ||
    p.postText ||
    p.caption ||
    p.content ||
    p.previewTitle ||
    p.previewDescription ||
    ""
  );
}

function fbAuthor(p) {
  return (
    p.pageName ||
    p.author?.name ||
    p.user?.name ||
    p.facebookUrl ||
    ""
  );
}

/** Menciones Intrant reales (la query “Intrant” sola en Apify trae “infant”; el filtro local usa substrings). */
function isFacebookIntrantMention(blob = "") {
  const n = hay(blob);
  return (
    n.includes("intrant") ||
    n.includes("digesett") ||
    /\brd\s*vial\b|\brdvial\b/.test(n) ||
    n.includes("milton morrison") ||
    n.includes("juan manuel mendez") ||
    n.includes("seguridad vial")
  );
}

function ymdDaysAgo(dateYmd, days) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Ventana FB keyword: hoy + N días (menciones son escasas). */
function inFacebookWindow(atYmd, dateYmd) {
  if (!dateYmd) return true;
  if (!atYmd) return true;
  const days = config.reporte.facebookSearchDays || 3;
  const oldest = ymdDaysAgo(dateYmd, days);
  return atYmd >= oldest && atYmd <= dateYmd;
}

export async function refreshFacebookDataset() {
  const query = (config.reporte.facebookQuery || "INTRANT RD").trim();
  if (!query || /^intrant$/i.test(query)) {
    throw new Error('Usa query tipo "INTRANT RD" (nunca solo "Intrant")');
  }
  const limit = config.reporte.facebookResultsLimit || 12;
  const days = config.reporte.facebookSearchDays || 3;
  const startDate = ymdDaysAgo(calendarYmd(new Date()), days);
  const body = {
    query,
    resultsCount: limit,
    searchType: "latest",
    startDate,
  };
  const data = await fetchJson(withToken(config.reporte.facebookRefreshUrl), {
    method: "POST",
    body,
    label: "Facebook refresh",
  });
  return asArray(data);
}

export async function fetchFacebookItems({ dateYmd } = {}) {
  const data = await fetchJson(withToken(config.reporte.facebookLastUrl), {
    label: "Facebook Apify",
  });
  const items = [];
  for (const p of asArray(data)) {
    const text = fbText(p);
    const page = fbAuthor(p);
    const at = pickDate(p.time || p.timestamp || p.date || p.createdAt);
    if (dateYmd && at && !inFacebookWindow(at, dateYmd)) continue;
    const blob = `${text} ${page}`;
    if (!isFacebookIntrantMention(blob)) continue;
    items.push(
      item({
        source: "facebook",
        medio: page || "Facebook",
        title: clip(text, 120) || `${page} — publicación`,
        summary: text || titleFallback(page),
        url: p.url || p.postUrl || p.facebookUrl || "",
        at: at || dateYmd,
        relevance: isKnownIntrantAccount(page) || /intrant/i.test(page)
          ? "alta"
          : relevanceFromText(blob),
      })
    );
  }
  return items;
}

function titleFallback(page = "") {
  return page ? `${page} — publicación` : "Publicación Facebook";
}

function fromAnalisis(channel, analisisItem, dateYmd) {
  return item({
    source: channel,
    medio: analisisItem.medioNombre || analisisItem.medio,
    title: analisisItem.tema || analisisItem.term,
    summary: analisisItem.contexto || analisisItem.tema || analisisItem.puntos,
    url: analisisItem.videoUrl || analisisItem.txtUrl || "",
    at: dateYmd,
    relevance: relevanceFromText(
      `${analisisItem.tema} ${analisisItem.contexto}`,
      analisisItem.relevancia
    ),
  });
}

export async function fetchTvRadioItems({ date, dateYmd, channel }) {
  try {
    const analisis = loadAnalisisHoy(date, channel);
    const { items } = filterForClient(analisis, "intrant", channel);
    return {
      items: items.map((it) => fromAnalisis(channel, it, dateYmd)),
      missing: false,
      path: analisis.path,
    };
  } catch (error) {
    if (/No encontré/i.test(error.message)) {
      return { items: [], missing: true, error: error.message };
    }
    throw error;
  }
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = `${it.source}|${(it.url || it.title).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {{ date?: Date, refreshInstagram?: boolean, refreshFacebook?: boolean, onStatus?: Function }} opts
 */
export async function collectReporteSources({
  date = new Date(),
  refreshInstagram = false,
  refreshFacebook = false,
  onStatus,
} = {}) {
  const dateYmd = calendarYmd(date);
  const errors = [];
  const skipped = [];
  const bySource = {
    gmail: [],
    x: [],
    youtube: [],
    instagram: [],
    facebook: [],
    tv: [],
    radio: [],
  };

  const run = async (name, fn) => {
    try {
      onStatus?.(`Fuente ${SOURCE_LABELS[name] || name}…`);
      return await fn();
    } catch (error) {
      errors.push({ source: name, error: error.message });
      onStatus?.(`⚠️ ${name}: ${error.message}`);
      return null;
    }
  };

  const gmail = await run("gmail", () => fetchGmailItems({ dateYmd, onStatus }));
  if (gmail) bySource.gmail = gmail;

  const x = await run("x", () => fetchXItems({ dateYmd }));
  if (x?.skipped) skipped.push({ source: "x", reason: x.skipped });
  if (x?.items) bySource.x = x.items;

  const yt = await run("youtube", () => fetchYoutubeItems({ dateYmd }));
  if (yt) bySource.youtube = yt;

  if (refreshInstagram) {
    await run("instagram", () => refreshInstagramDataset());
  }
  const ig = await run("instagram", () => fetchInstagramItems({ dateYmd }));
  if (ig) bySource.instagram = ig;

  if (refreshFacebook) {
    await run("facebook", () => refreshFacebookDataset());
  }
  const fb = await run("facebook", () => fetchFacebookItems({ dateYmd }));
  if (fb) bySource.facebook = fb;

  const tv = await run("tv", () => fetchTvRadioItems({ date, dateYmd, channel: "tv" }));
  if (tv?.missing) skipped.push({ source: "tv", reason: tv.error });
  if (tv?.items) bySource.tv = tv.items;

  const radio = await run("radio", () =>
    fetchTvRadioItems({ date, dateYmd, channel: "radio" })
  );
  if (radio?.missing) skipped.push({ source: "radio", reason: radio.error });
  if (radio?.items) bySource.radio = radio.items;

  const items = dedupe(Object.values(bySource).flat());
  const counts = Object.fromEntries(
    Object.entries(bySource).map(([k, v]) => [k, v.length])
  );

  return { dateYmd, items, bySource, counts, errors, skipped };
}
