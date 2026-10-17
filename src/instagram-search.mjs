/**
 * Monitor de Instagram RD — búsqueda de coincidencias vía buscadores
 * (Serper = Google, Brave como respaldo) sin iniciar sesión en Instagram.
 *
 * App independiente: NO modifica el agente. Solo lee la configuración (.env)
 * a través de ../src/config.mjs. Los items que devuelve usan la MISMA forma
 * que los items del REPORTE Intrant (source/medio/title/summary/url/at/...),
 * así que conectarlo al resumen ejecutivo es añadir unas pocas líneas.
 */
import { config } from "./config.mjs";
import { isFresh } from "./freshness.mjs";

// ─────────────────────────────────────────────────────────────
// Términos y cuentas (sobrescribibles por .env, separados por coma)
// ─────────────────────────────────────────────────────────────

const DEFAULT_TERMS = ["INTRANT", "intrantrd", "intrant_rd", "Juan Manuel Mendez"];

const DEFAULT_ACCOUNTS = [
  // Medios
  "cdn37",
  "ndigitalmultimedia",
  "elnacionalrd",
  "diariolibre",
  "losmocanos",
  "somospueblord",
  "eldia_do",
  "periodicohoyrd",
  "elcariberd",
  "antena7rd",
  "deultimominuto",
  "acentodiario",
  "super7fm",
  // Comunicadores
  "sergiocarlo",
  "elpiro",
  "ramontolentino",
  "nuriapiera",
  "dannyalcantara",
];

function listFromEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return [...fallback];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/^@/, ""))
    .filter(Boolean);
}

export function igSettings() {
  return {
    terms: listFromEnv("IG_MONITOR_TERMS", DEFAULT_TERMS),
    accounts: listFromEnv("IG_MONITOR_ACCOUNTS", DEFAULT_ACCOUNTS),
    serperKey: process.env.SERPER_API_KEY || "",
    tavilyKey: config.tavily?.apiKey || process.env.TAVILY_API_KEY || "",
    /** Cuentas propias del cliente: NO se reportan (se buscan menciones en OTROS perfiles). */
    excludeAccounts: listFromEnv("IG_MONITOR_EXCLUDE_ACCOUNTS", ["intrant_rd", "intrantrd"]).map((a) => a.toLowerCase()),
    braveKey: config.brave?.apiKey || process.env.BRAVE_API_KEY || "",
    /** Ventana de días (hoy + N atrás) para descartar posts viejos con fecha conocida. */
    /** 0 = solo HOY (por defecto). N = hoy + N días atrás. */
    days: Math.min(14, Math.max(0, Number(process.env.IG_MONITOR_DAYS ?? 0) || 0)),
    /** Brave free = 1 req/s */
    braveDelayMs: Math.max(0, Number(process.env.IG_MONITOR_BRAVE_DELAY_MS) || 1100),
    /** Tavily: además de las búsquedas generales, 1 consulta por cuenta (18 créditos/corrida). */
    perAccount: process.env.IG_MONITOR_PER_ACCOUNT === "true",
    /** Con sesión: averiguar dueño de cada post (hasta 40 consultas extra). Apagado: solo 2 consultas/día. */
    resolveOwners: process.env.IG_MONITOR_RESOLVE_OWNER === "true",
    /** Cuenta del cliente: se trae solo su último post + comentarios. */
    clientAccount: (process.env.IG_MONITOR_CLIENT_ACCOUNT || "intrant_rd").replace(/^@/, ""),
  };
}

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

export function norm(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function cleanUrl(url = "") {
  return String(url).split("?")[0].split("#")[0].replace(/\/+$/, "");
}

export function contentType(url = "") {
  const u = url.toLowerCase();
  if (u.includes("/reel/") || u.includes("/reels/")) return "reel";
  if (u.includes("/p/")) return "post";
  if (u.includes("/stories/")) return "story";
  if (u.includes("/tv/")) return "video";
  return "otro";
}

/** Solo contenido (post/reel/video); descarta perfiles, /explore, hashtags, etc. */
export function isContentUrl(url = "") {
  return /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i.test(url);
}

/** Código único del post (mismo post puede venir con o sin usuario en la URL). */
export function postKey(url = "") {
  const m = String(url).match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : cleanUrl(url).toLowerCase();
}

const RESERVED = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "popular"]);

