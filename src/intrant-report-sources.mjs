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
import {
  fetchInstagramDigestFromGmail,
  fetchYoutubeDigestFromGmail,
} from "./reporte-gmail-digests.mjs";
import { igSettings, postKey, searchInstagram } from "./instagram-search.mjs";
import { fetchYoutubeApiItems, youtubeKey } from "./youtube-report.mjs";
import { fetchXDayItems } from "./x-report.mjs";
import { isFresh, parseLooseDateTime, parseStamp } from "./freshness.mjs";
import { shortcodeDate } from "./instagram-search.mjs";

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

/** Ventana social Apify fallback: hoy + N días (REPORTE_SOCIAL_DAYS, default 3). */
function inSocialWindow(atYmd, dateYmd) {
  if (!dateYmd) return true;
  if (!atYmd) return true; // sin fecha: no descartar de golpe
  const days = config.reporte?.socialSearchDays || 3;
  const oldest = ymdDaysAgo(dateYmd, days);
  return atYmd >= oldest && atYmd <= dateYmd;
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

function item({
  source,
  medio,
  title,
  summary,
  url,
  at,
  relevance,
  term = "",
  tono = "",
  mediaType = "",
  mediaKind = "",
  videoUrl = "",
  txtUrl = "",
  archivo = "",
  puntos = "",
  relevanciaRaw = "",
} = {}) {
  const media = String(videoUrl || url || "").trim();
  return {
    source,
    medio: String(medio || "").trim() || SOURCE_LABELS[source] || source,
    title: String(title || "").trim() || "(sin título)",
    summary: clip(summary || title || ""),
    relevance: relevance || "media",
    url: media,
    at: String(at || "").trim(),
    term: String(term || "").trim().toLowerCase(),
    tono: String(tono || "").trim() || "",
    mediaType: String(mediaType || "").trim(),
    mediaKind: String(mediaKind || "").trim(),
    videoUrl: media,
    txtUrl: String(txtUrl || "").trim(),
    archivo: String(archivo || "").trim(),
    puntos: clip(puntos || "", 500),
    relevanciaRaw: String(relevanciaRaw || "").trim(),
  };
}

function titleFallback(page = "") {
  return page ? `${page} — publicación` : "Publicación Facebook";
}

function fromAnalisis(fallbackChannel, analisisItem, dateYmd) {
  const isAudio =
    analisisItem.mediaType === "audio" || analisisItem.channel === "radio";
  const source = isAudio ? "radio" : "tv";
  const mediaUrl = analisisItem.videoUrl || analisisItem.txtUrl || "";
  let mediaKind = analisisItem.mediaKind || "";
  if (!mediaKind) {
    if (isAudio) {
      mediaKind = /\.wav\b/i.test(`${analisisItem.archivo || ""} ${mediaUrl}`)
        ? "wav"
        : /\.mp3\b/i.test(mediaUrl)
          ? "mp3"
          : "audio";
    } else {
      mediaKind = "mp4";
    }
  }
  return item({
    source: source || fallbackChannel,
    medio: analisisItem.medioNombre || analisisItem.medio,
    title: analisisItem.tema || analisisItem.term,
    summary:
      analisisItem.contexto ||
      analisisItem.tema ||
      analisisItem.puntos ||
      analisisItem.motivo,
    url: mediaUrl,
    videoUrl: mediaUrl,
    txtUrl: analisisItem.txtUrl || "",
    at: dateYmd,
    term: analisisItem.term || "",
    tono: analisisItem.tono || "",
    mediaType: isAudio ? "audio" : analisisItem.mediaType || "video",
    mediaKind,
    archivo: analisisItem.archivo || "",
    puntos: analisisItem.puntos || "",
    relevanciaRaw: analisisItem.relevancia || "",
    relevance: relevanceFromText(
      `${analisisItem.tema} ${analisisItem.contexto}`,
      analisisItem.relevancia
    ),
  });
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

function mapDigestToItems(rows, source) {
  return (rows || []).map((r) =>
    item({
      source: r.source || source,
      medio: r.medio,
      title: r.title,
      summary: r.summary || r.title,
      url: r.url,
      at: r.at,
      relevance:
        source === "instagram" || /intrant|digesett/i.test(`${r.medio} ${r.title}`)
          ? "alta"
          : relevanceFromText(`${r.title} ${r.summary || ""}`),
    })
  );
}

async function fetchYoutubeFromApify({ dateYmd } = {}) {
  const data = await fetchJson(withToken(config.reporte.youtubeLastUrl), {
    label: "YouTube Apify",
  });
  const items = [];
  for (const v of asArray(data)) {
    const title = v.title || "";
    if (!isSpanishTitle(title)) continue;
    const at = pickDate(v.date || v.uploadDate || v.publishedAt);
    // Regla 24 h: hora exacta de publicación obligatoria
    if (!isFresh(parseStamp(v.date || v.uploadDate || v.publishedAt))) continue;
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

/**
 * YouTube: digest Gmail del día (Apify mailed) primero; GET Apify last como fallback.
 * No dispara corridas nuevas. No toca alertas/sheet.
 */
export async function fetchYoutubeItems({ dateYmd } = {}) {
  try {
    const digest = await fetchYoutubeDigestFromGmail({ dateYmd });
    // Regla 24 h: el digest no trae hora de publicación de cada video → no se usa
    if (digest.length) console.warn(`YouTube digest Gmail: ${digest.length} ítems sin hora verificable (omitidos)`);
  } catch (error) {
    console.warn(`YouTube digest Gmail: ${error.message}`);
  }
  return fetchYoutubeFromApify({ dateYmd });
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

async function fetchInstagramFromApify({ dateYmd } = {}) {
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
    // Regla 24 h: hora exacta (dataset o código del post)
    const igTs =
      parseStamp(p.timestamp || p.takenAt || p.date || p.time || p.createdAt) ||
      shortcodeDate(postKey(p.url || ""));
    if (!isFresh(igTs)) continue;
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

/**
 * Instagram: digest Gmail del día primero; GET Apify last como fallback.
 * No toca alertas/sheet.
 */
export async function fetchInstagramItems({ dateYmd } = {}) {
  try {
    const digest = await fetchInstagramDigestFromGmail({ dateYmd });
    if (digest.length) {
      // Regla 24 h: fecha exacta desde el código del post (/p/CODIGO)
      const fresh = mapDigestToItems(digest, "instagram").filter((it) => isFresh(shortcodeDate(postKey(it.url || ""))));
      if (fresh.length) return fresh;
    }
  } catch (error) {
    console.warn(`Instagram digest Gmail: ${error.message}`);
  }
  return fetchInstagramFromApify({ dateYmd });
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
    // Regla 24 h: hora exacta de publicación obligatoria
    if (!isFresh(parseStamp(p.time || p.timestamp || p.date || p.createdAt))) continue;
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

/** TV/radio: Analisishoy de hoy + día anterior (ventana del reporte matutino). */
export async function fetchTvRadioItems({ date, dateYmd, channel }) {
  const base = date instanceof Date ? new Date(date) : new Date(dateYmd || Date.now());
  if (Number.isNaN(base.getTime())) {
    throw new Error("Fecha inválida para TV/radio");
  }
  const prev = new Date(base);
  prev.setDate(prev.getDate() - 1);

  const paths = [];
  const collected = [];
  let lastMissing = "";

  for (const d of [base, prev]) {
    const ymd = calendarYmd(d);
    try {
      const analisis = loadAnalisisHoy(d, channel);
      paths.push(analisis.path);
      const { items } = filterForClient(analisis, "intrant", channel);
      for (const it of items) {
        // Regla 24 h: hora del clip (archivo / medio / hora / análisis). Sin hora: solo si el archivo es de HOY.
        const ts =
          parseLooseDateTime(it.archivo || "") ||
          parseLooseDateTime(it.medioFecha || "", ymd) ||
          parseLooseDateTime(it.analyzedAt || "", ymd);
        const todayYmd = calendarYmd(new Date());
        if (ts ? !isFresh(ts) : ymd !== todayYmd) continue;
        collected.push(fromAnalisis(channel, it, ymd));
      }
    } catch (error) {
      if (/No encontré/i.test(error.message)) {
        lastMissing = error.message;
        continue;
      }
      throw error;
    }
  }

  if (!paths.length) {
    return { items: [], missing: true, error: lastMissing || "Sin Analisishoy" };
  }

  return {
    items: dedupe(collected),
    missing: false,
    path: paths.join(" | "),
  };
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

  // X: búsqueda combinada Latest+Top con paginación (x-report); items con forma del REPORTE
  const x = await run("x", async () => {
    const r = await fetchXDayItems({ date });
    return r.skipped ? r : { items: r.items.map((t) => item(t)) };
  });
  if (x?.skipped) skipped.push({ source: "x", reason: x.skipped });
  if (x?.items) bySource.x = x.items;

  // YouTube: API oficial si hay YOUTUBE_API_KEY (hoy + ayer); si no, digest Gmail / Apify como antes
  const yt = youtubeKey()
    ? await run("youtube", async () =>
        (await fetchYoutubeApiItems({ date })).map((v) =>
          item({
            source: "youtube",
            medio: v.medio,
            title: v.title,
            summary: `${v.summary} (👁 ${v.views} · ❤ ${v.likes} · 💬 ${v.comments})`,
            url: v.url,
            at: v.at || dateYmd,
            relevance: v.relevance,
            mediaKind: "video",
          })
        )
      )
    : await run("youtube", () => fetchYoutubeItems({ dateYmd }));
  if (yt) bySource.youtube = yt;

  if (refreshInstagram) {
    await run("instagram", () => refreshInstagramDataset());
  }
  const ig = await run("instagram", () => fetchInstagramItems({ dateYmd }));
  if (ig) bySource.instagram = ig;

  // Instagram por buscadores (menciones explícitas de INTRANT en otros perfiles; hoy + ayer por defecto)
  const igSearch = await run("instagram", async () => {
    const days = Math.max(0, Number(process.env.IG_REPORT_DAYS ?? 1));
    const res = await searchInstagram({ now: date, settings: { ...igSettings(), days } });
    return res.items;
  });
  if (igSearch?.length) {
    const seen = new Set(bySource.instagram.map((it) => postKey(it.url || "")));
    for (const it of igSearch) {
      const k = postKey(it.url);
      if (seen.has(k)) continue;
      seen.add(k);
      bySource.instagram.push(
        item({
          source: "instagram",
          medio: it.medio,
          title: it.title,
          summary: it.summary,
          url: it.url,
          at: it.at || dateYmd,
          relevance: it.relevance,
          mediaKind: it.mediaKind,
        })
      );
    }
  }

  if (refreshFacebook) {
    await run("facebook", () => refreshFacebookDataset());
  }
  const fb = await run("facebook", () => fetchFacebookItems({ dateYmd }));
  if (fb) bySource.facebook = fb;

  const tv = await run("tv", () => fetchTvRadioItems({ date, dateYmd, channel: "tv" }));
  if (tv?.missing) skipped.push({ source: "tv", reason: tv.error });
  if (tv?.items) {
    // Analisishoy trae Video (.mp4) y Audio (.wav/.mp3); repartir por source
    bySource.tv = tv.items.filter((it) => it.source === "tv");
    bySource.radio.push(...tv.items.filter((it) => it.source === "radio"));
  }

  const radio = await run("radio", () =>
    fetchTvRadioItems({ date, dateYmd, channel: "radio" })
  );
  if (radio?.missing) skipped.push({ source: "radio", reason: radio.error });
  if (radio?.items) {
    bySource.radio = dedupe([...bySource.radio, ...radio.items]);
  }

  const items = dedupe(Object.values(bySource).flat());
  const counts = Object.fromEntries(
    Object.entries(bySource).map(([k, v]) => [k, v.length])
  );

  return { dateYmd, items, bySource, counts, errors, skipped };
}
