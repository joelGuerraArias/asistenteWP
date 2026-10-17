/**
 * Brief ejecutivo Intrant vía DeepSeek (prompt de inteligencia reputacional).
 */
import { deepseekChat, sanitizeForDeepseek } from "./deepseek.mjs";
import { CHANNEL_META } from "./intrant-report-pdf.mjs";

export const EXECUTIVE_BRIEF_SYSTEM = `Actúa como un Director Senior de Inteligencia de Medios, Comunicación Estratégica, Reputación Institucional y Asuntos Públicos con experiencia preparando informes para Presidencia, ministros, directores generales y altos ejecutivos.

Voy a proporcionarte un reporte bruto de monitoreo de medios y redes sociales.

Tu misión es transformar ese material en un REPORTE EJECUTIVO DE ALTO NIVEL, elegante, estratégico, preciso y orientado a la toma de decisiones.

IMPORTANTE:
- No te limites a resumir publicación por publicación.
- Analiza el panorama general.
- Identifica patrones, tendencias, riesgos, oportunidades y narrativas.
- Distingue claramente hechos de interpretaciones.
- No inventes información que no aparezca en el documento.
- Si no existen datos suficientes para determinar algo, indícalo.
- Conserva los enlaces originales de las publicaciones más relevantes.
- Evita lenguaje sensacionalista.
- Utiliza lenguaje ejecutivo, institucional, profesional y contundente.
- El informe debe poder ser entregado directamente a la máxima autoridad de la institución.
- Evita repeticiones.
- Prioriza información relevante sobre información secundaria.
- Corrige errores ortográficos y de redacción del material original sin alterar su significado.
- NO uses términos técnicos internos como Gmail, Google Alerts, Apify, RapidAPI, dataset ni nombres de scrapers.
- En indicadores, llama a la prensa digital simplemente "Medios digitales".
- PRIORIDAD ABSOLUTA — JUAN MANUEL MÉNDEZ: el informe debe ABRIR siempre con las noticias, entrevistas o videos que mencionen a Juan Manuel Méndez (nombramiento, declaración, entrevista, perfil). Esa cobertura va primero en: frase de panorama, Resumen Ejecutivo (párrafo 1), primera narrativa, primeras filas de Temas de mayor impacto y primeras Menciones prioritarias. Solo después el resto (fiscalización, DIGESETT, quejas ciudadanas, etc.). Si no hay piezas sobre Méndez en el material, decláralo en una línea y continúa con el resto.
- TÉRMINO MÁS MENCIONADO DEL CICLO: si el material indica un término dominante (p. ej. digesett, intrant, motoristas, accidente), resáltarlo en negrita en el panorama y en el resumen ejecutivo (ej. **digesett**).
- TELEVISIÓN / RADIO: el material incluye hallazgos de Analisishoy (clips .mp4 y audios .wav/.mp3). Cítalos con medio, tono y enlace cuando existan; no los ignores.

TÍTULO DEL DOCUMENTO:

REPORTE EJECUTIVO DE MONITOREO, REPUTACIÓN Y CONVERSACIÓN DIGITAL

Institución: INTRANT
Fecha del monitoreo: [FECHA]
Período analizado: [PERÍODO]

ESTRUCTURA OBLIGATORIA:

1. PORTADA / ENCABEZADO EJECUTIVO
Presentar: institución, fecha, período, total de menciones, plataformas monitoreadas, y una frase ejecutiva de máximo dos líneas sobre el comportamiento general de la conversación.

2. RESUMEN EJECUTIVO
Redactar entre 4 y 7 párrafos breves. El PRIMER párrafo debe centrarse en la cobertura sobre Juan Manuel Méndez (si existe). Luego: qué ocurrió en el resto; temas dominantes; percepción; riesgo; oportunidad; qué debe conocer de inmediato el Director Ejecutivo.

3. INDICADORES GENERALES
Tabla markdown:
| Indicador | Resultado |
| Total de menciones | |
| Medios digitales | |
| X / Twitter | |
| YouTube | |
| Instagram | |
| Facebook | |
| Televisión | |
| Radio | |
Agregar, si los datos lo permiten: % por plataforma, concentración y plataforma con mayor actividad.

4. SEMÁFORO EJECUTIVO DE REPUTACIÓN
Clasificar: 🟢 Favorable / 🟡 Atención / 🔴 Riesgo reputacional. Máximo 1 párrafo de justificación. No exagerar amenazas.

5. PRINCIPALES NARRATIVAS DEL DÍA
Entre 3 y 7 temas. La PRIMERA narrativa debe ser siempre la relacionada con Juan Manuel Méndez cuando haya material. Para cada uno: nombre estratégico, Descripción, Origen, Tono, Nivel de impacto, Implicación institucional. Agrupar publicaciones del mismo asunto.

6. TEMAS DE MAYOR IMPACTO
Tabla: Prioridad | Tema | Fuente | Tono | Impacto | Acción sugerida. La fila 1 debe ser Méndez si hay cobertura. Ordenar el resto por importancia.

7. ANÁLISIS DE SENTIMIENTO
Positivas / Neutrales-informativas / Críticas-negativas. Si no hay base para %, no inventar; usar expresiones cualitativas. Explicar asuntos por sentimiento.

8. PRINCIPALES CRÍTICAS Y PREOCUPACIONES CIUDADANAS
Agrupar (fiscalización, tránsito, transporte público, etc.). Para cada tema: reclamo, institución mencionada, riesgo potencial, si requiere seguimiento comunicacional u operativo.

9. COBERTURA POSITIVA Y OPORTUNIDADES
Contenidos favorables y cómo aprovecharlos comunicacionalmente.

10. ACTORES Y CUENTAS RELEVANTES
Medios, periodistas, comunicadores, instituciones, usuarios activos. No asumir audiencia sin métricas.

11. MENCIONES PRIORITARIAS
Solo 5–10. Primero todas las de Juan Manuel Méndez (noticia/video), después el resto. Formato: título, Fuente, Autor/medio, Resumen (2–3 líneas), Relevancia, Tono, Enlace (URL original).

12. ALERTAS REPUTACIONALES
Solo si hay señales justificadas. Tabla: Alerta | Nivel (🔴 Alto / 🟠 Medio / 🟡 Bajo) | Motivo | Recomendación. No tratar quejas aisladas como crisis.

13. OPORTUNIDADES DE COMUNICACIÓN
Acciones concretas: ACCIÓN / JUSTIFICACIÓN / PRIORIDAD (Alta/Media/Baja).

14. RECOMENDACIONES PARA LA DIRECCIÓN EJECUTIVA
Máximo 5, estratégicas y vinculadas al monitoreo: Inmediata, Corto plazo, Seguimiento, Comunicación, Prevención.

15. CONCLUSIÓN EJECUTIVA
2–3 párrafos: estado actual, principal riesgo, principal oportunidad, qué observar en 24–48 h.

16. ANEXO DE MONITOREO
Resto de menciones: Fuente | Usuario/Medio | Tema | Resumen | Enlace

ESTILO: firma internacional de inteligencia reputacional. Títulos claros, párrafos cortos, tablas markdown, jerarquía visual. Evitar redundancia, sensacionalismo y relleno.

NEGRITAS OBLIGATORIAS (markdown **doble asterisco**):
- Todos los nombres propios de personas (nombre y apellido o nombre completo): p. ej. **Juan Manuel Méndez**, **Milton Morrison**.
- Instituciones, organismos y cargos cuando se nombren como entidad: **INTRANT**, **DIGESETT**, **Ministerio de Interior y Policía**.
- Medios, programas y canales citados: **Noticias SIN**, **Color Visión**, **CDN**.
- No pongas en negrita frases enteras ni conceptos genéricos (tránsito, reputación, etc.); solo nombres propios / entidades.

CRITERIO: un Director Ejecutivo con 3 minutos debe entender solo con Resumen, Semáforo, Narrativas, Alertas y Recomendaciones.

Responde SOLO el informe en markdown (sin preámbulos ni meta-comentarios).`;

