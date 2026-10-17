/**
 * Estado de Instagram (INTRANT): menciones en otros perfiles + último post de @intrant_rd.
 * Correo 09:00 y 17:00 (SOCIAL_REPORT_CRON_TIMES) y fuente Instagram del REPORTE general.
 */
import { calendarYmd } from "./news-date.mjs";
import { isFresh } from "./freshness.mjs";
import { sendEmail } from "./informe-email.mjs";
import { fetchClientLatest, igSettings, searchInstagram } from "./instagram-search.mjs";
import {
  assertAllFresh,
  channelEmailText,
  iconAttachments,
  displayDateDR,
  horaDR,
  hourDR,
  shortDateDR,
  toneCounts,
  intrantRecipients,
  renderChannelEmail,
  sourceUrlHtml,
  summarizeChannel,
  withTone,
} from "./social-report.mjs";

function esc(v = "") {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Menciones de Instagram para el REPORTE general (sin consultar el perfil: solo buscadores).
 * @param {{ date?: Date, days?: number }} o  days: 1 = hoy + ayer (reporte 07:30 cubre la noche)
 */
export async function fetchInstagramSearchItems({ date = new Date(), days, onStatus } = {}) {
  const base = igSettings();
  const d = days ?? Math.max(0, Number(process.env.IG_REPORT_DAYS ?? 1));
  const res = await searchInstagram({ now: date, onStatus, settings: { ...base, days: d } });
  return res.items;
}

function clientBlockHtml(client) {
  if (!client?.ok || !client.latest) {
    return `<div style="margin:18px 0 0;padding:12px 14px;border-radius:10px;background:#F8FAFC;border:1px dashed #cbd5e1;font-size:12px;color:#64748b;">
      ${client?.stale ? "@intrant_rd no ha publicado en Instagram en las últimas 24 horas." : `Último post de @intrant_rd: no disponible en este corte${client?.error ? " (Instagram limitó la consulta)" : ""}.`}
    </div>`;
  }
  const L = client.latest;
  const cs = client.comments || {};
  const comments = (cs.comments || []).slice(0, 20);
  const list = comments.length
    ? comments
        .map(
          (c) => `<div style="padding:7px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#334155;line-height:1.45;"><b style="color:#0f172a;">@${esc(c.user)}</b> ${esc(c.text)}</div>`
        )
        .join("")
    : `<div style="font-size:12px;color:#94a3b8;">Comentarios no disponibles en este corte.</div>`;
  return `<div style="margin:22px 0 0;border:1px solid #e9d5ff;border-radius:12px;overflow:hidden;">
    <div style="background:#faf5ff;padding:12px 16px;border-bottom:1px solid #e9d5ff;">
      <div style="font-size:12px;font-weight:800;color:#7C3AED;letter-spacing:.06em;text-transform:uppercase;">Último post de @${esc(client.username)}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;">${esc(L.at ? `${displayDateDR(new Date(L.at))} · ${horaDR(new Date(L.at))}` : "")} · ❤ ${esc(L.likes ?? "—")} · 💬 ${esc(L.commentsCount ?? "—")}</div>
    </div>
    <div style="padding:12px 16px;">
      <div style="font-size:14px;color:#0f172a;line-height:1.5;">${esc(String(L.caption || "").slice(0, 600))}</div>
      <p style="margin:8px 0 12px;"><a href="${esc(L.url)}" style="color:#7C3AED;font-weight:700;text-decoration:none;">Ver post →</a></p>
      ${sourceUrlHtml(L.url, "#7C3AED")}
      <div style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Comentarios${cs.partial ? " (vista previa)" : ""} (${comments.length}${L.commentsCount ? ` de ${L.commentsCount}` : ""})</div>
      ${list}
    </div>
  </div>`;
}

/** Indicadores del encabezado para Instagram (solo datos que realmente tenemos). */
export function igStats(items = []) {
  const tones = toneCounts(items);
  const medios = new Set(items.filter((i) => i.medio && i.medio !== "Instagram").map((i) => i.medio.toLowerCase()));
  const reels = items.filter((i) => i.mediaKind === "reel" || i.mediaKind === "video").length;
  const mendez = items.filter((i) => i.mendez || /juan manuel (rafael )?m[eé]ndez/i.test(`${i.title} ${i.summary}`)).length;
  const byHour = new Map();
  for (const i of items) {
    if (!i.postedAt) continue;
    const h = hourDR(new Date(i.postedAt));
    byHour.set(h, (byHour.get(h) || 0) + 1);
  }
  return [
    { value: items.length, label: "Total menciones" },
    { value: medios.size, label: "Medios identificados" },
    { value: items.length - reels, label: "Posts" },
    { value: reels, label: "Reels / videos" },
    { value: mendez, label: "Mencionan a Méndez" },
    { value: tones.positivo, label: "Favorables" },
    { value: tones.negativo, label: "Críticas" },
    { value: byHour.size ? Math.max(...byHour.values()) : 0, label: "Máx. publicaciones / hora" },
  ];
}

/**
 * @param {{ now?: Date, dryRun?: boolean, to?: string, onStatus?: Function }} o
 */
export async function runInstagramReport({ now = new Date(), dryRun = false, to = "", onStatus } = {}) {
  const base = igSettings();
  onStatus?.(`👤 Perfil @${base.clientAccount}: último post y comentarios…`);
  let client = await fetchClientLatest(base.clientAccount);
  // Regla 24 h: el último post del INTRANT solo si es de las últimas 24 h
  if (client.ok && client.latest && !isFresh(client.latest.at, now)) client = { ...client, latest: null, stale: true };
  if (!client.ok) onStatus?.(`⚠️ Perfil @${base.clientAccount}: ${String(client.error).slice(0, 120)}`);

  const res = await searchInstagram({
    now,
    onStatus,
    settings: { ...base, days: 1, clientPostKeys: client.postKeys || [] }, // days=1 + regla 24 h exacta
  });
  const items = withTone(
    res.items.map((it) => ({ ...it, hora: it.postedAt ? `${shortDateDR(new Date(it.postedAt))} · ${horaDR(new Date(it.postedAt))}` : it.hora || "" }))
  );

  const displayDate = displayDateDR(now);
  const periodLabel = `Corte ${horaDR(now)} · últimas 24 horas`;
  const extra =
    client.ok && client.latest
      ? `Último post de la cuenta oficial @${client.username}: "${String(client.latest.caption).slice(0, 300)}" (${client.latest.commentsCount ?? "?"} comentarios). Comentarios: ${(client.comments?.comments || [])
          .slice(0, 15)
          .map((c) => `@${c.user}: ${c.text}`)
          .join(" | ")}`
      : "";
  const summaryMd = await summarizeChannel({ channel: "Instagram", items, periodLabel, extra, onStatus });

  const subject = `ESTADO INSTAGRAM INTRANT — ${items.length} ${items.length === 1 ? "mención" : "menciones"} — ${displayDate} ${horaDR(now)}`;
  const html = renderChannelEmail({
    channel: "Instagram",
    accent: "#7C3AED",
    displayDate,
    periodLabel,
    summaryMd,
    items,
    topBlockHtml: clientBlockHtml(client),
    sectionTitle: "Menciones de las últimas 24 horas en otros perfiles",
    footer: "Solo publicaciones de las últimas 24 horas (hora exacta del post) que mencionan explícitamente al INTRANT o @intrantrd, halladas en buscadores web. Puede haber publicaciones aún no indexadas.",
    kpiHeader: {
      title: "Monitoreo en Redes — Instagram",
      subtitle: `Boletín de Transporte y Movilidad – INTRANT  ·  ${shortDateDR(now)}`,
      network: "instagram",
      tiles: igStats(items),
    },
  });
  const text = channelEmailText({ subject, summaryMd, items });

  assertAllFresh(items, now); // Regla 24 h: si algo se pasa, no se envía
  let sent = null;
  let recipients = null;
  if (!dryRun) {
    recipients = to ? { to, cc: "" } : intrantRecipients();
    onStatus?.(`📤 Enviando estado de Instagram → ${recipients.to}`);
    sent = await sendEmail({ to: recipients.to, cc: recipients.cc || undefined, subject, html, text, attachments: iconAttachments(["instagram"]) });
  }
  return { dateYmd: calendarYmd(now), items, client, stats: res.stats, errors: res.errors, summaryMd, subject, html, text, sent, recipients, dryRun };
}
