/**
 * Reporte por canal (Instagram / X) con el mismo estilo del REPORTE ejecutivo Intrant:
 * resumen ejecutivo (DeepSeek) + tarjetas de menciones + destinatarios Intrant.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.mjs";
import { deepseekChat } from "./deepseek.mjs";
import { mergeFixedCc } from "./informe-email.mjs";
import { markdownToEmailHtml } from "./intrant-report-brief.mjs";
import { inferSentiment } from "./intrant-report-pdf.mjs";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function displayDateDR(d = new Date()) {
  const p = new Intl.DateTimeFormat("es-DO", {
    timeZone: "America/Santo_Domingo",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (t) => Number(p.find((x) => x.type === t)?.value);
  return `${get("day")} de ${MESES[get("month") - 1]} de ${get("year")}`;
}

export function horaDR(d = new Date()) {
  return new Date(d).toLocaleTimeString("es-DO", {
    timeZone: "America/Santo_Domingo",
    hour: "numeric",
    minute: "2-digit",
  });
}

function esc(v = "") {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// ─────────────────────────────────────────────────────────────
// Íconos de redes (PNG oficiales en assets/redes/*.png, incrustados por CID)
// ─────────────────────────────────────────────────────────────

const NETWORK = {
  instagram: { file: "instagram.png", label: "Instagram", bg: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)", solid: "#C13584" },
  x: { file: "x.png", label: "X", bg: "#000000", solid: "#000000" },
  twitter: { file: "x.png", label: "X", bg: "#000000", solid: "#000000" },
  youtube: { file: "youtube.png", label: "YouTube", bg: "#FF0000", solid: "#FF0000" },
  facebook: { file: "facebook.png", label: "Facebook", bg: "#1877F2", solid: "#1877F2" },
};

function iconPath(net) {
  const n = NETWORK[net];
  if (!n) return "";
  const p = join(config.root, "assets", "redes", n.file);
  return existsSync(p) ? p : "";
}

/** <img cid> si existe el PNG oficial; si no, etiqueta de color con el nombre (sin logos dibujados). */
export function networkIconHtml(net, size = 22) {
  const n = NETWORK[net];
  if (!n) return "";
  if (iconPath(net)) {
    return `<img src="cid:icon-${net === "twitter" ? "x" : net}" alt="${esc(n.label)}" width="${size}" height="${size}" style="vertical-align:middle;border:0;display:inline-block;">`;
  }
  return `<span style="display:inline-block;vertical-align:middle;padding:3px 9px;border-radius:6px;background:${n.solid};background-image:${n.bg.startsWith("linear") ? n.bg : "none"};color:#fff;font-size:11px;font-weight:800;font-family:Arial,sans-serif;">${esc(n.label)}</span>`;
}

/** Adjuntos inline (CID) para los íconos usados en un correo. */
export function iconAttachments(nets = []) {
  const out = [];
  const seen = new Set();
  for (const raw of nets) {
    const net = raw === "twitter" ? "x" : raw;
    if (seen.has(net)) continue;
    seen.add(net);
    const p = iconPath(net);
    if (p) out.push({ filename: NETWORK[net].file, path: p, cid: `icon-${net}`, contentDisposition: "inline" });
  }
  return out;
}

/** Bloquea el envío si alguna publicación no tiene hora o supera 24 h (regla de frescura). */
export function assertAllFresh(items = [], now = new Date(), hours = Number(process.env.MAX_AGE_HOURS) || 24) {
  const bad = items.filter((it) => {
    const t = new Date(it.publishedAt || it.postedAt || "").getTime();
    return !Number.isFinite(t) || now.getTime() - t > hours * 3600000;
  });
  if (bad.length) {
    throw new Error(`Frescura: ${bad.length} publicación(es) sin hora o con más de ${hours} h (${bad.slice(0, 3).map((b) => b.url).join(", ")}). No se envía.`);
  }
}

/** Fecha corta d/m/aaaa en hora dominicana (como el boletín). */
export function shortDateDR(d = new Date()) {
  return new Intl.DateTimeFormat("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "numeric", year: "numeric" }).format(d);
}

/** Hora (0–23) dominicana de una fecha. */
export function hourDR(d) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Santo_Domingo", hour: "numeric", hour12: false }).format(d)) % 24;
}

