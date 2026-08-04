import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Input, Markup, Telegraf } from "telegraf";
import { pathToFileURL } from "node:url";
import { pickJarvisOpener } from "./jarvis-openers.mjs";
import { config, isChatAllowed } from "./config.mjs";
import { startHttpServer } from "./http-server.mjs";
import {
  cleanupTemp,
  downloadTelegramFile,
  getSpeechProviderLabel,
  readTempFile,
  synthesizeSpeech,
  transcribeAudio,
} from "./audio.mjs";
import { askDeepseek, buildNewsPostFromOcr, composeCardHeadline, formatNewsBodyHtml, generateNewsHeadline, generateSocialCaption, suggestNewsTitles, translateToSpanish, writeOriginalNews } from "./deepseek.mjs";
import { generateNewsCard, fetchImageBuffer } from "./social-card.mjs";
import { publishToWebhook } from "./publish-webhook.mjs";
import { isPublicR2Url, uploadToR2 } from "./r2.mjs";
import { extractFirstUrl, extractUrlFromMessage, fetchArticleFromUrl, detectSocialPlatform, socialPlatformLabel } from "./news-fetch.mjs";
import {
  cleanWriteTopic,
  emptyWriteFlow,
  formatResearchBrief,
  isValidCustomTitle,
  isWriteFlowQuestion,
  isCasualMessage,
  isHelpMessage,
  looksLikePublishableText,
  parseWriteTopic,
  searchTopicImage,
  wantsWriteNews,
} from "./news-write.mjs";
import { researchTopic } from "./news-research.mjs";
import { cleanImportedText, finalizeNewsHtml, textToNewsHtml } from "./news-format.mjs";
import { fetchGoogleAlertsForSheet } from "./gmail-alerts.mjs";
import { replaceAlertsSheet } from "./sheets-alerts.mjs";
import { cropImageByPercent, mimeFromBuffer } from "./image.mjs";
import { detectCropBox, describeImage, ocrImage } from "./vision.mjs";
import {
  createPost,
  deletePost,
  formatPostForCopy,
  formatPostSummary,
  formatTaxonomyNotice,
  formatUploadedPost,
  getPost,
  listRecentPosts,
  updatePost,
  updatePostStatus,
  uploadImageFromBuffer,
  uploadImageFromUrl,
} from "./wordpress.mjs";
import {
  checkHyperframesProject,
  createHeyGenVideo,
  formatVideoToolsStatus,
  getVideoToolsStatus,
  listRemotionCompositions,
  renderHyperframesVideo,
  renderRemotionVideo,
} from "./video-tools.mjs";
import { parseVideoIntent } from "./video-intent.mjs";
import { createVideoJob, createThrottledProgress } from "./video-progress.mjs";
import {
  emptyHyperFlow,
  extractHyperFlowPrompt,
  hyperFlowMenuText,
  parseHyperAction,
} from "./hyper-flow.mjs";
import {
  formatWpPreview,
  isWpPreviewConfirm,
  parseWpTopic,
  wpIntroText,
} from "./wp-flow.mjs";
import { coerceArticleHtml } from "./article-json.mjs";
import {
  applyResolvedFeaturedImage,
  resolveFeaturedImage,
} from "./featured-image.mjs";
import {
  buildSocialVideoR2Key,
  downloadSocialVideo,
  isSupportedSocialVideoUrl,
  socialVideoPlatformLabel,
} from "./social-video.mjs";
import {
  discardTradJob,
  finalizeTradJob,
  prepareTradJob,
} from "./trad-video.mjs";

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      mode: config.telegram.echoOnly ? "echo" : "auto",
      photoIntent: null,
      voiceReplies: config.audio.voiceReplies,
      chatHistory: [],
      buffer: {
        photos: [],
        text: "",
        title: "",
        extraCategories: [],
        processedImage: null,
      },
      timer: null,
      lastPostId: null,
      transcribeOnlyNext: false,
      editPostId: null,
      awaitingContentEdit: false,
      pendingDeleteId: null,
      writeFlow: null,
      hyperFlow: null,
      jarvisRecentOpeners: [],
      lastVideo: null,
      pendingSocialVideo: null,
      pendingTradJob: null,
    });
  }
  return sessions.get(chatId);
}

function isEchoMode(session) {
  return config.telegram.echoOnly || session.mode === "echo";
}

function helpText() {
  if (config.telegram.echoOnly) {
    return [
      "Modo ECO — devuelvo el mismo texto que envías.",
      "",
      "• /auto — activar publicación WordPress",
      "• /echo — volver a modo eco",
      "• /ayuda — esta ayuda",
    ].join("\n");
  }
  return [
    "JARVIS — FV Digital",
    "",
    "Publicación directa:",
    "• Enlace de noticia o red social (Instagram, Facebook, X) → titular, foto y texto a WP",
    "• /escribir — redactar noticia (elige entre 3 titulares)",
    "• /wp — artículo guiado: tema → borrador → foto → publicar",
    "• /noticia o /ocr — captura de pantalla (elige foto destacada antes de publicar)",
    "• /auto — foto + texto",
    "• /publicar — publicar el último borrador",
    "",
    "/cancelar — cancelar redacción o modo /hyper en curso",
    "/ia — modo conversación (opcional)",
    "",
    "Video:",
    "• /video URL — descargar (YT/IG/FB/X) → R2 → webhook (con confirmación)",
    "• /trad URL — si no es ES: doblaje pabmatos; si ya es ES: solo overlay → 9:16 → webhook",
    "• /hyper — diálogo guiado HyperFrames (generar o verificar)",
    "• «genera un video con heygen» · /heygen /remotion · /videostatus",
    "",
    "Otros: /alertas /alertas-electricas /recortar /borrador /ver /editar /borrar /estado",
  ].join("\n");
}

function unauthorized(ctx) {
  return !isChatAllowed(ctx.chat?.id);
}

const LAST_CHAT_FILE = join(config.root, ".last-chat.json");

function rememberChat(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  try {
    writeFileSync(
      LAST_CHAT_FILE,
      JSON.stringify({ chatId, at: new Date().toISOString() })
    );
  } catch {
    // ignore
  }
}

async function guard(ctx, next) {
  if (unauthorized(ctx)) {
    await reply(ctx, "No autorizado.");
    return;
  }
  rememberChat(ctx);
  return next();
}

async function reply(ctx, text, { voice = null } = {}) {
  await ctx.reply(text);
  const session = getSession(ctx.chat.id);
  if (isEchoMode(session)) return;
  const useVoice = voice ?? session.voiceReplies;
  if (!useVoice || !text) return;

  let audioPath;
  try {
    const short = text.length > 220 ? `${text.slice(0, 217)}...` : text;
    audioPath = await synthesizeSpeech(short);
    const audioBuffer = await readTempFile(audioPath);
    await ctx.replyWithAudio(Input.fromBuffer(audioBuffer, "respuesta.mp3"), {
      title: "JARVIS",
    });
  } catch (error) {
    console.warn("TTS falló:", error.message);
  } finally {
    cleanupTemp(audioPath);
  }
}

async function replyLong(ctx, text, opts = {}) {
  const max = 4000;
  if (text.length <= max) {
    await reply(ctx, text, opts);
    return;
  }

  let remaining = text;
  let first = true;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, max);
    if (remaining.length > max) {
      const cut = chunk.lastIndexOf("\n");
      if (cut > max * 0.4) chunk = remaining.slice(0, cut);
    }
    await reply(ctx, chunk, { ...opts, voice: first ? opts.voice : false });
    first = false;
    remaining = remaining.slice(chunk.length).trimStart();
  }
}

async function status(ctx, text) {
  await ctx.sendChatAction("typing").catch(() => {});
  await ctx.reply(text);
}

async function withTyping(ctx, fn) {
  await ctx.sendChatAction("typing").catch(() => {});
  const timer = setInterval(() => {
    ctx.sendChatAction("typing").catch(() => {});
  }, 4000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

async function handleCasualChat(ctx, text) {
  if (isHelpMessage(text)) {
    await ctx.reply(helpText());
    return;
  }

  const session = getSession(ctx.chat.id);
  const opener = pickJarvisOpener(session.jarvisRecentOpeners);
  session.jarvisRecentOpeners = [...session.jarvisRecentOpeners, opener.id].slice(-12);

  await ctx.reply(
    [
      `${timeGreeting()}. Soy JARVIS, su asistente editorial de FV Digital.`,
      "",
      opener.text,
      "",
      "¿En qué puedo servirle?",
      "• Enlace de noticia o red social → la subo directo",
      "• /escribir [tema] → redacto con datos de la web",
      "• /wp → artículo paso a paso para WordPress",
      "• /noticia → captura de pantalla",
      "• «genera un video heygen» → presentador con el resumen",
      "• /hyper → asistente HyperFrames paso a paso",
      "• /ayuda → comandos",
    ].join("\n")
  );
}

async function downloadPhotoBuffer(ctx, fileId) {
  return downloadTelegramFile(ctx, fileId);
}

function parseExtraCategories(text) {
  if (!text) return [];
  const match = text.match(/(?:^|\s)\+([\w-]+(?:,[\w-]+)*)/i);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim()).filter(Boolean);
}

function stripCategoryDirective(text) {
  return text.replace(/(?:^|\s)\+[\w-]+(?:,[\w-]+)*/i, "").trim();
}

function wantsCrop(caption, photoIntent) {
  return photoIntent === "crop" || /recort/i.test(caption || "");
}

function wantsNewsOcr(caption, photoIntent) {
  return photoIntent === "noticia" || /noticia|ocr|captura/i.test(caption || "");
}

async function processCrop(ctx, buffer, mimeType, hint) {
  await ctx.reply("✂️ Detectando recorte...", { voice: false });
  const box = await detectCropBox(buffer, mimeType, hint);
  const cropped = await cropImageByPercent(buffer, box);
  await ctx.replyWithPhoto(Input.fromBuffer(cropped, "recorte.jpg"), {
    caption: `Recorte listo (${Math.round(box.width)}×${Math.round(box.height)}%)`,
  });
  return { buffer: cropped, mimeType: "image/jpeg" };
}

function htmlToPlainText(html = "") {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

async function sendSocialCard(ctx, { title, imageBuffer = null, imageUrl = null, bodyText = "" }) {
  if (!config.socialCard.enabled) return;
  if (!title) return;

  try {
    let bg = imageBuffer;
    if (!bg && imageUrl) {
      bg = await fetchImageBuffer(imageUrl);
    }
    if (!bg) return; // sin imagen de fondo no se genera tarjeta

    await ctx.sendChatAction("upload_photo").catch(() => {});
    const session = getSession(ctx.chat.id);
    session.lastVideo = {
      ...(session.lastVideo || {}),
      title,
      bodyText: bodyText?.slice(0, 2000) || "",
      at: new Date().toISOString(),
    };

    const cardTitle = await composeCardHeadline(title, bodyText).catch(() => title);
    const card = await generateNewsCard({
      backgroundBuffer: bg,
      title: cardTitle,
    });

    await ctx.replyWithPhoto(Input.fromBuffer(card, "fv-card.png"), {
      caption: "🖼️ Gráfico para redes (FV Digital)",
    });

    await sendCardToWebhook(ctx, { card, title, bodyText });
  } catch (error) {
    console.warn("sendSocialCard:", error.message);
  }
}

async function uploadCardPublicUrl(card, title) {
  const filename = `fv-card-${Date.now()}.png`;

  if (config.r2?.enabled) {
    try {
      return await uploadToR2(card, `cards/${filename}`, "image/png");
    } catch (error) {
      console.warn("uploadToR2 falló, uso WordPress:", error.message);
    }
  }

  const media = await uploadImageFromBuffer(card, filename, "image/png", {
    title,
    altText: title,
  });
  return media?.source_url || null;
}

async function sendCardToWebhook(ctx, { card, title, bodyText = "" }) {
  if (!config.publishWebhook?.enabled) return;

  try {
    const publicUrl = await uploadCardPublicUrl(card, title);
    if (!publicUrl) {
      await ctx.reply("⚠️ No obtuve URL pública de la tarjeta; no la envié al webhook.");
      return;
    }

    const hashtag = config.publishWebhook.hashtag || "#fvdigital";
    const caption = await generateSocialCaption(title, bodyText, { hashtag }).catch(
      () => `${title} ${hashtag}`.trim()
    );

    const session = getSession(ctx.chat.id);
    session.lastVideo = {
      title,
      caption,
      at: new Date().toISOString(),
    };

    const result = await publishToWebhook({
      caption,
      title,
      imageUrl: publicUrl,
      mediaType: "IMAGE",
    });

    if (result.ok) {
      const note = result.queued
        ? "📤 Enviado a la cola de redes (n8n está procesando)."
        : "📤 Enviado a la cola de redes (webhook).";
      await ctx.reply(`${note}\n\n📝 ${caption}`);

      if (publicUrl) {
        session.lastVideo.imageUrl = publicUrl;
      }
    } else {
      await ctx.reply(
        `⚠️ No pude enviar al webhook: ${result.error || `HTTP ${result.status}`}`
      );
    }
  } catch (error) {
    console.warn("sendCardToWebhook:", error.message);
    await ctx.reply(`⚠️ No pude enviar la tarjeta al webhook: ${error.message}`);
  }
}

async function handleVideoStatus(ctx) {
  await status(ctx, "🎬 Revisando herramientas de video...");
  const st = await getVideoToolsStatus();
  await reply(ctx, formatVideoToolsStatus(st), { voice: false });
}

function socialVideoConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Enviar", "svideo:send"),
      Markup.button.callback("✏️ Editar caption", "svideo:edit"),
    ],
    [Markup.button.callback("❌ Cancelar", "svideo:cancel")],
  ]);
}

