/**
 * Monitor de noticias oficiales en https://intrant.gob.do/noticias/
 * Si hay nueva → corre el mismo flujo que /busca (Tavily + Brave + correo estilizado).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { mergeFixedCc, sendEmail } from "./informe-email.mjs";
import { searchHeadlineSources } from "./headline-search.mjs";

const LIST_URL = "https://intrant.gob.do/noticias/";
const STATE_FILE = join(config.root, ".intrant-site-news-seen.json");
const UA = "Mozilla/5.0 (compatible; AsistenteWP/2.5; +https://fvdigital.do)";

const MONTHS = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

function decodeHtml(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function canonUrl(url = "") {
  try {
    const u = new URL(url);
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.origin}${path}`.toLowerCase();
  } catch {
    return String(url || "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

function parseDateLabel(label = "") {
  const m = String(label)
    .trim()
    .match(/^(\d{1,2})\s+([A-Za-záéíóúñ]+)\s+(\d{4})$/i);
  if (!m) return { dateLabel: label, dateYmd: "" };
  const day = Number(m[1]);
  const monKey = m[2]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .slice(0, 3)
    .toLowerCase();
  const month = MONTHS[monKey];
  const year = Number(m[3]);
  if (!month || !day || !year) return { dateLabel: label, dateYmd: "" };
  const dateYmd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { dateLabel: label.trim(), dateYmd };
}

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return { seen: {}, seededAt: null, lastCheckAt: null };
  }
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return {
      seen: raw.seen && typeof raw.seen === "object" ? raw.seen : {},
      seededAt: raw.seededAt || null,
      lastCheckAt: raw.lastCheckAt || null,
    };
  } catch {
    return { seen: {}, seededAt: null, lastCheckAt: null };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return res.text();
}

/**
 * Lista noticias del archivo oficial (más reciente primero).
 */
export async function fetchIntrantNewsList() {
  const html = await fetchHtml(config.intrantSiteNews?.url || LIST_URL);
  const items = [];
  const re =
    /<a\s+class="enlace-noticia-grid"\s+href="([^"]+)"[^>]*>[\s\S]*?<div\s+class="news-card-archive"[^>]*(?:style="[^"]*url\('([^']+)'\)[^"]*")?[^>]*>[\s\S]*?<div\s+class="news-date-archive">([^<]*)<\/div>[\s\S]*?<div\s+class="news-title-archive">([^<]*)<\/div>/gi;

  let m;
  while ((m = re.exec(html))) {
    const url = m[1].trim();
    const imageUrl = m[2] || "";
    const dateRaw = decodeHtml(m[3] || "");
    const title = decodeHtml(m[4] || "");
    if (!url || !title) continue;
    const { dateLabel, dateYmd } = parseDateLabel(dateRaw);
    items.push({
      id: canonUrl(url),
      title,
      url: url.replace(/\/+$/, "") + "/",
      dateLabel,
      dateYmd,
      imageUrl,
    });
  }

  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  out.sort((a, b) => {
    if (a.dateYmd && b.dateYmd && a.dateYmd !== b.dateYmd) {
      return b.dateYmd.localeCompare(a.dateYmd);
    }
    return 0;
  });
  return out;
}

