import { config } from "./config.mjs";
import { summarizeArticleForSheet } from "./deepseek.mjs";
import { isRelevantElectricAlert } from "./google-alerts-parse.mjs";
import { isNewsFromToday } from "./news-date.mjs";
import { fetchArticleFromUrl } from "./news-fetch.mjs";
import { isTavilyEnabled, tavilyNewsSearch } from "./tavily.mjs";

const SEARCH_QUERIES = [
  "Edesur apagones noticias Republica Dominicana",
  "Edeeste suministro electrico noticias",
  "Celso Marranzini CUED noticias",
  "Punta Catalina ETED noticias Dominicana",
  "EGEHID generacion electricidad Dominicana",
  "\"Edesur\" OR \"Edeeste\" apagones OR averia",
];

const EXTRA_DOMAINS = [
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
  "diarioazua.com",
];

function classifySentiment(text = "") {
  const t = String(text).toLowerCase();
  const neg =
    /apag[oó]n|apagones|aver[ií]a|queja|crítica|critica|denuncia|protest|fallo|sin luz|deuda|crisis|colapso/;
  const pos =
    /mejora|refuerza|fortalece|restablec|garantiza|inversi[oó]n|capacidad|beneficio|avance|estabilidad/;
  if (pos.test(t) && !neg.test(t)) return "positivo";
  if (neg.test(t) && !pos.test(t)) return "negativo";
  if (pos.test(t) && neg.test(t)) return "mixto";
  return "neutral";
}

function extractLikelyDate(url = "") {
  return (
    /\/20\d{2}\/\d{1,2}\/\d{1,2}(?:\/|$|\?)/.test(url) ||
    /20\d{2}-\d{2}-\d{2}/.test(url)
  );
}

export async function fetchElectricNewsForSheet({
  onlyToday = true,
  maxItems = 20,
  onStatus,
} = {}) {
  if (!isTavilyEnabled()) {
    throw new Error("Configura TAVILY_API_KEY para buscar noticias electricas");
  }

  const filters = config.electricAlerts?.filters?.length
    ? config.electricAlerts.filters
    : undefined;

  onStatus?.(
    "Buscando noticias Edesur / Edeeste / EGEHID / Punta Catalina (Tavily)..."
  );

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
          /\/tags?\/|\/tema[s]?\/|\/etiquetas?\/|\/categor(y|ia)s?\//i.test(
            r.url
          )
        ) {
          continue;
        }
        if (
          !isRelevantElectricAlert(
            { title: r.title, snippet: r.content, url: r.url },
            filters
          )
        ) {
          continue;
        }
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
      console.warn("tavily electric:", q, error.message);
    }
  }

  const candidates = [...byUrl.values()].slice(0, maxItems);
  onStatus?.(
    `Enriqueciendo ${candidates.length} noticia(s) electricas...`
  );

  const now = new Date();
  const enriched = [];

  for (const item of candidates) {
    if (
      /\/tags?\/|\/tema[s]?\/|\/etiquetas?\/|\/categor(y|ia)s?\//i.test(
        item.url
      )
    ) {
      continue;
    }

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
        !isRelevantElectricAlert(
          { title, snippet: bodyText.slice(0, 500), url: item.url },
          filters
        )
      ) {
        continue;
      }

      if (onlyToday && !isNewsFromToday({ url: item.url, publishedAt })) {
        continue;
      }

      if (
        periodista &&
        medio &&
        periodista.toLowerCase().includes(medio.toLowerCase().split(".")[0])
      ) {
        periodista = "";
      }
      if (
        /^(hoy|acento|el caribe|diario libre|list[ií]n|n digital|la redacci|el nacional)/i.test(
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
        receivedAt: publishedAt || now.toISOString(),
        publishedAt,
        alertQuery: "tavily-electric",
        fuente: medio || "web",
        subject: "",
        messageUid: "",
      });
    } catch (error) {
      console.warn("enrich electric:", item.url, error.message);
    }
  }

  return enriched;
}