/** Destinatarios registrados del Intrant (igual que el REPORTE general). */
export function intrantRecipients() {
  const to = String(config.informes.emailIntrant || "").trim();
  if (!to) throw new Error("Configura INFORME_EMAIL_INTRANT en .env");
  return { to, cc: mergeFixedCc(config.informes.emailIntrantCc) };
}

const TONE = {
  positivo: { label: "FAVORABLE", bg: "#16a34a" },
  negativo: { label: "CRÍTICA", bg: "#dc2626" },
  neutro: { label: "NEUTRAL", bg: "#64748b" },
};

export function withTone(items = []) {
  return items.map((it) => ({ ...it, sentiment: it.sentiment || inferSentiment(it) }));
}

export function toneCounts(items = []) {
  const c = { positivo: 0, negativo: 0, neutro: 0 };
  for (const it of items) c[it.sentiment || "neutro"]++;
  return c;
}

const CHANNEL_SYSTEM = `Eres analista senior de inteligencia reputacional para el INTRANT (República Dominicana).
Recibirás publicaciones de UNA red social (Instagram o X) de un período corto.
Escribe un RESUMEN EJECUTIVO breve en markdown, en español, con esta estructura exacta:

**Panorama:** una frase (máx. 2 líneas) sobre el comportamiento de la conversación.

Luego 2 a 4 párrafos cortos: qué se dijo, temas dominantes, quién lo dijo (medios, comunicadores, ciudadanos), tono general. Si hay cobertura sobre **Juan Manuel Méndez**, va en el primer párrafo.

**Atención:** 1 a 3 viñetas con lo que la Dirección debe saber o vigilar (quejas, críticas, oportunidades). Si no hay nada relevante, escribe "Sin alertas en este corte."

Contexto fijo: el director ejecutivo ACTUAL del INTRANT es **Juan Manuel Méndez** (recién designado); **Milton Morrison** es el director ANTERIOR. Si el material menciona a Morrison, trátalo como exdirector (p. ej. memorias de su gestión).

Reglas: no inventes nada que no esté en el material; no uses términos técnicos (API, scraper, dataset, Tavily, Serper, Brave, RapidAPI); negritas solo para nombres propios e instituciones; nada de preámbulos.`;

/** Resumen ejecutivo del canal con DeepSeek; si falla, resumen determinístico. */
export async function summarizeChannel({ channel, items = [], periodLabel = "", extra = "", onStatus } = {}) {
  const tones = toneCounts(items);
  const fallback = () => {
    if (!items.length) return `**Panorama:** sin publicaciones sobre el INTRANT en ${channel} en este corte.`;
    const top = items.slice(0, 3).map((it) => `- ${it.medio}: ${it.title}`).join("\n");
    return `**Panorama:** ${items.length} publicaciones en ${channel} (${tones.positivo} favorables, ${tones.negativo} críticas, ${tones.neutro} neutrales).\n\n${top}`;
  };
  if (!items.length && !extra) return fallback();
  if (!config.deepseek?.apiKey) return fallback();

  const lines = items.slice(0, 40).map(
    (it, i) =>
      `${i + 1}. [${it.medio}] (${it.hora || it.at || ""}) tono estimado: ${it.sentiment} — ${it.title}\n   ${String(it.summary || "").slice(0, 400)}\n   ${it.url}`
  );
  const user = `Red social: ${channel}
Período: ${periodLabel}
Total de publicaciones: ${items.length} (favorables ${tones.positivo}, críticas ${tones.negativo}, neutrales ${tones.neutro})
${extra ? `\n${extra}\n` : ""}
Publicaciones:
${lines.join("\n") || "(ninguna)"}`;

  try {
    onStatus?.(`Redactando resumen ejecutivo de ${channel}…`);
    const { content } = await deepseekChat([{ role: "user", content: user }], {
      system: CHANNEL_SYSTEM,
      temperature: 0.3,
      thinking: false,
    });
    return String(content || "").trim() || fallback();
  } catch (e) {
    onStatus?.(`⚠️ Resumen IA no disponible (${e.message}); uso resumen básico.`);
    return fallback();
  }
}