function ensureCaptionHashtag(caption = "") {
  const hashtag = config.publishWebhook?.hashtag || "#fvdigital";
  const base = String(caption || "").trim();
  if (!base) return hashtag;
  return base.includes(hashtag) ? base : `${base}\n\n${hashtag}`.trim();
}

async function askSocialVideoConfirm(ctx, pending) {
  const label = socialVideoPlatformLabel(pending.platform);
  const mb = (pending.bytes / 1024 / 1024).toFixed(1);
  const isTrad = pending.kind === "trad";
  const text = [
    isTrad && pending.captionFallback
      ? `🎬 Reel listo (9:16 · ${label} · ${mb} MB · voz desde caption${pending.includeHeadline === false ? " · sin titular" : ""})`
      : isTrad && pending.overlayOnly
      ? `🎬 Reel listo (9:16 · ${label} · ${mb} MB · ya en español, solo overlay${pending.includeHeadline === false ? " · sin titular" : ""})`
      : isTrad
        ? `🎬 Reel traducido listo (9:16 · ${label} · ${mb} MB · doblaje pabmatos${pending.includeHeadline === false ? " · sin titular" : ""})`
        : `🎬 Video listo (${label} · ${mb} MB)`,
    `Origen: ${pending.sourceUrl}`,
    `R2 (público): ${pending.videoUrl}`,
    isTrad && pending.language ? `Idioma detectado: ${pending.language}` : "",
    "",
    "📝 Caption propuesto:",
    pending.caption,
    "",
    "¿Lo envío al webhook de redes?",
  ]
    .filter(Boolean)
    .join("\n");

  await ctx.reply(text, {
    ...socialVideoConfirmKeyboard(),
    disable_web_page_preview: true,
  });
}

async function processSocialVideoUrl(ctx, sourceUrl) {
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  if (!config.publishWebhook?.enabled || !config.publishWebhook?.url) {
    throw new Error("Webhook deshabilitado o falta PUBLISH_WEBHOOK_URL.");
  }
  if (!isSupportedSocialVideoUrl(sourceUrl)) {
    throw new Error(
      "URL no soportada. Usa YouTube, Instagram, Facebook o X."
    );
  }

  const session = getSession(ctx.chat.id);
  session.pendingSocialVideo = null;

  await reply(ctx, "⏳ Descargando video…", { voice: false });

  const downloaded = await downloadSocialVideo(sourceUrl, {
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  await reply(ctx, "📦 Subiendo al bucket R2 (URL pública)…", { voice: false });
  const key = buildSocialVideoR2Key(downloaded.ext);
  const videoUrl = await uploadToR2(
    downloaded.buffer,
    key,
    downloaded.contentType
  );
  if (!isPublicR2Url(videoUrl)) {
    throw new Error(
      "La URL generada no es la pública de R2. Revisa R2_PUBLIC_BASE_URL (debe ser pub-….r2.dev, no cloudflarestorage.com)."
    );
  }

  await reply(ctx, "✍️ Generando caption con IA…", { voice: false });
  const hashtag = config.publishWebhook.hashtag || "#fvdigital";
  const rawCaption = await generateSocialCaption(
    downloaded.title,
    downloaded.description || downloaded.title,
    { hashtag }
  ).catch(() => downloaded.title);
  const caption = ensureCaptionHashtag(rawCaption);

  const pending = {
    videoUrl,
    r2Key: key,
    title: downloaded.title,
    caption,
    sourceUrl: downloaded.sourceUrl,
    platform: downloaded.platform,
    bytes: downloaded.bytes,
    step: "confirm",
  };
  session.pendingSocialVideo = pending;
  session.lastVideo = {
    title: pending.title,
    caption: pending.caption,
    videoUrl: pending.videoUrl,
    at: new Date().toISOString(),
  };

  await askSocialVideoConfirm(ctx, pending);
}

function tradHeadlineKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Sí, con titular", "trad:headline:yes"),
      Markup.button.callback("🚫 Sin titular", "trad:headline:no"),
    ],
    [Markup.button.callback("❌ Cancelar", "trad:headline:cancel")],
  ]);
}

async function askTradHeadlineConfirm(ctx, job) {
  const text = [
    "📰 Titular propuesto:",
    `«${job.headline || "(sin titular)"}»`,
    "",
    job.overlayOnly
      ? "El video ya está en español (solo overlay)."
      : job.captionFallback
        ? "Voz generada desde el caption."
        : "Incluye doblaje pabmatos.",
    "",
    "¿Pongo este titular sobre el video?",
  ].join("\n");

  await ctx.reply(text, tradHeadlineKeyboard());
}