/** Detecta la cuenta: de la URL (instagram.com/usuario/p/...) o del título ("(@usuario)", "usuario on Instagram"). */
export function detectAccount(url = "", title = "", fallback = "") {
  const m = String(url).match(/instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|reels|tv)\//i);
  if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
  const t = String(title);
  const at = t.match(/\(@([A-Za-z0-9._]+)\)/) || t.match(/@([A-Za-z0-9._]{3,})/);
  if (at) return at[1];
  const on = t.match(/^([A-Za-z0-9._]{3,})\s+(?:on|en)\s+Instagram/i);
  if (on) return on[1];
  return fallback;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const IG_EPOCH_MS = 1314220021721n;

/**
 * Fecha EXACTA de publicación a partir del código del post (/p/CODIGO).
 * El ID de Instagram lleva el timestamp en sus bits altos (id >> 23 = ms desde 2011-08-24).
 * Verificado con fechas reales de Serper/Brave.
 */
export function shortcodeDate(code = "") {
  const c = String(code).slice(0, 11);
  if (!/^[A-Za-z0-9_-]{10,11}$/.test(c)) return null;
  let n = 0n;
  for (const ch of c) n = n * 64n + BigInt(B64.indexOf(ch));
  const ms = Number((n >> 23n) + IG_EPOCH_MS);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2012) return null;
  return d;
}

/**
 * ¿El texto devuelto pertenece al mismo post que el título? (primeras palabras del título dentro del texto).
 * Títulos genéricos ("Instagram", "Reel by …", "Photo by …") no se pueden verificar → false.
 */
export function textMatchesTitle(title = "", text = "") {
  const clean = (v) =>
    norm(v)
      .replace(/\.\.\.|…/g, " ")
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const t = clean(title);
  const x = clean(text);
  if (!x) return true;
  if (!t || /^instagram$/.test(t) || /^(photo|reel|video|post) by /.test(t) || t.length < 15) return false;
  const words = t.split(" ").filter(Boolean);
  const probe = words.slice(0, Math.min(6, words.length)).join(" ");
  return x.includes(probe);
}

/** Qué términos aparecen realmente en el texto (sin tildes, sin mayúsculas). */
export function termsFound(text = "", terms = []) {
  const n = norm(text);
  return terms.filter((t) => {
    const k = norm(t);
    if (!k) return false;
    if (k.length <= 8 && !k.includes(" ")) {
      return new RegExp(`(?:^|[^\\p{L}\\p{N}])${k}(?:$|[^\\p{L}\\p{N}])`, "iu").test(n);
    }
    return n.includes(k);
  });
}

// ─────────────────────────────────────────────────────────────
// Exactitud: contexto dominicano y vínculo real con el INTRANT
// ─────────────────────────────────────────────────────────────

const DR_SIGNALS =
  /\b(rd|republica dominicana|dominican[oa]s?|santo domingo|santiago de los caballeros|digesett|intrant|distrito nacional|san pedro de macoris|la altagracia|san cristobal|la vega|puerto plata|punta cana|villa tapia|abinader|listin|diario libre|el nuevo diario|n digital|cdn|hoy\.com\.do)\b/;
const FOREIGN_SIGNALS =
  /\b(honduras|hondure\w*|tegucigalpa|roatan|san pedro sula|guatemala|guatemalteco\w*|el salvador|salvadore\w*|nicaragua|nicaraguense\w*|paraguay|asuncion|costa rica|panama|colombia|venezuela|mexico|peru|ecuador|chile|argentina|chicago|texas|florida)\b/;

/**
 * ¿La publicación es realmente sobre el INTRANT dominicano?
 *  - OBLIGATORIO: el texto dice explícitamente "INTRANT" o menciona @intrantrd / @intrant_rd.
 *    (Juan Manuel Méndez solo, sin INTRANT, no cuenta.)
 *  - Si trae señales de otro país y ninguna dominicana → fuera.
 */
export function mentionsIntrant(text = "") {
  const n = norm(text);
  return /\bintrant\b/.test(n) || /@?intrant_?rd\b/.test(n);
}

export function isRelevantDR(text = "") {
  if (!mentionsIntrant(text)) return false;
  const n = norm(text);
  if (FOREIGN_SIGNALS.test(n) && !DR_SIGNALS.test(n.replace(/\bintrant\b/g, ""))) return false;
  return true;
}

