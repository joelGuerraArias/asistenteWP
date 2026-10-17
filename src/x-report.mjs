/**
 * Estado de X / Twitter (INTRANT): menciones de @INTRANT_RD vía twitter-api47 (RapidAPI),
 * con métricas (vistas, likes, retweets, respuestas) para el encabezado de indicadores.
 * Correo 09:00 y 17:00 (SOCIAL_REPORT_CRON_TIMES). En el REPORTE general entra como fuente "x".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { sendEmail } from "./informe-email.mjs";
import { calendarYmd } from "./news-date.mjs";
import { isFresh, windowStart } from "./freshness.mjs";
import {
  assertAllFresh,
  channelEmailText,
  iconAttachments,
  displayDateDR,
  horaDR,
  hourDR,
  intrantRecipients,
  renderChannelEmail,
  shortDateDR,
  summarizeChannel,
  withTone,
} from "./social-report.mjs";

function get(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Primer valor numérico encontrado entre varias rutas posibles (la API varía de forma). */
function num(tw, paths) {
  for (const p of paths) {
    const v = get(tw, p);
    if (v === undefined || v === null || v === "") continue;
    const n = Number(String(v).replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function str(tw, paths) {
  for (const p of paths) {
    const v = get(tw, p);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  for (const k of ["tweets", "timeline", "results", "data", "items"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return [];
}

/** Algunas respuestas envuelven el tweet (tweet_results.result / tweet / content). */
function unwrap(t) {
  return t?.tweet_results?.result || t?.result?.tweet || t?.tweet || t?.content?.tweet || t;
}

export function mapTweet(raw) {
  const tw = unwrap(raw);
  const text = str(tw, ["full_text", "text", "content", "legacy.full_text", "note_tweet.text"]);
  const createdRaw = str(tw, ["created_at", "createdAt", "date", "legacy.created_at", "timestamp"]) || get(tw, "timestamp");
  const created = createdRaw ? new Date(/^\d+$/.test(String(createdRaw)) ? Number(createdRaw) * (String(createdRaw).length <= 10 ? 1000 : 1) : createdRaw) : null;
  const user =
    str(tw, [
      "author.screen_name",
      "author.username",
      "user.screen_name",
      "user.username",
      "core.user_results.result.legacy.screen_name",
      "core.user_results.result.core.screen_name",
      "username",
      "screen_name",
    ]) || "X";
  const id = str(tw, ["id_str", "rest_id", "id", "tweet_id", "legacy.id_str"]) || String(get(tw, "id") ?? "");
  const likes = num(tw, ["likeCount", "favoriteCount", "favorite_count", "legacy.favorite_count", "likes", "like_count", "favorites", "public_metrics.like_count", "stats.likes"]);
  const retweets = num(tw, ["retweetCount", "retweet_count", "legacy.retweet_count", "retweets", "public_metrics.retweet_count", "stats.retweets"]);
  const replies = num(tw, ["replyCount", "reply_count", "legacy.reply_count", "replies", "public_metrics.reply_count", "stats.replies"]);
  const quotes = num(tw, ["quoteCount", "quote_count", "legacy.quote_count", "quotes", "public_metrics.quote_count"]);
  const views = num(tw, ["viewCount", "views.count", "view_count", "views", "ext_views.count", "public_metrics.impression_count", "stats.views"]);
  const isRetweet = Boolean(get(tw, "retweetedTweet") || get(tw, "retweeted_status") || str(tw, ["type"]) === "retweet" || /^RT @/.test(text));
  return {
    id,
    isRetweet,
    text,
    user: String(user).replace(/^@/, ""),
    created: created && !Number.isNaN(created.getTime()) ? created : null,
    likes,
    retweets,
    replies,
    quotes,
    views,
    url: str(tw, ["url", "tweet_url"]) || (id ? `https://x.com/${String(user).replace(/^@/, "")}/status/${id}` : ""),
  };
}

function nextCursor(data) {
  const p = data?.pagination || data?.meta || {};
  return p.nextCursor || p.next_cursor || p.cursor || p.bottom || p.next || data?.next_cursor || data?.cursor || "";
}

/** Busca en X combinando "Latest" y "Top" (X_SEARCH_TYPES) y pagina (X_MAX_PAGES por tipo) mientras haya publicaciones de hoy. */
async function fetchXRaw({ query, dateYmd }) {
  const key = config.reporte?.twitterRapidApiKey;
  if (!key) throw new Error("Falta TWITTER_RAPIDAPI_KEY o RAPIDAPI_KEY en .env");
  const host = config.reporte.twitterRapidApiHost || "twitter-api47.p.rapidapi.com";
  const types = String(process.env.X_SEARCH_TYPES || process.env.INTRANT_TWITTER_TYPE || "Latest,Top")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const maxPages = Math.max(1, Number(process.env.X_MAX_PAGES) || 3);
  const rows = [];
  let first = null;
  let okCalls = 0;
  let lastError = "";
  for (const type of types) {
    let cursor = "";
    for (let page = 0; page < maxPages; page++) {
      const url =
        `https://${host}/v3/search?query=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const res = await fetch(url, { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = `X ${res.status}: ${data?.message || data?.error || ""}`;
        break;
      }
      okCalls++;
      if (!first) first = data;
      const got = rowsOf(data);
      rows.push(...got);
      cursor = nextCursor(data);
      const oldest = got.map(mapTweet).filter((t) => t.created).map((t) => calendarYmd(t.created)).sort()[0];
      if (!cursor || !got.length || (type === "Latest" && oldest && oldest < dateYmd)) break;
    }
  }
  if (!okCalls) throw new Error(lastError || "X sin respuesta");
  return { data: first || {}, rows };
}

/** Publicaciones de X de un día (para el REPORTE general): mismas reglas que el correo de estado. */
export async function fetchXDayItems({ date = new Date() } = {}) {
  const key = config.reporte?.twitterRapidApiKey;
  if (!key) return { items: [], skipped: "sin RAPIDAPI_KEY" };
  const dateYmd = calendarYmd(date);
  const query = config.reporte?.twitterQuery || "@INTRANT_RD";
  const { rows } = await fetchXRaw({ query, dateYmd: calendarYmd(windowStart(date)) });
  const seen = new Set();
  const items = rows
    .map(mapTweet)
    .filter((t) => (t.id ? !seen.has(t.id) && seen.add(t.id) : true))
    .filter((t) => !t.isRetweet && isFresh(t.created, date)) // Regla 24 h; RT puros fuera (pueden traer contenido viejo)
    .filter((t) => /intrant/i.test(`${t.text} ${t.user}`))
    .map((t) => ({
      source: "x",
      medio: `@${t.user}`,
      title: t.text.replace(/\s+/g, " ").slice(0, 120),
      summary: `${t.text.replace(/\s+/g, " ")} (👁 ${t.views} · ❤ ${t.likes} · 🔁 ${t.retweets} · 💬 ${t.replies})`,
      url: t.url,
      at: dateYmd,
      relevance: "alta",
    }));
  return { items };
}

/** Indicadores del encabezado (como el boletín). */
export function xStats(tweets = []) {
  const users = new Set(tweets.map((t) => t.user.toLowerCase()));
  const sum = (k) => tweets.reduce((a, t) => a + (t[k] || 0), 0);
  const likes = sum("likes");
  const retweets = sum("retweets");
  const replies = sum("replies");
  const byHour = new Map();
  for (const t of tweets) {
    if (!t.created) continue;
    const h = hourDR(t.created);
    byHour.set(h, (byHour.get(h) || 0) + t.likes + t.retweets + t.replies);
  }
  return {
    total: tweets.length,
    uniqueUsers: users.size,
    views: sum("views"),
    engagement: likes + retweets + replies,
    likes,
    retweets,
    replies,
    maxEngHour: byHour.size ? Math.max(...byHour.values()) : 0,
  };
}

/**
 * @param {{ now?: Date, dryRun?: boolean, to?: string, onStatus?: Function }} o
 */
export async function runXReport({ now = new Date(), dryRun = false, to = "", onStatus } = {}) {
  const dateYmd = calendarYmd(now);
  const query = config.reporte?.twitterQuery || "@INTRANT_RD";
  onStatus?.(`🔎 X: ${query} (últimas 24 h)…`);
  const { data, rows } = await fetchXRaw({ query, dateYmd: calendarYmd(windowStart(now)) });

  // Muestra de la respuesta cruda (para verificar campos de métricas)
  try {
    const dir = join(config.root, "logs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "x-raw-sample.json"), JSON.stringify({ keys: Object.keys(data || {}), pagination: data?.pagination ?? null, total: rows.length, first: rows[0] ?? null }, null, 2), "utf8");
  } catch {
    /* no bloquear */
  }

  const seenIds = new Set();
  const tweets = rows
    .map(mapTweet)
    .filter((t) => (t.id ? !seenIds.has(t.id) && seenIds.add(t.id) : true))
    .filter((t) => t.text || t.id)
    .filter((t) => !t.isRetweet && isFresh(t.created, now)) // Regla 24 h: hora exacta; RT puros fuera
    .filter((t) => /intrant/i.test(`${t.text} ${t.user}`));

  const items = withTone(
    tweets.map((t) => ({
      source: "x",
      medio: `@${t.user}`,
      title: t.text.replace(/\s+/g, " ").slice(0, 160),
      summary: t.text.replace(/\s+/g, " "),
      url: t.url,
      at: calendarYmd(t.created),
      publishedAt: t.created ? t.created.toISOString() : "",
      hora: t.created ? `${shortDateDR(t.created)} · ${horaDR(t.created)}` : "",
      metrics: `👁 ${t.views.toLocaleString("en-US")} · ❤ ${t.likes} · 🔁 ${t.retweets} · 💬 ${t.replies}`,
    }))
  );
  const st = xStats(tweets);

  const displayDate = displayDateDR(now);
  const periodLabel = `Corte ${horaDR(now)} · últimas 24 horas`;
  const extra = `Métricas del día: ${st.total} publicaciones, ${st.uniqueUsers} usuarios únicos, ${st.views} vistas, engagement ${st.engagement} (likes ${st.likes}, retweets ${st.retweets}, respuestas ${st.replies}).`;
  const summaryMd = await summarizeChannel({ channel: "X", items, periodLabel, extra, onStatus });
  const subject = `ESTADO X (TWITTER) INTRANT — ${items.length} ${items.length === 1 ? "mención" : "menciones"} — ${displayDate} ${horaDR(now)}`;
  const html = renderChannelEmail({
    channel: "X",
    accent: "#0F172A",
    displayDate,
    periodLabel,
    summaryMd,
    items,
    sectionTitle: `Publicaciones en X (${query})`,
    footer: `Búsqueda en X: ${query} · solo publicaciones de las últimas 24 horas · corte ${horaDR(now)}.`,
    kpiHeader: {
      title: "Monitoreo en Redes — X (Twitter)",
      subtitle: `Boletín de Transporte y Movilidad – INTRANT  ·  ${shortDateDR(now)}`,
      network: "x",
      tiles: [
        { value: st.total, label: "Total menciones" },
        { value: st.uniqueUsers, label: "Usuarios únicos" },
        { value: st.views, label: "Vistas" },
        { value: st.engagement, label: "Engagement" },
        { value: st.likes, label: "Likes" },
        { value: st.retweets, label: "Retweets" },
        { value: st.replies, label: "Respuestas" },
        { value: st.maxEngHour, label: "Máx. engagement / hora" },
      ],
    },
  });
  const text = channelEmailText({ subject, summaryMd, items });

  assertAllFresh(items, now); // Regla 24 h: si algo se pasa, no se envía
  let sent = null;
  let recipients = null;
  if (!dryRun) {
    recipients = to ? { to, cc: "" } : intrantRecipients();
    onStatus?.(`📤 Enviando estado de X → ${recipients.to}`);
    sent = await sendEmail({ to: recipients.to, cc: recipients.cc || undefined, subject, html, text, attachments: iconAttachments(["x"]) });
  }
  return { dateYmd, items, stats: st, summaryMd, subject, html, text, sent, recipients, dryRun };
}
