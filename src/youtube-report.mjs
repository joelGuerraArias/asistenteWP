/**
 * Estado de YouTube (INTRANT) con la API oficial YouTube Data v3 (gratis, cuota diaria).
 *  - Videos de hoy que mencionan explícitamente INTRANT (título/descripción), RD, en español.
 *  - Métricas reales: vistas, likes, comentarios.
 *  - Último video del canal oficial del INTRANT + comentarios.
 * Costo aprox. por corrida: 2 búsquedas (200 u.) + estadísticas/comentarios (~5 u.) de 10,000 u./día.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { sendEmail } from "./informe-email.mjs";
import { isRelevantDR } from "./instagram-search.mjs";
import { calendarYmd } from "./news-date.mjs";
import { isFresh, windowStart } from "./freshness.mjs";
import {
  assertAllFresh,
  channelEmailText,
  displayDateDR,
  horaDR,
  hourDR,
  iconAttachments,
  intrantRecipients,
  networkIconHtml,
  renderChannelEmail,
  shortDateDR,
  sourceUrlHtml,
  summarizeChannel,
  withTone,
} from "./social-report.mjs";

const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL_CACHE = () => join(config.root, ".youtube-channel.json");

/** Días hacia atrás además de hoy (YT_DAYS, default 2 → últimos 3 días). */
export function ytDays() {
  return Math.min(14, Math.max(0, Number(process.env.YT_DAYS ?? 2)));
}

export function youtubeKey() {
  return process.env.YOUTUBE_API_KEY || "";
}

async function yt(path, params) {
  const key = youtubeKey();
  if (!key) throw new Error("Falta YOUTUBE_API_KEY en .env");
  const u = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  u.searchParams.set("key", key);
  const res = await fetch(u);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || "";
    throw new Error(`YouTube ${res.status}${reason ? ` (${reason})` : ""}: ${data?.error?.message || ""}`.slice(0, 220));
  }
  return data;
}

function esc(v = "") {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Inicio del día N días atrás en hora dominicana (UTC-4, sin horario de verano). */
function startOfDayDR(now, daysBack = 0) {
  const ymd = calendarYmd(new Date(now.getTime() - daysBack * 86400000));
  return new Date(`${ymd}T00:00:00-04:00`);
}

/** Canal oficial del INTRANT: YT_CLIENT_CHANNEL_ID, caché, o búsqueda única (100 u.). */
export async function resolveClientChannelId() {
  if (process.env.YT_CLIENT_CHANNEL_ID) return process.env.YT_CLIENT_CHANNEL_ID;
  try {
    if (existsSync(CHANNEL_CACHE())) {
      const c = JSON.parse(readFileSync(CHANNEL_CACHE(), "utf8"));
      if (c.channelId) return c.channelId;
    }
  } catch {
    /* caché corrupta */
  }
  const data = await yt("search", {
    part: "snippet",
    type: "channel",
    q: "INTRANT Instituto Nacional de Tránsito y Transporte Terrestre",
    regionCode: "DO",
    maxResults: 5,
  });
  const hit = (data.items || []).find((it) => /intrant|instituto nacional de tr[aá]nsito/i.test(`${it.snippet?.channelTitle} ${it.snippet?.title}`));
  const channelId = hit?.snippet?.channelId || hit?.id?.channelId || "";
  if (channelId) {
    writeFileSync(CHANNEL_CACHE(), JSON.stringify({ channelId, title: hit.snippet?.channelTitle || "", at: new Date().toISOString() }, null, 2), "utf8");
  }
  return channelId;
}

async function videoDetails(ids = []) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await yt("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(",") });
    for (const v of data.items || []) out.set(v.id, v);
  }
  return out;
}

