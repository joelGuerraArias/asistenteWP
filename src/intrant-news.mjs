import { config } from "./config.mjs";
import { summarizeArticleForSheet } from "./deepseek.mjs";
import { isRelevantIntrantAlert } from "./google-alerts-parse.mjs";
import { isNewsFromToday } from "./news-date.mjs";
import { fetchArticleFromUrl } from "./news-fetch.mjs";
import { isTavilyEnabled, tavilyNewsSearch } from "./tavily.mjs";

const SEARCH_QUERIES = [
  "INTRANT República Dominicana",
  "Digesett tránsito República Dominicana",
  "Milton Morrison INTRANT",
  "seguridad vial RDVial República Dominicana",
  "aumento pasaje transporte INTRANT",
];

const EXTRA_DOMAINS = [
  ...new Set([
    "n.com.do",
    "listindiario.com",
    "diariolibre.com",
    "eldia.com.do",
    "acento.com.do",
    "elnacional.com.do",
    "hoy.com.do",
    "cdn.com.do",
    "elcaribe.com.do",
    "ensegundos.do",
    "7dias.com.do",
    "deultimominuto.net",
    "almomento.net",
    "noticiassin.com",
    "rccnoticias.com.do",
  ]),
];

function classifySentiment(text = "") {
  const t = String(text).toLowerCase();
  const neg =
    /accidente|herid|muert|detenid|exigen|queja|crítica|critica|alza|caos|peligro|denuncia|protest|ileg/;
  const pos =
    /respaldan|apoyan|garantiza|mejora|abre|inaugur|promueve|beneficio|avance|acuerdo/;
  if (pos.test(t) && !neg.test(t)) return "positivo";
  if (neg.test(t) && !pos.test(t)) return "negativo";
  if (pos.test(t) && neg.test(t)) return "mixto";
  return "neutral";
}

/**
 * Busca noticias Intrant/tránsito vía Tavily (NO Google Alerts),
 * enriquece cada URL con periodista + resumen.
 */
export async function fetchIntrantNewsForSheet({
  onlyToday = true,
  maxItems = 20,
  onStatus,
} = {}) {
  if (!isTavilyEnabled()) {
    throw new Error("Configura TAVILY_API_KEY para buscar noticias Intrant");
  }

  const filters = config.googleAlerts?.filters?.length
    ? config.googleAlerts.filters
    : undefined;

  onStatus?.("🔍 Buscando noticias Intrant / Digesett / Morrison (Tavily)...");

  const byUrl = new Map();
  for (const q of SEARCH_QUERIES) {
    try {
      const results = await tavilyNewsSearch(q, {
        maxResults: 6,
        includeDomains: EXTRA_DOMAINS,
        timeRange: onlyToday ? "day" : config.tavily.timeRange || "week",
      });
      for (const r of results) {
        if (!r.url || byUrl.has(r.url)) continue;
        if (
          !isRelevantIntrantAlert(
            { title: r.title, snippet: r.content, url: r.url },
            filters
          )
        ) {
          continue;
        }
        // Tavily "day" ≈ 24h: descartar ayer u otra fecha conocida
        if (
          onlyToday &&
          (r.publishedAt || extractLikelyDate(r.url)) &&
          !isNewsFromToday({ url: r.url, publishedAt: r.publishedAt })
        ) {
          continue;
        }
        byUrl.set(r.url, r);
      }
    } catch (error) {
      console.warn("tavily query:", q, error.message);
    }
  }

  const candidates = [...byUrl.values()].slice(0, maxItems);
  onStatus?.(
    `📄 Enriqueciendo ${candidates.length} noticia(s): periodista + resumen...`
  );

  const now = new Date();
  const enriched = [];

  for (const item of candidates) {
    if (/\/tags\/|\/tag\/|\/tema\//i.test(item.url)) continue;

    try {
      let title = item.title;
      let bodyText = item.content || "";
      let periodista = "";
      let medio = "";
      let publishedAt = item.publishedAt || "";

      try {
        const article = await fetchArticleFromUrl(item.url);
        title = article.title || title;
        bodyText = article.bodyText || bodyText;
        periodista = article.author || "";
        medio = article.sourceName || "";
        publishedAt = article.publishedAt || publishedAt;
      } catch (error) {
        console.warn("fetch article:", item.url, error.message);
        try {
          medio = new URL(item.url).hostname.replace(/^www\./, "");
        } catch {
          medio = "";
        }
      }

      if (
        !isRelevantIntrantAlert(
          { title, snippet: bodyText.slice(0, 500), url: item.url },
          filters
        )
      ) {
        continue;
      }

      // Solo noticias del día calendario actual (RD). Sin fecha fiable → fuera.
      if (
        onlyToday &&
        !isNewsFromToday({ url: item.url, publishedAt })
      ) {
        continue;
      }

      // Si el "author" es el nombre del medio, no es periodista
      if (
        periodista &&
        medio &&
        periodista.toLowerCase().includes(medio.toLowerCase().split(".")[0])
      ) {
        periodista = "";
      }
      if (
        /^(hoy|acento|el caribe|diario libre|list[ií]n|n digital|servicios de)/i.test(
          periodista
        )
      ) {
        periodista = "";
      }

      let texto =
        (await summarizeArticleForSheet({ title, bodyText }).catch(() => "")) ||
        bodyText.slice(0, 450);

      if (
        /todas las noticias del acontecer|enterate de las últimas|your browser/i.test(
          texto
        )
      ) {
        texto = (item.content || bodyText).slice(0, 450);
      }

      if (!periodista) periodista = "Redacción";
      if (!texto || texto.length < 40) continue;

      enriched.push({
        title,
        url: item.url.replace(/\?amp=1$/i, ""),
        snippet: texto,
        source: medio,
        periodista,
        sentimiento: classifySentiment(`${title} ${texto}`),
        receivedAt: now.toISOString(),
        alertQuery: "tavily-intrant",
        subject: "",
        messageUid: "",
      });
    } catch (error) {
      console.warn("enrich:", item.url, error.message);
    }
  }

  return enriched;
}

function extractLikelyDate(url = "") {
  return /\/20\d{2}\/\d{1,2}\/\d{1,2}(?:\/|$|\?)/.test(url) ||
    /20\d{2}-\d{2}-\d{2}/.test(url);
}
