/**
 * Publica noticias nuevas de feeds RSS a webhooks de redes.
 * - FV Digital → webhook fvdigital
 * - Motorsport F1 (lat) → webhook formula1rd
 * Nunca repite un guid/link ya enviado (por marca). Siempre avisa por Telegram.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Input, Telegraf } from "telegraf";
import { config } from "./config.mjs";
import { composeCardHeadline, generateSocialCaption } from "./deepseek.mjs";
import { publishToWebhook } from "./publish-webhook.mjs";
import { isPublicR2Url, uploadToR2 } from "./r2.mjs";
import { fetchImageBuffer, generateNewsCard, LOGO_F1RD_PATH } from "./social-card.mjs";
import { fetchArticleFromUrl } from "./news-fetch.mjs";

const STATE_FILE = join(config.root, ".feed-repost-sent.json");
const LAST_CHAT_FILE = join(config.root, ".last-chat.json");
const FEED_FETCH_MS = 45000;

function decodeXml(text = "") {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]) : "";
}

function attrUrl(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*\\burl=["']([^"']+)["']`, "i");
  const m = block.match(re);
  return m?.[1]?.trim() || "";
}

function stripHtml(html = "") {
  return decodeXml(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLink(url = "") {
  try {
    const u = new URL(url);
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ].forEach((k) => u.searchParams.delete(k));
    const q = u.searchParams.toString();
    return q ? `${u.origin}${u.pathname}?${q}` : `${u.origin}${u.pathname}`;
  } catch {
    return String(url || "").trim();
  }
}

export function parseRssItems(xml = "") {
  const items = [];
  const chunks = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of chunks) {
    const title = tagText(block, "title");
    const link = cleanLink(tagText(block, "link"));
    const guid = tagText(block, "guid") || link;
    const description = stripHtml(tagText(block, "description"));
    const imageUrl =
      attrUrl(block, "enclosure") ||
      attrUrl(block, "media:content") ||
      attrUrl(block, "media:thumbnail") ||
      "";
    if (!title || !link) continue;
    items.push({
      id: guid || link,
      title,
      link,
      description,
      imageUrl,
      pubDate: tagText(block, "pubDate") || "",
    });
  }
  return items;
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { sent: {} };
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    const sent = data.sent && typeof data.sent === "object" ? data.sent : {};
    // Migrar formato plano antiguo (solo FV) → claves brand::id
    const migrated = {};
    for (const [key, value] of Object.entries(sent)) {
      if (key.includes("::")) {
        migrated[key] = value;
      } else {
        migrated[`fvdigital::${key}`] = value;
      }
    }
    return { sent: migrated };
  } catch {
    return { sent: {} };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function markSent(state, brand, item, meta = {}) {
  const link = cleanLink(item.link || "");
  const id = String(item.id || link || "").trim();
  const entry = {
    brand,
    link: link || id,
    title: item.title || "",
    at: new Date().toISOString(),
    ...meta,
  };
  if (id) state.sent[`${brand}::${id}`] = entry;
  if (link && link !== id) state.sent[`${brand}::${link}`] = entry;
  // Si el id era el link, ya quedó una sola clave.
  if (!id && link) state.sent[`${brand}::${link}`] = entry;
}

function isSent(state, brand, item) {
  const link = cleanLink(item.link || "");
  const id = String(item.id || "").trim();
  if (id && state.sent[`${brand}::${id}`]) return true;
  if (link && state.sent[`${brand}::${link}`]) return true;
  if (link) {
    for (const [key, val] of Object.entries(state.sent)) {
      if (!key.startsWith(`${brand}::`)) continue;
      if (val?.link && cleanLink(val.link) === link) return true;
    }
  }
  return false;
}

/**
 * Marca URLs/GUIDs como ya publicados a redes.
 * Llamar desde bot/encuestas tras WP+webhook para que el cron feed-repost no duplique.
 *
 * @param {{ dest?: string, brand?: string, links?: string[], title?: string, source?: string }} opts
 * @returns {{ marked: number, brands: string[], links: string[] }}
 */