function platformLabel(source) {
  if (source === "gmail") return "Medios digitales";
  return CHANNEL_META[source]?.label || source;
}

function hay(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Detecta menciones a Juan Manuel Méndez (noticia/video prioritarios). */
export function mentionsJuanManuelMendez(it = {}) {
  const blob = hay(`${it.title || ""} ${it.summary || ""} ${it.medio || ""}`);
  if (!blob) return false;
  if (/juan\s+manuel\s+mendez/.test(blob)) return true;
  if (/mendez\s+garcia/.test(blob)) return true;
  if (/\bmendez\b/.test(blob) && /(intrant|director|coe|nombr|decreto|entrevista|nuria)/.test(blob)) {
    return true;
  }
  return false;
}

/** Noticias/videos de Méndez primero; resto después. */
export function prioritizeMendezItems(items = []) {
  const mendez = [];
  const rest = [];
  for (const it of items) {
    if (mentionsJuanManuelMendez(it)) mendez.push(it);
    else rest.push(it);
  }
  // Dentro de Méndez: priorizar prensa + video sobre redes sueltas
  const rank = (it) => {
    if (it.source === "youtube" || it.source === "tv") return 0;
    if (it.source === "gmail") return 1;
    if (it.source === "facebook" || it.source === "instagram") return 2;
    return 3;
  };
  mendez.sort((a, b) => rank(a) - rank(b));
  return [...mendez, ...rest];
}

/**
 * Términos más mencionados en el ciclo (campo `term` de Analisishoy / menciones).
 * @returns {{ term: string, count: number, ranked: { term: string, count: number }[] } | null}
 */
export function topMentionedTerms(items = [], { limit = 5 } = {}) {
  const counts = new Map();
  for (const it of items) {
    const t = String(it.term || "")
      .toLowerCase()
      .trim();
    if (!t || t.length < 3) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  // Si no hay `term`, intentar palabras clave en título de TV/radio
  if (!counts.size) {
    for (const it of items) {
      if (it.source !== "tv" && it.source !== "radio") continue;
      const blob = hay(`${it.title || ""} ${it.summary || ""}`);
      for (const kw of [
        "intrant",
        "digesett",
        "motoristas",
        "motorista",
        "accidente",
        "pasaje",
        "morrison",
        "mendez",
        "méndez",
      ]) {
        if (blob.includes(hay(kw))) {
          const key = kw === "méndez" ? "mendez" : kw === "motorista" ? "motoristas" : kw;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
  }
  const ranked = [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  if (!ranked.length) return null;
  return {
    term: ranked[0].term,
    count: ranked[0].count,
    ranked: ranked.slice(0, limit),
  };
}

/**
 * Serializa el monitoreo bruto para el modelo (sin jerga interna).
 */
export function buildRawMonitoringDump({
  displayDate,
  dateYmd,
  counts = {},
  items = [],
  periodLabel = "",
  topTerms = null,
} = {}) {
  const period =
    periodLabel ||
    `Ventana de monitoreo del ${displayDate} (incluye menciones recientes de prensa, redes y video asociadas al día de análisis)`;

  const ordered = prioritizeMendezItems(items);
  const mendezItems = ordered.filter(mentionsJuanManuelMendez);
  const otherItems = ordered.filter((it) => !mentionsJuanManuelMendez(it));
  const top = topTerms || topMentionedTerms(items);
  const broadcast = ordered.filter(
    (it) => it.source === "tv" || it.source === "radio"
  );

  const lines = [
    `Institución: INTRANT`,
    `Fecha del monitoreo: ${displayDate}`,
    `Fecha ISO: ${dateYmd || ""}`,
    `Período analizado: ${period}`,
    `Total de menciones en el material bruto: ${items.length}`,
    `Menciones prioritarias Juan Manuel Méndez: ${mendezItems.length}`,
    top
      ? `Término más mencionado del ciclo: **${top.term}** (${top.count} veces)` +
        (top.ranked.length > 1
          ? ` · Ranking: ${top.ranked.map((r) => `${r.term}(${r.count})`).join(", ")}`
          : "")
      : "Término más mencionado del ciclo: no determinado",
    "",
    "## INSTRUCCIÓN DE ORDEN",
    "Abre el reporte SIEMPRE con las piezas de la sección PRIORIDAD JUAN MANUEL MÉNDEZ (noticias/videos). Luego el resto.",
    top
      ? `Resalta en negrita el término dominante **${top.term}** en panorama y resumen.`
      : "",
    "",
    "## Conteos por plataforma",
    `- Medios digitales: ${counts.gmail || 0}`,
    `- X / Twitter: ${counts.x || 0}`,
    `- YouTube: ${counts.youtube || 0}`,
    `- Instagram: ${counts.instagram || 0}`,
    `- Facebook: ${counts.facebook || 0}`,
    `- Televisión (clips .mp4): ${counts.tv || 0}`,
    `- Radio / audio (.wav/.mp3): ${counts.radio || 0}`,
    "",
    "## PRIORIDAD — Juan Manuel Méndez (noticias / video / cobertura directa)",
  ].filter((x) => x !== "");

  const clean = (v) => sanitizeForDeepseek(v);

  const pushMention = (it, i, prefix) => {
    lines.push("");
    lines.push(`### ${prefix} ${i}`);
    lines.push(`Plataforma: ${platformLabel(it.source)}`);
    lines.push(`Medio / cuenta: ${clean(it.medio) || "—"}`);
    if (it.term) lines.push(`Término detectado: ${clean(it.term)}`);
    if (it.tono) lines.push(`Tono: ${clean(it.tono)}`);
    if (it.mediaKind) {
      lines.push(
        `Tipo de archivo: ${
          it.mediaKind === "mp4"
            ? "Clip TV (.mp4)"
            : it.mediaKind === "wav"
              ? "Audio (.wav)"
              : `Audio (.${it.mediaKind})`
        }`
      );
    }
    lines.push(`Título: ${clean(it.title) || "—"}`);
    lines.push(`Resumen: ${clean(it.summary || it.title) || "—"}`);
    lines.push(`Relevancia operativa: ${it.relevance || "media"}`);
    lines.push(`Fecha pieza: ${it.at || "no indicada"}`);
    lines.push(`Enlace: ${it.url || "sin enlace"}`);
    if (it.txtUrl) lines.push(`Transcripción TXT: ${it.txtUrl}`);
    lines.push(`Prioridad director: ${mentionsJuanManuelMendez(it) ? "SÍ — Juan Manuel Méndez" : "no"}`);
  };

  if (mendezItems.length) {
    mendezItems.forEach((it, i) => pushMention(it, i + 1, "Méndez"));
  } else {
    lines.push("");
    lines.push("(No hay noticias/videos que mencionen explícitamente a Juan Manuel Méndez en esta ventana.)");
  }

  lines.push("");
  lines.push("## Televisión / Radio (Analisishoy MD completo)");
  if (broadcast.length) {
    broadcast.forEach((it, i) => pushMention(it, i + 1, it.source === "radio" ? "Audio" : "TV"));
  } else {
    lines.push("");
    lines.push("(Sin menciones Intrant en Analisishoy TV/radio para esta ventana.)");
  }

  lines.push("");
  lines.push("## Resto del monitoreo");
  otherItems
    .filter((it) => it.source !== "tv" && it.source !== "radio")
    .forEach((it, i) => pushMention(it, i + 1, "Mención"));

  if (!items.length) {
    lines.push("");
    lines.push("(Sin menciones en el material bruto de esta ventana.)");
  }

  return lines.join("\n");
}

/**
 * @returns {Promise<{ markdown: string, rawDump: string }>}
 */
export async function generateExecutiveBrief({
  displayDate,
  dateYmd,
  counts,
  items,
  periodLabel,
  onStatus,
} = {}) {
  const topTerms = topMentionedTerms(items);
  const rawDump = buildRawMonitoringDump({
    displayDate,
    dateYmd,
    counts,
    items,
    periodLabel,
    topTerms,
  });

  onStatus?.("Redactando brief ejecutivo (inteligencia reputacional)…");

  const topHint = topTerms
    ? `\nTérmino dominante del ciclo (resaltar en negrita): **${topTerms.term}** (${topTerms.count} menciones). Ranking: ${topTerms.ranked.map((r) => `${r.term}(${r.count})`).join(", ")}.`
    : "";

  const userMsg = `Fecha del monitoreo: ${displayDate}
Período analizado: ${periodLabel || `Monitoreo asociado al ${displayDate}`}
${topHint}

REGLA DE APERTURA OBLIGATORIA: empieza el informe con la cobertura de Juan Manuel Méndez (noticias, entrevistas, videos). Si la sección PRIORIDAD — Juan Manuel Méndez tiene piezas, úsalas primero en resumen, narrativas y menciones prioritarias.

Analiza íntegramente el siguiente reporte bruto (incluye Televisión/Radio del MD Analisishoy completo) y conviértelo en el formato ejecutivo obligatorio:

---
${rawDump}
---`;

  const { content } = await deepseekChat([{ role: "user", content: userMsg }], {
    system: EXECUTIVE_BRIEF_SYSTEM,
    temperature: 0.35,
    thinking: false,
  });

  if (!content) throw new Error("DeepSeek no devolvió el brief ejecutivo");
  return { markdown: content, rawDump, topTerms };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pill(label, bg, fg) {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:700;font-family:Segoe UI,Arial,sans-serif;letter-spacing:0.02em;">${escapeHtml(label)}</span>`;
}

/** Colorea tonos / prioridades / semáforos en texto plano. */
function colorizeTokens(html) {
  return html
    .replace(
      /\b(Favorable|Positivo|Positiva|Positivas)\b/gi,
      () => pill("Favorable", "#DCFCE7", "#15803D")
    )
    .replace(
      /\b(Neutro|Neutral|Neutrales|Informativ[oa]s?)\b/gi,
      (m) => pill(m, "#FEF3C7", "#B45309")
    )
    .replace(
      /\b(Crítico|Crítica|Críticas|Negativo|Negativa|Negativas)\b/gi,
      (m) => pill(m, "#FEE2E2", "#B91C1C")
    )
    .replace(
      /\b(Mixto|Mixta)\b/gi,
      () => pill("Mixto", "#E0E7FF", "#3730A3")
    )
    .replace(
      /\b(Alto|Alta)\b(?=\s*(impacto|prioridad|nivel)?)/gi,
      () => pill("Alto", "#FEE2E2", "#B91C1C")
    )
    .replace(
      /\b(Medio|Media)\b(?=\s*(impacto|prioridad|nivel)?)/gi,
      () => pill("Medio", "#FFEDD5", "#C2410C")
    )
    .replace(
      /\b(Bajo|Baja)\b(?=\s*(impacto|prioridad|nivel)?)/gi,
      () => pill("Bajo", "#DBEAFE", "#1D4ED8")
    )
    .replace(/🟢\s*Favorable/gi, () => pill("🟢 Favorable", "#DCFCE7", "#15803D"))
    .replace(/🟡\s*Atención/gi, () => pill("🟡 Atención", "#FEF3C7", "#B45309"))
    .replace(
      /🔴\s*Riesgo(?:\s+reputacional)?/gi,
      () => pill("🔴 Riesgo reputacional", "#FEE2E2", "#B91C1C")
    )
    .replace(/🟠\s*Medio/gi, () => pill("🟠 Medio", "#FFEDD5", "#C2410C"));
}

function sectionStyle(title = "") {
  const t = title.toLowerCase();
  if (/sem[aá]foro|alerta|riesgo|cr[ií]tica/.test(t)) {
    return { bar: "#DC2626", bg: "#FEF2F2", title: "#991B1B" };
  }
  if (/oportunidad|positiva|cobertura positiva|recomend/.test(t)) {
    return { bar: "#16A34A", bg: "#F0FDF4", title: "#166534" };
  }
  if (/narrativa|tema|impacto|menci[oó]n/.test(t)) {
    return { bar: "#2563EB", bg: "#EFF6FF", title: "#1E40AF" };
  }
  if (/sentimiento|indicador/.test(t)) {
    return { bar: "#D97706", bg: "#FFFBEB", title: "#92400E" };
  }
  if (/conclusi[oó]n|resumen/.test(t)) {
    return { bar: "#0B1F3A", bg: "#F1F5F9", title: "#0B1F3A" };
  }
  return { bar: "#0B1F3A", bg: "#F8FAFC", title: "#0B1F3A" };
}

function detectSemaforoCallout(text = "") {
  if (/🔴|riesgo reputacional/i.test(text)) {
    return {
      bg: "#FEF2F2",
      border: "#DC2626",
      titleBg: "#DC2626",
      title: "SEMÁFORO · RIESGO REPUTACIONAL",
    };
  }
  if (/🟢|favorable/i.test(text) && /sem[aá]foro|atenci[oó]n|riesgo/i.test(text) === false) {
    // weak - better check emoji first
  }
  if (/🟢/.test(text) || /\bfavorable\b/i.test(text)) {
    return {
      bg: "#F0FDF4",
      border: "#16A34A",
      titleBg: "#16A34A",
      title: "SEMÁFORO · FAVORABLE",
    };
  }
  if (/🟡|atenci[oó]n/i.test(text)) {
    return {
      bg: "#FFFBEB",
      border: "#D97706",
      titleBg: "#D97706",
      title: "SEMÁFORO · ATENCIÓN",
    };
  }
  return {
    bg: "#FFFBEB",
    border: "#D97706",
    titleBg: "#D97706",
    title: "SEMÁFORO EJECUTIVO",
  };
}

function inlineFmt(s) {
  return colorizeTokens(
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong style=\"color:#0B1F3A;\">$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" style="color:#0369a1;font-weight:600;">$1</a>'
      )
      .replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" style="color:#0369a1;font-weight:600;">$1</a>'
      )
  );
}

function cellToneStyle(text = "") {
  const t = text.toLowerCase();
  if (/favor|positiv|🟢/.test(t)) return "background:#DCFCE7;color:#166534;font-weight:700;";
  if (/cr[ií]tic|negativ|🔴/.test(t)) return "background:#FEE2E2;color:#991B1B;font-weight:700;";
  if (/neut|inform|🟡/.test(t)) return "background:#FEF3C7;color:#92400E;font-weight:700;";
  if (/mixto/.test(t)) return "background:#E0E7FF;color:#3730A3;font-weight:700;";
  if (/^alto|alta$/.test(t.trim())) return "background:#FEE2E2;color:#991B1B;font-weight:700;";
  if (/^medio|media$/.test(t.trim())) return "background:#FFEDD5;color:#9A3412;font-weight:700;";
  if (/^bajo|baja$/.test(t.trim())) return "background:#DBEAFE;color:#1E40AF;font-weight:700;";
  return "";
}

/** Markdown ligero → HTML colorido para correo institucional. */
export function markdownToEmailHtml(md = "") {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inUl = false;
  let inTable = false;
  let tableRows = [];
  let inSemaforo = false;
  let semaforoBuf = [];
  let narrativeOpen = false;

  const flushUl = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };

  const flushNarrative = () => {
    if (narrativeOpen) {
      out.push("</div>");
      narrativeOpen = false;
    }
  };

  const flushSemaforo = () => {
    if (!inSemaforo) return;
    const text = semaforoBuf.join(" ").trim();
    const cfg = detectSemaforoCallout(text || semaforoBuf.join("\n"));
    out.push(`<div style="margin:16px 0;border-radius:12px;overflow:hidden;border:1px solid ${cfg.border};background:${cfg.bg};font-family:Segoe UI,Arial,sans-serif;">
      <div style="background:${cfg.titleBg};color:#fff;padding:10px 14px;font-size:13px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(cfg.title)}</div>
      <div style="padding:14px 16px;color:#334155;font-size:14px;line-height:1.55;">${semaforoBuf.map((p) => `<p style="margin:0 0 8px;">${inlineFmt(p)}</p>`).join("")}</div>
    </div>`);
    semaforoBuf = [];
    inSemaforo = false;
  };

  const flushTable = () => {
    if (!inTable) return;
    out.push(
      '<table style="width:100%;border-collapse:separate;border-spacing:0;margin:14px 0;font-size:13px;font-family:Segoe UI,Arial,sans-serif;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">'
    );
    tableRows.forEach((cells, idx) => {
      const tag = idx === 0 ? "th" : "td";
      out.push("<tr>");
      cells.forEach((c, ci) => {
        const headerStyle =
          "background:#0B1F3A;color:#fff;font-weight:700;border:none;padding:10px 12px;text-align:left;";
        const tone = idx > 0 ? cellToneStyle(c) : "";
        const zebra = idx > 0 && idx % 2 === 0 ? "background:#F8FAFC;" : idx > 0 ? "background:#fff;" : "";
        const style =
          idx === 0
            ? headerStyle
            : `border-bottom:1px solid #e2e8f0;padding:10px 12px;text-align:left;vertical-align:top;${tone || zebra}`;
        out.push(`<${tag} style="${style}">${inlineFmt(c)}</${tag}>`);
      });
      out.push("</tr>");
    });
    out.push("</table>");
    tableRows = [];
    inTable = false;
  };

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (/^\|/.test(trimmed) && trimmed.includes("|")) {
      flushUl();
      flushSemaforo();
      flushNarrative();
      if (/^\|?\s*-+/.test(trimmed.replace(/\|/g, "|"))) continue;
      const cells = trimmed
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      inTable = true;
      tableRows.push(cells);
      continue;
    }
    flushTable();

    if (!trimmed || trimmed === "---") {
      flushUl();
      if (inSemaforo && trimmed === "---") flushSemaforo();
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushUl();
      flushSemaforo();
      flushNarrative();
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.replace(/^#{1,3}\s+/, "");
      const plain = text.replace(/\*\*/g, "");

      if (/sem[aá]foro/i.test(plain)) {
        inSemaforo = true;
        semaforoBuf = [];
        continue;
      }

      if (level >= 3 || /^narrativa\s*\d/i.test(plain) || /^\d+\.\s+/.test(plain)) {
        const st = sectionStyle(plain);
        out.push(
          `<div style="margin:14px 0;padding:12px 14px;border-left:4px solid ${st.bar};background:${st.bg};border-radius:0 10px 10px 0;font-family:Segoe UI,Arial,sans-serif;">
            <div style="color:${st.title};font-size:14px;font-weight:700;margin-bottom:6px;">${inlineFmt(plain)}</div>`
        );
        narrativeOpen = true;
        continue;
      }

      const st = sectionStyle(plain);
      const size = level === 1 ? 18 : 15;
      out.push(
        `<div style="margin:22px 0 10px;padding:10px 14px;background:${st.bg};border-left:5px solid ${st.bar};border-radius:0 8px 8px 0;font-family:Segoe UI,Arial,sans-serif;">
          <div style="color:${st.title};font-size:${size}px;font-weight:700;letter-spacing:0.01em;">${inlineFmt(plain)}</div>
        </div>`
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushSemaforo();
      if (!inUl) {
        out.push(
          '<ul style="margin:8px 0 12px 6px;padding:0 0 0 18px;color:#334155;font-family:Segoe UI,Arial,sans-serif;">'
        );
        inUl = true;
      }
      out.push(
        `<li style="margin:6px 0;line-height:1.5;">${inlineFmt(trimmed.replace(/^[-*]\s+/, ""))}</li>`
      );
      continue;
    }

    flushUl();

    if (inSemaforo) {
      semaforoBuf.push(trimmed);
      continue;
    }

    // Etiquetas tipo ACCIÓN: / PRIORIDAD:
    if (/^(ACCIÓN|JUSTIFICACIÓN|PRIORIDAD|Descripción|Origen|Tono|Nivel de impacto|Implicación institucional|Fuente|Autor\s*\/\s*medio|Resumen|Relevancia|Enlace)\s*:/i.test(trimmed)) {
      const [label, ...rest] = trimmed.split(":");
      const value = rest.join(":").trim();
      out.push(
        `<p style="margin:6px 0;font-size:14px;line-height:1.5;font-family:Segoe UI,Arial,sans-serif;">
          <span style="display:inline-block;min-width:118px;color:#0B1F3A;font-weight:700;">${escapeHtml(label)}:</span>
          <span style="color:#334155;">${inlineFmt(value)}</span>
        </p>`
      );
      continue;
    }

    out.push(
      `<p style="margin:0 0 10px;line-height:1.6;color:#334155;font-size:14px;font-family:Segoe UI,Arial,sans-serif;">${inlineFmt(trimmed)}</p>`
    );
  }
  flushUl();
  flushTable();
  flushSemaforo();
  flushNarrative();
  return out.join("\n");
}

export function wrapExecutiveEmailHtml({
  displayDate,
  bodyHtml,
  pdfFilename,
  attachmentFilename,
  stats = null,
  bySource = null,
  topTerms = null,
  broadcastHtml = "",
  reputBannerCid = "",
} = {}) {
  const fileLabel = attachmentFilename || pdfFilename || "";
  const total = stats?.total ?? "";
  const net =
    stats && typeof stats.net === "number"
      ? stats.net > 0
        ? `+${stats.net}`
        : String(stats.net)
      : "";
  const prensa = stats?.byGroup?.prensa ?? "";
  const redes =
    stats && typeof stats.byGroup?.redes === "number"
      ? (stats.byGroup.redes || 0) + (stats.byGroup.video || 0)
      : "";
  const tvCount = bySource?.tv?.length ?? stats?.byGroup?.broadcast ?? "";
  const radioCount = bySource?.radio?.length ?? "";
  const top =
    topTerms ||
    topMentionedTerms([
      ...(bySource?.tv || []),
      ...(bySource?.radio || []),
    ]);

  const kpi = (value, label, accent) =>
    value === "" || value === undefined
      ? ""
      : `<div style="background:${accent};border-radius:10px;padding:10px 12px;min-width:86px;">
          <div style="font-size:22px;font-weight:700;color:#fff;">${escapeHtml(String(value))}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.75);margin-top:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</div>
        </div>`;

  const topTermBanner = top
    ? `<div style="margin:14px 0 0;padding:10px 14px;border-radius:10px;background:rgba(251,191,36,0.18);border:1px solid rgba(251,191,36,0.45);">
        <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#FDE68A;font-weight:700;">Término más mencionado en este ciclo</div>
        <div style="margin-top:4px;font-size:18px;font-weight:800;color:#FFF;">
          <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#F59E0B;color:#111827;">${escapeHtml(top.term)}</span>
          <span style="margin-left:8px;font-size:13px;font-weight:600;color:#FDE68A;">${top.count} menciones</span>
        </div>
        ${
          top.ranked.length > 1
            ? `<div style="margin-top:8px;font-size:12px;color:#E2E8F0;">También: ${top.ranked
                .slice(1)
                .map((r) => `<strong style="color:#fff;">${escapeHtml(r.term)}</strong> (${r.count})`)
                .join(" · ")}</div>`
            : ""
        }
      </div>`
    : "";

  const annex =
    broadcastHtml ||
    (bySource
      ? buildBroadcastAnnexHtml({
          tv: bySource.tv || [],
          radio: bySource.radio || [],
          topTerms: top,
        })
      : "");

  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:780px;margin:0 auto;color:#0f172a;background:#F1F5F9;padding:12px;">
  ${
    reputBannerCid
      ? `<img src="cid:${reputBannerCid}" alt="Estado reputacional Juan Manuel Méndez" width="780" style="width:100%;max-width:780px;height:auto;display:block;border-radius:14px 14px 0 0;">`
      : ""
  }
  <div style="background:linear-gradient(135deg,#0B1F3A 0%,#123056 55%,#1e3a5f 100%);border-radius:${reputBannerCid ? "0" : "14px 14px 0 0"};padding:22px 24px;color:#fff;">
    <div style="font-size:12px;letter-spacing:0.12em;color:#93C5FD;font-weight:700;">INTRANT · INTELIGENCIA REPUTACIONAL</div>
    <div style="font-size:24px;font-weight:700;margin-top:8px;line-height:1.25;">Reporte ejecutivo de monitoreo, reputación y conversación digital</div>
    <div style="color:#CBD5E1;margin-top:8px;font-size:14px;">${escapeHtml(displayDate)} · Uso Departamento de Comunicaciones</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">
      ${kpi(net, "Balance", "#0F766E")}
      ${kpi(total, "Menciones", "#B91C1C")}
      ${kpi(prensa, "Medios", "#1D4ED8")}
      ${kpi(redes, "Redes / video", "#7C3AED")}
      ${kpi(tvCount, "TV .mp4", "#0369A1")}
      ${kpi(radioCount, "Audio", "#0F766E")}
    </div>
    ${topTermBanner}
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px;padding:8px 20px 22px;">
    ${bodyHtml}
    ${annex}
    ${
      fileLabel
        ? `<p style="margin-top:24px;padding:12px 14px;border-radius:10px;background:#F1F5F9;color:#475569;font-size:12px;">📎 Adjunto Word ejecutivo: <strong style="color:#0B1F3A;">${escapeHtml(fileLabel)}</strong></p>`
        : ""
    }
  </div>
</div>`;
}

function tonoBadgeHtml(tono) {
  const map = {
    positiva: { bg: "#16a34a", text: "FAVORABLE" },
    negativa: { bg: "#dc2626", text: "CRÍTICA" },
    neutral: { bg: "#64748b", text: "NEUTRAL" },
  };
  const { bg, text } = map[tono] || map.neutral;
  return `<span style="display:inline-block;background:${bg};color:#fff;font-size:10px;font-weight:700;letter-spacing:.03em;padding:3px 8px;border-radius:999px;">${text}</span>`;
}

function broadcastToneCounts(items = []) {
  const c = { positiva: 0, negativa: 0, neutral: 0 };
  for (const it of items) {
    const t = it.tono || "neutral";
    c[t] = (c[t] || 0) + 1;
  }
  return c;
}

/** Anexo determinístico TV (.mp4) / Radio-audio (.wav/.mp3) desde Analisishoy. */
export function buildBroadcastAnnexHtml({ tv = [], radio = [], topTerms = null } = {}) {
  const all = [...tv, ...radio];
  const tones = broadcastToneCounts(all);
  const top = topTerms || topMentionedTerms(all);

  const card = (it, i) => {
    const isAudio = it.source === "radio" || it.mediaType === "audio";
    const accent = isAudio ? "#0f766e" : "#1d4ed8";
    const kind =
      it.mediaKind === "wav"
        ? "Audio (.wav)"
        : it.mediaKind === "mp3"
          ? "Audio (.mp3)"
          : isAudio
            ? "Audio"
            : "Clip TV (.mp4)";
    const cta = isAudio
      ? `Escuchar audio (${it.mediaKind || "wav"}) →`
      : "Ver clip (.mp4) →";
    const termChip = it.term
      ? `<span style="display:inline-block;margin-left:6px;padding:3px 8px;border-radius:999px;background:${
          top?.term === it.term ? "#F59E0B" : "#e2e8f0"
        };color:${top?.term === it.term ? "#111827" : "#0f172a"};font-size:10px;font-weight:800;">${escapeHtml(it.term)}</span>`
      : "";
    const link = it.url
      ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(it.url)}" style="color:#0f766e;font-weight:700;text-decoration:none;">${cta}</a></p>`
      : `<p style="margin:10px 0 0;color:#b45309;font-size:12px;">Sin URL en el MD</p>`;
    return `<tr><td style="padding:0 0 12px;">
      <table width="100%" cellspacing="0" cellpadding="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr><td style="padding:14px 16px;border-left:4px solid ${accent};">
          <p style="margin:0 0 8px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;">#${i + 1} · ${escapeHtml(kind)} · ${escapeHtml(it.at || "")}${termChip}</p>
          <p style="margin:0 0 8px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${accent};color:#ffffff !important;font-size:11px;font-weight:800;">${escapeHtml(it.medio || "Medio")}</span>
            &nbsp;${tonoBadgeHtml(it.tono || "neutral")}
          </p>
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#0f172a;line-height:1.35;">${escapeHtml(it.title || "")}</p>
          <p style="margin:0;font-size:13px;line-height:1.5;color:#334155;">${escapeHtml(it.summary || "")}</p>
          ${link}
        </td></tr>
      </table>
    </td></tr>`;
  };

  const header = `<div style="margin:28px 0 12px;padding:16px 18px;border-radius:12px;background:#f0fdfa;border:1px solid #99f6e4;">
    <div style="font-size:12px;font-weight:800;color:#134e4a;letter-spacing:.06em;text-transform:uppercase;">Hallazgos TV / Radio · Analisishoy MD</div>
    <p style="margin:8px 0 0;font-size:14px;color:#0f172a;line-height:1.5;">
      ${all.length} menciones Intrant en este ciclo
      · Favorables <strong>${tones.positiva}</strong>
      · Críticas <strong>${tones.negativa}</strong>
      · Neutrales <strong>${tones.neutral}</strong>
      · TV <strong>${tv.length}</strong> · Audio <strong>${radio.length}</strong>
    </p>
    ${
      top
        ? `<p style="margin:10px 0 0;font-size:14px;color:#0f172a;">Palabra más mencionada:
            <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#F59E0B;color:#111827;font-weight:800;">${escapeHtml(top.term)}</span>
            <span style="color:#64748b;">(${top.count})</span>
            ${
              top.ranked.length > 1
                ? `<span style="color:#64748b;"> · ${top.ranked
                    .slice(1)
                    .map((r) => `${escapeHtml(r.term)} (${r.count})`)
                    .join(" · ")}</span>`
                : ""
            }
          </p>`
        : ""
    }
  </div>`;

  if (!all.length) {
    return `${header}<p style="color:#64748b;font-size:13px;">Sin menciones Intrant en Analisishoy (hoy/ayer).</p>`;
  }

  return `${header}
  <h3 style="margin:16px 0 8px;font-size:15px;color:#1d4ed8;">Televisión · .mp4 (${tv.length})</h3>
  <table width="100%" cellspacing="0" cellpadding="0">${tv.map((it, i) => card(it, i)).join("") || "<tr><td style=\"color:#64748b;padding:8px;\">Sin clips TV.</td></tr>"}</table>
  <h3 style="margin:18px 0 8px;font-size:15px;color:#0f766e;">Audio · .wav / .mp3 (${radio.length})</h3>
  <table width="100%" cellspacing="0" cellpadding="0">${radio.map((it, i) => card(it, i)).join("") || "<tr><td style=\"color:#64748b;padding:8px;\">Sin audios.</td></tr>"}</table>`;
}