/** Último video del canal del cliente + comentarios. */
export async function fetchClientLatestVideo({ maxComments = 20 } = {}) {
  const channelId = await resolveClientChannelId();
  if (!channelId) return { ok: false, error: "No se encontró el canal del INTRANT" };
  const ch = await yt("channels", { part: "contentDetails,snippet", id: channelId });
  const channel = ch.items?.[0];
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { ok: false, error: "Canal sin lista de subidas", channelId };
  const pl = await yt("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 5 });
  const videoId = pl.items?.[0]?.contentDetails?.videoId;
  if (!videoId) return { ok: false, error: "Canal sin videos", channelId };
  const det = (await videoDetails([videoId])).get(videoId);
  let comments = [];
  let commentsError = "";
  try {
    const ct = await yt("commentThreads", { part: "snippet", videoId, maxResults: maxComments, order: "relevance", textFormat: "plainText" });
    comments = (ct.items || []).map((c) => {
      const s = c.snippet?.topLevelComment?.snippet || {};
      return { user: s.authorDisplayName || "", text: s.textDisplay || "", likes: s.likeCount || 0, at: s.publishedAt || "" };
    });
  } catch (e) {
    commentsError = /commentsDisabled/i.test(e.message) ? "Comentarios desactivados" : e.message;
  }
  return {
    ok: true,
    channelId,
    channelTitle: channel?.snippet?.title || "",
    video: {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: det?.snippet?.title || "",
      at: det?.snippet?.publishedAt || "",
      views: Number(det?.statistics?.viewCount || 0),
      likes: Number(det?.statistics?.likeCount || 0),
      commentsCount: Number(det?.statistics?.commentCount || 0),
    },
    comments,
    commentsError,
  };
}

/**
 * Videos que mencionan al INTRANT en el período.
 * @param {{ now?: Date, days?: number, excludeChannelId?: string, onStatus?: Function }} o
 */
export async function searchYoutube({ now = new Date(), days = 0, excludeChannelId = "", onStatus } = {}) {
  // Regla 24 h: ventana móvil exacta (no por días de calendario)
  const publishedAfter = windowStart(now).toISOString();
  const queries = (process.env.YT_QUERIES || "INTRANT|Juan Manuel Mendez INTRANT").split("|").map((q) => q.trim()).filter(Boolean);
  const ids = new Set();
  for (const q of queries) {
    const data = await yt("search", {
      part: "snippet",
      type: "video",
      q,
      order: "date",
      publishedAfter,
      regionCode: "DO",
      relevanceLanguage: "es",
      maxResults: 50,
    });
    onStatus?.(`🔎 YouTube "${q}" → ${(data.items || []).length}`);
    for (const it of data.items || []) if (it.id?.videoId) ids.add(it.id.videoId);
  }
  const details = await videoDetails([...ids]);
  const items = [];
  let descartados = 0;
  for (const [id, v] of details) {
    const sn = v.snippet || {};
    const blob = `${sn.title || ""}\n${sn.description || ""}\n${(sn.tags || []).join(" ")}`;
    if (!isRelevantDR(blob)) {
      descartados++;
      continue;
    }
    if (excludeChannelId && sn.channelId === excludeChannelId) continue;
    const st = v.statistics || {};
    const published = sn.publishedAt ? new Date(sn.publishedAt) : null;
    if (!isFresh(published, now)) continue;
    items.push({
      source: "youtube",
      medio: sn.channelTitle || "YouTube",
      channelId: sn.channelId,
      title: String(sn.title || "").trim(),
      summary: String(sn.description || "").replace(/\s+/g, " ").trim().slice(0, 260),
      url: `https://www.youtube.com/watch?v=${id}`,
      at: published ? calendarYmd(published) : "",
      publishedAt: published ? published.toISOString() : "",
      hora: published ? `${shortDateDR(published)} · ${horaDR(published)}` : "",
      views: Number(st.viewCount || 0),
      likes: Number(st.likeCount || 0),
      comments: Number(st.commentCount || 0),
      mediaKind: "video",
      mendez: /juan manuel (rafael )?m[eé]ndez/i.test(blob),
      relevance: "alta",
    });
  }
  items.sort((a, b) => (b.mendez ? 1 : 0) - (a.mendez ? 1 : 0) || String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return { items, stats: { consultas: queries.length, candidatos: details.size, descartados } };
}

export function ytStats(items = []) {
  const sum = (k) => items.reduce((a, i) => a + (i[k] || 0), 0);
  const byHour = new Map();
  for (const i of items) {
    if (!i.publishedAt) continue;
    const h = hourDR(new Date(i.publishedAt));
    byHour.set(h, (byHour.get(h) || 0) + (i.likes || 0) + (i.comments || 0));
  }
  return {
    total: items.length,
    channels: new Set(items.map((i) => i.channelId || i.medio)).size,
    views: sum("views"),
    likes: sum("likes"),
    comments: sum("comments"),
    engagement: sum("likes") + sum("comments"),
    mendez: items.filter((i) => i.mendez).length,
    maxEngHour: byHour.size ? Math.max(...byHour.values()) : 0,
  };
}

function clientVideoBlock(client) {
  if (!client?.ok) {
    return `<div style="margin:18px 0 0;padding:12px 14px;border-radius:10px;background:#F8FAFC;border:1px dashed #cbd5e1;font-size:12px;color:#64748b;">${client?.stale ? "El canal del INTRANT no ha publicado videos en las últimas 24 horas." : "Último video del canal del INTRANT: no disponible en este corte."}</div>`;
  }
  const v = client.video;
  const list = client.comments.length
    ? client.comments
        .map((c) => `<div style="padding:7px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#334155;line-height:1.45;"><b style="color:#0f172a;">${esc(c.user)}</b> ${esc(c.text)}</div>`)
        .join("")
    : `<div style="font-size:12px;color:#94a3b8;">${esc(client.commentsError || "Sin comentarios.")}</div>`;
  return `<div style="margin:22px 0 0;border:1px solid #fecaca;border-radius:12px;overflow:hidden;">
    <div style="background:#fef2f2;padding:12px 16px;border-bottom:1px solid #fecaca;">
      <div style="font-size:12px;font-weight:800;color:#DC2626;letter-spacing:.06em;text-transform:uppercase;">${networkIconHtml("youtube", 18)}&nbsp; Último video de ${esc(client.channelTitle || "INTRANT")}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;">${esc(v.at ? `${displayDateDR(new Date(v.at))} · ${horaDR(new Date(v.at))}` : "")} · 👁 ${v.views.toLocaleString("en-US")} · ❤ ${v.likes} · 💬 ${v.commentsCount}</div>
    </div>
    <div style="padding:12px 16px;">
      <div style="font-size:14px;font-weight:700;color:#0f172a;">${esc(v.title)}</div>
      <p style="margin:8px 0 12px;"><a href="${esc(v.url)}" style="color:#DC2626;font-weight:700;text-decoration:none;">Ver video →</a></p>
      ${sourceUrlHtml(v.url, "#DC2626")}
      <div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Comentarios (${client.comments.length}${v.commentsCount ? ` de ${v.commentsCount}` : ""})</div>
      ${list}
    </div>
  </div>`;
}

/** Fuente YouTube para el REPORTE general (hoy + ayer por defecto; sin el canal propio). */
export async function fetchYoutubeApiItems({ date = new Date(), days } = {}) {
  if (!youtubeKey()) return [];
  const d = days ?? ytDays();
  let exclude = "";
  try {
    exclude = await resolveClientChannelId();
  } catch {
    /* sin canal: no excluir */
  }
  const { items } = await searchYoutube({ now: date, days: d, excludeChannelId: exclude });
  return items;
}

/**
 * @param {{ now?: Date, dryRun?: boolean, to?: string, onStatus?: Function }} o
 */
export async function runYoutubeReport({ now = new Date(), dryRun = false, to = "", onStatus } = {}) {
  if (!youtubeKey()) throw new Error("Falta YOUTUBE_API_KEY en .env");
  let client = { ok: false, error: "" };
  try {
    onStatus?.("📺 Canal del INTRANT: último video y comentarios…");
    client = await fetchClientLatestVideo();
  } catch (e) {
    client = { ok: false, error: e.message };
    onStatus?.(`⚠️ Canal INTRANT: ${e.message}`);
  }
  // Último video del canal oficial: solo si es de las últimas 24 h
  if (client.ok && !isFresh(client.video?.at, now)) client = { ...client, ok: false, stale: true };
  const res = await searchYoutube({ now, excludeChannelId: client.channelId || "", onStatus });
  const items = withTone(
    res.items.map((i) => ({ ...i, metrics: `👁 ${i.views.toLocaleString("en-US")} · ❤ ${i.likes} · 💬 ${i.comments}` }))
  );
  const st = ytStats(items);
  const displayDate = displayDateDR(now);
  const periodLabel = `Corte ${horaDR(now)} · últimas 24 horas`;
  const extra = [
    `Métricas: ${st.total} videos, ${st.channels} canales, ${st.views} vistas, ${st.likes} likes, ${st.comments} comentarios.`,
    client.stale
      ? "El canal oficial del INTRANT no publicó videos en las últimas 24 horas."
      : client.ok
      ? `Último video del canal oficial: "${client.video.title}" (${client.video.views} vistas). Comentarios: ${client.comments.slice(0, 15).map((c) => `${c.user}: ${c.text}`).join(" | ")}`
      : "",
  ].join("\n");
  const summaryMd = await summarizeChannel({ channel: "YouTube", items, periodLabel, extra, onStatus });
  const subject = `ESTADO YOUTUBE INTRANT — ${items.length} ${items.length === 1 ? "video" : "videos"} — ${displayDate} ${horaDR(now)}`;
  const html = renderChannelEmail({
    channel: "YouTube",
    accent: "#DC2626",
    displayDate,
    periodLabel,
    summaryMd,
    items,
    topBlockHtml: clientVideoBlock(client),
    sectionTitle: "Videos de las últimas 24 horas que mencionan al INTRANT",
    footer: "Solo videos publicados en las últimas 24 horas cuyo título, descripción o etiquetas mencionan explícitamente al INTRANT (API oficial de YouTube).",
    kpiHeader: {
      title: "Monitoreo en Redes — YouTube",
      subtitle: `Boletín de Transporte y Movilidad – INTRANT  ·  ${shortDateDR(now)}`,
      network: "youtube",
      tiles: [
        { value: st.total, label: "Total videos" },
        { value: st.channels, label: "Canales únicos" },
        { value: st.views, label: "Vistas" },
        { value: st.engagement, label: "Engagement" },
        { value: st.likes, label: "Likes" },
        { value: st.comments, label: "Comentarios" },
        { value: st.mendez, label: "Mencionan a Méndez" },
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
    onStatus?.(`📤 Enviando estado de YouTube → ${recipients.to}`);
    sent = await sendEmail({ to: recipients.to, cc: recipients.cc || undefined, subject, html, text, attachments: iconAttachments(["youtube"]) });
  }
  return { dateYmd: calendarYmd(now), items, client, stats: { ...res.stats, ...st }, summaryMd, subject, html, text, sent, recipients, dryRun };
}
