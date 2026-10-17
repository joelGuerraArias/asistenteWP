/**
 * /busca — localiza un titular (Tavily + Brave, compara ambos) y envía correo.
 */
import { config } from "./config.mjs";
import { isTavilyEnabled, tavilyNewsSearch } from "./tavily.mjs";
import { deepseekChat } from "./deepseek.mjs";
import { sendEmail } from "./informe-email.mjs";

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

export function isBraveEnabled() {
  return Boolean(config.brave?.apiKey);
}

function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function medioFromHost(host = "") {
  if (!host) return "Medio digital";
  const map = {
    "listindiario.com": "Listín Diario",
    "diariolibre.com": "Diario Libre",
    "eldia.com.do": "El Día",
    "elnacional.com.do": "El Nacional",
    "hoy.com.do": "Periódico Hoy",
    "elcaribe.com.do": "El Caribe",
    "acento.com.do": "Acento",
    "cdn.com.do": "CDN",
    "n.com.do": "N Digital",
    "arecoa.com": "Arecoa",
    "proceso.com.do": "Proceso",
    "remolacha.net": "Remolacha",
    "intrant.gob.do": "INTRANT",
    "presidencia.gob.do": "Presidencia RD",
  };
  return map[host] || host;
}

function fold(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHit(raw, engine) {
  const url = String(raw.url || raw.link || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const title = String(raw.title || "").trim() || "(sin título)";
  const snippet = String(raw.content || raw.description || raw.snippet || "").trim();
  const host = hostFromUrl(url);
  return {
    engine,
    title,
    url,
    snippet: snippet.slice(0, 400),
    host,
    medio: medioFromHost(host),
  };
}

async function searchBrave(query, { count = 10 } = {}) {
  if (!isBraveEnabled()) return [];
  const u = new URL(BRAVE_URL);
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(Math.min(20, Math.max(1, count))));
  u.searchParams.set("search_lang", "es");
  u.searchParams.set("country", "ES");

  const res = await fetch(u.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": config.brave.apiKey,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brave ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const web = data.web?.results || data.results || [];
  return web
    .map((r) =>
      normalizeHit(
        {
          title: r.title,
          url: r.url,
          description: r.description,
        },
        "brave"
      )
    )
    .filter(Boolean);
}

async function searchTavily(query, { maxResults = 10 } = {}) {
  if (!isTavilyEnabled()) return [];
  const results = await tavilyNewsSearch(query, {
    maxResults,
    timeRange: "month",
    includeDomains: [],
  });
  return (results || [])
    .map((r) =>
      normalizeHit(
        {
          title: r.title,
          url: r.url,
          content: r.content || r.snippet,
        },
        "tavily"
      )
    )
    .filter(Boolean);
}

/** Corre ambas consultas por motor (libre + entre comillas) y deduplica. */
async function searchEngineBothQueries(engine, query) {
  const quoted = `"${query.replace(/"/g, "")}"`;
  if (engine === "tavily") {
    const [a, b] = await Promise.all([
      searchTavily(query).catch((e) => {
        console.warn("busca tavily:", e.message);
        return [];
      }),
      searchTavily(quoted).catch(() => []),
    ]);
    return mergeHits([a, b]).map((h) => ({
      ...h,
      engine: "tavily",
      engines: ["tavily"],
    }));
  }

  // Brave Free: 1 req/s — secuencial con pausa
  let a = [];
  let b = [];
  try {
    a = await searchBrave(query);
  } catch (e) {
    console.warn("busca brave:", e.message);
  }
  await new Promise((r) => setTimeout(r, 1100));
  try {
    b = await searchBrave(quoted);
  } catch (e) {
    console.warn("busca brave quoted:", e.message);
  }
  return mergeHits([a, b]).map((h) => ({
    ...h,
    engine: "brave",
    engines: ["brave"],
  }));
}

function urlKey(url = "") {
  return String(url)
    .replace(/#.*$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function mergeHits(lists = []) {
  const seen = new Map();
  const out = [];
  for (const list of lists) {
    for (const hit of list) {
      const key = urlKey(hit.url);
      if (seen.has(key)) {
        const existing = seen.get(key);
        const engine = hit.engine || hit.engines?.[0];
        if (engine && !existing.engines.includes(engine)) {
          existing.engines.push(engine);
        }
        if ((hit.snippet || "").length > (existing.snippet || "").length) {
          existing.snippet = hit.snippet;
        }
        continue;
      }
      const engines = hit.engines
        ? [...hit.engines]
        : hit.engine
          ? [hit.engine]
          : [];
      const row = { ...hit, engines };
      seen.set(key, row);
      out.push(row);
    }
  }
  return out;
}

function titleSimilarity(a, b) {
  const wa = new Set(fold(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(fold(b).split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / Math.max(wa.size, wb.size);
}

function scoreHit(hit, headline) {
  const hFold = fold(headline);
  const titleFold = fold(hit.title);
  const blob = fold(`${hit.title} ${hit.snippet}`);
  let s = 0;

  const sim = titleSimilarity(headline, hit.title);
  s += sim * 12;

  if (titleFold === hFold) s += 20;
  else if (titleFold.includes(hFold) || hFold.includes(titleFold)) s += 10;

  const words = hFold.split(" ").filter((w) => w.length > 3);
  let wordHits = 0;
  for (const w of words) {
    if (blob.includes(w)) wordHits += 1;
  }
  s += wordHits;

  if (hit.engines?.length > 1) s += 8;

  if (
    /\.do\b|listindiario|diariolibre|elnacional|eldia|cdn\.com|n\.com\.do|intrant\.gob|presidencia\.gob/i.test(
      hit.host
    )
  ) {
    s += 3;
  }

  if (/facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com/i.test(hit.host)) {
    s -= 4;
  }

  hit._score = Math.round(s * 10) / 10;
  return hit._score;
}

function compareAndRank(tavilyHits, braveHits, headline) {
  const merged = mergeHits([tavilyHits, braveHits]);
  for (const hit of merged) scoreHit(hit, headline);
  merged.sort((a, b) => (b._score || 0) - (a._score || 0));

  const both = merged.filter((h) => h.engines?.length > 1);
  const best = merged[0] || null;

  return {
    hits: merged,
    best,
    compare: {
      tavilyCount: tavilyHits.length,
      braveCount: braveHits.length,
      mergedCount: merged.length,
      confirmedByBoth: both.length,
      bestEngines: best?.engines || [],
      bestScore: best?._score ?? 0,
    },
  };
}

/**
 * @returns {Promise<{ headline, hits, best, enginesUsed, compare, email, sent? }>}
 */
export async function searchHeadlineSources(headline, { onStatus, send = false, draftEmail = true } = {}) {
  const q = String(headline || "").trim();
  if (!q) throw new Error("Indica un titular para /busca");

  const enginesUsed = [];
  const tasks = [];

  if (isTavilyEnabled()) {
    enginesUsed.push("Tavily");
    onStatus?.("🔎 Tavily (libre + exacto)…");
    tasks.push(searchEngineBothQueries("tavily", q));
  } else {
    tasks.push(Promise.resolve([]));
  }

  if (isBraveEnabled()) {
    enginesUsed.push("Brave");
    onStatus?.("🦁 Brave (libre + exacto)…");
    tasks.push(searchEngineBothQueries("brave", q));
  } else {
    tasks.push(Promise.resolve([]));
  }

  if (!enginesUsed.length) {
    throw new Error("Configura TAVILY_API_KEY y BRAVE_API_KEY en .env");
  }

  onStatus?.("⚖️ Comparando Tavily vs Brave…");
  const [tavilyHits, braveHits] = await Promise.all(tasks);
  const { hits, best, compare } = compareAndRank(tavilyHits, braveHits, q);

  let email = null;
  if (draftEmail || send) {
    onStatus?.("✉️ Redactando correo…");
    email = await draftSourceEmail(q, hits, enginesUsed, compare, best);
  }

  let sent = null;
  if (send) {
    onStatus?.("📤 Enviando correo…");
    sent = await sendBuscaEmail(email);
  }

  return { headline: q, hits, best, enginesUsed, compare, email, sent };
}

export async function sendBuscaEmail(email, { to, cc } = {}) {
  const dest = String(
    to || process.env.BUSCA_EMAIL_TO || "autosemana@gmail.com"
  ).trim();
  if (!dest) throw new Error("Falta destinatario para /busca");
  const payload = {
    to: dest,
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
  if (cc && String(cc).trim()) payload.cc = cc;
  return sendEmail(payload);
}

function medioBrand(hostOrName = "") {
  const key = fold(hostOrName);
  const brands = [
    { match: /listin|listindiario/, name: "Listín Diario", bg: "#1d4ed8" },
    { match: /diario.?libre|diariolibre/, name: "Diario Libre", bg: "#dc2626" },
    { match: /el.?dia|eldia/, name: "El Día", bg: "#ea580c" },
    { match: /nacional|elnacional/, name: "El Nacional", bg: "#111827" },
    { match: /\bhoy\b|hoy\.com/, name: "Hoy", bg: "#7c3aed" },
    { match: /caribe|elcaribe/, name: "El Caribe", bg: "#0369a1" },
    { match: /acento/, name: "Acento", bg: "#be123c" },
    { match: /\bcdn\b/, name: "CDN", bg: "#e11d48" },
    { match: /\bn digital\b|^n\.com|n\.com\.do/, name: "N Digital", bg: "#0ea5e9" },
    { match: /z101/, name: "Z101", bg: "#16a34a" },
    { match: /rcc/, name: "RCC", bg: "#0f766e" },
    { match: /nuevo.?diario|elnuevodiario/, name: "El Nuevo Diario", bg: "#1e3a8a" },
    { match: /noticentro/, name: "Noticentro", bg: "#b91c1c" },
    { match: /arecoa/, name: "Arecoa", bg: "#4338ca" },
    { match: /proceso/, name: "Proceso", bg: "#334155" },
    { match: /remolacha/, name: "Remolacha", bg: "#65a30d" },
    { match: /primicias/, name: "Primicias", bg: "#b45309" },
    { match: /intrant/, name: "INTRANT", bg: "#0f766e" },
    { match: /presidencia/, name: "Presidencia", bg: "#1e40af" },
  ];
  for (const b of brands) {
    if (b.match.test(key)) return { name: b.name, bg: b.bg, fg: "#ffffff" };
  }
  const palette = ["#0f766e", "#1d4ed8", "#b45309", "#7e22ce", "#be123c", "#0369a1"];
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  // Nombre corto: evita "primicias.net primicias.net"
  const shortName =
    String(hostOrName || "Medio")
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p, i, arr) => arr.findIndex((x) => fold(x) === fold(p)) === i)[0] ||
    "Medio";
  return { name: shortName, bg: palette[hash % palette.length], fg: "#ffffff" };
}

function scoreMeta(score = 0) {
  const s = Number(score) || 0;
  if (s >= 30) return { label: "Alta", bg: "#059669", bar: "#10b981", pct: 100 };
  if (s >= 18) return { label: "Buena", bg: "#0284c7", bar: "#38bdf8", pct: 78 };
  if (s >= 10) return { label: "Media", bg: "#d97706", bar: "#fbbf24", pct: 55 };
  return { label: "Baja", bg: "#64748b", bar: "#94a3b8", pct: 32 };
}

/** Pastilla con fondo de color: texto siempre blanco (Gmail autolinkea dominios en azul). */
function colorPill(label, bg, { upper = false, size = 11 } = {}) {
  const raw = String(label || "").trim();
  // ZWSP tras cada punto evita que Gmail convierta "medio.com" en <a> azul
  const safe = escapeHtml(raw).replace(/\./g, ".\u200B");
  const transform = upper ? "text-transform:uppercase;letter-spacing:.04em;" : "letter-spacing:.03em;";
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bg};color:#ffffff !important;font-size:${size}px;font-weight:800;${transform}mso-style-textfill-fill-color:#ffffff;"><font color="#ffffff" style="color:#ffffff !important;">${safe}</font></span>`;
}

function enginePills(engines = []) {
  const map = {
    tavily: { label: "Tavily", bg: "#4f46e5" },
    brave: { label: "Brave", bg: "#ea580c" },
  };
  return engines
    .map((e) => {
      const m = map[String(e).toLowerCase()] || { label: e, bg: "#475569" };
      return colorPill(m.label, m.bg, { upper: true, size: 10 });
    })
    .join("");
}

function hitCardHtml(hit, index) {
  const brand = medioBrand(`${hit.medio} ${hit.host}`);
  const score = scoreMeta(hit._score);
  const rank = index + 1;
  const both = (hit.engines || []).length > 1;
  const border = both ? "#10b981" : "#e2e8f0";
  const snippet = hit.snippet
    ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.45;color:#64748b;">${escapeHtml(hit.snippet.slice(0, 180))}${hit.snippet.length > 180 ? "…" : ""}</p>`
    : "";

  return `
  <tr>
    <td style="padding:0 0 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid ${border};border-radius:14px;overflow:hidden;">
        <tr>
          <td style="width:52px;background:${brand.bg};color:#ffffff !important;text-align:center;vertical-align:middle;font-size:18px;font-weight:800;padding:16px 8px;">
            <font color="#ffffff">#${rank}</font>
          </td>
          <td style="padding:14px 16px 12px;vertical-align:top;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="vertical-align:middle;">
                  ${colorPill(brand.name || hit.medio || hit.host, brand.bg)}
                  ${both ? `<span style="display:inline-block;margin-left:6px;padding:4px 8px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:10px;font-weight:700;">✓ Ambos motores</span>` : ""}
                </td>
                <td align="right" style="vertical-align:middle;white-space:nowrap;">
                  ${colorPill(Number(hit._score ?? 0).toFixed(1), score.bg, { size: 12 })}
                  <span style="display:inline-block;margin-left:4px;font-size:11px;color:#64748b;font-weight:600;">${score.label}</span>
                </td>
              </tr>
            </table>
            <p style="margin:10px 0 6px;font-size:15px;line-height:1.35;color:#0f172a;font-weight:700;">${escapeHtml(hit.title)}</p>
            <p style="margin:0 0 8px;font-size:11px;color:#94a3b8;">${escapeHtml(hit.host || "")}</p>
            <div style="height:6px;background:#f1f5f9;border-radius:999px;overflow:hidden;margin:0 0 10px;">
              <div style="height:6px;width:${score.pct}%;background:${score.bar};border-radius:999px;"></div>
            </div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="vertical-align:middle;">${enginePills(hit.engines)}</td>
                <td align="right" style="vertical-align:middle;">
                  <a href="${escapeHtml(hit.url)}" style="display:inline-block;padding:8px 14px;border-radius:10px;background:#0f766e;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;">Abrir nota →</a>
                </td>
              </tr>
            </table>
            <p style="margin:10px 0 0;font-size:11px;line-height:1.4;word-break:break-all;">
              <a href="${escapeHtml(hit.url)}" style="color:#0369a1;text-decoration:none;">${escapeHtml(hit.url)}</a>
            </p>
            ${snippet}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function buildBuscaEmailHtml({ headline, hits, enginesUsed, compare, best, intro }) {
  const dateLabel = new Date().toLocaleString("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const cards = hits.length
    ? hits.map((h, i) => hitCardHtml(h, i)).join("\n")
    : `<tr><td style="padding:28px;background:#fff;border:1px dashed #cbd5e1;border-radius:14px;text-align:center;color:#64748b;">Sin coincidencias en esta pasada.</td></tr>`;

  const kpi = (label, value, accent) => `
    <td width="33%" style="padding:6px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr>
          <td style="padding:12px 10px;text-align:center;">
            <div style="font-size:20px;font-weight:800;color:${accent};line-height:1.1;">${escapeHtml(String(value))}</div>
            <div style="margin-top:4px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700;">${escapeHtml(label)}</div>
          </td>
        </tr>
      </table>
    </td>`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;">
          <tr>
            <td style="background:#0f766e;border-radius:18px 18px 0 0;padding:28px 28px 22px;color:#fff;">
              <p style="margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.88;">FGJ Medios · Localización de titular</p>
              <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;font-weight:800;">¿Dónde se publicó?</h1>
              <p style="margin:0;font-size:15px;line-height:1.45;opacity:.95;font-weight:600;">«${escapeHtml(headline)}»</p>
              <p style="margin:12px 0 0;font-size:12px;opacity:.8;">${escapeHtml(dateLabel)} · Motores: ${escapeHtml((enginesUsed || []).join(" + ") || "—")}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;padding:18px 18px 6px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  ${kpi("Hallazgos", hits.length, "#0f766e")}
                  ${kpi("Ambos motores", compare?.confirmedByBoth ?? 0, "#059669")}
                  ${kpi("Mejor score", best?._score != null ? Number(best._score).toFixed(1) : "—", "#0284c7")}
                </tr>
              </table>
              <p style="margin:12px 8px 8px;font-size:13px;line-height:1.55;color:#334155;">${escapeHtml(intro).replaceAll("\n", "<br/>")}</p>
              ${
                best
                  ? `<p style="margin:0 8px 14px;padding:10px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;font-size:12px;color:#065f46;"><strong>Mejor coincidencia:</strong> ${escapeHtml(best.medio)} — ${escapeHtml(best.title)}</p>`
                  : ""
              }
              <p style="margin:0 8px 10px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;">Todas las ubicaciones · ordenadas por puntaje</p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 18px 18px;padding:8px 18px 18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${cards}
              </table>
              <p style="margin:6px 8px 8px;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center;">
                Correo automático FGJ Medios · /busca · Tavily + Brave contrastados<br/>
                Puntaje = similitud de titular + dominio RD + confirmación dual.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function draftSourceEmail(headline, hits, enginesUsed, compare, best) {
  const compareNote = compare
    ? `Se contrastaron Tavily (${compare.tavilyCount}) y Brave (${compare.braveCount}): ${compare.mergedCount} hallazgos unidos, ${compare.confirmedByBoth} confirmados por ambos motores.`
    : "";

  const listText = hits.length
    ? hits
        .map((h, i) => {
          const tag =
            h.engines.length > 1 ? "Tavily + Brave" : h.engines.join(", ");
          const score = Number(h._score ?? 0).toFixed(1);
          return `${i + 1}. [${score}] ${h.medio}\n   ${h.title}\n   ${h.url}\n   Motores: ${tag}`;
        })
        .join("\n\n")
    : "No se localizaron publicaciones coincidentes.";

  let subject = `📍 Titular localizado (${hits.length}) — ${headline.slice(0, 65)}`;
  let intro =
    "Buenas,\n\nLes comparto el monitoreo completo del titular: todas las URLs localizadas, con puntaje de coincidencia y motor de búsqueda.";

  if (config.deepseek?.apiKey) {
    try {
      const { content } = await deepseekChat(
        [
          {
            role: "user",
            content: `Redacta SOLO el asunto y un párrafo introductorio corto (2-3 oraciones) para un correo ejecutivo de monitoreo de medios en RD.

Titular: """${headline}"""
${compareNote}
Total URLs: ${hits.length}
Mejor: ${best ? `${best.medio} (score ${best._score})` : "ninguna"}

Responde SOLO JSON:
{"subject":"asunto corto con emoji opcional","intro":"párrafo intro en texto plano, sin lista de medios"}

Reglas: no listes URLs; di que el detalle completo va abajo con puntaje; tono institucional.`,
          },
        ],
        { json: true, temperature: 0.3, thinking: false }
      );
      const parsed = JSON.parse(content);
      if (parsed.subject) subject = String(parsed.subject);
      if (parsed.intro) intro = String(parsed.intro).trim();
    } catch (error) {
      console.warn("draftSourceEmail AI:", error.message);
    }
  }

  const text = [
    intro,
    "",
    `Titular: «${headline}»`,
    compareNote,
    "",
    `Publicaciones (${hits.length}) — todas, por puntaje:`,
    "",
    listText,
    "",
    "FGJ Medios · /busca",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");

  const html = buildBuscaEmailHtml({
    headline,
    hits,
    enginesUsed,
    compare,
    best,
    intro,
  });

  return { subject, text, html };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatBuscaTelegram({
  headline,
  hits,
  enginesUsed,
  compare,
  email,
  sent,
  best,
}) {
  const lines = [
    `🔍 Búsqueda: «${headline}»`,
    `Motores: ${enginesUsed.join(" + ") || "—"} (comparados)`,
    compare
      ? `Tavily ${compare.tavilyCount} · Brave ${compare.braveCount} · unidos ${compare.mergedCount} · ambos ${compare.confirmedByBoth}`
      : "",
    best ? `Mejor: ${best.medio} — ${best.title}` : "",
    best ? `  ${best.url}` : "",
    `Hallazgos: ${hits.length}`,
    "",
  ].filter(Boolean);

  for (const h of hits.slice(0, 6)) {
    const tag = h.engines.length > 1 ? "✓ambos" : h.engines.join(",");
    lines.push(`• [${tag}] ${Number(h._score ?? 0).toFixed(1)} ${h.medio} — ${h.title}`);
    lines.push(`  ${h.url}`);
  }
  if (!hits.length) lines.push("Sin coincidencias.");
  if (sent?.accepted?.length) {
    lines.push("", `✅ Correo enviado → ${sent.accepted.join(", ")}`);
  }
  lines.push("", "—— Correo ——", `Asunto: ${email.subject}`, "", email.text);
  return lines.join("\n");
}