/**
 * Encabezado de indicadores (estilo boletín): título, subtítulo, línea naranja y rejilla 4×2 de KPIs.
 * @param {{ title:string, subtitle:string, tiles:{value:any,label:string}[] }} o
 */
export function renderKpiHeader({ title, subtitle, tiles = [], network = "" }) {
  const fmt = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : v ?? "—");
  const cell = (t) => `<td width="25%" style="background:#D9E6EE;border:3px solid #ffffff;padding:14px 6px;text-align:center;vertical-align:middle;">
      <div style="font-size:24px;font-weight:700;color:#1B4F6B;line-height:1.1;">${esc(String(fmt(t.value)))}</div>
      <div style="font-size:12px;color:#334155;margin-top:8px;">${esc(t.label)}</div>
    </td>`;
  const rows = [];
  for (let i = 0; i < tiles.length; i += 4) rows.push(`<tr>${tiles.slice(i, i + 4).map(cell).join("")}</tr>`);
  return `<div style="background:#ffffff;padding:20px 20px 16px;border-radius:14px 14px 0 0;border:1px solid #e2e8f0;border-bottom:0;">
    <div style="font-size:22px;font-weight:700;color:#1B4F6B;font-family:Arial,Helvetica,sans-serif;">${network ? `${networkIconHtml(network, 26)}&nbsp; ` : ""}${esc(title)}</div>
    <div style="font-size:13px;font-style:italic;color:#475569;margin-top:6px;">${esc(subtitle)}</div>
    <div style="height:3px;background:#F26B21;margin:12px 0 0;"></div>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:0;">${rows.join("")}</table>
  </div>`;
}

/**
 * URL de la fuente en texto visible (obligatorio en los correos de redes):
 * se imprime siempre, además del botón "Ver publicación / Ver post / Ver video".
 * Si la publicación no trae enlace, lo dice en vez de omitir la línea.
 */
export function sourceUrlHtml(url = "", accent = "#0f172a") {
  const clean = String(url || "").trim();
  const body = clean
    ? `<a href="${esc(clean)}" style="color:${accent};font-weight:600;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${esc(clean)}</a>`
    : `<span style="color:#94a3b8;">no disponible en este corte</span>`;
  return `<p style="margin:8px 0 0;font-size:11px;line-height:1.55;color:#475569;word-break:break-all;overflow-wrap:anywhere;">
          <b style="color:#0f172a;">URL de la fuente:</b> ${body}
        </p>`;
}

function card(it, i, accent) {
  const t = TONE[it.sentiment] || TONE.neutro;
  const mendez = /juan manuel (rafael )?m[eé]ndez/i.test(`${it.title} ${it.summary}`)
    ? `<span style="display:inline-block;margin-left:6px;padding:3px 8px;border-radius:999px;background:#F59E0B;color:#111827;font-size:10px;font-weight:800;">Juan Manuel Méndez</span>`
    : "";
  const kind = it.mediaKind === "reel" ? "Reel" : it.mediaKind === "video" ? "Video" : it.source === "x" ? "Post en X" : "Post";
  const summary = it.summary && it.summary !== it.title ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#334155;">${esc(it.summary)}</p>` : "";
  return `<tr><td style="padding:0 0 12px;">
    <table width="100%" cellspacing="0" cellpadding="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
      <tr><td style="padding:14px 16px;border-left:4px solid ${accent};">
        <p style="margin:0 0 8px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">#${i + 1} · ${esc(kind)} · ${esc(it.hora || it.at || "")}${mendez}</p>
        <p style="margin:0 0 8px;">
          ${it.source ? `${networkIconHtml(it.source, 16)}&nbsp;` : ""}<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${accent};color:#ffffff !important;font-size:11px;font-weight:800;">${esc(it.medio || "")}</span>
          &nbsp;<span style="display:inline-block;background:${t.bg};color:#fff;font-size:10px;font-weight:700;letter-spacing:.03em;padding:3px 8px;border-radius:999px;">${t.label}</span>
        </p>
        <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#0f172a;line-height:1.35;">${esc(it.title || "")}</p>
        ${summary}
        ${it.metrics ? `<p style="margin:8px 0 0;font-size:12px;color:#475569;">${esc(it.metrics)}</p>` : ""}
        ${it.url ? `<p style="margin:10px 0 0;"><a href="${esc(it.url)}" style="color:${accent};font-weight:700;text-decoration:none;">Ver publicación →</a></p>` : ""}
        ${sourceUrlHtml(it.url, accent)}
      </td></tr>
    </table>
  </td></tr>`;
}