async function finishTradAfterHeadlineChoice(ctx, includeHeadline) {
  const session = getSession(ctx.chat.id);
  const job = session.pendingTradJob;
  if (!job) {
    throw new Error("No hay preparación /trad pendiente. Vuelve a enviar /trad URL.");
  }

  session.pendingTradJob = null;
  session.pendingSocialVideo = null;

  const built = await finalizeTradJob(job, {
    includeHeadline,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  if (built.overlayOnly) {
    await reply(ctx, "🇪🇸 Video en español — no se tradujo, solo overlay FV.", {
      voice: false,
    });
  }

  await reply(ctx, "📦 Subiendo reel 9:16 a R2…", { voice: false });
  const key =
    built.r2KeyHint ||
    buildSocialVideoR2Key(built.ext).replace("videos/fv-", "videos/trad-");
  const videoUrl = await uploadToR2(built.buffer, key, built.contentType);
  if (!isPublicR2Url(videoUrl)) {
    throw new Error(
      "La URL generada no es la pública de R2. Revisa R2_PUBLIC_BASE_URL."
    );
  }

  await reply(ctx, "✍️ Generando caption…", { voice: false });
  const hashtag = config.publishWebhook.hashtag || "#fvdigital";
  const captionSeed =
    built.headline ||
    built.translation?.slice(0, 280) ||
    built.description?.slice(0, 280) ||
    built.title ||
    (built.overlayOnly ? "Video" : "Video traducido");
  const rawCaption = await generateSocialCaption(
    built.title || "Video",
    captionSeed,
    { hashtag }
  ).catch(() => captionSeed);
  const caption = ensureCaptionHashtag(rawCaption);

  const pending = {
    kind: "trad",
    videoUrl,
    r2Key: key,
    title: built.title,
    caption,
    sourceUrl: built.sourceUrl,
    platform: built.platform,
    bytes: built.bytes,
    language: built.language,
    translation: built.translation,
    headline: built.headline,
    overlayOnly: built.overlayOnly,
    captionFallback: built.captionFallback,
    includeHeadline: built.includeHeadline,
    step: "confirm",
  };
  session.pendingSocialVideo = pending;
  session.lastVideo = {
    title: pending.title,
    caption: pending.caption,
    videoUrl: pending.videoUrl,
    at: new Date().toISOString(),
  };

  await askSocialVideoConfirm(ctx, pending);
}

async function processTradVideoUrl(ctx, sourceUrl) {
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  if (!config.publishWebhook?.enabled || !config.publishWebhook?.url) {
    throw new Error("Webhook deshabilitado o falta PUBLISH_WEBHOOK_URL.");
  }
  if (!config.audio.mistralApiKey) {
    throw new Error("Falta MISTRAL_API_KEY para /trad.");
  }
  if (!isSupportedSocialVideoUrl(sourceUrl)) {
    throw new Error(
      "URL no soportada. Usa YouTube, Instagram, Facebook o X."
    );
  }

  const session = getSession(ctx.chat.id);
  if (session.pendingTradJob) {
    await discardTradJob(session.pendingTradJob);
    session.pendingTradJob = null;
  }
  session.pendingSocialVideo = null;

  await reply(
    ctx,
    "⏳ /trad: descargando video (detecto idioma → doblaje o solo overlay)…",
    { voice: false }
  );

  const job = await prepareTradJob(sourceUrl, {
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  session.pendingTradJob = job;
  session.pendingSocialVideo = {
    kind: "trad",
    step: "ask_headline",
    sourceUrl: job.sourceUrl,
    headline: job.headline,
  };

  await askTradHeadlineConfirm(ctx, job);
}

async function sendPendingSocialVideoToWebhook(ctx) {
  const session = getSession(ctx.chat.id);
  const pending = session.pendingSocialVideo;
  if (!pending?.videoUrl) {
    throw new Error("No hay video pendiente de envío.");
  }

  if (!isPublicR2Url(pending.videoUrl)) {
    throw new Error(
      "El video pendiente no tiene URL pública R2. Cancela y vuelve a intentar /video."
    );
  }

  const caption = ensureCaptionHashtag(pending.caption);
  const result = await publishToWebhook({
    caption,
    title: pending.title || caption,
    videoUrl: pending.videoUrl,
    r2Key: pending.r2Key || null,
    mediaType: "VIDEO",
  });

  session.pendingSocialVideo = null;

  if (result.ok) {
    const note = result.queued
      ? "📤 Video (R2) encolado en n8n (procesando)."
      : "📤 Video enviado al webhook con URL R2.";
    await ctx.reply(
      `${note}\n\n🔗 ${pending.videoUrl}\n\n📝 ${caption}`,
      { disable_web_page_preview: true }
    );
  } else {
    throw new Error(result.error || `HTTP ${result.status}`);
  }
}

async function handleHeyGenCommand(ctx, text = "") {
  const session = getSession(ctx.chat.id);
  const prompt = text.trim() || session.lastVideo?.caption || session.lastVideo?.title;

  if (!prompt) {
    await ctx.reply(
      "No hay texto para el video. Publica una noticia o escribe:\n/heygen [guión o resumen]",
      { voice: false }
    );
    return;
  }

  const preview =
    prompt.length > 140 ? `${prompt.slice(0, 137)}...` : prompt;

  const job = await createVideoJob(ctx, {
    tool: "HeyGen",
    label: "Generando video con presentador",
    detail: `Guión: ${preview}`,
  });

  try {
    await withTyping(ctx, async () => {
      let lastLine = "⏳ HeyGen está procesando el video...";

      const { videoUrl } = await createHeyGenVideo({
        prompt,
        orientation: config.video.heygen.orientation,
        onProgress: (line) => {
          lastLine = `⏳ ${line}`;
          job.update(lastLine).catch(() => {});
        },
      });

      if (videoUrl) {
        await job.finish({
          ok: true,
          message: "✅ Video HeyGen listo",
          videoUrl,
        });
        return;
      }

      await job.finish({
        ok: true,
        message:
          "✅ HeyGen completó la sesión. Si no ves el video, revisa app.heygen.com",
      });
    });
  } catch (error) {
    console.error("handleHeyGenCommand:", error);
    await job.finish({
      ok: false,
      message: `❌ HeyGen: ${error.message}`,
    });
  }
}

async function handleHyperframesCommand(ctx, { render = false, prompt = "" } = {}) {
  if (render) {
    const detail = prompt
      ? `Texto: ${prompt.length > 100 ? `${prompt.slice(0, 97)}...` : prompt}`
      : "Puede tardar varios minutos.";

    const job = await createVideoJob(ctx, {
      tool: "HyperFrames",
      label: "Renderizando composición HTML",
      detail,
    });

    try {
      const progress = createThrottledProgress((line) => {
        job.update(`⏳ ${line.slice(0, 160)}`).catch(() => {});
      });

      await withTyping(ctx, async () => {
        const { outputPath } = await renderHyperframesVideo({
          prompt,
          onProgress: (line) => {
            progress(line);
          },
        });

        await job.finish({
          ok: true,
          message: "✅ Video HyperFrames listo",
          videoPath: outputPath,
        });
      });
    } catch (error) {
      console.error("handleHyperframesCommand:", error);
      await job.finish({
        ok: false,
        message: `❌ HyperFrames: ${error.message}`,
      });
    }
    return;
  }

  try {
    await status(ctx, "🔍 Verificando proyecto HyperFrames...");
    const out = await checkHyperframesProject();
    await reply(
      ctx,
      ["✅ HyperFrames en la app", "", out, "", "Preview local: npm run video:hyperframes"].join(
        "\n"
      ),
      { voice: false }
    );
  } catch (error) {
    await ctx.reply(`❌ HyperFrames: ${error.message}`, { voice: false });
  }
}

async function handleRemotionCommand(ctx, { render = false } = {}) {
  if (render) {
    const job = await createVideoJob(ctx, {
      tool: "Remotion",
      label: "Renderizando composición MyComp",
      detail: "Puede tardar varios minutos.",
    });

    try {
      await withTyping(ctx, async () => {
        const { outputPath } = await renderRemotionVideo({
          onProgress: (line) => job.update(`⏳ ${line}`).catch(() => {}),
        });

        await job.finish({
          ok: true,
          message: "✅ Video Remotion listo",
          videoPath: outputPath,
        });
      });
    } catch (error) {
      await job.finish({
        ok: false,
        message: `❌ Remotion: ${error.message}`,
      });
    }
    return;
  }

  try {
    await status(ctx, "🎞️ Listando composiciones Remotion...");
    const out = await listRemotionCompositions();
    await reply(
      ctx,
      ["✅ Remotion en la app", "", out, "", "Studio local: npm run video:remotion"].join("\n"),
      { voice: false }
    );
  } catch (error) {
    await ctx.reply(`❌ Remotion: ${error.message}`, { voice: false });
  }
}

async function tryRouteVideoIntent(ctx, text) {
  const intent = parseVideoIntent(text);
  if (!intent) return false;

  try {
    switch (intent.tool) {
      case "status":
        await handleVideoStatus(ctx);
        break;
      case "heygen":
        await handleHeyGenCommand(ctx, intent.prompt);
        break;
      case "hyperframes":
        await handleHyperframesCommand(ctx, {
          render: intent.render,
          prompt: intent.prompt,
        });
        break;
      case "remotion":
        await handleRemotionCommand(ctx, { render: intent.render });
        break;
      default:
        return false;
    }
    return true;
  } catch (error) {
    console.error("tryRouteVideoIntent:", error);
    await ctx.reply(`❌ Video: ${error.message}`, { voice: false });
    return true;
  }
}

async function handleNewsFromUrl(ctx, url, extraCategorySlugs = []) {
  try {
    await withTyping(ctx, async () => {
      const platform = detectSocialPlatform(url);
      const platformLabel = platform ? socialPlatformLabel(platform) : null;

      await status(
        ctx,
        platformLabel
          ? `1/4 📱 Leyendo publicación de ${platformLabel}...`
          : "1/4 📰 Leyendo la noticia del enlace..."
      );

      const article = await fetchArticleFromUrl(url);
      const cleanBody = article.platform
        ? article.bodyText
        : cleanImportedText(article.bodyText);

      // En redes el "título" es el propio texto del post; generamos un
      // titular periodístico real a partir del contenido.
      let headlineForFormat = article.title;
      if (platform) {
        await status(ctx, "2/4 🧠 Redactando titular a partir del contenido...");
        headlineForFormat = await generateNewsHeadline(cleanBody, {
          platform: platformLabel,
          fallbackTitle: article.title,
        }).catch(() => article.title);
      }

      const titlePreview =
        headlineForFormat.length > 90
          ? `${headlineForFormat.slice(0, 87)}...`
          : headlineForFormat;
      await status(ctx, `2/4 ✅ Titular:\n${titlePreview}`);

      await status(ctx, "2/4 ✍️ Traduciendo y formateando en español...");
      const formatted = await formatNewsBodyHtml({
        text: cleanBody,
        title: headlineForFormat,
        topic: platformLabel ? `publicación de ${platformLabel}` : "",
      });
      const spanishTitle = formatted.title;
      const bodyHtml = coerceArticleHtml(formatted.content_html);
      const html = finalizeNewsHtml(bodyHtml, { skipSource: true });

      if (platform) {
        const session = getSession(ctx.chat.id);
        session.writeFlow = {
          ...emptyWriteFlow(),
          source: "social",
          step: "photo",
          topic: spanishTitle,
          selectedTitle: spanishTitle,
          excerpt: cleanBody.slice(0, 200),
          body_html: html,
          imageUrl: article.imageUrl || null,
          extraCategorySlugs,
        };

        await ctx.reply(
          [
            `✅ Publicación de ${platformLabel} procesada.`,
            `Titular: ${spanishTitle}`,
            "",
            "Elige la foto destacada (siempre la verás antes de publicar).",
          ].join("\n"),
          { voice: false }
        );
        await askFeaturedImage(ctx, session);
        return;
      }

      let featuredMediaId = 0;
      if (article.imageUrl) {
        await status(ctx, "3/4 🖼️ Subiendo imagen destacada...");
        try {
          const media = await uploadImageFromUrl(
            article.imageUrl,
            `noticia-${Date.now()}.jpg`
          );
          featuredMediaId = media.id;
          await status(ctx, `3/4 ✅ Imagen subida (ID ${featuredMediaId})`);
        } catch (error) {
          console.warn("Imagen de noticia no descargada:", error.message);
          await status(ctx, `3/4 ⚠️ Sin imagen: ${error.message}`);
        }
      } else {
        await status(ctx, "3/4 ℹ️ Continúo sin imagen destacada.");
      }

      await status(ctx, "4/4 📤 Subiendo a WordPress...");
      const postStatus = config.autoPublishUrls ? "publish" : config.defaultPostStatus;
      const result = await createPost({
        title: spanishTitle,
        text: cleanBody.slice(0, 200),
        htmlContent: html,
        featuredMediaId,
        extraCategorySlugs,
        status: postStatus,
      });

      const verified = await getPost(result.post.id);
      if (!verified?.id) {
        throw new Error("WordPress no confirmó el post. Revisa permisos de hermes.");
      }

      const session = getSession(ctx.chat.id);
      session.lastPostId = verified.id;

      await reply(
        ctx,
        formatTaxonomyNotice({
          categories: result.categories,
          tags: result.tags,
        }),
        { voice: false }
      );
      await replyLong(
        ctx,
        formatUploadedPost(verified, { categories: result.categories, tags: result.tags }),
        { voice: false }
      );

      await sendSocialCard(ctx, {
        title: spanishTitle,
        imageUrl: article.imageUrl || null,
        bodyText: cleanBody,
      });
    });
  } catch (error) {
    console.error("handleNewsFromUrl:", error);
    await ctx.reply(`❌ No pude subir la noticia: ${error.message}`);
  }
}

function cancelWriteFlow(session) {
  session.writeFlow = null;
}

function cancelHyperFlow(session) {
  session.hyperFlow = null;
}

async function startHyperFlow(ctx, { silent = false } = {}) {
  const session = getSession(ctx.chat.id);
  if (session.writeFlow) cancelWriteFlow(session);
  session.hyperFlow = emptyHyperFlow();
  if (!silent) await ctx.reply(hyperFlowMenuText(), { voice: false });
}

async function handleHyperFlowMessage(ctx, text) {
  const session = getSession(ctx.chat.id);
  const hf = session.hyperFlow;
  if (!hf) return;

  if (/^\/cancelar$/i.test(text) || /^cancelar$/i.test(text)) {
    cancelHyperFlow(session);
    await ctx.reply("Modo HyperFrames cancelado.", { voice: false });
    return;
  }

  if (hf.step === "action") {
    const directPrompt = extractHyperFlowPrompt(text);
    if (
      directPrompt &&
      /genera|render|video|diciendo|haz|crea/i.test(text) &&
      directPrompt.length >= 2
    ) {
      cancelHyperFlow(session);
      await handleHyperframesCommand(ctx, { render: true, prompt: directPrompt });
      return;
    }

    const action = parseHyperAction(text);
    if (!action) {
      await ctx.reply(
        "No entendí. Responda 1, 2, 3 o 4, o descríbame el video que quiere.",
        { voice: false }
      );
      return;
    }

    if (action === "cancel") {
      cancelHyperFlow(session);
      await ctx.reply("Modo HyperFrames cancelado.", { voice: false });
      return;
    }

    if (action === "check") {
      cancelHyperFlow(session);
      await handleHyperframesCommand(ctx, { render: false });
      return;
    }

    if (action === "render-last") {
      const prompt = session.lastVideo?.caption || session.lastVideo?.title;
      if (!prompt) {
        hf.step = "text";
        await ctx.reply(
          "No hay noticia reciente. Escriba el texto que debe aparecer en el video:",
          { voice: false }
        );
        return;
      }
      cancelHyperFlow(session);
      await handleHyperframesCommand(ctx, { render: true, prompt });
      return;
    }

    if (action === "render-text") {
      hf.step = "text";
      await ctx.reply("¿Qué texto debe aparecer en el video?", { voice: false });
      return;
    }
  }

  if (hf.step === "text") {
    const prompt = text.trim();
    if (!prompt || prompt.length < 2) {
      await ctx.reply("Escriba el texto del video (mínimo 2 caracteres).", { voice: false });
      return;
    }
    cancelHyperFlow(session);
    await handleHyperframesCommand(ctx, { render: true, prompt });
  }
}

function aiStackBrief() {
  const researchLine = config.tavily.enabled
    ? "Búsqueda web: Tavily (avanzada) + Google News + medios RD + Wikipedia"
    : "Búsqueda web: Google News + N Digital, Listín, Diario Libre + Wikipedia";
  return [
    "Motor de redacción: DeepSeek V4 Pro (" + config.deepseek.model + ")",
    researchLine,
    "Visión/OCR: Mistral (" + config.vision.model + ")",
    "",
    "Los titulares y el artículo se basan en esa investigación, no en suposiciones.",
  ].join("\n");
}

async function answerWriteFlowQuestion(ctx, session, text) {
  const t = text.toLowerCase();
  const wf = session.writeFlow;
  const research = wf?.research;

  if (/qué ia|que ia|inteligencia artificial|qué modelo|que modelo|deepseek|mistral|usas/i.test(t)) {
    await ctx.reply(aiStackBrief());
    await remindWriteStep(ctx, wf);
    return;
  }

  if (/datos?\s+reales?|fuente|información real|noticias parecidas/i.test(t)) {
    await ctx.reply(formatResearchBrief(research));
    await remindWriteStep(ctx, wf);
    return;
  }

  if (/^investiga/i.test(t)) {
    await status(ctx, "🔍 Actualizando búsqueda en la web...");
    try {
      wf.research = await researchTopic(wf.topic);
      await ctx.reply(formatResearchBrief(wf.research));
    } catch (error) {
      await ctx.reply(`No pude actualizar la búsqueda: ${error.message}`);
    }
    await remindWriteStep(ctx, wf);
    return;
  }

  const { content } = await askDeepseek(
    [
      `Estamos redactando una noticia para FV Digital sobre: "${wf.topic}".`,
      `El usuario pregunta: "${text}"`,
      "",
      "Responde breve en español, con datos concretos si los hay.",
      "NO inventes. NO propongas opciones A/B/C.",
      "Cierra recordando el paso actual (elegir titular o foto).",
      "",
      research?.researchText
        ? `Investigación web:\n${research.researchText.slice(0, 2500)}`
        : "Sin investigación web todavía.",
    ].join("\n"),
    []
  );
  await ctx.reply(content);
  await remindWriteStep(ctx, wf);
}

async function remindWriteStep(ctx, wf) {
  if (wf.step === "title") {
    await ctx.reply("Siguiente paso: responde 1, 2, 3 o escribe tu titular.");
  } else if (wf.step === "photo") {
    await ctx.reply(
      "Siguiente paso: envía foto, escribe *buscar*, *captura* (si aplica) o *sin foto*."
    );
  }
}

async function researchWithStatus(ctx, topic) {
  return researchTopic(topic, {
    onStatus: (msg) => status(ctx, msg).catch(() => {}),
  });
}

async function findFeaturedImage(ctx, wf) {
  if (wf.imageBuffer || wf.imageUrl) return wf.imageUrl;

  await status(
    ctx,
    config.tavily.enabled
      ? "🖼️ Buscando foto destacada (Tavily + web)..."
      : "🖼️ Buscando foto destacada en la web..."
  );

  const imageUrl = await searchTopicImage(wf.topic || wf.selectedTitle);
  if (!imageUrl) return null;

  try {
    await status(ctx, "⬇️ Descargando imagen encontrada...");
    const resolved = await resolveFeaturedImage(imageUrl);
    applyResolvedFeaturedImage(wf, resolved);
    if (resolved.r2Url) {
      await status(ctx, "☁️ Imagen guardada en R2.");
    }
    return wf.imageUrl || imageUrl;
  } catch (error) {
    console.warn("findFeaturedImage download:", error.message);
    wf.imageUrl = imageUrl;
    return imageUrl;
  }
}

async function askWriteTitles(ctx, session) {
  try {
    session.writeFlow.research = await Promise.race([
      researchWithStatus(ctx, session.writeFlow.topic),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Búsqueda web tardó demasiado")), 60000)
      ),
    ]);
  } catch (error) {
    console.warn("researchTopic:", error.message);
    session.writeFlow.research = { researchText: "", similarNews: [], articleBodies: [] };
    await ctx.reply(`ℹ️ Búsqueda web limitada (${error.message}). Continúo con lo disponible.`);
  }

  const research = session.writeFlow.research;
  const similarLines = [];

  if (research.articleBodies?.length) {
    for (const article of research.articleBodies.slice(0, 3)) {
      similarLines.push(`• ${article.title}`);
    }
  } else if (research.similarNews?.length) {
    for (const item of research.similarNews.slice(0, 3)) {
      similarLines.push(`• ${item.title}`);
    }
  }

  if (similarLines.length) {
    await ctx.reply(
      ["📰 Noticias parecidas encontradas:", ...similarLines].join("\n")
    );
  } else {
    await ctx.reply("ℹ️ No encontré noticias parecidas; usaré contexto general.");
  }

  const brief = formatResearchBrief(research);
  if (research.researchText || research.articleBodies?.length) {
    await ctx.reply(["📊 Resumen de la investigación:", brief].join("\n\n"));
  }

  if (research.imageUrl && !session.writeFlow.imageUrl) {
    session.writeFlow.imageUrl = research.imageUrl;
  }

  await status(ctx, "📝 Sugiriendo titulares con la información encontrada...");
  const titles = await suggestNewsTitles(
    session.writeFlow.topic,
    research.researchText || ""
  );
  session.writeFlow.titles = titles;
  session.writeFlow.step = "title";

  await reply(
    ctx,
    [
      `Tema: ${session.writeFlow.topic}`,
      "",
      "Titulares sugeridos:",
      ...titles.map((t, i) => `${i + 1}. ${t}`),
      "",
      "Responde con el número (1-3) o escribe tu propio titular.",
      "Puedes preguntar si hay datos reales o qué IA uso antes de elegir.",
    ].join("\n"),
    { voice: false }
  );
}

async function startWriteFlow(ctx, text) {
  const session = getSession(ctx.chat.id);
  if (session.hyperFlow) cancelHyperFlow(session);
  const topic = parseWriteTopic(text);
  session.writeFlow = emptyWriteFlow();
  session.writeFlow.extraCategorySlugs = parseExtraCategories(text);

  await ctx.reply(
    "✍️ Redacción de noticia — buscaré datos reales en la web antes de publicar."
  );

  if (topic) {
    session.writeFlow.topic = cleanWriteTopic(topic);
    try {
      await askWriteTitles(ctx, session);
    } catch (error) {
      console.error("askWriteTitles:", error);
      cancelWriteFlow(session);
      await ctx.reply(`❌ Error al preparar la noticia: ${error.message}`);
    }
    return;
  }

  session.writeFlow.step = "topic";
  await ctx.reply("¿Sobre qué tema es la noticia?");
}

async function generateWpDraft(ctx, session) {
  const wf = session.writeFlow;
  wf.step = "generating";

  try {
    wf.research = await Promise.race([
      researchWithStatus(ctx, wf.topic),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Búsqueda web tardó demasiado")), 60000)
      ),
    ]).catch((error) => {
      console.warn("researchTopic wp:", error.message);
      return { researchText: "", similarNews: [], articleBodies: [], imageUrl: null };
    });

    if (wf.research.imageUrl && !wf.imageUrl) {
      wf.imageUrl = wf.research.imageUrl;
    }

    await status(ctx, "✍️ Redactando titular y contenido...");
    const titles = await suggestNewsTitles(wf.topic, wf.research.researchText || "");
    wf.titles = titles;
    wf.selectedTitle = titles[0] || wf.topic;

    const draft = await writeOriginalNews({
      topic: wf.topic,
      title: wf.selectedTitle,
      researchText: wf.research.researchText || "",
    });

    wf.body_html = finalizeNewsHtml(coerceArticleHtml(draft.body_html), {
      skipSource: true,
    });
    wf.excerpt = draft.excerpt || "";
    wf.step = "preview";

    await showWpPreview(ctx, session);
  } catch (error) {
    console.error("generateWpDraft:", error);
    cancelWriteFlow(session);
    await ctx.reply(`❌ Error al redactar: ${error.message}`, { voice: false });
  }
}

async function showWpPreview(ctx, session) {
  const wf = session.writeFlow;
  await reply(
    ctx,
    formatWpPreview({
      title: wf.selectedTitle,
      excerpt: wf.excerpt,
      bodyPlain: htmlToPlainText(wf.body_html),
    }),
    { voice: false }
  );
}

async function startWpFlow(ctx, text) {
  const session = getSession(ctx.chat.id);
  if (session.hyperFlow) cancelHyperFlow(session);

  const topic = parseWpTopic(text);
  session.writeFlow = emptyWriteFlow();
  session.writeFlow.source = "wp";
  session.writeFlow.extraCategorySlugs = parseExtraCategories(text);

  await ctx.reply(wpIntroText(), { voice: false });

  if (topic) {
    session.writeFlow.topic = cleanWriteTopic(topic);
    await generateWpDraft(ctx, session);
    return;
  }

  session.writeFlow.step = "topic";
  await ctx.reply("¿Sobre qué tema quieres el artículo?", { voice: false });
}

async function previewFeaturedImage(ctx, { buffer, url, caption, wf = null }) {
  const defaultCaption =
    "¿Usamos esta imagen destacada? Responde *sí* para publicar, *buscar* otra, o envía otra foto.";

  if (!buffer && url) {
    try {
      await status(ctx, "⬇️ Descargando imagen para previsualizar...");
      const resolved = await resolveFeaturedImage(url);
      buffer = resolved.buffer;
      applyResolvedFeaturedImage(wf, resolved);
    } catch (error) {
      console.warn("previewFeaturedImage:", error.message);
      await ctx.reply(
        [
          "Encontré una imagen pero no pude descargarla.",
          url ? `URL: ${url}` : "",
          wf?.imageR2Url ? `R2: ${wf.imageR2Url}` : "",
          caption || defaultCaption,
        ]
          .filter(Boolean)
          .join("\n\n"),
        { voice: false }
      );
      return;
    }
  }

  if (buffer) {
    const extra =
      wf?.imageR2Url && config.r2?.enabled
        ? `\n\n☁️ Guardada en R2: ${wf.imageR2Url}`
        : "";
    await ctx.replyWithPhoto(Input.fromBuffer(buffer, "destacada.jpg"), {
      caption: `${caption || defaultCaption}${extra}`,
    });
    return;
  }
}

async function askFeaturedImage(ctx, session) {
  const wf = session.writeFlow;
  wf.step = "photo";

  if (!wf.imageUrl && !wf.imageBuffer) {
    await findFeaturedImage(ctx, wf);
  }

  const lines = [
    `Titular: ${wf.selectedTitle}`,
    "",
    wf.source === "wp"
      ? "¿Foto destacada para publicar en WordPress?"
      : "¿Foto destacada para el artículo?",
    "• Envía una imagen",
    "• Escribe *buscar* — busco otra en la web",
  ];

  if (wf.source === "ocr" && wf.captureBuffer) {
    lines.push("• Escribe *captura* — usar imagen del screenshot");
  }

  lines.push("• Escribe *sin foto* — publicar sin imagen destacada");
  lines.push("", "Siempre te muestro la imagen antes de publicar.");

  await reply(ctx, lines.join("\n"), { voice: false });

  if (wf.imageUrl) {
    const fromSocial = wf.source === "social";
    await previewFeaturedImage(ctx, {
      url: wf.imageUrl,
      wf,
      caption: fromSocial
        ? "Imagen de la publicación. Responde *sí*, *buscar* otra, o envía tu foto."
        : "Imagen sugerida. Responde *sí*, *buscar* otra, o envía tu foto.",
    });
    return;
  }

  await ctx.reply(
    "No encontré imagen automática. Envía una foto o escribe *buscar*.",
    { voice: false }
  );
}

async function askWritePhoto(ctx, session) {
  await askFeaturedImage(ctx, session);
}

async function publishWrittenNews(ctx) {
  const session = getSession(ctx.chat.id);
  const wf = session.writeFlow;
  if (!wf?.selectedTitle) throw new Error("Falta el titular");

  wf.step = "writing";

  try {
    await withTyping(ctx, async () => {
      let spanishTitle;
      let html;
      let excerpt;

      if (wf.source === "ocr" || wf.source === "social") {
        await status(ctx, "1/3 ✍️ Preparando artículo...");
        if (wf.source === "ocr") {
          spanishTitle = await translateToSpanish(wf.selectedTitle, {
            context: "titular de noticia",
          });
          html = finalizeNewsHtml(coerceArticleHtml(wf.body_html), { skipSource: true });
        } else {
          spanishTitle = wf.selectedTitle;
          html = coerceArticleHtml(wf.body_html);
        }
        excerpt = wf.excerpt || "";
      } else if (wf.source === "wp") {
        await status(ctx, "1/3 ✍️ Preparando artículo...");
        spanishTitle = await translateToSpanish(wf.selectedTitle, {
          context: "titular de noticia",
        });
        html = coerceArticleHtml(wf.body_html);
        excerpt = wf.excerpt || "";
      } else {
        await status(ctx, "1/4 🔍 Verificando datos en la web...");
        const research =
          wf.research?.researchText
            ? wf.research
            : await researchTopic(wf.topic).catch(() => ({
                researchText: "",
                imageUrl: null,
              }));

        await status(ctx, "2/4 ✍️ Redactando con datos reales...");
        spanishTitle = await translateToSpanish(wf.selectedTitle, {
          context: "titular de noticia",
        });
        const draft = await writeOriginalNews({
          topic: wf.topic,
          title: spanishTitle,
          researchText: research.researchText || "",
        });
        html = finalizeNewsHtml(coerceArticleHtml(draft.body_html), { skipSource: true });
        excerpt = draft.excerpt || "";
      }

      let featuredMediaId = 0;

      if (wf.imageBuffer) {
        await status(
          ctx,
          wf.source === "ocr" || wf.source === "social" || wf.source === "wp"
            ? "2/3 🖼️ Subiendo imagen destacada..."
            : "3/4 🖼️ Subiendo tu imagen..."
        );
        const media = await uploadImageFromBuffer(
          wf.imageBuffer,
          `noticia-${Date.now()}.jpg`,
          wf.imageMimeType || "image/jpeg"
        );
        featuredMediaId = media.id;
      } else if (wf.imageUrl) {
        await status(
          ctx,
          wf.source === "ocr" || wf.source === "social" || wf.source === "wp"
            ? "2/3 🖼️ Subiendo imagen destacada..."
            : "3/4 🖼️ Subiendo imagen encontrada..."
        );
        try {
          const media = await uploadImageFromUrl(wf.imageUrl, `noticia-${Date.now()}.jpg`);
          featuredMediaId = media.id;
        } catch (error) {
          console.warn("Imagen de búsqueda no descargada:", error.message);
          await status(ctx, `⚠️ Sin imagen: ${error.message}`);
        }
      } else {
        await status(
          ctx,
          wf.source === "ocr" || wf.source === "social" || wf.source === "wp"
            ? "2/3 ℹ️ Sin imagen destacada."
            : "3/4 ℹ️ Sin imagen destacada."
        );
      }

      await status(
        ctx,
        wf.source === "ocr" || wf.source === "social" || wf.source === "wp"
          ? "3/3 📤 Subiendo a WordPress..."
          : "4/4 📤 Subiendo a WordPress..."
      );
      const postStatus = config.autoPublishUrls ? "publish" : config.defaultPostStatus;
      html = coerceArticleHtml(html);
      const result = await createPost({
        title: spanishTitle,
        text: excerpt,
        htmlContent: html,
        featuredMediaId,
        extraCategorySlugs: wf.extraCategorySlugs,
        status: postStatus,
      });

      const verified = await getPost(result.post.id);
      if (!verified?.id) {
        throw new Error("WordPress no confirmó el post.");
      }

      const cardImageBuffer = wf.imageBuffer || wf.captureBuffer || null;
      const cardImageUrl = wf.imageUrl || null;

      session.lastPostId = verified.id;
      session.writeFlow = null;

      await reply(
        ctx,
        formatTaxonomyNotice({
          categories: result.categories,
          tags: result.tags,
        }),
        { voice: false }
      );
      await replyLong(
        ctx,
        formatUploadedPost(verified, { categories: result.categories, tags: result.tags }),
        { voice: false }
      );

      const captionSource =
        [excerpt, htmlToPlainText(html)].filter(Boolean).join(" ").trim() ||
        excerpt;

      await sendSocialCard(ctx, {
        title: spanishTitle,
        imageBuffer: cardImageBuffer,
        imageUrl: cardImageUrl,
        bodyText: captionSource,
      });
    });
  } catch (error) {
    console.error("publishWrittenNews:", error);
    wf.step = "photo";
    await ctx.reply(`❌ Error al publicar: ${error.message}`);
  }
}

async function handleWritePhotoStep(ctx, text) {
  const session = getSession(ctx.chat.id);
  const wf = session.writeFlow;
  const lower = text.toLowerCase().trim();
  const searchTopic = wf.topic || wf.selectedTitle;

  if (/^(sin foto|sin imagen|no|ninguna)$/i.test(lower)) {
    wf.imageBuffer = null;
    wf.imageUrl = null;
    await publishWrittenNews(ctx);
    return;
  }

  if (/^(sí|si|publicar|ok|dale)$/i.test(lower) && (wf.imageUrl || wf.imageBuffer)) {
    await publishWrittenNews(ctx);
    return;
  }

  if (/^(captura|usar captura)$/i.test(lower)) {
    if (!wf.captureBuffer) {
      await ctx.reply("No hay captura guardada. Envía una foto o escribe *buscar*.");
      return;
    }
    wf.imageBuffer = wf.captureBuffer;
    wf.imageMimeType = wf.captureMime || "image/jpeg";
    wf.imageUrl = null;
    await previewFeaturedImage(ctx, {
      buffer: wf.imageBuffer,
      caption:
        "Imagen del screenshot. Responde *sí* para publicar, *buscar* otra, o envía otra foto.",
    });
    return;
  }

  if (/^buscar$/i.test(lower)) {
    await status(ctx, "🔍 Buscando imagen relacionada...");
    const imageUrl = await searchTopicImage(searchTopic);
    if (!imageUrl) {
      await ctx.reply("No encontré imagen. Envía una foto o escribe *sin foto*.");
      return;
    }
    wf.imageUrl = imageUrl;
    wf.imageBuffer = null;
    wf.imageR2Url = null;
    await previewFeaturedImage(ctx, {
      url: imageUrl,
      wf,
      caption:
        "Imagen encontrada en la web. Responde *sí* para publicar, *buscar* otra, o envía tu foto.",
    });
    return;
  }

  await ctx.reply(
    "Envía una foto, escribe *buscar*, *captura* (si aplica), *sin foto*, o *sí* si ya viste la imagen."
  );
}

async function acceptFeaturedPhoto(ctx, imageBuffer, mimeType) {
  const session = getSession(ctx.chat.id);
  const wf = session.writeFlow;
  wf.imageBuffer = imageBuffer;
  wf.imageMimeType = mimeType;
  wf.imageUrl = null;
  await previewFeaturedImage(ctx, {
    buffer: imageBuffer,
    caption:
      "Tu imagen destacada. Responde *sí* para publicar, *buscar* otra, o envía otra foto.",
  });
}

async function acceptWriteFlowPhoto(ctx, imageBuffer, mimeType) {
  await acceptFeaturedPhoto(ctx, imageBuffer, mimeType);
}

async function handleWriteFlowMessage(ctx, text) {
  const session = getSession(ctx.chat.id);
  const wf = session.writeFlow;

  try {
    if (/^\/cancelar$/i.test(text) || /^cancelar$/i.test(text)) {
      const wasWp = wf.source === "wp";
      cancelWriteFlow(session);
      await ctx.reply(wasWp ? "Artículo WordPress cancelado." : "Redacción cancelada.");
      return;
    }

    if (wf.step === "topic") {
      wf.topic = cleanWriteTopic(text.trim());
      if (!wf.topic) {
        await ctx.reply(
          wf.source === "wp"
            ? "Indica el tema del artículo."
            : "Indica el tema de la noticia."
        );
        return;
      }
      if (wf.source === "wp") {
        await generateWpDraft(ctx, session);
        return;
      }
      await askWriteTitles(ctx, session);
      return;
    }

    if (wf.step === "generating") {
      await ctx.reply("Estoy redactando el artículo, un momento...", { voice: false });
      return;
    }

    if (wf.step === "preview") {
      if (isWpPreviewConfirm(text)) {
        await askFeaturedImage(ctx, session);
        return;
      }
      const newTitle = text.trim();
      if (newTitle.length >= 12 && !isWriteFlowQuestion(newTitle)) {
        wf.selectedTitle = newTitle;
        await status(ctx, "✍️ Regenerando contenido con el nuevo titular...");
        const draft = await writeOriginalNews({
          topic: wf.topic,
          title: wf.selectedTitle,
          researchText: wf.research?.researchText || "",
        });
        wf.body_html = finalizeNewsHtml(coerceArticleHtml(draft.body_html), {
      skipSource: true,
    });
        wf.excerpt = draft.excerpt || "";
        await showWpPreview(ctx, session);
        return;
      }
      await ctx.reply(
        "Responde *sí* para continuar con la foto, escribe un titular nuevo, o *cancelar*.",
        { voice: false }
      );
      return;
    }

    if (wf.step === "title") {
      if (isWriteFlowQuestion(text)) {
        await answerWriteFlowQuestion(ctx, session, text);
        return;
      }

      let title = text.trim();
      if (/^[1-3]$/.test(title)) {
        title = wf.titles[Number(title) - 1];
      } else if (!isValidCustomTitle(title)) {
        await ctx.reply(
          "Eso parece una pregunta, no un titular. Elige 1, 2, 3 o escribe un titular periodístico."
        );
        return;
      }
      wf.selectedTitle = title;
      await askWritePhoto(ctx, session);
      return;
    }

    if (wf.step === "photo") {
      if (isWriteFlowQuestion(text)) {
        await answerWriteFlowQuestion(ctx, session, text);
        return;
      }
      await handleWritePhotoStep(ctx, text);
      return;
    }

    if (wf.step === "writing") {
      await ctx.reply("Estoy publicando la noticia, un momento...");
    }
  } catch (error) {
    console.error("handleWriteFlowMessage:", error);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

async function handleNewsFromImage(
  ctx,
  imageBuffer,
  mimeType,
  userHint,
  extraCategorySlugs,
  { autoCrop = false } = {}
) {
  try {
    let workBuffer = imageBuffer;
    let workMime = mimeType;

    if (autoCrop) {
      try {
        await status(ctx, "1/3 ✂️ Recortando la captura...");
        const box = await detectCropBox(workBuffer, workMime, userHint);
        workBuffer = await cropImageByPercent(workBuffer, box);
        workMime = "image/jpeg";
      } catch (cropError) {
        console.warn("Recorte automático falló:", cropError.message);
      }
    }

    await status(ctx, "2/3 📰 Extrayendo texto de la captura...");

    let ocrText;
    try {
      ocrText = await ocrImage(workBuffer, workMime);
    } catch (error) {
      throw new Error(`Lectura de captura: ${error.message}`);
    }

    let draft;
    try {
      await status(ctx, "3/3 ✍️ Redactando la noticia...");
      draft = await buildNewsPostFromOcr({ ocrText, userHint });
    } catch (error) {
      throw new Error(`Redacción IA: ${error.message}`);
    }

    const session = getSession(ctx.chat.id);
    session.writeFlow = {
      ...emptyWriteFlow(),
      source: "ocr",
      step: "photo",
      topic: draft.title,
      selectedTitle: draft.title,
      excerpt: draft.excerpt || "",
      body_html: finalizeNewsHtml(coerceArticleHtml(draft.body_html), { skipSource: true }),
      captureBuffer: workBuffer,
      captureMime: workMime,
      extraCategorySlugs,
      research: null,
    };

    await ctx.reply(
      [
        `✅ Texto extraído y redactado.`,
        `Titular: ${draft.title}`,
        "",
        "Ahora elige la foto destacada (siempre la verás antes de publicar).",
      ].join("\n"),
      { voice: false }
    );

    await askFeaturedImage(ctx, session);
  } catch (error) {
    console.error("handleNewsFromImage:", error);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

async function flushBuffer(chatId, ctx) {
  const session = getSession(chatId);
  const { buffer, mode } = session;
  clearTimeout(session.timer);
  session.timer = null;

  const rawText = buffer.text || buffer.photos[0]?.caption || "";
  const text = stripCategoryDirective(rawText);
  const extraCategorySlugs = [
    ...buffer.extraCategories,
    ...parseExtraCategories(rawText),
  ];
  const title = buffer.title || undefined;

  if (!text && !buffer.photos.length && !buffer.processedImage) return;

  const hasMedia = buffer.photos.length > 0 || buffer.processedImage;
  if (!hasMedia && text && (isCasualMessage(text) || !looksLikePublishableText(text))) {
    return;
  }

  try {
    if (mode === "copiar") {
      const copy = formatPostForCopy({ text, title, extraCategorySlugs });
      await reply(ctx, copy);
      if (buffer.photos.length || buffer.processedImage) {
        await reply(
          ctx,
          "Imagen lista. En modo copiar no se sube; adjúntala en WordPress.",
          { voice: false }
        );
      }
    } else {
      let featuredMediaId = 0;
      let cardBgBuffer = null;

      if (buffer.processedImage) {
        cardBgBuffer = buffer.processedImage.buffer;
        const media = await uploadImageFromBuffer(
          buffer.processedImage.buffer,
          `telegram-${Date.now()}.jpg`,
          buffer.processedImage.mimeType
        );
        featuredMediaId = media.id;
      } else if (buffer.photos.length) {
        const photo = buffer.photos[buffer.photos.length - 1];
        const file = await ctx.telegram.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
        cardBgBuffer = await fetchImageBuffer(fileUrl).catch(() => null);
        const media = await uploadImageFromUrl(fileUrl, `telegram-${Date.now()}.jpg`);
        featuredMediaId = media.id;
      }

      const result = await createPost({
        text,
        title,
        featuredMediaId,
        extraCategorySlugs,
      });

      session.lastPostId = result.post.id;

      await reply(
        ctx,
        formatTaxonomyNotice({
          categories: result.categories,
          tags: result.tags,
        }),
        { voice: false }
      );
      await replyLong(
        ctx,
        formatUploadedPost(result.post, { categories: result.categories, tags: result.tags }),
        { voice: false }
      );

      await sendSocialCard(ctx, {
        title: result.post.title?.rendered || title || text.slice(0, 90),
        imageBuffer: cardBgBuffer,
        bodyText: text,
      });
    }
  } catch (error) {
    await reply(ctx, `❌ Error: ${error.message}`, { voice: false });
  } finally {
    session.buffer = {
      photos: [],
      text: "",
      title: "",
      extraCategories: [],
      processedImage: null,
    };
    session.photoIntent = null;
  }
}

function scheduleFlush(chatId, ctx) {
  const session = getSession(chatId);
  clearTimeout(session.timer);
  session.timer = setTimeout(() => flushBuffer(chatId, ctx), config.messageBufferMs);
}

async function handleChatText(ctx, text, { showThinking = false } = {}) {
  if (await tryRouteVideoIntent(ctx, text)) return;

  const session = getSession(ctx.chat.id);
  if (showThinking) await ctx.reply("Un momento...", { voice: false });

  const { content } = await askDeepseek(text, session.chatHistory);
  session.chatHistory.push({ role: "user", content: text });
  session.chatHistory.push({ role: "assistant", content });
  if (session.chatHistory.length > 20) {
    session.chatHistory = session.chatHistory.slice(-20);
  }

  await reply(ctx, content);
}

async function handleAudioInput(ctx, fileId, { transcribeOnly = false } = {}) {
  await ctx.reply("🎧 Escuchando tu audio...", { voice: false });

  try {
    const { buffer, ext } = await downloadTelegramFile(ctx, fileId);
    const text = await transcribeAudio(buffer, ext);

    if (!text) {
      await reply(ctx, "No pude entender el audio.", { voice: false });
      return;
    }

    const session = getSession(ctx.chat.id);
    const trimmed = text.trim();

    if (transcribeOnly) {
      await reply(ctx, `📝 Entendí:\n${trimmed}`, { voice: false });
      return;
    }

    const url = extractFirstUrl(trimmed);
    if (url) {
      if (session.writeFlow) cancelWriteFlow(session);
      await handleNewsFromUrl(ctx, url, parseExtraCategories(trimmed));
      return;
    }

    if (wantsWriteNews(trimmed)) {
      await startWriteFlow(ctx, trimmed);
      return;
    }

    if (session.writeFlow) {
      await handleWriteFlowMessage(ctx, trimmed);
      return;
    }

    if (session.hyperFlow) {
      await handleHyperFlowMessage(ctx, trimmed);
      return;
    }

    if (await tryRouteVideoIntent(ctx, trimmed)) return;

    if (session.mode === "chat") {
      await reply(ctx, `📝 Entendí:\n${trimmed}`, { voice: false });
      await handleChatText(ctx, trimmed, { showThinking: false });
      return;
    }

    if (isCasualMessage(trimmed) || isHelpMessage(trimmed)) {
      await handleCasualChat(ctx, trimmed);
      return;
    }

    const hasPendingPhoto =
      session.buffer.photos.length > 0 || session.buffer.processedImage;

    if (!hasPendingPhoto && !looksLikePublishableText(trimmed)) {
      await handleCasualChat(ctx, trimmed);
      return;
    }

    if (!session.buffer.text) session.buffer.text = trimmed;
    else session.buffer.text = `${session.buffer.text}\n\n${trimmed}`;

    await ctx.reply("📝 Entendí. Procesando tu noticia...", { voice: false });
    scheduleFlush(ctx.chat.id, ctx);
  } catch (error) {
    await reply(ctx, `❌ Audio: ${error.message}`, { voice: false });
  }
}

async function handlePhoto(ctx) {
  const session = getSession(ctx.chat.id);
  const caption = ctx.message.caption || "";

  if (isEchoMode(session)) {
    await ctx.reply(caption);
    return;
  }

  const best = ctx.message.photo[ctx.message.photo.length - 1];

  try {
    const { buffer, ext } = await downloadPhotoBuffer(ctx, best.file_id);
    let imageBuffer = buffer;
    let mimeType = mimeFromBuffer(buffer) || `image/${ext}`;

    if (session.writeFlow?.step === "photo") {
      await acceptWriteFlowPhoto(ctx, imageBuffer, mimeType);
      return;
    }

    if (session.mode === "chat") {
      await ctx.reply("👁️ Analizando imagen...", { voice: false });
      const description = await describeImage(
        imageBuffer,
        mimeType,
        caption || "Describe esta imagen brevemente en español."
      );
      await handleChatText(
        ctx,
        caption
          ? `${caption}\n\n[Imagen adjunta: ${description}]`
          : `[Imagen adjunta: ${description}]`
      );
      return;
    }

    const doCrop = wantsCrop(caption, session.photoIntent);
    const doNews = wantsNewsOcr(caption, session.photoIntent);

    if (doCrop) {
      const cropped = await processCrop(ctx, imageBuffer, mimeType, caption);
      imageBuffer = cropped.buffer;
      mimeType = cropped.mimeType;
    }

    if (doNews) {
      const extra = [
        ...session.buffer.extraCategories,
        ...parseExtraCategories(caption),
      ];
      await handleNewsFromImage(ctx, imageBuffer, mimeType, caption, extra, {
        autoCrop: session.photoIntent === "noticia" && !doCrop,
      });
      session.photoIntent = null;
      return;
    }

    session.buffer.processedImage = doCrop
      ? { buffer: imageBuffer, mimeType }
      : null;

    if (!doCrop) {
      session.buffer.photos.push({ file_id: best.file_id, caption });
    }

    if (caption) session.buffer.text = caption;

    await reply(
      ctx,
      doCrop
        ? "📷 Imagen recortada guardada. Envía texto o espero para subir."
        : "📷 Imagen recibida. Esperando texto...",
      { voice: false }
    );
    scheduleFlush(ctx.chat.id, ctx);
  } catch (error) {
    await reply(ctx, `❌ Imagen: ${error.message}`, { voice: false });
  } finally {
    if (session.photoIntent && !wantsNewsOcr(caption, session.photoIntent)) {
      session.photoIntent = null;
    }
  }
}

function resolvePostId(session, explicitId) {
  const id = explicitId || session.lastPostId || session.editPostId;
  if (!id) throw new Error("No hay post seleccionado. Usa /ver o crea uno primero.");
  return Number(id);
}

async function showPost(ctx, postId) {
  const post = await getPost(postId);
  const session = getSession(ctx.chat.id);
  session.editPostId = post.id;
  session.lastPostId = post.id;
  await reply(ctx, formatPostSummary(post), { voice: false });
}

async function handleEditCommand(ctx, args) {
  const session = getSession(ctx.chat.id);
  const parts = args.trim().split(/\s+/);
  if (!parts[0] || parts[0] === "ayuda") {
    await reply(
      ctx,
      [
        "✏️ Editar post",
        "/editar — ver último post",
        "/editar 436990 — seleccionar post",
        "/editar titulo Nuevo título",
        "/editar 436990 titulo Nuevo título",
        "/editar contenido — el siguiente mensaje será el cuerpo",
        "/editar 436990 contenido Texto aquí mismo",
      ].join("\n"),
      { voice: false }
    );
    return;
  }

  let postId;
  let field;
  let value;

  if (/^\d+$/.test(parts[0])) {
    postId = Number(parts[0]);
    field = parts[1]?.toLowerCase();
    value = parts.slice(2).join(" ").trim();
  } else {
    postId = resolvePostId(session, null);
    field = parts[0].toLowerCase();
    value = parts.slice(1).join(" ").trim();
  }

  session.editPostId = postId;

  if (!field) {
    await showPost(ctx, postId);
    await reply(
      ctx,
      "Usa /editar titulo ... o /editar contenido",
      { voice: false }
    );
    return;
  }

  if (field === "titulo" || field === "título") {
    if (!value) {
      await reply(ctx, "Uso: /editar titulo Nuevo título", { voice: false });
      return;
    }
    const result = await updatePost(postId, { title: value });
    session.lastPostId = result.post.id;
    await reply(ctx, `✅ Título actualizado.\n${formatPostSummary(result.post)}`, {
      voice: false,
    });
    return;
  }

  if (field === "contenido" || field === "texto") {
    if (!value) {
      session.awaitingContentEdit = postId;
      await reply(
        ctx,
        `Envía el nuevo contenido para el post ${postId}.`,
        { voice: false }
      );
      return;
    }
    const result = await updatePost(postId, { text: value });
    session.lastPostId = result.post.id;
    session.awaitingContentEdit = false;
    await reply(ctx, `✅ Contenido actualizado.\n${formatPostSummary(result.post)}`, {
      voice: false,
    });
    return;
  }

  await reply(ctx, "Campo no válido. Usa titulo o contenido.", { voice: false });
}

async function handleDeleteCommand(ctx, args) {
  const session = getSession(ctx.chat.id);
  const parts = args.trim().split(/\s+/);
  const force = parts.includes("force");
  const filtered = parts.filter((p) => p !== "force");

  if (!filtered[0] || filtered[0] === "ayuda") {
    await reply(
      ctx,
      [
        "🗑️ Borrar post (papelera)",
        "/borrar — preparar borrado del último",
        "/borrar 436990",
        "/borrar confirmar",
        "/borrar 436990 confirmar",
        "/borrar 436990 force confirmar — borrado permanente",
      ].join("\n"),
      { voice: false }
    );
    return;
  }

  if (filtered.includes("confirmar")) {
    const idPart = filtered.find((p) => /^\d+$/.test(p));
    const postId = idPart
      ? Number(idPart)
      : session.pendingDeleteId || resolvePostId(session, null);
    const deleted = await deletePost(postId, { force });
    session.pendingDeleteId = null;
    session.editPostId = null;
    if (session.lastPostId === postId) session.lastPostId = null;
    await reply(
      ctx,
      force
        ? `🗑️ Post ${postId} eliminado permanentemente.`
        : `🗑️ Post ${postId} enviado a papelera.`,
      { voice: false }
    );
    if (deleted?.title?.rendered) {
      await reply(ctx, `Título: ${deleted.title.rendered}`, { voice: false });
    }
    return;
  }

  if (filtered[0] === "confirmar") {
    const postId = session.pendingDeleteId || resolvePostId(session, null);
    const deleted = await deletePost(postId, { force });
    session.pendingDeleteId = null;
    session.editPostId = null;
    if (session.lastPostId === postId) session.lastPostId = null;
    await reply(
      ctx,
      force
        ? `🗑️ Post ${postId} eliminado permanentemente.`
        : `🗑️ Post ${postId} enviado a papelera.`,
      { voice: false }
    );
    if (deleted?.title?.rendered) {
      await reply(ctx, `Título: ${deleted.title.rendered}`, { voice: false });
    }
    return;
  }

  const postId = /^\d+$/.test(filtered[0])
    ? Number(filtered[0])
    : resolvePostId(session, null);

  const post = await getPost(postId);
  session.pendingDeleteId = postId;
  await reply(
    ctx,
    [
      "⚠️ ¿Borrar este post?",
      formatPostSummary(post),
      "",
      "Confirma con:",
      `/borrar ${postId} confirmar`,
      force ? "Incluye force para borrado permanente." : "",
    ]
      .filter(Boolean)
      .join("\n"),
    { voice: false }
  );
}

function ensureConfigured() {
  const missing = [];
  if (!config.wp.siteUrl) missing.push("WORDPRESS_SITE_URL");
  if (!config.wp.username) missing.push("WORDPRESS_USERNAME");
  if (!config.wp.appPassword) missing.push("WORDPRESS_APP_PASSWORD");
  if (!config.telegram.token) missing.push("TELEGRAM_BOT_TOKEN");
  if (missing.length) {
    throw new Error(`Faltan variables en .env: ${missing.join(", ")}`);
  }
}

const PID_FILE = join(config.root, ".bot.pid");

export async function startBot() {
  ensureConfigured();

  const bot = new Telegraf(config.telegram.token);
  bot.use(guard);

  bot.start(async (ctx) => {
    getSession(ctx.chat.id).mode = "auto";
    await handleCasualChat(ctx, "hola");
  });
  bot.command("ayuda", async (ctx) => reply(ctx, helpText(), { voice: false }));

  bot.command("video", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const arg = (ctx.message.text || "")
      .replace(/^\/video(@\w+)?\s*/i, "")
      .trim();
    const url = extractFirstUrl(arg) || extractUrlFromMessage(ctx);
    try {
      if (!url) {
        const session = getSession(ctx.chat.id);
        session.pendingSocialVideo = { step: "await_url", kind: "video" };
        await reply(
          ctx,
          "Envía el enlace del video (YouTube, Instagram, Facebook o X).",
          { voice: false }
        );
        return;
      }
      await processSocialVideoUrl(ctx, url);
    } catch (error) {
      console.error("/video:", error);
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.command("trad", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const arg = (ctx.message.text || "")
      .replace(/^\/trad(@\w+)?\s*/i, "")
      .trim();
    const url = extractFirstUrl(arg) || extractUrlFromMessage(ctx);
    try {
      if (!url) {
        const session = getSession(ctx.chat.id);
        session.pendingSocialVideo = { step: "await_url", kind: "trad" };
        await reply(
          ctx,
          "Envía el enlace del video (YouTube, Instagram, Facebook o X).\nSi NO está en español: lo traduzco con voz pabmatos.\nSi YA está en español: solo pongo overlay FV en 9:16.",
          { voice: false }
        );
        return;
      }
      await processTradVideoUrl(ctx, url);
    } catch (error) {
      console.error("/trad:", error);
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.command("videostatus", async (ctx) => {
    try {
      await handleVideoStatus(ctx);
    } catch (error) {
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.command("heygen", async (ctx) => {
    const text = (ctx.message.text || "").replace(/^\/heygen(@\w+)?\s*/i, "").trim();
    try {
      await handleHeyGenCommand(ctx, text);
    } catch (error) {
      await ctx.reply(`❌ ${error.message}`, { voice: false });
    }
  });

  bot.command(["hyper", "hyperframes"], async (ctx) => {
    const text = (ctx.message.text || "")
      .replace(/^\/(hyper|hyperframes)(@\w+)?\s*/i, "")
      .trim();
    try {
      await startHyperFlow(ctx, { silent: Boolean(text) });
      if (text) await handleHyperFlowMessage(ctx, text);
    } catch (error) {
      await ctx.reply(`❌ ${error.message}`, { voice: false });
    }
  });

  bot.command("remotion", async (ctx) => {
    try {
      await handleRemotionCommand(ctx);
    } catch (error) {
      await ctx.reply(`❌ ${error.message}`, { voice: false });
    }
  });

  bot.command("estado", async (ctx) => {
    const session = getSession(ctx.chat.id);
    await reply(
      ctx,
      [
        `Modo: ${session.mode}`,
        `Foto: ${session.photoIntent || "normal"}`,
        `Voz: ${session.voiceReplies ? "on" : "off"}`,
        `IA: ${config.deepseek.apiKey ? `DeepSeek V4 Pro (${config.deepseek.model})` : "sin DEEPSEEK_API_KEY"}`,
        `Visión/OCR: ${config.audio.mistralApiKey ? config.vision.model : "sin MISTRAL_API_KEY"}`,
        `STT: ${getSpeechProviderLabel()}`,
        `Categorías: ${config.defaultCategorySlugs.join(", ")}`,
        `Último post: ${session.lastPostId || "ninguno"}`,
        session.lastVideo?.title ? `Último video (ctx): ${session.lastVideo.title.slice(0, 60)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      { voice: false }
    );
  });

  bot.command(["alertas", "intrant"], async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    await reply(
      ctx,
      "Leyendo *Google Alerts* de Gmail (Intrant, hoy). Keyword en título → Sheet.",
      { voice: false }
    );
    try {
      const alerts = await fetchGoogleAlertsForSheet({
        onlyToday: true,
        maxMessages: 80,
        mode: "intrant",
        onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
      });
      if (config.googleAlerts?.sheetId) {
        try {
          await replaceAlertsSheet(alerts);
        } catch (error) {
          console.warn("sheet alertas:", error.message);
        }
      }
      if (!alerts.length) {
        await reply(
          ctx,
          "No hay Google Alerts Intrant de hoy con la keyword en el título.",
          { voice: false }
        );
        return;
      }
      const lines = [
        `Google Alerts INTRANT (hoy · ${alerts.length})`,
        "Fuente: Gmail · columna desde = firma agente",
        "",
      ];
      alerts.slice(0, 12).forEach((a, i) => {
        lines.push(`${i + 1}. ${a.title}`);
        lines.push(
          `   ${a.periodista || "Redacción"} · ${a.source || ""}`
        );
        if (a.snippet) lines.push(`   ${a.snippet.slice(0, 160)}…`);
        if (a.url) lines.push(`   ${a.url}`);
        lines.push("");
      });
      if (config.googleAlerts?.sheetId) {
        lines.push(
          `Sheet: https://docs.google.com/spreadsheets/d/${config.googleAlerts.sheetId}`
        );
      }
      const text = lines.join("\n");
      for (let i = 0; i < text.length; i += 3900) {
        await reply(ctx, text.slice(i, i + 3900), { voice: false });
      }
    } catch (error) {
      await reply(ctx, `❌ Alertas: ${error.message}`, { voice: false });
    }
  });

  bot.command(["alertas-electricas", "edesur", "electricas"], async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    if (config.edesurEnabled === false) {
      await reply(
        ctx,
        "Edesur/eléctrico está pausado (`EDESUR_ENABLED=false`). Intrant sigue activo.",
        { voice: false }
      );
      return;
    }
    await reply(
      ctx,
      "Leyendo *Google Alerts* de Gmail (eléctrico, hoy). Keyword en título → Sheet.",
      { voice: false }
    );
    try {
      const alerts = await fetchGoogleAlertsForSheet({
        onlyToday: true,
        maxMessages: 80,
        mode: "electric",
        onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
      });
      const sheetId = config.electricAlerts?.sheetId;
      const sheetName = config.electricAlerts?.sheetName || "Hoja 1";
      if (sheetId) {
        try {
          await replaceAlertsSheet(alerts, { spreadsheetId: sheetId, sheetName });
        } catch (error) {
          console.warn("sheet electricas:", error.message);
        }
      }
      if (!alerts.length) {
        await reply(
          ctx,
          "No hay Google Alerts eléctricas de hoy con esas keywords en el título.",
          { voice: false }
        );
        return;
      }
      const lines = [
        `Google Alerts ELECTRICAS (hoy · ${alerts.length})`,
        "Fuente: Gmail · columna desde = firma agente",
        "",
      ];
      alerts.slice(0, 12).forEach((a, i) => {
        lines.push(`${i + 1}. ${a.title}`);
        lines.push(`   ${a.periodista || "Redacción"} · ${a.source || ""}`);
        if (a.snippet) lines.push(`   ${a.snippet.slice(0, 160)}…`);
        if (a.url) lines.push(`   ${a.url}`);
        lines.push("");
      });
      if (sheetId) {
        lines.push(`Sheet: https://docs.google.com/spreadsheets/d/${sheetId}`);
      }
      const text = lines.join("\n");
      for (let i = 0; i < text.length; i += 3900) {
        await reply(ctx, text.slice(i, i + 3900), { voice: false });
      }
    } catch (error) {
      await reply(ctx, `❌ Alertas eléctricas: ${error.message}`, { voice: false });
    }
  });

  bot.command("auto", async (ctx) => {
    const session = getSession(ctx.chat.id);
    session.mode = "auto";
    await reply(ctx, "Modo AUTO — publicación directa a WordPress.", { voice: false });
  });

  bot.command("echo", async (ctx) => {
    getSession(ctx.chat.id).mode = "echo";
    await ctx.reply("Modo ECO — solo devuelvo el texto que envías.");
  });

  bot.command("post", async (ctx) => {
    getSession(ctx.chat.id).mode = "auto";
    await reply(ctx, "Modo POST activado.");
  });

  bot.command("copiar", async (ctx) => {
    getSession(ctx.chat.id).mode = "copiar";
    await reply(ctx, "Modo COPIAR activado.");
  });

  bot.command("escribir", async (ctx) => {
    const text = ctx.message.text.replace(/^\/escribir\s*/i, "").trim();
    await startWriteFlow(ctx, text ? `/escribir ${text}` : "/escribir");
  });

  bot.command("wp", async (ctx) => {
    const text = ctx.message.text || "";
    try {
      await startWpFlow(ctx, text);
    } catch (error) {
      console.error("startWpFlow:", error);
      await ctx.reply(`❌ Error: ${error.message}`, { voice: false });
    }
  });

  bot.command("cancelar", async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (session.pendingTradJob) {
      await discardTradJob(session.pendingTradJob);
      session.pendingTradJob = null;
      session.pendingSocialVideo = null;
      await reply(ctx, "Preparación /trad cancelada.", { voice: false });
      return;
    }
    if (session.pendingSocialVideo) {
      session.pendingSocialVideo = null;
      await reply(ctx, "Envío de /video o /trad cancelado.", { voice: false });
      return;
    }
    if (session.hyperFlow) {
      cancelHyperFlow(session);
      await reply(ctx, "Modo HyperFrames cancelado.", { voice: false });
      return;
    }
    if (!session.writeFlow) {
      await reply(ctx, "No hay redacción, /video, /trad ni modo /hyper en curso.", {
        voice: false,
      });
      return;
    }
    const wasWp = session.writeFlow.source === "wp";
    cancelWriteFlow(session);
    await reply(
      ctx,
      wasWp ? "Artículo WordPress cancelado." : "Redacción cancelada.",
      { voice: false }
    );
  });

  bot.command("ia", async (ctx) => {
    getSession(ctx.chat.id).mode = "chat";
    const q = ctx.message.text.replace(/^\/ia\s*/i, "").trim();
    if (q) await handleChatText(ctx, q);
    else await reply(ctx, "Modo conversación activo. ¿En qué puedo asistirle?", { voice: false });
  });

  bot.command("recortar", async (ctx) => {
    getSession(ctx.chat.id).photoIntent = "crop";
    await reply(ctx, "Envía la foto a recortar (captura de noticia, etc.).", {
      voice: false,
    });
  });

  bot.command(["noticia", "ocr"], async (ctx) => {
    getSession(ctx.chat.id).photoIntent = "noticia";
    await reply(
      ctx,
      "Envía la captura. Extraeré el texto, redactaré la noticia y luego te pediré la foto destacada (siempre con vista previa antes de publicar).",
      { voice: false }
    );
  });

  bot.command("voz", async (ctx) => {
    const arg = ctx.message.text.replace(/^\/voz\s*/i, "").trim().toLowerCase();
    const session = getSession(ctx.chat.id);
    if (arg === "on") session.voiceReplies = true;
    else if (arg === "off") session.voiceReplies = false;
    else {
      await reply(ctx, "Uso: /voz on  o  /voz off", { voice: false });
      return;
    }
    await reply(ctx, `Respuestas de voz: ${session.voiceReplies ? "on" : "off"}`);
  });

  bot.command("escuchar", async (ctx) => {
    await reply(ctx, "Envía audio y solo lo transcribo.", { voice: false });
    getSession(ctx.chat.id).transcribeOnlyNext = true;
  });

  bot.command("mas", async (ctx) => {
    const extra = ctx.message.text.replace(/^\/mas\s*/i, "").trim();
    if (!extra) {
      await reply(ctx, "Uso: /mas deportes", { voice: false });
      return;
    }
    getSession(ctx.chat.id).buffer.extraCategories.push(
      ...extra.split(",").map((s) => s.trim()).filter(Boolean)
    );
    await reply(ctx, `Categorías extra: ${extra}`, { voice: false });
  });

  bot.command("publicar", async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (!session.lastPostId) {
      await reply(ctx, "No hay post reciente.", { voice: false });
      return;
    }
    try {
      const post = await updatePostStatus(session.lastPostId, "publish");
      await replyLong(ctx, formatUploadedPost(post), { voice: false });
    } catch (error) {
      await reply(ctx, `❌ ${error.message}`, { voice: false });
    }
  });

  bot.command("borrador", async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (!session.lastPostId) {
      await reply(ctx, "No hay post reciente.", { voice: false });
      return;
    }
    try {
      await updatePostStatus(session.lastPostId, "draft");
      await reply(ctx, "📝 Borrador guardado.");
    } catch (error) {
      await reply(ctx, `❌ ${error.message}`, { voice: false });
    }
  });

  bot.command(["ver", "verpost"], async (ctx) => {
    try {
      const arg = ctx.message.text.replace(/^\/\w+\s*/i, "").trim();
      const session = getSession(ctx.chat.id);
      if (!arg) {
        if (!session.lastPostId) {
          const posts = await listRecentPosts({ perPage: 5 });
          if (!posts.length) {
            await reply(ctx, "No hay posts.", { voice: false });
            return;
          }
          const list = posts
            .map((p) => `• ${p.id} [${p.status}] ${p.title.rendered}`)
            .join("\n");
          await reply(ctx, `Últimos posts:\n${list}`, { voice: false });
          return;
        }
        await showPost(ctx, session.lastPostId);
        return;
      }
      await showPost(ctx, Number(arg));
    } catch (error) {
      await reply(ctx, `❌ ${error.message}`, { voice: false });
    }
  });

  bot.command("editar", async (ctx) => {
    try {
      const args = ctx.message.text.replace(/^\/editar\s*/i, "");
      await handleEditCommand(ctx, args);
    } catch (error) {
      await reply(ctx, `❌ ${error.message}`, { voice: false });
    }
  });

  bot.command("borrar", async (ctx) => {
    try {
      const args = ctx.message.text.replace(/^\/borrar\s*/i, "");
      await handleDeleteCommand(ctx, args);
    } catch (error) {
      await reply(ctx, `❌ ${error.message}`, { voice: false });
    }
  });

  bot.on("photo", handlePhoto);

  bot.on("voice", async (ctx) => {
    const session = getSession(ctx.chat.id);
    const transcribeOnly = session.transcribeOnlyNext;
    session.transcribeOnlyNext = false;
    await handleAudioInput(ctx, ctx.message.voice.file_id, { transcribeOnly });
  });

  bot.on("audio", async (ctx) => {
    const session = getSession(ctx.chat.id);
    const transcribeOnly = session.transcribeOnlyNext;
    session.transcribeOnlyNext = false;
    await handleAudioInput(ctx, ctx.message.audio.file_id, { transcribeOnly });
  });

  bot.action(/^trad:headline:(yes|no|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const choice = ctx.match[1];

    try {
      if (choice === "cancel") {
        if (session.pendingTradJob) {
          await discardTradJob(session.pendingTradJob);
          session.pendingTradJob = null;
        }
        session.pendingSocialVideo = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("/trad cancelado.");
        return;
      }

      if (!session.pendingTradJob) {
        await ctx.answerCbQuery("No hay /trad pendiente");
        await ctx.reply("No hay preparación pendiente. Usa /trad con una URL.");
        return;
      }

      await ctx.answerCbQuery(choice === "yes" ? "Con titular" : "Sin titular");
      await finishTradAfterHeadlineChoice(ctx, choice === "yes");
    } catch (error) {
      console.error("trad:headline:", error);
      if (session.pendingTradJob) {
        await discardTradJob(session.pendingTradJob);
        session.pendingTradJob = null;
      }
      session.pendingSocialVideo = null;
      try {
        await ctx.answerCbQuery("Error");
      } catch {
        // ignore
      }
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.action(/^svideo:(send|edit|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);

    const session = getSession(ctx.chat.id);
    const pending = session.pendingSocialVideo;
    const action = ctx.match[1];

    try {
      if (action === "cancel") {
        session.pendingSocialVideo = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Envío de /video o /trad cancelado.");
        return;
      }

      if (!pending?.videoUrl) {
        await ctx.answerCbQuery("No hay video pendiente");
        await ctx.reply("No hay video pendiente. Usa /video o /trad con una URL.");
        return;
      }

      if (action === "edit") {
        pending.step = "edit_caption";
        session.pendingSocialVideo = pending;
        await ctx.answerCbQuery("Editar caption");
        await ctx.reply(
          "Envía el nuevo caption (texto completo). Luego te volveré a preguntar si lo envío."
        );
        return;
      }

      if (action === "send") {
        await ctx.answerCbQuery("Enviando…");
        await sendPendingSocialVideoToWebhook(ctx);
      }
    } catch (error) {
      console.error("svideo callback:", error);
      try {
        await ctx.answerCbQuery("Error");
      } catch {
        // ignore
      }
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    const session = getSession(ctx.chat.id);
    const incoming = ctx.message.text;

    if (isEchoMode(session)) {
      await ctx.reply(incoming);
      return;
    }

    const trimmed = incoming.trim();
    const url = extractUrlFromMessage(ctx);

    // /video o /trad: esperando URL
    if (session.pendingSocialVideo?.step === "await_url") {
      const videoUrl = url || extractFirstUrl(trimmed);
      if (!videoUrl) {
        await ctx.reply(
          "Necesito un enlace válido (YouTube, Instagram, Facebook o X). O /cancelar."
        );
        return;
      }
      try {
        if (session.pendingSocialVideo.kind === "trad") {
          await processTradVideoUrl(ctx, videoUrl);
        } else {
          await processSocialVideoUrl(ctx, videoUrl);
        }
      } catch (error) {
        console.error("pendingSocialVideo URL:", error);
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    // /video: editando caption
    if (session.pendingSocialVideo?.step === "edit_caption") {
      const pending = session.pendingSocialVideo;
      pending.caption = ensureCaptionHashtag(trimmed);
      pending.step = "confirm";
      session.pendingSocialVideo = pending;
      if (session.lastVideo) session.lastVideo.caption = pending.caption;
      try {
        await askSocialVideoConfirm(ctx, pending);
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    if (url) {
      if (session.writeFlow) cancelWriteFlow(session);
      try {
        await handleNewsFromUrl(ctx, url, parseExtraCategories(trimmed));
      } catch (error) {
        console.error("text handler URL:", error);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
      return;
    }

    if (wantsWriteNews(trimmed)) {
      try {
        await startWriteFlow(ctx, trimmed);
      } catch (error) {
        console.error("startWriteFlow:", error);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
      return;
    }

    if (session.writeFlow) {
      try {
        await handleWriteFlowMessage(ctx, trimmed);
      } catch (error) {
        console.error("writeFlow:", error);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
      return;
    }

    if (session.hyperFlow) {
      try {
        await handleHyperFlowMessage(ctx, trimmed);
      } catch (error) {
        console.error("hyperFlow:", error);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
      return;
    }

    if (await tryRouteVideoIntent(ctx, trimmed)) return;

    if (session.mode === "chat") {
      await handleChatText(ctx, trimmed);
      return;
    }

    if (session.awaitingContentEdit) {
      try {
        const postId = session.awaitingContentEdit;
        const result = await updatePost(postId, { text: trimmed });
        session.lastPostId = result.post.id;
        session.awaitingContentEdit = false;
        await reply(
          ctx,
          `✅ Contenido actualizado.\n${formatPostSummary(result.post)}`,
          { voice: false }
        );
      } catch (error) {
        await reply(ctx, `❌ ${error.message}`, { voice: false });
      }
      return;
    }

    if (isCasualMessage(trimmed) || isHelpMessage(trimmed)) {
      await handleCasualChat(ctx, trimmed);
      return;
    }

    const hasPendingPhoto =
      session.buffer.photos.length > 0 || session.buffer.processedImage;

    if (!hasPendingPhoto && !looksLikePublishableText(trimmed)) {
      await handleCasualChat(ctx, trimmed);
      return;
    }

    if (!session.buffer.text) session.buffer.text = trimmed;
    else session.buffer.text = `${session.buffer.text}\n\n${trimmed}`;

    scheduleFlush(ctx.chat.id, ctx);
  });

  bot.catch((error) => console.error("Bot error:", error));

  writeFileSync(PID_FILE, String(process.pid));

  const httpServer = await startHttpServer({
    port: config.server.port,
    getStatus: () => ({
      telegram: "online",
      activeSessions: sessions.size,
      video: {
        hyperframes: config.video.hyperframes.enabled,
        remotion: config.video.remotion.enabled,
        heygen: config.video.heygen.enabled && Boolean(config.video.heygen.apiKey),
      },
    }),
  });

  // En Telegraf 4, launch() no resuelve mientras el bot está vivo — no hacer await.
  bot
    .launch({ dropPendingUpdates: true })
    .catch((error) => {
      if (error.response?.error_code === 409) {
        console.error(
          "409 Conflict: hay otra instancia del bot. Ejecuta: npm run bot:stop"
        );
      } else {
        console.error("bot.launch:", error.message);
      }
      cleanupPidFile();
      httpServer.close();
      process.exit(1);
    });

  console.log(
    `JARVIS online — FV Digital (Telegram + DeepSeek + Mistral) — http://127.0.0.1:${config.server.port}`
  );

  const shutdown = async (signal) => {
    console.log(`Deteniendo (${signal})...`);
    httpServer.close();
    await bot.stop(signal);
    cleanupPidFile();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return bot;
}

function cleanupPidFile() {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBot().catch((error) => {
    console.error("No se pudo iniciar el bot:", error.message);
    process.exit(1);
  });
}