export function markFeedLinksSent({
  dest = "fvdigital",
  brand = "",
  links = [],
  title = "",
  source = "bot",
} = {}) {
  const brands = brand
    ? [brand === "f1rd" ? "f1rd" : "fvdigital"]
    : dest === "both"
      ? ["fvdigital", "f1rd"]
      : dest === "f1rd"
        ? ["f1rd"]
        : ["fvdigital"];

  const cleaned = [
    ...new Set(
      (Array.isArray(links) ? links : [links])
        .map((u) => cleanLink(u))
        .filter((u) => /^https?:\/\//i.test(u))
    ),
  ];
  if (!cleaned.length) return { marked: 0, brands, links: [] };

  const state = loadState();
  let marked = 0;
  for (const b of brands) {
    for (const link of cleaned) {
      if (isSent(state, b, { id: link, link, title })) continue;
      markSent(
        state,
        b,
        { id: link, link, title },
        { source, via: "external-publish" }
      );
      marked += 1;
    }
  }
  if (marked) saveState(state);
  return { marked, brands, links: cleaned };
}

function resolveChatId() {
  if (process.env.TELEGRAM_CHAT_ID) return String(process.env.TELEGRAM_CHAT_ID);
  const allowed = config.telegram?.allowedChatIds || [];
  if (allowed.length) return String(allowed[0]);
  if (!existsSync(LAST_CHAT_FILE)) return "";
  try {
    const data = JSON.parse(readFileSync(LAST_CHAT_FILE, "utf8"));
    return data.chatId ? String(data.chatId) : "";
  } catch {
    return "";
  }
}

async function notifyTelegram(lines, { photoBuffer = null, photoCaption = "" } = {}) {
  const token = config.telegram?.token;
  const chatId = resolveChatId();
  if (!token || !chatId) {
    throw new Error(
      "Telegram obligatorio: falta TELEGRAM_BOT_TOKEN o chat (.last-chat.json / TELEGRAM_ALLOWED_CHAT_IDS / TELEGRAM_CHAT_ID)."
    );
  }
  const bot = new Telegraf(token);
  if (photoBuffer) {
    const caption = (photoCaption || lines.filter(Boolean).join("\n")).slice(0, 1024);
    await bot.telegram.sendPhoto(chatId, Input.fromBuffer(photoBuffer, "feed-card.png"), {
      caption,
      disable_notification: false,
    });
    const rest = lines.filter(Boolean).join("\n");
    if (rest && rest !== caption) {
      await bot.telegram.sendMessage(chatId, rest.slice(0, 4000), {
        disable_web_page_preview: true,
      });
    }
    return;
  }
  await bot.telegram.sendMessage(chatId, lines.filter(Boolean).join("\n"), {
    disable_web_page_preview: true,
  });
}

async function fetchFeedXml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_FETCH_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AsistenteWP-FeedRepost/1.0)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveItemImage(item) {
  if (item.imageUrl) {
    try {
      return await fetchImageBuffer(item.imageUrl);
    } catch (error) {
      console.warn(`Imagen enclosure falló (${item.title}): ${error.message}`);
    }
  }
  try {
    const article = await fetchArticleFromUrl(item.link);
    if (article?.imageUrl) {
      return await fetchImageBuffer(article.imageUrl);
    }
  } catch (error) {
    console.warn(`og:image falló (${item.title}): ${error.message}`);
  }
  return null;
}

function brandHashtag(brand) {
  if (brand === "f1rd") return config.f1rdWebhook?.hashtag || "#Formula1RD";
  return config.publishWebhook?.hashtag || "#fvdigital";
}

function cardBrandOptions(brand) {
  if (brand === "f1rd") {
    const handle = brandHashtag(brand);
    return {
      logoPath: LOGO_F1RD_PATH,
      badgeText: "f1mister",
      handle,
      site: "www.formula1rd.com",
      logoWidthRatio: 0.2,
    };
  }
  return {};
}

function brandLabel(brand) {
  return brand === "f1rd" ? "F1RD" : "FV Digital";
}