export function resolveIntrantSiteNewsRecipients() {
  const base = String(config.informes.emailIntrant || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const extra = String(
    config.intrantSiteNews?.extraTo || "autosemana@gmail.com"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const toSet = new Set();
  for (const e of [...base, ...extra]) toSet.add(e.toLowerCase());
  const to = [...toSet].join(", ");
  if (!to) {
    throw new Error("Falta INFORME_EMAIL_INTRANT o INTRANT_SITE_NEWS_EXTRA_TO");
  }

  const cc = mergeFixedCc(
    config.informes.emailIntrantCc || "belgicajr@gmail.com"
  );
  return { to, cc };
}

/**
 * Detecta noticia nueva en el sitio y ejecuta /busca (Tavily + Brave + mismo correo).
 *
 * @param {{ dryRun?: boolean, forceSendAll?: boolean, forceLatest?: boolean, toOverride?: string, skipCc?: boolean, onStatus?: (msg: string) => void }} [opts]
 */
export async function runIntrantSiteNewsCheck({
  dryRun = false,
  forceSendAll = false,
  forceLatest = false,
  toOverride = "",
  skipCc = false,
  onStatus,
} = {}) {
  onStatus?.("📥 Leyendo intrant.gob.do/noticias/…");
  const list = await fetchIntrantNewsList();
  if (!list.length) {
    throw new Error("No se pudo parsear el listado de noticias del INTRANT");
  }

  const latest = list[0];
  const state = loadState();
  const isFirstRun = !state.seededAt || Object.keys(state.seen).length === 0;

  let newItems = list.filter((item) => !state.seen[item.id]);

  if ((isFirstRun || forceLatest) && !forceSendAll) {
    newItems = latest ? [latest] : [];
  } else if (forceSendAll) {
    newItems = [...list];
  }

  newItems.sort((a, b) => {
    if (a.dateYmd && b.dateYmd && a.dateYmd !== b.dateYmd) {
      return b.dateYmd.localeCompare(a.dateYmd);
    }
    return 0;
  });

  const nowIso = new Date().toISOString();
  state.lastCheckAt = nowIso;

  if (!newItems.length) {
    if (!dryRun) saveState(state);
    onStatus?.(`✅ Sin noticias nuevas (última: «${latest?.title || "—"}»).`);
    return {
      seeded: false,
      sent: false,
      newCount: 0,
      listCount: list.length,
      latest,
      items: [],
      dryRun,
    };
  }

  // Igual que /busca: titular oficial → Tavily + Brave → correo estilizado
  const primary = newItems[0];
  onStatus?.(
    `🆕 Titular oficial: «${primary.title}» → mismo flujo /busca…`
  );
  onStatus?.(`📌 Nota oficial: ${primary.url}`);

  const busca = await searchHeadlineSources(primary.title, {
    send: false,
    draftEmail: true,
    onStatus,
  });

  const recipients = toOverride
    ? { to: String(toOverride).trim(), cc: "" }
    : resolveIntrantSiteNewsRecipients();

  let sent = null;
  if (!dryRun) {
    onStatus?.(
      toOverride
        ? `📤 Enviando /busca → ${recipients.to}…`
        : "📤 Enviando /busca a Intrant + autosemana (CC belgicajr)…"
    );
    const payload = {
      to: recipients.to,
      subject: busca.email.subject,
      html: busca.email.html,
      text: [
        `Fuente oficial INTRANT (${primary.dateLabel || "—"}):`,
        primary.url,
        "",
        busca.email.text,
      ].join("\n"),
    };
    // Prefijo en HTML: banner con URL oficial
    payload.html = String(busca.email.html || "").replace(
      /(FGJ Medios · Localización de titular)/,
      `$1 · desde sitio oficial`
    );
    if (!toOverride && recipients.cc) payload.cc = recipients.cc;
    sent = await sendEmail(payload);

    if (isFirstRun || forceLatest) {
      for (const item of list) {
        state.seen[item.id] = { title: item.title, at: nowIso };
      }
      state.seededAt = state.seededAt || nowIso;
    } else {
      for (const item of newItems) {
        state.seen[item.id] = { title: item.title, at: nowIso };
      }
      if (!state.seededAt) state.seededAt = nowIso;
    }
    saveState(state);
  }

  return {
    seeded: isFirstRun,
    sent: Boolean(sent),
    newCount: newItems.length,
    listCount: list.length,
    latest: primary,
    items: newItems,
    busca,
    email: busca.email,
    recipients,
    mailResult: sent,
    dryRun,
  };
}

export function formatIntrantSiteNewsResult(result) {
  if (!result.newCount) {
    return `Sin noticias nuevas en intrant.gob.do (${result.listCount} en listado).\nÚltima en sitio: ${result.latest?.title || "—"}`;
  }
  const hits = result.busca?.hits?.length ?? 0;
  const lines = [
    `🆕 Nota oficial → /busca (Tavily + Brave)`,
    `Titular: ${result.latest?.title || "—"}`,
    result.latest?.url ? `Oficial: ${result.latest.url}` : "",
    `Hallazgos medios: ${hits}`,
    result.dryRun
      ? "(dry-run — no enviado)"
      : result.sent
        ? "✅ Correo /busca enviado"
        : "",
    result.recipients
      ? `TO: ${result.recipients.to}\nCC: ${result.recipients.cc || "—"}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}