/**
 * Correo con el look del REPORTE ejecutivo (cabecera navy + KPIs + cuerpo blanco).
 * @param {{ channel:string, accent:string, displayDate:string, periodLabel:string, summaryMd:string,
 *           items:object[], topBlockHtml?:string, sectionTitle?:string, footer?:string }} o
 */
export function renderChannelEmail({
  channel,
  accent = "#7C3AED",
  displayDate,
  periodLabel = "",
  summaryMd = "",
  items = [],
  topBlockHtml = "",
  sectionTitle = "",
  footer = "",
  kpiHeader = null,
}) {
  const tones = toneCounts(items);
  const kpi = (value, label, bg) => `<div style="background:${bg};border-radius:10px;padding:10px 12px;min-width:86px;display:inline-block;margin:0 8px 8px 0;">
      <div style="font-size:20px;font-weight:700;color:#fff;">${esc(String(value))}</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.75);margin-top:2px;text-transform:uppercase;letter-spacing:0.04em;">${esc(label)}</div>
    </div>`;
  const listHtml = items.length
    ? `<table width="100%" cellspacing="0" cellpadding="0">${items.map((it, i) => card(it, i, accent)).join("")}</table>`
    : `<p style="color:#64748b;font-size:13px;">Sin publicaciones sobre el INTRANT en este corte.</p>`;

  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:780px;margin:0 auto;color:#0f172a;background:#F1F5F9;padding:12px;">
  ${kpiHeader ? renderKpiHeader(kpiHeader) : `<div style="background:linear-gradient(135deg,#0B1F3A 0%,#123056 55%,#1e3a5f 100%);border-radius:14px 14px 0 0;padding:22px 24px;color:#fff;">
    <div style="font-size:11px;letter-spacing:0.12em;color:#93C5FD;font-weight:700;">INTRANT · INTELIGENCIA REPUTACIONAL · ${esc(channel.toUpperCase())}</div>
    <div style="font-size:22px;font-weight:700;margin-top:8px;line-height:1.25;">Estado de ${esc(channel)}: conversación sobre el INTRANT</div>
    <div style="color:#CBD5E1;margin-top:8px;font-size:13px;">${esc(displayDate)}${periodLabel ? ` · ${esc(periodLabel)}` : ""}</div>
    <div style="margin-top:16px;">
      ${kpi(items.length, "Menciones", "#B91C1C")}
      ${kpi(tones.positivo, "Favorables", "#15803D")}
      ${kpi(tones.negativo, "Críticas", "#991B1B")}
      ${kpi(tones.neutro, "Neutrales", "#475569")}
    </div>
  </div>`}
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px;padding:8px 20px 22px;">
    <div style="margin:16px 0 8px;font-size:12px;font-weight:800;color:#0B1F3A;letter-spacing:.06em;text-transform:uppercase;">Resumen ejecutivo</div>
    ${markdownToEmailHtml(summaryMd)}
    ${topBlockHtml}
    <div style="margin:22px 0 12px;font-size:12px;font-weight:800;color:${accent};letter-spacing:.06em;text-transform:uppercase;">${esc(sectionTitle || `Menciones en ${channel}`)} (${items.length})</div>
    ${listHtml}
    ${footer ? `<p style="margin-top:20px;font-size:11px;color:#94a3b8;">${esc(footer)}</p>` : ""}
  </div>
</div>`;
}

export function channelEmailText({ subject, summaryMd, items }) {
  return [
    subject,
    "",
    summaryMd,
    "",
    ...items.map((it, i) => `${i + 1}. ${it.medio} (${it.hora || it.at || ""}) — ${it.title}\n   ${it.url}`),
  ].join("\n");
}