function buildCaptionFallback(item, brand) {
  const hashtag = brandHashtag(brand);
  const base = item.title || "";
  return base.includes(hashtag) ? base : `${base}\n\n${hashtag}`.trim();
}

function assertWebhookReady(brand) {
  if (brand === "f1rd") {
    const cfg = config.f1rdWebhook || {};
    if (cfg.enabled === false || !cfg.url) {
      throw new Error("Webhook F1RD deshabilitado o falta F1RD_WEBHOOK_URL.");
    }
    return;
  }
  if (!config.publishWebhook?.enabled || !config.publishWebhook?.url) {
    throw new Error("Webhook FV deshabilitado o falta PUBLISH_WEBHOOK_URL.");
  }
}

async function publishOneItem(item, brand, { dryRun = false } = {}) {
  const hashtag = brandHashtag(brand);
  const bodyText = item.description || "";

  // Misma ruta que el bot al pegar un enlace: titular corto + caption de redes.
  // FV y F1RD: gráfico y caption en español.
  const lang = "es";
  const cardTitle = await composeCardHeadline(item.title, bodyText, { lang }).catch(
    () => item.title
  );
  const caption = await generateSocialCaption(item.title, bodyText, {
    hashtag,
    lang,
  }).catch(() => buildCaptionFallback(item, brand));

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      brand,
      item,
      cardTitle,
      caption,
      cardUrl: null,
      cardBuffer: null,
      webhook: null,
    };
  }

  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  assertWebhookReady(brand);

  const bg = await resolveItemImage(item);
  if (!bg) {
    throw new Error(`Sin imagen para: ${item.title}`);
  }

  // Misma tarjeta gráfica que IG/FB/URL; F1RD usa logo Formula 1 Al Límite.
  const card = await generateNewsCard({
    backgroundBuffer: bg,
    title: cardTitle,
    ...cardBrandOptions(brand),
  });
  const prefix = brand === "f1rd" ? "f1rd" : "fv";
  const filename = `${prefix}-feed-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.png`;
  const cardUrl = await uploadToR2(card, `cards/${filename}`, "image/png");
  if (!isPublicR2Url(cardUrl)) {
    throw new Error("URL R2 de tarjeta no es pública (r2.dev).");
  }

  const webhook = await publishToWebhook({
    title: cardTitle,
    caption,
    imageUrl: cardUrl,
    mediaType: "IMAGE",
    target: brand,
  });

  return {
    ok: Boolean(webhook?.ok),
    brand,
    item,
    cardTitle,
    caption,
    cardUrl,
    cardBuffer: card,
    webhook,
  };
}

function interleaveLists(lists = []) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

function feedSources() {
  const cfg = config.feedRepost || {};
  const sources = [];
  if (cfg.fvEnabled !== false) {
    sources.push({
      brand: "fvdigital",
      label: "FV Digital",
      feeds: [
        {
          id: "fvdigital",
          label: "FV Digital",
          url: cfg.url || "https://fvdigital.do/feed",
        },
      ],
      count: cfg.count,
    });
  }
  if (cfg.f1Enabled !== false) {
    sources.push({
      brand: "f1rd",
      label: "F1RD",
      feeds: [
        {
          id: "motorsport",
          label: "Motorsport F1",
          url: cfg.f1Url || "https://lat.motorsport.com/rss/f1/news/",
        },
      ],
      count: cfg.f1Count ?? cfg.count,
    });
  }
  return sources;
}

async function collectFreshFromFeeds(source, state) {
  const freshByFeed = [];
  for (const feed of source.feeds || []) {
    console.log(`[${source.label}] Leyendo ${feed.label}: ${feed.url}`);
    try {
      const xml = await fetchFeedXml(feed.url);
      const items = parseRssItems(xml).map((item) => ({
        ...item,
        feedId: feed.id,
        feedLabel: feed.label,
      }));
      console.log(`[${source.label}] ${feed.label}: ${items.length} ítems`);
      freshByFeed.push(
        items.filter((item) => !isSent(state, source.brand, item))
      );
    } catch (error) {
      console.error(
        `[${source.label}] Falló ${feed.label}: ${error.message}`
      );
      freshByFeed.push([]);
    }
  }
  return interleaveLists(freshByFeed);
}