/** Medio a partir de etiquetas/firmas propias de cada medio. */
const MEDIA_TAGS = [
  [/#videold\b|listin diario|#listin/, "Listín Diario"],
  [/#nacionalesen\b|el nuevo diario/, "El Nuevo Diario"],
  [/#diariolibre\b|diario libre/, "Diario Libre"],
  [/#ndigital\b|n digital/, "N Digital"],
  [/#cdn\b|cdn 37|cdn37/, "CDN"],
  [/#eldia\b|el dia\b/, "El Día"],
  [/#hoydigital\b|periodico hoy/, "Hoy"],
  [/#elcaribe\b|el caribe/, "El Caribe"],
  [/#acento\b|acento\.com/, "Acento"],
  [/#nacionalesnat\b|noticias al tiempo/, "Noticias al Tiempo"],
  [/infoenn\.com/, "InfoENN"],
  [/latoradigital/, "La Tora Digital"],
  [/#sincortapisa/, "Sin Cortapisa"],
];
export function mediaFromText(text = "") {
  const n = norm(text);
  for (const [re, name] of MEDIA_TAGS) if (re.test(n)) return name;
  return "";
}

/** Titular limpio: primera frase real del texto (sin hashtags, "...", ni prefijos). */
export function cleanHeadline(title = "", text = "") {
  const strip = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .replace(/^(#\w+\s*\|?\s*)+/u, "")
      .replace(/^(photo|reel|video) by [^:]+:\s*/i, "")
      .replace(/\s*\.\.\.\s*$|\s*…\s*$/u, "")
      .trim();
  const t = strip(title);
  const x = strip(text);
  const titleIsGeneric = !t || /^instagram$/i.test(t) || /^(photo|reel) by/i.test(title) || t.length < 25;
  const base = titleIsGeneric || (x && !norm(x).startsWith(norm(t).slice(0, 20))) ? x || t : t;
  const sentence = base.match(/^(.{30,180}?[.!?])(\s|$)/u);
  const out = sentence ? sentence[1] : base.slice(0, 160);
  return out.length < base.length && !sentence ? `${out.replace(/\s+\S*$/, "")}…` : out;
}

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Fecha de publicación desde page_age (ISO), "2 days ago", "hace 3 horas", "Sep 23, 2026". */
export function parseAge(raw, now = new Date()) {
  if (!raw) return "";
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const rel =
    s.match(/(\d+)\s*(minute|hour|day|week|month)s?\s+ago/i) ||
    s.match(/hace\s+(\d+)\s*(minuto|hora|d[ií]a|semana|mes)/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = norm(rel[2]);
    const d = new Date(now);
    if (/^(minute|minuto|hour|hora)/.test(unit)) return ymdLocal(d);
    if (/^(day|dia)/.test(unit)) d.setDate(d.getDate() - n);
    else if (/^(week|semana)/.test(unit)) d.setDate(d.getDate() - 7 * n);
    else if (/^(month|mes)/.test(unit)) d.setMonth(d.getMonth() - n);
    return ymdLocal(d);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return ymdLocal(parsed);
  return "";
}

function inWindow(atYmd, todayYmd, days) {
  if (!atYmd) return true; // sin fecha: no descartar (el control de "ya visto" evita repetidos)
  const [y, m, d] = todayYmd.split("-").map(Number);
  const oldest = new Date(y, m - 1, d);
  oldest.setDate(oldest.getDate() - days);
  return atYmd >= ymdLocal(oldest) && atYmd <= todayYmd;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// Motores
// ─────────────────────────────────────────────────────────────

export async function searchSerper(query, { key, fetchImpl = fetch, days = 0 } = {}) {
  if (!key) return [];
  const res = await fetchImpl("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 20, gl: "do", hl: "es", tbs: days <= 1 ? "qdr:d" : "qdr:w" }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return (data.organic || [])
    .filter((it) => /instagram\.com/i.test(it.link || ""))
    .map((it) => ({
      title: it.title || "",
      text: it.snippet || "",
      url: cleanUrl(it.link),
      age: it.date || "",
      engine: "Serper",
    }));
}

async function braveRequest(params, { key, fetchImpl }) {
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return fetchImpl(u.toString(), {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
}

/**
 * Brave: solo q + count. country=DO da 422 y freshness/search_lang dejan la búsqueda en 0
 * (comprobado con diagnostico.mjs). La frescura se controla con page_age al filtrar.
 */
export async function searchBrave(query, { key, fetchImpl = fetch } = {}) {
  if (!key) return [];
  const res = await braveRequest({ q: query, count: "20" }, { key, fetchImpl });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  return (data.web?.results || [])
    .filter((it) => /instagram\.com/i.test(it.url || ""))
    .map((it) => ({
      title: it.title || "",
      text: it.description || "",
      url: cleanUrl(it.url),
      age: it.page_age || it.age || "",
      engine: "Brave",
    }));
}

/**
 * Tavily: sin "site:"; se limita a instagram.com con include_domains.
 * Usa la consulta en texto plano (cuenta + términos).
 */
export async function searchTavily(query, { key, fetchImpl = fetch, days = 7 } = {}) {
  if (!key) return [];
  const res = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      topic: "general",
      max_results: 20,
      include_domains: ["instagram.com"],
      time_range: days <= 1 ? "day" : days <= 7 ? "week" : "month",
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.results || [])
    .filter((it) => /instagram\.com/i.test(it.url || ""))
    .map((it) => ({
      title: it.title || "",
      text: it.content || "",
      url: cleanUrl(it.url),
      age: it.published_date || "",
      engine: "Tavily",
    }));
}

/**
 * Dueño del post cuando el buscador no lo dice: abre la página pública del post
 * y lee og:title / og:url / "username". Sin login; si Instagram no lo da, queda vacío.
 */
export async function fetchPostOwner(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.replace(/\/?$/, "/"), {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        "Accept-Language": "es-DO,es;q=0.9",
        Accept: "text/html",
      },
    });
    if (!res.ok) return "";
    const html = await res.text();
    const pats = [
      /<meta[^>]+property="og:url"[^>]+content="https?:\/\/www\.instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|tv)\//i,
      /<meta[^>]+property="og:title"[^>]+content="[^"]*?\(@([A-Za-z0-9._]+)\)/i,
      /<meta[^>]+property="og:title"[^>]+content="([A-Za-z0-9._]+) (?:on|en) Instagram/i,
      /"owner":\{[^}]*?"username":"([A-Za-z0-9._]+)"/,
      /"username":"([A-Za-z0-9._]+)"/,
      /<meta[^>]+name="twitter:title"[^>]+content="[^"]*?\(@([A-Za-z0-9._]+)\)/i,
    ];
    for (const re of pats) {
      const m = html.match(re);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    }
    return "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perfil público del cliente (sin login, sin Apify): endpoint que usa la web de Instagram.
 * Devuelve sus posts recientes (código, fecha, texto, conteos) y los comentarios de vista previa
 * que Instagram incluya. Si Instagram lo bloquea, devuelve { ok:false, error }.
 */
const IG_APP_ID = "936619743392459";
const IG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "X-IG-App-ID": IG_APP_ID,
  Accept: "*/*",
  "Accept-Language": "es-DO,es;q=0.9",
  Referer: "https://www.instagram.com/",
};

/** Cookies de sesión (opcionales) desde .env — nunca se imprimen. */
function igHeaders() {
  const sid = process.env.IG_SESSIONID || "";
  if (!sid) return IG_HEADERS;
  const csrf = process.env.IG_CSRFTOKEN || "";
  const uid = process.env.IG_DS_USER_ID || "";
  const cookie = [`sessionid=${sid}`, csrf && `csrftoken=${csrf}`, uid && `ds_user_id=${uid}`].filter(Boolean).join("; ");
  return { ...IG_HEADERS, Cookie: cookie, ...(csrf ? { "X-CSRFToken": csrf } : {}) };
}
export function hasIgSession() {
  return Boolean(process.env.IG_SESSIONID);
}

/** ID numérico del post a partir del código (/p/CODIGO). */
export function mediaPk(code = "") {
  const c = String(code).slice(0, 11);
  if (!/^[A-Za-z0-9_-]{10,11}$/.test(c)) return "";
  let n = 0n;
  for (const ch of c) n = n * 64n + BigInt(B64.indexOf(ch));
  return n.toString();
}

/** Dueño real del post (requiere sesión). */
export async function fetchMediaOwner(code, { fetchImpl = fetch } = {}) {
  const pk = mediaPk(code);
  if (!pk) return "";
  try {
    const res = await fetchImpl(`https://www.instagram.com/api/v1/media/${pk}/info/`, { headers: igHeaders() });
    if (!res.ok) return "";
    const data = await res.json().catch(() => null);
    return data?.items?.[0]?.user?.username || "";
  } catch {
    return "";
  }
}

function edgeText(node) {
  return node?.edge_media_to_caption?.edges?.[0]?.node?.text || "";
}

export async function fetchClientProfile(username, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { headers: igHeaders() }
    );
    const txt = await res.text();
    if (!res.ok) return { ok: false, error: `Instagram ${res.status}: ${txt.slice(0, 160)}` };
    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      return { ok: false, error: "Instagram respondió sin JSON (pide login)" };
    }
    const user = data?.data?.user;
    if (!user) return { ok: false, error: "Perfil no disponible sin login" };
    const edges = user.edge_owner_to_timeline_media?.edges || [];
    const posts = edges.map(({ node }) => ({
      id: node.id,
      key: node.shortcode,
      url: `https://www.instagram.com/${username}/${node.is_video ? "reel" : "p"}/${node.shortcode}`,
      at: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : "",
      caption: edgeText(node),
      likes: node.edge_liked_by?.count ?? node.edge_media_preview_like?.count ?? null,
      commentsCount: node.edge_media_to_comment?.count ?? null,
      previewComments: (node.edge_media_to_comment?.edges || node.edge_media_preview_comment?.edges || []).map(
        ({ node: c }) => ({ user: c.owner?.username || "", text: c.text || "", at: c.created_at ? new Date(c.created_at * 1000).toISOString() : "" })
      ),
      isVideo: Boolean(node.is_video),
      pinned: Array.isArray(node.pinned_for_users) && node.pinned_for_users.length > 0,
    }));
    return { ok: true, username, fullName: user.full_name || "", followers: user.edge_followed_by?.count ?? null, posts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Comentarios de un post (sin login). Instagram suele pedir sesión; si es así se informa. */
export async function fetchPostComments(mediaId, { fetchImpl = fetch, max = 50 } = {}) {
  try {
    const res = await fetchImpl(
      `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`,
      { headers: igHeaders() }
    );
    const txt = await res.text();
    let data = null;
    try {
      data = JSON.parse(txt);
    } catch {
      /* HTML de login */
    }
    if (!res.ok || !data || data.require_login || data.status === "fail") {
      return { ok: false, error: data?.message || `Instagram ${res.status} (requiere sesión)`, comments: [] };
    }
    const comments = (data.comments || []).slice(0, max).map((c) => ({
      user: c.user?.username || "",
      text: c.text || "",
      at: c.created_at ? new Date(c.created_at * 1000).toISOString() : "",
      likes: c.comment_like_count ?? 0,
    }));
    return { ok: true, comments, total: data.comment_count ?? comments.length };
  } catch (e) {
    return { ok: false, error: e.message, comments: [] };
  }
}

/** Último post del cliente (no fijado) + comentarios. */
export async function fetchClientLatest(username, { fetchImpl = fetch } = {}) {
  const profile = await fetchClientProfile(username, { fetchImpl });
  if (!profile.ok) return { ok: false, error: profile.error, postKeys: [] };
  const sorted = [...profile.posts].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const latest = sorted.find((p) => !p.pinned) || sorted[0] || null;
  let comments = { ok: false, comments: [], error: "sin post" };
  if (latest) {
    comments = await fetchPostComments(latest.id, { fetchImpl });
    if (!comments.ok && latest.previewComments.length) {
      comments = { ok: true, comments: latest.previewComments, partial: true, error: comments.error };
    }
  }
  return {
    ok: true,
    username,
    latest,
    comments,
    postKeys: profile.posts.map((p) => p.key),
  };
}

// ─────────────────────────────────────────────────────────────
// Consultas (según lo que cada motor acepta — ver diagnostico.mjs)
//  · Tavily: texto libre + include_domains instagram.com + time_range week  ✔ mejor fuente
//  · Serper (plan gratis): SIN site:, inurl: ni comillas → "instagram INTRANT" + tbs=qdr:w  ✔
//  · Brave: site:/cuenta y OR con paréntesis devuelven 0; freshness mata resultados.
//           Se usa sin filtro de fecha y solo se aceptan posts con fecha reciente.
// ─────────────────────────────────────────────────────────────

export function buildQueries({ accounts = [], perAccount = false }) {
  // Solo dos búsquedas por motor: INTRANT y Juan Manuel Mendez (sin acento).
  const tavily = [{ q: "INTRANT" }, { q: "Juan Manuel Mendez" }];
  if (perAccount) for (const a of accounts) tavily.push({ q: `${a} INTRANT OR Juan Manuel Mendez`, account: a });
  const serper = [{ q: "instagram INTRANT" }, { q: "instagram Juan Manuel Mendez" }];
  const brave = [{ q: "instagram INTRANT" }, { q: "instagram Juan Manuel Mendez" }];
  return [
    ...tavily.map((x) => ({ ...x, engine: "Tavily", fresh: true })),
    ...serper.map((x) => ({ ...x, engine: "Serper", fresh: true })),
    ...brave.map((x) => ({ ...x, engine: "Brave", fresh: false })),
  ];
}

// ─────────────────────────────────────────────────────────────
// Búsqueda completa
// ─────────────────────────────────────────────────────────────

/**
 * @param {{ now?: Date, onStatus?: (m:string)=>void, fetchImpl?: typeof fetch, settings?: object }} opts
 * @returns {Promise<{ items: object[], raw: object[], stats: object, errors: object[] }>}
 */
export async function searchInstagram({
  now = new Date(),
  onStatus,
  fetchImpl = fetch,
  settings = igSettings(),
} = {}) {
  const { terms, serperKey, braveKey, tavilyKey = "", days, braveDelayMs } = settings;
  const excluded = new Set((settings.excludeAccounts || []).map((a) => a.toLowerCase()));
  if (!serperKey && !braveKey && !tavilyKey) {
    throw new Error("Falta TAVILY_API_KEY, SERPER_API_KEY o BRAVE_API_KEY en .env");
  }
  const keys = { Tavily: tavilyKey, Serper: serperKey, Brave: braveKey };
  const todayYmd = ymdLocal(now);
  const queries = buildQueries(settings).filter((x) => keys[x.engine]);
  const errors = [];
  const stats = { queries: queries.length, tavily: 0, serper: 0, brave: 0, rawHits: 0, fueraDeVentana: 0, sinTermino: 0, sinFecha: 0, cuentaPropia: 0 };
  const raw = [];
  let lastBraveAt = 0;

  for (const { engine, q, fresh } of queries) {
    let hits = [];
    try {
      if (engine === "Tavily") {
        hits = await searchTavily(q, { key: tavilyKey, fetchImpl, days: Math.max(days, 1) });
      } else if (engine === "Serper") {
        hits = await searchSerper(q, { key: serperKey, fetchImpl, days });
      } else {
        const wait = braveDelayMs - (Date.now() - lastBraveAt);
        if (wait > 0) await sleep(wait);
        hits = await searchBrave(q, { key: braveKey, fetchImpl });
        lastBraveAt = Date.now();
      }
      stats[engine.toLowerCase()]++;
    } catch (e) {
      errors.push({ query: q, engine, error: e.message });
    }
    onStatus?.(`🔎 ${engine.padEnd(6)} ${q} → ${hits.length}`);
    for (const h of hits) raw.push({ ...h, fresh });
  }
  stats.rawHits = raw.length;

  // Filtrar + deduplicar por código del post
  const byKey = new Map();
  for (const h0 of raw) {
    if (!isContentUrl(h0.url)) continue;
    // Tavily a veces devuelve texto de OTRAS publicaciones de la página (posts viejos alrededor).
    // Solo se confía en su texto si coincide con el título real del post; si no, se usa solo el título.
    const coherent = h0.engine !== "Tavily" || textMatchesTitle(h0.title, h0.text);
    if (!coherent) stats.textoDescartado = (stats.textoDescartado || 0) + 1;
    const h = coherent ? h0 : { ...h0, text: "" };
    const found = termsFound(`${h.title} ${h.text}`, terms);
    if (!found.length) {
      stats.sinTermino++;
      continue;
    }
    if (!isRelevantDR(`${h.title} ${h.text}`)) {
      stats.noRelevante = (stats.noRelevante || 0) + 1;
      continue;
    }
    const postedAt = shortcodeDate(postKey(h.url));
    // Regla 24 h: hora exacta del post (código /p/…) dentro de las últimas 24 h; sin hora → fuera
    if (settings.strict24h !== false && !isFresh(postedAt, now)) {
      stats.fueraDeVentana++;
      continue;
    }
    const at = postedAt ? ymdLocal(postedAt) : parseAge(h.age, now);
    if (at && !inWindow(at, todayYmd, days)) {
      stats.fueraDeVentana++;
      continue;
    }
    // Motor sin filtro de fecha (Brave) y sin fecha conocida → podría ser viejo: descartar
    if (!at && !h.fresh) {
      stats.sinFecha++;
      continue;
    }
    const key = postKey(h.url);
    const prev = byKey.get(key);
    if (prev) {
      for (const t of found) if (!prev.terms.includes(t)) prev.terms.push(t);
      if (!prev.engines.includes(h.engine)) prev.engines.push(h.engine);
      if (!prev.at && at) prev.at = at;
      if (!prev.account) prev.account = detectAccount(h.url, h.title, "");
      if (h.text.length > prev.text.length) prev.text = h.text;
      continue;
    }
    byKey.set(key, {
      key,
      url: h.url,
      account: detectAccount(h.url, h.title, ""),
      title: h.title,
      text: h.text,
      type: contentType(h.url),
      at,
      postedAt: postedAt ? postedAt.toISOString() : "",
      terms: found,
      engines: [h.engine],
    });
  }

  // Con sesión: dueño real de los posts sin cuenta (pausado, máx. 40 por corrida)
  if (hasIgSession() && settings.resolveOwners === true) {
    const pending = [...byKey.values()].filter((p) => !p.account).slice(0, 40);
    let resolved = 0;
    for (const p of pending) {
      const owner = await fetchMediaOwner(p.key, { fetchImpl });
      if (owner) {
        p.account = owner;
        resolved++;
      }
      await sleep(1200);
    }
    stats.duenoResuelto = resolved;
    stats.duenoPendiente = pending.length - resolved;
    if (pending.length) onStatus?.(`👤 Dueño identificado (con sesión) en ${resolved}/${pending.length} posts`);
  }

  // Posts propios del cliente (lista pública de su perfil) → se excluyen aunque el buscador no diga la cuenta
  const ownKeys = new Set(settings.clientPostKeys || []);
  for (const [k, p] of byKey) {
    if (ownKeys.has(k)) {
      p.account = p.account || settings.clientAccount || "intrant_rd";
    }
  }

  // Excluir publicaciones de la cuenta propia (se decide al final: la cuenta puede venir de otro motor)
  for (const [k, p] of byKey) {
    if (p.account && excluded.has(p.account.toLowerCase())) {
      byKey.delete(k);
      stats.cuentaPropia++;
    }
  }

  const items = [...byKey.values()].map(toReporteItem);
  items.sort((a, b) => rank(b) - rank(a) || String(b.at).localeCompare(String(a.at)));
  return { items, raw, stats, errors };
}

function rank(it) {
  return (it.mendez ? 2 : 0) + (it.relevance === "alta" ? 1 : 0);
}

/** Misma forma que item() de src/intrant-report-sources.mjs → listo para el REPORTE. */
export function toReporteItem(p) {
  const blob = `${p.title} ${p.text}`;
  const mendez = /juan manuel mendez/.test(norm(blob));
  const intrant = /\bintrant/.test(norm(blob));
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const caption = clean(p.text) || clean(p.title);
  const medioTag = mediaFromText(blob);
  const hora = p.postedAt
    ? new Date(p.postedAt).toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo", hour: "numeric", minute: "2-digit" })
    : "";
  return {
    source: "instagram",
    medio: p.account ? `@${p.account}` : medioTag || "Instagram",
    medioNombre: medioTag,
    hora,
    title: cleanHeadline(p.title, p.text) || "Publicación Instagram",
    summary: caption.slice(0, 220),
    relevance: mendez || intrant ? "alta" : "media",
    url: p.url,
    videoUrl: p.url,
    at: p.at || "",
    term: (p.terms[0] || "").toLowerCase(),
    tono: "",
    mediaType: p.type === "reel" || p.type === "video" ? "video" : "",
    mediaKind: p.type,
    txtUrl: "",
    archivo: "",
    puntos: "",
    relevanciaRaw: "",
    // extra (el reporte los ignora)
    key: p.key,
    terms: p.terms,
    engines: p.engines,
    mendez,
    via: "busqueda-instagram",
    postedAt: p.postedAt || "",
  };
}