async function processFeedSource(source, state, { dryRun = false, count } = {}) {
  const limit = Math.max(
    1,
    Math.min(10, Number(count ?? source.count ?? 2))
  );
  const label = source.label || brandLabel(source.brand);

  console.log(`\n[${label}] hasta ${limit} nuevas (feeds intercalados)`);
  const fresh = (await collectFreshFromFeeds(source, state)).slice(0, limit);

  if (!fresh.length) {
    const urls = (source.feeds || []).map((f) => f.url).join("\n");
    await notifyTelegram([
      `Feed ${label} → redes`,
      "Sin noticias nuevas en los RSS (nada por publicar).",
      urls,
    ]);
    return { published: [], errors: [], noneNew: true };
  }

  const published = [];
  const errors = [];

  for (const item of fresh) {
    const from = item.feedLabel || label;
    console.log(`[${label}/${from}] → ${item.title}`);
    try {
      const result = await publishOneItem(item, source.brand, { dryRun });
      if (!dryRun) {
        if (!result.ok) {
          throw new Error(
            result.webhook?.error || `HTTP ${result.webhook?.status || "?"}`
          );
        }
        markSent(state, source.brand, item, {
          cardUrl: result.cardUrl,
          caption: result.caption || "",
          queued: Boolean(result.webhook?.queued),
          feedId: item.feedId || null,
        });
        saveState(state);
      }

      published.push(result);
      const photoCaption = [
        dryRun ? `Feed ${label} (dry-run)` : `Gráfico para redes (${label})`,
        from,
        result.cardTitle || item.title,
      ]
        .filter(Boolean)
        .join("\n");
      await notifyTelegram(
        [
          dryRun ? `Feed ${label} (dry-run)` : `Feed ${label} → redes`,
          from,
          result.cardTitle || item.title,
          item.link,
          result.cardUrl || "(sin tarjeta)",
          dryRun
            ? "Dry-run: no se envió al webhook"
            : result.webhook?.queued
              ? "Webhook: encolado"
              : "Webhook: ok",
          result.caption,
        ],
        {
          photoBuffer: result.cardBuffer || null,
          photoCaption,
        }
      );
    } catch (error) {
      console.error(`[${label}] Error: ${error.message}`);
      errors.push({ brand: source.brand, item, error: error.message });
      try {
        await notifyTelegram([
          `Feed ${label} → redes (error)`,
          from,
          item.title,
          item.link,
          error.message,
        ]);
      } catch (tgErr) {
        console.error(`Telegram: ${tgErr.message}`);
      }
    }
  }

  return { published, errors, noneNew: false };
}

/**
 * @param {{ dryRun?: boolean, count?: number, brand?: "fvdigital"|"f1rd"|"all" }} opts
 */
export async function runFeedRepost({
  dryRun = false,
  count,
  brand = "all",
} = {}) {
  const cfg = config.feedRepost || {};
  if (cfg.enabled === false) {
    console.log("FEED_REPOST_ENABLED=false — omito.");
    return { skipped: true, reason: "disabled", published: [] };
  }

  let sources = feedSources();
  if (brand === "fvdigital" || brand === "f1rd") {
    sources = sources.filter((s) => s.brand === brand);
  }
  if (!sources.length) {
    console.log("Ningún feed habilitado.");
    return { skipped: true, reason: "no-sources", published: [] };
  }

  const state = loadState();
  const published = [];
  const errors = [];
  let noneNew = true;

  for (const source of sources) {
    const result = await processFeedSource(source, state, { dryRun, count });
    published.push(...result.published);
    errors.push(...result.errors);
    if (!result.noneNew) noneNew = false;
  }

  return {
    skipped: false,
    dryRun,
    published,
    errors,
    noneNew: noneNew && !published.length,
  };
}
