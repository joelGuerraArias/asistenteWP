import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
  mp3ToVoiceOgg,
  readTempFile,
  synthesizeSpeech,
  transcribeAudio,
} from "./audio.mjs";
import { askDeepseek, buildNewsPostFromOcr, buildNoteFromDocument, composeCardHeadline, correctHeadlineSpelling, correctTradText, enrichTradTextWithResearch, ensureSpanishCaption, formatNewsBodyHtml, generateNewsHeadline, generateSocialCaption, suggestNewsTitles, translateToSpanish, writeOriginalNews } from "./deepseek.mjs";
import { generateNewsCard, fetchImageBuffer, LOGO_F1RD_PATH } from "./social-card.mjs";
import {
  publishToDestinations,
  publishToWebhook,
  destIncludesFv,
  destLabel,
  assertDestWebhooksReady,
  captionForTarget,
  webhookTargets,
} from "./publish-webhook.mjs";
import { markFeedLinksSent } from "./feed-repost.mjs";
import {
  formatGraphicsFeedHelp,
  graphicsFeedBrandFromPath,
  renderGraphicsFeedXml,
} from "./graphics-feed.mjs";
import { isPublicR2Url, uploadToR2 } from "./r2.mjs";
import {
  archiveProcessedVideoSafe,
  archiveProducedGraphic,
} from "./video-archive.mjs";
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
import { cleanImportedText, finalizeNewsHtml, textToNewsHtml, withNewsVideoPlayer } from "./news-format.mjs";
import { fetchGoogleAlertsForSheet } from "./gmail-alerts.mjs";
import { replaceAlertsSheet } from "./sheets-alerts.mjs";
import { cropImageByPercent, mimeFromBuffer } from "./image.mjs";
import { detectCropBox, describeImage, ocrDocument, ocrImage } from "./vision.mjs";
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
import { resolveCommandIntent } from "./command-intent.mjs";
import { createVideoJob, createThrottledProgress } from "./video-progress.mjs";
import {
  emptyHyperFlow,
  extractHyperFlowPrompt,
  hyperFlowMenuText,
  parseHyperAction,
} from "./hyper-flow.mjs";
import {
  articlePreviewKeyboard,
  askRewriteOpinionText,
  formatPeriodistaPreview,
  formatWpPreview,
  isWpPreviewConfirm,
  isWpPreviewOpinion,
  isWpPreviewRewrite,
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
  detectVideoPlatform,
  downloadSocialVideo,
  isSupportedSocialVideoUrl,
  socialVideoPlatformLabel,
} from "./social-video.mjs";
import {
  discardTradJob,
  finalizeTradJob,
  inspectTradVideo,
  continueTradJob,
} from "./trad-video.mjs";
import {
  discardDubJob,
  finalizeDubJob,
  prepareDubJob,
} from "./dub-video.mjs";
import {
  buildNdigitalR2Key,
  composeNdigitalBranded,
  discardNdigitalJob,
  generateNdigitalHeadline,
  prepareNdigitalJob,
} from "./ndigital-video.mjs";
import {
  brandLocalVideo,
  buildLocalR2Key,
  discardLocalJob,
  extractVideoFrame1280x720,
  prepareLocalVideoJob,
  toFeatured1280x720,
} from "./local-video.mjs";
import {
  concatVideoWithSie,
  discardSieWork,
  markSieUsed,
  pickNextSieVideo,
  sieBumperAvailable,
} from "./sie-bumper.mjs";
import { isTavilyEnabled, tavilyResearchTopic } from "./tavily.mjs";
import {
  cancelTermometroFlow,
  emptyTermometroFlow,
  getTermometroData,
  handleTermometroText,
  isTermometroActive,
  setTermometroPhoto,
  termometroAwaitingPhoto,
  termometroCancelText,
  termometroIntroText,
} from "./termometro-flow.mjs";
import {
  cancelPicFlow,
  emptyPicFlow,
  advancePicAfterPhoto,
  handlePicText,
  handlePicDestText,
  isPicFlowActive,
  picAwaitingDest,
  picAwaitingConfirm,
  picAwaitingPhoto,
  picAwaitingTitle,
  picCancelText,
  headlineWasCorrected,
  picAskDestText,
  picPreviewReadyText,
  picIntroText,
  setPicPhoto,
} from "./pic-flow.mjs";
import {
  cancelEncuestaFlow,
  emptyEncuestaDobleFlow,
  emptyEncuestaFlow,
  encuestaAskNextPhotoText,
  encuestaAskQuestionText,
  encuestaAwaitingPhoto,
  encuestaAwaitingQuestion,
  encuestaCancelText,
  encuestaDobleIntroText,
  encuestaIntroText,
  encuestaSpellingDiffers,
  isEncuestaFlowActive,
  normalizeEncuestaQuestion,
  parseEncuestaPhotoCount,
  setEncuestaPhoto,
} from "./encuesta-flow.mjs";
import { generateEncuestaAlphaCard } from "./encuesta-alpha-card.mjs";
import { generateEncuestaDobleCard } from "./encuesta-doble-card.mjs";
import {
  formatReporteTelegram,
  runIntrantReport,
} from "./intrant-report.mjs";
import {
  formatBuscaTelegram,
  searchHeadlineSources,
} from "./headline-search.mjs";
import {
  cleanupTermometroWorkDir,
  generateTermometroVideo,
} from "./termometro-video.mjs";

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      mode: config.telegram.echoOnly ? "echo" : "auto",
      photoIntent: null,
      voiceReplies: config.audio.voiceReplies,
      fromVoice: false,
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
      pendingLinkChoice: null,
      pendingDestChoice: null,
      publishDest: "fvdigital",
      pendingTradJob: null,
      pendingTradText: null,
      pendingDubJob: null,
      pendingNdigitalJob: null,
      pendingLocalJob: null,
      termometroFlow: null,
      picFlow: null,
      encuestaFlow: null,
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
    "JARVIS — comandos",
    "",
    "Ayuda:",
    "• /ayuda · /help · /comandos — esta lista",
    "",
    "Publicar noticias:",
    "• Enlace de noticia → titular, foto y texto a WP",
    "• Enlace YT/IG/FB/Dailymotion → destino (FV / F1RD / ambos), luego Video o Noticia",
    "• /escribir — redactar noticia (elige entre 3 titulares)",
    "• /periodista — tu titular → tema → foto → WP + redes",
    "• /wp — artículo guiado: tema → borrador → foto → publicar",
    "• /noticia · /ocr — captura de pantalla → WP",
    "• /nota — PDF o foto de documento → extrae info + foto",
    "• /auto — modo foto + texto",
    "• /encuesta — foto + pregunta → tarjeta ALPHA → webhook (revisa ortografía, no cambia el texto)",
    "• /encuestadoble — 2/3/4 fotos en círculos + pregunta → webhook",
    "• /encuestas — 1 encuesta temática (ALPHA) → WP + redes; cron 09:00 y 16:00",
    "• /publicar — publicar el último borrador",
    "• /borrador — listar borradores",
    "• /ver · /verpost — ver un post",
    "• /editar — editar post",
    "• /borrar — borrar post",
    "• /cancelar — cancelar flujo en curso",
    "",
    "Video / redes:",
    "• /video URL — descarga → R2 → webhook (destino FV/F1RD/ambos; FV pregunta SIE)",
    "• /trad URL — elige: traducir audio, audio desde caption, o pegar texto (audio+caption) → webhook",
    "• /trad + texto — corregir / traducir / buscar (Tavily) / audio",
    "• /dub URL — doblaje ElevenLabs a español → reel 9:16 → webhook",
    "• /ndigital URL — reel N Digital: crop → logo + titular rojo → caption → webhook (FV pregunta SIE)",
    "• /local — video del PC → STT ES → logo/titular → frame → WP + redes + video webhook",
    "• /foto — Termómetro (nombre + institución + foto)",
    "• /pic — foto + texto → vista previa → confirmar (FV o F1RD) → redes",
    "• /feeds — RSS de gráficos FV Digital y Formula 1 RD (dlvr.it)",
    "• /pic last — reenvía el último /pic a redes",
    "• /hyper · /hyperframes — HyperFrames (generar / verificar)",
    "• /heygen — video HeyGen",
    "• /remotion — listar composiciones Remotion",
    "• /videostatus — estado de herramientas de video",
    "",
    "Otros:",
    "• /busca [titular] — Tavily + Brave → medios + borrador de correo",
    "• /reporte — REPORTE Intrant (Word + correo)",
    "• /alertas · /intrant — sync alertas Intrant",
    "• /alertas-electricas · /edesur — alertas eléctricas",
    "• /recortar — recortar imagen",
    "• /ia — modo conversación",
    "• /echo — solo eco (sin publicar)",
    "• /estado — estado del bot / sesión",
    "• /voz · /escuchar — respuestas por voz",
    "• Órdenes por voz — ej. «crea una noticia sobre…», «hazme una imagen», «video heygen»",
    "• /mas — categorías extra al publicar",
  ].join("\n");
}

function unauthorized(ctx) {
  return !isChatAllowed(ctx.chat?.id);
}

const LAST_CHAT_FILE = join(config.root, ".last-chat.json");
const LAST_PIC_DIR = join(config.root, ".last-pic");
const LAST_PIC_META = join(LAST_PIC_DIR, "meta.json");
const LAST_PIC_BG = join(LAST_PIC_DIR, "bg.bin");

function saveLastPic({ title, dest, photoBuffer }) {
  if (!photoBuffer?.length || !title) return;
  mkdirSync(LAST_PIC_DIR, { recursive: true });
  writeFileSync(
    LAST_PIC_META,
    JSON.stringify(
      {
        title: String(title).trim(),
        dest: dest || "fvdigital",
        pending: true,
        at: new Date().toISOString(),
      },
      null,
      2
    )
  );
  writeFileSync(LAST_PIC_BG, photoBuffer);
}

function loadLastPic() {
  if (!existsSync(LAST_PIC_META) || !existsSync(LAST_PIC_BG)) return null;
  try {
    const meta = JSON.parse(readFileSync(LAST_PIC_META, "utf8"));
    const photoBuffer = readFileSync(LAST_PIC_BG);
    if (!meta?.title || !photoBuffer?.length) return null;
    return {
      title: meta.title,
      dest: meta.dest || "fvdigital",
      pending: meta.pending !== false,
      photoBuffer,
    };
  } catch {
    return null;
  }
}

function markLastPicSent() {
  if (!existsSync(LAST_PIC_META)) return;
  try {
    const meta = JSON.parse(readFileSync(LAST_PIC_META, "utf8"));
    meta.pending = false;
    meta.sentAt = new Date().toISOString();
    writeFileSync(LAST_PIC_META, JSON.stringify(meta, null, 2));
  } catch {
    // ignore
  }
}

/** Mismo camino que noticias/escritos: preview Telegram + webhook n8n. */
async function publishPicToSocial(ctx, { title, photoBuffer, dest }) {
  const session = getSession(ctx.chat.id);
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle || !photoBuffer?.length) {
    throw new Error("Falta foto o texto del /pic");
  }
  const target = dest || session.publishDest || "fvdigital";
  assertDestWebhooksReady(target);
  session.publishDest = target;
  saveLastPic({ title: cleanTitle, dest: target, photoBuffer });
  await status(ctx, "📤 Enviando gráfico a redes...");
  const result = await sendSocialCard(ctx, {
    title: cleanTitle,
    imageBuffer: photoBuffer,
    bodyText: cleanTitle,
    // /pic: solo ortografía ya aplicada; no reescribir titular ni caption
    lockTitle: true,
  });
  if (!result?.ok) {
    throw new Error(result?.error || "No se pudo enviar a redes");
  }
  markLastPicSent();
  return result;
}

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

const TELEGRAM_TEXT_MAX = 3900;

function sanitizeTelegramText(text) {
  let t = String(text ?? "");
  if (/<!DOCTYPE html|<html[\s>]/i.test(t)) {
    t = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/522|timed out/i.test(t)) {
      return "WordPress no respondió (Cloudflare 522: timeout). Reintenta en un minuto.";
    }
  }
  return t;
}

function splitTelegramChunks(text, max = TELEGRAM_TEXT_MAX) {
  const clean = sanitizeTelegramText(text);
  if (clean.length <= max) return [clean];
  const parts = [];
  let remaining = clean;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, max);
    if (remaining.length > max) {
      const cut = chunk.lastIndexOf("\n");
      if (cut > max * 0.4) chunk = remaining.slice(0, cut);
    }
    parts.push(chunk);
    remaining = remaining.slice(chunk.length).trimStart();
  }
  return parts.length ? parts : [""];
}

async function reply(ctx, text, { voice = null, ...telegramOpts } = {}) {
  const chunks = splitTelegramChunks(text);
  for (let i = 0; i < chunks.length; i++) {
    const opts = i === chunks.length - 1 ? telegramOpts : {};
    await ctx.reply(chunks[i], opts);
  }
  const session = getSession(ctx.chat.id);
  if (isEchoMode(session)) return;
  // Si el usuario habló por audio, siempre responder en audio (salvo voice: false explícito).
  const useVoice = voice ?? (session.fromVoice || session.voiceReplies);
  if (!useVoice || !chunks[0]) return;

  let audioPath;
  let voicePath;
  try {
    const spoken = chunks[0];
    const short = spoken.length > 220 ? `${spoken.slice(0, 217)}...` : spoken;
    audioPath = await synthesizeSpeech(short);
    // Nota de voz (burbuja) — evita el player con carátula tipo "Rock…"
    try {
      voicePath = await mp3ToVoiceOgg(audioPath);
      const voiceBuffer = await readTempFile(voicePath);
      await ctx.replyWithVoice(Input.fromBuffer(voiceBuffer, "respuesta.ogg"));
    } catch (convErr) {
      console.warn("Voz OGG falló, envío MP3 sin título:", convErr.message);
      const audioBuffer = await readTempFile(audioPath);
      await ctx.replyWithAudio(Input.fromBuffer(audioBuffer, "jarvis.mp3"), {
        title: "JARVIS",
        performer: "FV Digital",
      });
    }
  } catch (error) {
    console.warn("TTS falló:", error.message);
  } finally {
    cleanupTemp(audioPath);
    cleanupTemp(voicePath);
  }
}

async function replyLong(ctx, text, opts = {}) {
  await reply(ctx, text, opts);
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
    await reply(ctx, helpText());
    return;
  }

  const session = getSession(ctx.chat.id);
  const opener = pickJarvisOpener(session.jarvisRecentOpeners);
  session.jarvisRecentOpeners = [...session.jarvisRecentOpeners, opener.id].slice(-12);

  await reply(
    ctx,
    [
      `${timeGreeting()}. Soy JARVIS, su asistente editorial de FV Digital.`,
      "",
      opener.text,
      "",
      "¿En qué puedo servirle?",
      "• Enlace de noticia o red social → la subo directo",
      "• /escribir [tema] → redacto con datos de la web",
      "• /periodista → tu titular (sin cambiar su esencia) + tema + foto",
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

function wantsNota(caption, photoIntent) {
  return photoIntent === "nota" || /\bnota\b/i.test(caption || "");
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

function cardOptsForDest(dest) {
  if (dest === "f1rd") {
    return {
      logoPath: LOGO_F1RD_PATH,
      badgeText: "f1mister",
      handle: config.f1rdWebhook?.hashtag || "#Formula1RD",
      site: "www.formula1rd.com",
      logoWidthRatio: 0.2,
    };
  }
  return {};
}

function picDestKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("FV Digital", "pic:fvdigital"),
      Markup.button.callback("F1RD", "pic:f1rd"),
    ],
    [Markup.button.callback("❌ Cancelar", "pic:cancel")],
  ]);
}

function picConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Enviar", "pic:done")],
    [
      Markup.button.callback("🔄 Otra marca", "pic:change"),
      Markup.button.callback("❌ Cancelar", "pic:cancel"),
    ],
  ]);
}

async function correctPicHeadline(ctx, rawText) {
  const original = String(rawText || "").trim();
  if (!original) return { original: "", corrected: "", changed: false, failed: false };

  await status(ctx, "📝 Corrigiendo ortografía…");
  try {
    const corrected = (await correctHeadlineSpelling(original)).trim() || original;
    return {
      original,
      corrected,
      changed: headlineWasCorrected(original, corrected),
      failed: false,
    };
  } catch (error) {
    console.warn("correctPicHeadline:", error.message);
    await reply(
      ctx,
      `⚠️ No pude corregir ortografía (${error.message}). Uso tu texto original.`,
      { voice: false }
    );
    return { original, corrected: original, changed: false, failed: true };
  }
}

async function preparePicDestStep(ctx, session) {
  const flow = session.picFlow;
  if (!flow?.headline?.trim()) return;

  const { original, corrected, changed } = await correctPicHeadline(
    ctx,
    flow.headline
  );
  flow.originalHeadline = original;
  flow.headline = corrected;
  flow.step = "awaiting_dest";
  flow.spellingApplied = true;

  const spellNote = changed
    ? `\n\n✏️ Ortografía corregida:\nAntes: ${original}\nAhora: ${corrected}`
    : "";

  const text = picAskDestText(corrected) + spellNote;
  // Keyboard explícito (no mezclar con voice opts del helper reply)
  await ctx.reply(text, picDestKeyboard());
}

async function handlePicFlowText(ctx, trimmed) {
  const session = getSession(ctx.chat.id);
  if (!isPicFlowActive(session)) return false;

  if (picAwaitingDest(session)) {
    const destPick = handlePicDestText(session, trimmed);
    if (destPick.dest) {
      await showPicPreview(ctx, destPick.dest);
      return true;
    }
    await ctx.reply(
      destPick.reply || "Elige FV Digital o F1RD con los botones, o escribe «fv» o «f1rd».",
      picDestKeyboard()
    );
    return true;
  }

  const handled = handlePicText(session, trimmed);
  if (handled.handled) {
    if (handled.readyForDest) {
      await preparePicDestStep(ctx, session);
    } else {
      await reply(ctx, handled.reply, { voice: false });
    }
    return true;
  }

  if (picAwaitingConfirm(session)) {
    await ctx.reply(
      "Usa los botones bajo la vista previa: ✅ Enviar, 🔄 Otra marca o ❌ Cancelar.",
      picConfirmKeyboard()
    );
    return true;
  }

  if (picAwaitingPhoto(session) || picAwaitingTitle(session)) {
    await reply(ctx, "Envía la foto o escribe el texto para el lower-third.", {
      voice: false,
    });
    return true;
  }

  return false;
}

async function handlePicPhoto(ctx, imageBuffer, mimeType, caption = "") {
  const session = getSession(ctx.chat.id);
  const flow = session.picFlow;
  if (!flow) return;

  setPicPhoto(session, imageBuffer, mimeType);

  const next = advancePicAfterPhoto(session, caption);
  if (!next) {
    await ctx.reply("❌ /pic: no pude guardar la foto.", { voice: false });
    cancelPicFlow(session);
    return;
  }

  if (next.readyForDest) {
    await preparePicDestStep(ctx, session);
    return;
  }

  await ctx.reply(next.reply, { voice: false });
}

async function showPicPreview(ctx, dest) {
  const session = getSession(ctx.chat.id);
  const flow = session.picFlow;
  if (!flow?.photoBuffer || !flow.headline) {
    await reply(ctx, "No hay foto o titular pendiente. Usa /pic de nuevo.", {
      voice: false,
    });
    return;
  }

  try {
    await ctx.sendChatAction("upload_photo").catch(() => {});

    const rawTitle = flow.headline.trim();
    const originalHeadline = flow.originalHeadline?.trim() || rawTitle;
    let cardTitle = rawTitle;

    if (!flow.spellingApplied) {
      const spell = await correctPicHeadline(ctx, rawTitle);
      cardTitle = spell.corrected;
      flow.headline = cardTitle;
      flow.originalHeadline = spell.original;
      flow.spellingApplied = true;
    }

    // /pic: solo ortografía — no reescribir ni “ajustar” el titular
    flow.headline = cardTitle;

    const card = await generateNewsCard({
      backgroundBuffer: flow.photoBuffer,
      title: cardTitle,
      ...cardOptsForDest(dest),
    });

    flow.dest = dest;
    flow.previewCard = card;
    flow.step = "awaiting_confirm";
    saveLastPic({ title: cardTitle, dest, photoBuffer: flow.photoBuffer });

    const spellNote = headlineWasCorrected(originalHeadline, cardTitle)
      ? `\n\n✏️ Ortografía corregida:\nAntes: ${originalHeadline}\nAhora: ${cardTitle}`
      : "";

    await ctx.replyWithPhoto(Input.fromBuffer(card, "pic-preview.png"), {
      caption: `Vista previa · ${destLabel(dest)}${spellNote}`,
      ...picConfirmKeyboard(),
    });

    await ctx.reply(picPreviewReadyText(destLabel(dest)), picConfirmKeyboard());
  } catch (error) {
    console.error("showPicPreview:", error);
    cancelPicFlow(session);
    await ctx.reply(`❌ /pic: ${error.message}`, { voice: false });
  }
}

function socialLangForTarget(_target) {
  return "es";
}

/** Tras WP+redes: anotar el link para que feed-repost no republicque el mismo artículo. */
function rememberFeedPublished(dest, postLink, title = "", source = "bot") {
  const link = String(postLink || "").trim();
  if (!link) return;
  try {
    const r = markFeedLinksSent({
      dest: dest || "fvdigital",
      links: [link],
      title,
      source,
    });
    if (r.marked) {
      console.log(
        `feed-repost: marcado ${r.marked} link(s) [${r.brands.join(",")}] vía ${source}`
      );
    }
  } catch (error) {
    console.warn("rememberFeedPublished:", error.message);
  }
}

async function sendSocialCard(
  ctx,
  { title, imageBuffer = null, imageUrl = null, bodyText = "", lockTitle = false } = {}
) {
  if (!config.socialCard.enabled) {
    return { ok: false, error: "SOCIAL_CARD deshabilitado" };
  }
  if (!title) return { ok: false, error: "sin titular" };

  try {
    let bg = imageBuffer;
    if (!bg && imageUrl) {
      bg = await fetchImageBuffer(imageUrl);
    }
    if (!bg) return { ok: false, error: "sin imagen de fondo" };

    await ctx.sendChatAction("upload_photo").catch(() => {});
    const session = getSession(ctx.chat.id);
    session.lastVideo = {
      ...(session.lastVideo || {}),
      title,
      bodyText: bodyText?.slice(0, 2000) || "",
      at: new Date().toISOString(),
    };

    const dest = session.publishDest || "fvdigital";
    // Preview: siempre español (FV y F1RD).
    const previewLang = "es";
    const previewTarget = dest === "f1rd" ? "f1rd" : "fvdigital";
    const cardTitle = lockTitle
      ? String(title).trim()
      : await composeCardHeadline(title, bodyText, {
          lang: previewLang,
        }).catch(() => title);
    const card = await generateNewsCard({
      backgroundBuffer: bg,
      title: cardTitle,
      ...cardOptsForDest(previewTarget),
    });

    await ctx.replyWithPhoto(Input.fromBuffer(card, "fv-card.png"), {
      caption: `Gráfico para redes (${destLabel(dest)}${
        dest === "f1rd" ? " · F1RD" : ""
      })`,
    });

    await sendCardToWebhook(ctx, {
      title: lockTitle ? cardTitle : title,
      bodyText: lockTitle ? cardTitle : bodyText,
      imageBuffer: bg,
      lockTitle,
    });
    return { ok: true };
  } catch (error) {
    console.warn("sendSocialCard:", error.message);
    await ctx.reply(`⚠️ No pude preparar el gráfico: ${error.message}`).catch(() => {});
    return { ok: false, error: error.message };
  }
}

async function uploadCardPublicUrl(card, title) {
  const filename = `fv-card-${Date.now()}.png`;

  if (config.r2?.enabled) {
    return uploadToR2(card, `cards/${filename}`, "image/png");
  }

  const media = await uploadImageFromBuffer(card, filename, "image/png", {
    title,
    altText: title,
  });
  return media?.source_url || null;
}

async function sendCardToWebhook(
  ctx,
  { card = null, title, bodyText = "", imageBuffer = null, lockTitle = false } = {}
) {
  const session = getSession(ctx.chat.id);
  const dest = session.publishDest || "fvdigital";
  if (destIncludesFv(dest) && !config.publishWebhook?.enabled) {
    if (dest === "fvdigital") return;
  }

  try {
    let bg = imageBuffer;
    if (!bg && card) {
      // compat: si solo viene el PNG ya renderizado, úsalo solo para un target
      bg = null;
    }

    const targets = webhookTargets(dest);
    const results = [];
    let lastCaption = "";

    for (const target of targets) {
      const lang = socialLangForTarget(target);
      const hashtag =
        target === "f1rd"
          ? config.f1rdWebhook?.hashtag || "#Formula1RD"
          : config.publishWebhook?.hashtag || "#fvdigital";

      const cardTitle = lockTitle
        ? String(title || "").trim()
        : await composeCardHeadline(title, bodyText, { lang }).catch(() => title);
      const captionSeed = lockTitle
        ? `${cardTitle}\n\n${hashtag}`.trim()
        : await generateSocialCaption(title, bodyText, {
            hashtag,
            lang,
          }).catch(() => `${title}\n\n${hashtag}`.trim());

      let outCard = card;
      if (bg) {
        outCard = await generateNewsCard({
          backgroundBuffer: bg,
          title: cardTitle,
          ...cardOptsForDest(target),
        });
      } else if (!outCard) {
        results.push({ ok: false, target, error: "sin imagen para la tarjeta" });
        continue;
      }

      const publicUrl = await uploadCardPublicUrl(outCard, cardTitle);
      if (!publicUrl) {
        results.push({ ok: false, target, error: "sin URL pública de tarjeta" });
        continue;
      }

      const published = await publishToWebhook({
        caption: captionSeed,
        title: cardTitle,
        imageUrl: publicUrl,
        mediaType: "IMAGE",
        target,
      });
      results.push(published);
      if (published.ok) lastCaption = published.caption || captionSeed;
      if (published.ok) {
        session.lastVideo = {
          ...(session.lastVideo || {}),
          title: cardTitle,
          caption: lastCaption,
          imageUrl: publicUrl,
          at: new Date().toISOString(),
        };
      }
    }

    const failed = results.filter((r) => !r.ok);
    const ok = results.filter((r) => r.ok);
    if (ok.length) {
      const queued = ok.some((r) => r.queued);
      const note = queued
        ? `Encolado en n8n (${destLabel(dest)}).`
        : `Enviado a ${destLabel(dest)}.`;
      await ctx.reply(`${note}\n\n${lastCaption}`);
    }
    if (failed.length) {
      await ctx.reply(
        `No pude enviar a: ${failed.map((f) => f.target || "?").join(", ")} — ${failed[0].error || failed[0].status}`
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

function destChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("FV Digital", "dest:fvdigital"),
      Markup.button.callback("F1RD", "dest:f1rd"),
    ],
    [
      Markup.button.callback("Ambos", "dest:both"),
      Markup.button.callback("❌ Cancelar", "dest:cancel"),
    ],
  ]);
}

/**
 * Pregunta siempre FV / F1RD / Ambos antes de publicar.
 * @param {{ url?: string|null, extraCategories?: string[], resume?: string, text?: string }} opts
 */
async function askPublishDest(
  ctx,
  { url = null, extraCategories = [], resume = "link", text = "" } = {}
) {
  const session = getSession(ctx.chat.id);
  // Evita heredar un destino viejo (ej. F1 de un /video anterior).
  session.publishDest = null;
  session.pendingDestChoice = {
    url: url || null,
    extraCategories,
    resume,
    text: String(text || ""),
  };
  await ctx.reply(
    [
      "¿A qué webhook va esta publicación?",
      "• FV Digital — WordPress + redes FV",
      "• F1RD — solo redes Formula1RD (sin WordPress)",
      "• Ambos — WordPress FV + ambos webhooks",
    ].join("\n"),
    { ...destChoiceKeyboard(), disable_web_page_preview: true }
  );
}

/** Siempre pregunta destino (ya no depende del tipo de URL). */
async function maybeAskPublishDest(ctx, url, extraCategories = [], resume = "link") {
  if (!url) {
    getSession(ctx.chat.id).publishDest = "fvdigital";
    return false;
  }
  await askPublishDest(ctx, { url, extraCategories, resume });
  return true;
}

async function resumeAfterPublishDest(ctx, dest, pending) {
  const session = getSession(ctx.chat.id);
  session.publishDest = dest;
  session.pendingDestChoice = null;
  const url = pending.url;
  const extra = pending.extraCategories || [];
  const resume = pending.resume || "link";
  const text = pending.text || "";
  await ctx.reply(`Destino: ${destLabel(dest)}. Sigo.`, {
    disable_web_page_preview: true,
  });

  if (resume === "periodista") {
    await startPeriodistaFlow(ctx, text || "/periodista");
    return;
  }
  if (resume === "escribir") {
    await startWriteFlow(ctx, text || "/escribir");
    return;
  }
  if (resume === "wp") {
    await startWpFlow(ctx, text || "/wp");
    return;
  }
  if (resume === "noticia") {
    session.photoIntent = "noticia";
    await reply(
      ctx,
      "Envía la captura. Extraeré el texto, redactaré la noticia y luego te pediré la foto destacada (siempre con vista previa antes de publicar).",
      { voice: false }
    );
    return;
  }
  if (resume === "nota") {
    session.photoIntent = "nota";
    if (text) session.buffer.text = text;
    await reply(
      ctx,
      [
        "📄 /nota — envía un documento",
        "",
        "Acepta: PDF o foto del documento.",
        "Extraigo la información, redacto la nota y, si el archivo trae imagen, la uso; si no, te pido la foto destacada.",
        text ? `\nNota: ${text}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      { voice: false }
    );
    return;
  }
  if (resume === "auto") {
    session.mode = "auto";
    await reply(
      ctx,
      `Modo AUTO — destino ${destLabel(dest)}. Publicación a WordPress/redes según destino.`,
      { voice: false }
    );
    return;
  }
  if (resume === "encuestas") {
    await runEncuestasWithDest(ctx, dest);
    return;
  }
  if (resume === "encuesta_manual") {
    await sendManualEncuestaToWebhook(ctx, dest);
    return;
  }
  if (resume === "video") {
    await processSocialVideoUrl(ctx, url);
    return;
  }
  if (resume === "trad") {
    await processTradVideoUrl(ctx, url);
    return;
  }
  if (resume === "dub") {
    await processDubVideoUrl(ctx, url);
    return;
  }
  if (resume === "ndigital_brand") {
    await brandAndPreviewNdigital(ctx);
    return;
  }
  if (resume === "ndigital_publish") {
    await publishNdigitalAfterDest(ctx);
    return;
  }
  if (resume === "local_brand") {
    await brandAndPreviewLocal(ctx);
    return;
  }
  if (resume === "local_publish") {
    await publishLocalAfterDest(ctx);
    return;
  }

  // Enlace normal: Video/Noticia solo si es YT/IG/FB/X; si no → noticia de artículo (FV o F1).
  if (url && isSupportedSocialVideoUrl(url)) {
    await askSocialLinkChoice(ctx, url, extra);
    return;
  }
  if (url) {
    if (session.writeFlow) cancelWriteFlow(session);
    await handleNewsFromUrl(ctx, url, extra);
    return;
  }
  await reply(ctx, "No hay URL pendiente. Pega un enlace de nuevo.", {
    voice: false,
  });
}

async function runEncuestasWithDest(ctx, dest = "fvdigital") {
  await reply(
    ctx,
    `Publicando la siguiente encuesta pendiente (${destLabel(dest)})…`,
    { voice: false }
  );
  const { encuestasDailyLimit, runEncuestas } = await import("./encuestas.mjs");
  const result = await runEncuestas({
    limit: encuestasDailyLimit(),
    webhookDest: dest,
    mode: "tema",
  });
  const n = result?.published?.length || 0;
  const skip = result?.skipped?.length || 0;
  const errs = result?.errors?.length || 0;
  if (result?.noneNew) {
    await reply(ctx, "No hay encuestas nuevas por publicar.", { voice: false });
    return;
  }
  const recycled = result?.recycled ? " (cola reiniciada)" : "";
  await reply(
    ctx,
    `Encuestas listas [${result?.source || "tema"}]. Publicadas: ${n} | omitidas (sin foto): ${skip} | errores: ${errs}${recycled}`,
    { voice: false }
  );
}

async function handleEncuestaPhoto(ctx, imageBuffer, mimeType, caption = "") {
  const session = getSession(ctx.chat.id);
  if (!session.encuestaFlow) session.encuestaFlow = emptyEncuestaFlow();
  const flow = session.encuestaFlow;

  if (flow.mode === "doble") {
    if (flow.step !== "awaiting_photos") {
      await reply(
        ctx,
        "Primero dime de cuántas fotos será (2, 3 o 4).",
        { voice: false }
      );
      return;
    }
    flow.photos.push(imageBuffer);
    const have = flow.photos.length;
    const need = flow.photoCount;
    await reply(ctx, `✅ Foto ${have}/${need} recibida.`, { voice: false });
    if (have < need) {
      await reply(ctx, encuestaAskNextPhotoText(flow), { voice: false });
      return;
    }
    flow.step = "awaiting_question";
    const maybeQ = normalizeEncuestaQuestion(caption);
    if (maybeQ.length >= 8) {
      await finishEncuestaWithQuestion(ctx, maybeQ);
      return;
    }
    await reply(ctx, encuestaAskQuestionText(), { voice: false });
    return;
  }

  setEncuestaPhoto(session, imageBuffer, mimeType);
  const maybeQ =
    normalizeEncuestaQuestion(caption) ||
    normalizeEncuestaQuestion(flow.question || "");
  if (maybeQ.length >= 5) {
    await finishEncuestaWithQuestion(ctx, maybeQ);
    return;
  }
  await reply(ctx, encuestaAskQuestionText(), { voice: false });
}

async function handleEncuestaFlowText(ctx, trimmed) {
  const session = getSession(ctx.chat.id);
  const flow = session.encuestaFlow;
  if (!flow) return false;

  if (flow.mode === "doble" && flow.step === "awaiting_count") {
    const n = parseEncuestaPhotoCount(trimmed);
    if (![2, 3, 4].includes(n)) {
      await reply(ctx, "Responde solo con 2, 3 o 4.", { voice: false });
      return true;
    }
    flow.photoCount = n;
    flow.photos = [];
    flow.step = "awaiting_photos";
    await reply(
      ctx,
      `Perfecto: encuesta de ${n} fotos.\n${encuestaAskNextPhotoText(flow)}`,
      { voice: false }
    );
    return true;
  }

  if (flow.step === "awaiting_question") {
    await finishEncuestaWithQuestion(ctx, trimmed);
    return true;
  }

  if (flow.mode === "doble" && flow.step === "awaiting_photos") {
    await reply(ctx, encuestaAskNextPhotoText(flow), { voice: false });
    return true;
  }

  if (flow.step === "awaiting_photo") {
    await reply(ctx, "Envía la foto de la encuesta primero.", { voice: false });
    return true;
  }

  return false;
}

async function finishEncuestaWithQuestion(ctx, questionRaw) {
  const session = getSession(ctx.chat.id);
  const flow = session.encuestaFlow;
  const isDoble = flow?.mode === "doble";
  if (isDoble) {
    if (!flow.photos?.length || flow.photos.length !== flow.photoCount) {
      throw new Error(
        `Faltan fotos. Van ${flow.photos?.length || 0} de ${flow.photoCount}.`
      );
    }
  } else if (!flow?.photoBuffer) {
    throw new Error("Falta la foto. Envía /encuesta y luego la foto.");
  }
  const question = normalizeEncuestaQuestion(questionRaw);
  if (question.length < 5) {
    await reply(ctx, "La pregunta es muy corta. Escríbela completa:", {
      voice: false,
    });
    return;
  }

  flow.question = question;
  flow.step = "building";

  await reply(ctx, "📝 Revisando ortografía (sin cambiar tu texto)…", {
    voice: false,
  });
  let suggested = question;
  try {
    suggested = (await correctHeadlineSpelling(question)).trim() || question;
  } catch (err) {
    console.warn("encuesta spelling:", err.message);
  }

  if (encuestaSpellingDiffers(question, suggested)) {
    flow.spellingNote = suggested;
    await reply(
      ctx,
      [
        "⚠️ Posible ortografía / tildes distintas (mantengo tu texto):",
        `Tu pregunta: «${question}»`,
        `Sugerencia: «${suggested}»`,
      ].join("\n"),
      { voice: false }
    );
  } else {
    flow.spellingNote = "";
    await reply(ctx, "✅ Ortografía OK. Montando la tarjeta…", { voice: false });
  }

  await reply(
    ctx,
    isDoble
      ? `🎨 Generando tarjeta con ${flow.photoCount} rostros en círculo…`
      : "🎨 Generando tarjeta ALPHA…",
    { voice: false }
  );
  const cardBuffer = isDoble
    ? await generateEncuestaDobleCard({
        photoBuffers: flow.photos,
        title: question,
      })
    : await generateEncuestaAlphaCard({
        photoBuffer: flow.photoBuffer,
        title: question,
      });
  flow.cardBuffer = cardBuffer;

  try {
    archiveProducedGraphic({
      buffer: cardBuffer,
      caption: question,
      ext: ".png",
      nameHint: isDoble ? `encuesta-${flow.photoCount}f` : "encuesta",
    });
  } catch (err) {
    console.warn("encuesta archive:", err.message);
  }

  if (!config.r2?.enabled) {
    await ctx.replyWithPhoto(Input.fromBuffer(cardBuffer, "encuesta.png"), {
      caption: question,
    });
    cancelEncuestaFlow(session);
    await reply(
      ctx,
      "Tarjeta lista (R2 no configurado). No pude enviar al webhook.",
      { voice: false }
    );
    return;
  }

  await reply(ctx, "📦 Subiendo a R2…", { voice: false });
  const r2Key = `encuestas/encuesta-${Date.now()}.png`;
  const imageUrl = await uploadToR2(cardBuffer, r2Key, "image/png");
  if (!isPublicR2Url(imageUrl)) {
    throw new Error("La URL R2 de la encuesta no es pública.");
  }
  flow.imageUrl = imageUrl;
  flow.r2Key = r2Key;
  flow.step = "awaiting_dest";

  await ctx.replyWithPhoto(Input.fromBuffer(cardBuffer, "encuesta.png"), {
    caption: question,
  });

  await askPublishDest(ctx, { resume: "encuesta_manual" });
}

async function sendManualEncuestaToWebhook(ctx, dest = "fvdigital") {
  const session = getSession(ctx.chat.id);
  const flow = session.encuestaFlow;
  if (!flow?.imageUrl || !flow?.question) {
    throw new Error("No hay encuesta lista. Usa /encuesta (foto + pregunta).");
  }

  assertDestWebhooksReady(dest);
  const hashtag =
    dest === "f1rd"
      ? config.f1rdWebhook?.hashtag || "#Formula1RD"
      : config.publishWebhook?.hashtag || "#fvdigital";
  const caption = ensureCaptionHashtag(flow.question, dest) || `${flow.question}\n\n${hashtag}`;

  await reply(ctx, `📤 Enviando encuesta a ${destLabel(dest)}…`, {
    voice: false,
  });
  const results = await publishToDestinations(dest, {
    caption,
    title: flow.question,
    imageUrl: flow.imageUrl,
    r2Key: flow.r2Key || null,
    mediaType: "IMAGE",
  });
  const failed = results.filter((r) => !r.ok);
  const ok = results.filter((r) => r.ok);
  cancelEncuestaFlow(session);
  session.publishDest = "fvdigital";

  if (!ok.length) {
    throw new Error(failed[0]?.error || `HTTP ${failed[0]?.status}`);
  }
  const queued = ok.some((r) => r.queued);
  await reply(
    ctx,
    [
      queued
        ? `Encuesta encolada en n8n (${destLabel(dest)}).`
        : `Encuesta enviada a ${destLabel(dest)}.`,
      flow.imageUrl,
      "",
      caption,
      flow.spellingNote
        ? `\n(Nota: hubo sugerencia ortográfica; se publicó tu texto original.)`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    { voice: false, disable_web_page_preview: true }
  );
  if (failed.length) {
    await reply(
      ctx,
      `Falló: ${failed.map((f) => f.target).join(", ")} — ${failed[0].error || failed[0].status}`,
      { voice: false }
    );
  }
}

function socialLinkChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🎬 Video", "link:video"),
      Markup.button.callback("📰 Noticia", "link:news"),
    ],
    [Markup.button.callback("❌ Cancelar", "link:cancel")],
  ]);
}

async function askSocialLinkChoice(ctx, url, extraCategorySlugs = []) {
  const session = getSession(ctx.chat.id);
  const platform =
    detectVideoPlatform(url) || detectSocialPlatform(url) || "";
  const label = socialVideoPlatformLabel(platform) || socialPlatformLabel(platform);
  session.pendingLinkChoice = {
    url,
    extraCategories: extraCategorySlugs,
  };
  await ctx.reply(
    [
      `Enlace de ${label}. Destino: ${destLabel(session.publishDest || "fvdigital")}.`,
      "",
      "¿Qué hago con él?",
      "• Video — descargar y publicar en redes",
      destIncludesFv(session.publishDest)
        ? "• Noticia — titular, imagen y texto a WordPress"
        : "• Noticia — titular, imagen y gráfico a redes (sin WordPress)",
    ].join("\n"),
    { ...socialLinkChoiceKeyboard(), disable_web_page_preview: true }
  );
}

/** true si el bot preguntó Video/Noticia (no seguir el flujo de noticias). */
async function maybeAskSocialLinkChoice(ctx, url, extraCategorySlugs = []) {
  if (!url || !isSupportedSocialVideoUrl(url)) return false;
  if (getSession(ctx.chat.id).writeFlow) cancelWriteFlow(getSession(ctx.chat.id));
  await askSocialLinkChoice(ctx, url, extraCategorySlugs);
  return true;
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

function ndigitalPreviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Publicar", "ndigital:publish")],
    [Markup.button.callback("❌ Cancelar", "ndigital:cancel")],
  ]);
}

function localPreviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Publicar", "local:publish")],
    [Markup.button.callback("❌ Cancelar", "local:cancel")],
  ]);
}

function sieConcatKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Sí, concatenar SIE", "sie:yes"),
      Markup.button.callback("No, enviar así", "sie:no"),
    ],
    [Markup.button.callback("❌ Cancelar", "sie:cancel")],
  ]);
}

function ensureCaptionHashtag(caption = "", dest = "fvdigital") {
  if (dest === "both") {
    let base = String(caption || "")
      .replace(/#fvdigital(?:\.do)?/gi, "")
      .replace(/#formula1rd\b/gi, "")
      .replace(/#f1rd\b/gi, "")
      .trim();
    const fv = config.publishWebhook?.hashtag || "#fvdigital";
    const f1 = config.f1rdWebhook?.hashtag || "#Formula1RD";
    if (!base) return `${fv}\n\n${f1}`;
    return `${base}\n\n${fv}\n${f1}`.trim();
  }
  // n8n Formula1RD exige #Formula1RD en el caption o no publica.
  return captionForTarget(caption, dest === "f1rd" ? "f1rd" : "fvdigital");
}

/**
 * Adjunta paquete de noticia WP al pendiente (titular + HTML + frame 1280×720).
 * Se publica al confirmar Enviar, junto con el video a redes.
 */
async function attachWpNewsToPending(
  pending,
  {
    videoBuffer,
    textSeed = "",
    titleHint = "",
    dest = "fvdigital",
    onStatus,
  } = {}
) {
  if (!pending || !destIncludesFv(dest)) {
    if (pending) pending.publishNews = false;
    return pending;
  }
  pending.publishNews = true;
  const seed = String(textSeed || "").trim();
  let newsTitle = String(titleHint || pending.title || "Video").trim();

  if (Buffer.isBuffer(videoBuffer) && videoBuffer.length > 1000) {
    try {
      onStatus?.("🖼️ Frame 1280×720 para WordPress…");
      pending.frameBuffer = await extractVideoFrame1280x720(videoBuffer, {
        onStatus,
      });
    } catch (err) {
      console.warn("attachWpNews frame:", err.message);
    }
  }

  if (seed.length >= 20) {
    try {
      const formatted = await formatNewsBodyHtml({
        text: seed,
        title: newsTitle,
        topic: "noticia en video",
      });
      pending.body_html = finalizeNewsHtml(
        coerceArticleHtml(formatted.content_html),
        { skipSource: true }
      );
      newsTitle = formatted.title || newsTitle;
    } catch {
      const paras = seed
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .slice(0, 8)
        .map((p) => `<p>${p.replace(/</g, "&lt;")}</p>`)
        .join("\n");
      pending.body_html = finalizeNewsHtml(paras || `<p>${newsTitle}</p>`, {
        skipSource: true,
      });
    }
    pending.excerpt = seed.slice(0, 280);
  } else if (!pending.body_html) {
    pending.body_html = finalizeNewsHtml(`<p>${newsTitle}</p>`, {
      skipSource: true,
    });
    pending.excerpt = newsTitle.slice(0, 280);
  }

  pending.newsTitle = newsTitle;
  if (!pending.title) pending.title = newsTitle;
  return pending;
}

async function askSocialVideoConfirm(ctx, pending) {
  const session = getSession(ctx.chat.id);
  const dest = pending.dest || session.publishDest || "fvdigital";
  pending.dest = dest;
  session.pendingSocialVideo = pending;

  const label = socialVideoPlatformLabel(pending.platform);
  const mb = (pending.bytes / 1024 / 1024).toFixed(1);
  const isTrad = pending.kind === "trad";
  const isNdigital = pending.kind === "ndigital";
  const isLocal = pending.kind === "local";
  const sieHint = destIncludesFv(dest)
    ? "Tras Enviar te preguntaré si concateno un bumper SIE."
    : "Destino solo F1RD → se envía sin bumper SIE.";
  const newsHint =
    pending.publishNews !== false && destIncludesFv(dest)
      ? "También crearé noticia WP: titular + imagen 1280×720 + categorías fv/tweet2/tema."
      : "";
  const text = [
    isTrad && pending.captionFallback
      ? `🎬 Reel listo (9:16 · ${label} · ${mb} MB · voz desde caption${pending.includeHeadline === false ? " · sin titular" : ""})`
      : isTrad && pending.overlayOnly
      ? `🎬 Reel listo (9:16 · ${label} · ${mb} MB · ya en español${pending.includeHeadline === false ? " · sin titular" : ""})`
      : isTrad
        ? `🎬 Reel traducido listo (9:16 · ${label} · ${mb} MB · doblaje pabmatos${pending.includeHeadline === false ? " · sin titular" : ""})`
        : isNdigital
          ? `🎬 /ndigital listo (${label} · ${mb} MB · crop overlays)`
          : isLocal
            ? `🎬 /local listo (${mb} MB · video + noticia WP)`
          : `🎬 Video listo (${label} · ${mb} MB)`,
    `Origen: ${pending.sourceUrl}`,
    `R2 (público): ${pending.videoUrl}`,
    isTrad && pending.language ? `Idioma detectado: ${pending.language}` : "",
    "",
    "📝 Caption propuesto:",
    pending.caption,
    "",
    `Destino: ${destLabel(dest)}`,
    newsHint,
    sieHint,
    "¿Lo envío?",
  ]
    .filter(Boolean)
    .join("\n");

  await ctx.reply(text, {
    ...socialVideoConfirmKeyboard(),
    disable_web_page_preview: true,
  });
}

async function processSocialVideoUrl(ctx, sourceUrl) {
  const session = getSession(ctx.chat.id);
  const dest = session.publishDest || "fvdigital";
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  assertDestWebhooksReady(dest);
  if (!isSupportedSocialVideoUrl(sourceUrl)) {
    throw new Error(
      "URL no soportada. Usa YouTube, Instagram, Facebook, Dailymotion o X."
    );
  }

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
  const hashtag =
    dest === "f1rd"
      ? config.f1rdWebhook?.hashtag || "#Formula1RD"
      : config.publishWebhook?.hashtag || "#fvdigital";
  const rawCaption = await generateSocialCaption(
    downloaded.title,
    downloaded.description || downloaded.title,
    { hashtag, stickToSource: true }
  ).catch(() => downloaded.title);
  const caption = ensureCaptionHashtag(rawCaption, dest);
  await archiveProcessedVideoSafe({
    buffer: downloaded.buffer,
    caption,
    url: videoUrl,
    nameHint: key.match(/(\d{8}-\d{6})/)?.[1] || "",
  });

  // También prepara noticia WP (titular + frame 1280×720 + texto del audio)
  let news = {
    publishNews: destIncludesFv(dest),
    newsTitle: downloaded.title,
    body_html: "",
    excerpt: "",
    frameBuffer: null,
  };
  if (news.publishNews) {
    try {
      await reply(ctx, "📰 Preparando noticia WP (audio + frame 1280×720)…", {
        voice: false,
      });
      const ext = downloaded.ext || ".mp4";
      const job = await prepareLocalVideoJob(downloaded.buffer, {
        fileName: `social${ext.startsWith(".") ? ext : `.${ext}`}`,
        titleHint: downloaded.title || "",
        descriptionHint: downloaded.description || "",
        onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
      });
      try {
        const seed =
          job.transcriptEs || job.transcript || downloaded.description || "";
        news.newsTitle = job.headline || job.title || downloaded.title;
        news.excerpt = String(seed).slice(0, 280);
        news.frameBuffer = job.frameBuffer || null;
        try {
          const formatted = await formatNewsBodyHtml({
            text: seed,
            title: news.newsTitle,
            topic: "noticia en video",
          });
          news.body_html = finalizeNewsHtml(
            coerceArticleHtml(formatted.content_html),
            { skipSource: true }
          );
          news.newsTitle = formatted.title || news.newsTitle;
        } catch {
          const paras = String(seed)
            .split(/(?<=[.!?])\s+/)
            .filter(Boolean)
            .slice(0, 8)
            .map((p) => `<p>${p.replace(/</g, "&lt;")}</p>`)
            .join("\n");
          news.body_html = finalizeNewsHtml(
            paras || `<p>${news.newsTitle}</p>`,
            { skipSource: true }
          );
        }
      } finally {
        await discardLocalJob(job).catch(() => {});
      }
    } catch (err) {
      console.warn("video→noticia prep:", err.message);
      news.publishNews = false;
      await reply(
        ctx,
        `⚠️ El video se puede enviar, pero no armé la noticia WP: ${err.message}`,
        { voice: false }
      );
    }
  }

  const pending = {
    kind: "video",
    videoUrl,
    r2Key: key,
    title: news.newsTitle || downloaded.title,
    caption,
    sourceUrl: downloaded.sourceUrl,
    platform: downloaded.platform,
    bytes: downloaded.bytes,
    step: "confirm",
    publishNews: news.publishNews,
    newsTitle: news.newsTitle,
    body_html: news.body_html,
    excerpt: news.excerpt,
    frameBuffer: news.frameBuffer,
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

function tradSourceModeKeyboard(job) {
  const rows = [];
  if (job?.hasTranscript) {
    rows.push([
      Markup.button.callback("🌐 Traducir el audio", "trad:source:audio"),
    ]);
  }
  if (job?.hasCaption) {
    rows.push([
      Markup.button.callback(
        "📝 Crear audio desde el caption",
        "trad:source:caption"
      ),
    ]);
  }
  rows.push([
    Markup.button.callback("📋 Pegar texto (audio + caption)", "trad:source:text"),
  ]);
  rows.push([Markup.button.callback("❌ Cancelar", "trad:source:cancel")]);
  return Markup.inlineKeyboard(rows);
}

async function askTradSourceMode(ctx, job) {
  const lines = [
    "🎙️ Video listo. ¿Cómo genero la voz?",
    "",
    job.hasTranscript
      ? "• Traducir el audio — tomo lo que se dice, lo paso a español y doblo"
      : "• (Sin audio usable para traducir)",
    job.hasCaption
      ? "• Crear audio desde el caption — traduzco el caption a español y genero la narración"
      : "• (Sin caption/descripción)",
    "• Pegar texto — envías el guion; creo el audio y el caption a partir de ese texto",
    "",
    "Elige una opción:",
  ];
  await ctx.reply(lines.join("\n"), tradSourceModeKeyboard(job));
}

async function askTradHeadlineConfirm(ctx, job) {
  const voiceNote =
    job.overlayOnly
      ? "El video ya está en español (solo reel 9:16)."
      : job.sourceMode === "from_text"
        ? "Voz y caption generados desde el texto que pegaste."
        : job.captionFallback || job.sourceMode === "from_caption"
          ? "Voz generada desde el caption (traducido a español)."
          : "Incluye doblaje pabmatos desde el audio.";
  const text = [
    "📰 Titular propuesto:",
    `«${job.headline || "(sin titular)"}»`,
    "",
    voiceNote,
    "",
    "¿Pongo este titular sobre el video?",
  ].join("\n");

  await ctx.reply(text, tradHeadlineKeyboard());
}

function tradTextKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✍️ Corregir", "trad:text:correct"),
      Markup.button.callback("🌐 Traducir", "trad:text:translate"),
    ],
    [
      Markup.button.callback("🔍 Buscar", "trad:text:search"),
      Markup.button.callback("🔊 Audio", "trad:text:audio"),
    ],
    [Markup.button.callback("❌ Cancelar", "trad:text:cancel")],
  ]);
}

function tradTextAudioConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Generar audio con este texto", "trad:text:audio_yes")],
    [Markup.button.callback("✏️ Cambiar texto", "trad:text:audio_edit")],
    [Markup.button.callback("⬅️ Volver", "trad:text:audio_back")],
  ]);
}

function startTradTextFlow(ctx, rawText) {
  const session = getSession(ctx.chat.id);
  const draft = String(rawText || "").trim();
  if (!draft) {
    throw new Error("Pega un texto o envía una URL de video.");
  }
  session.pendingSocialVideo = null;
  session.pendingTradText = { step: "choose", draft };
  return draft;
}

async function askTradTextChoice(ctx, draft) {
  const preview = draft.length > 600 ? `${draft.slice(0, 600)}…` : draft;
  await ctx.reply(
    [
      "📝 Texto recibido para /trad (IA).",
      "",
      preview,
      "",
      "¿Qué hago?",
      "• Corregir — ortografía y redacción",
      "• Traducir — al español",
      "• Buscar — información con Tavily y enriquecer el texto",
      "• Audio — primero te muestro el texto y confirmas",
    ].join("\n"),
    tradTextKeyboard()
  );
}

async function askTradTextAudioConfirm(ctx, draft) {
  const session = getSession(ctx.chat.id);
  session.pendingTradText = {
    ...(session.pendingTradText || {}),
    step: "confirm_audio",
    draft,
  };
  const body = draft.length > 3500 ? `${draft.slice(0, 3500)}…` : draft;
  await ctx.reply(
    [
      "🔊 Texto que se narrará en el audio:",
      "",
      body,
      "",
      "¿Genero el audio con este texto, o quieres cambiarlo?",
    ].join("\n"),
    tradTextAudioConfirmKeyboard()
  );
}

async function generateTradTextAudio(ctx, draft) {
  await reply(ctx, "🔊 Generando audio (voz /trad)…", { voice: false });
  const voiceId =
    config.trad?.voiceId ||
    config.audio.mistralTtsVoiceId ||
    "";
  const audioPath = await synthesizeSpeech(draft, {
    voiceId,
    preferMistral: true,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });
  try {
    const buf = await readTempFile(audioPath);
    await ctx.replyWithAudio(Input.fromBuffer(buf, "trad-texto.mp3"), {
      caption: draft.slice(0, 900),
    });
  } finally {
    cleanupTemp(audioPath);
  }
}

async function applyTradTextAction(ctx, action) {
  const session = getSession(ctx.chat.id);
  const pending = session.pendingTradText;
  if (!pending?.draft && action !== "cancel") {
    throw new Error("No hay texto /trad pendiente. Usa /trad y pega el texto.");
  }
  const draft = pending?.draft || "";

  if (action === "cancel") {
    session.pendingTradText = null;
    await reply(ctx, "/trad texto cancelado.", { voice: false });
    return;
  }

  if (action === "correct") {
    await reply(ctx, "✍️ Corrigiendo texto…", { voice: false });
    const out = await correctTradText(draft);
    session.pendingTradText = { step: "choose", draft: out };
    await reply(ctx, `✅ Texto corregido:\n\n${out}`, { voice: false });
    await askTradTextChoice(ctx, out);
    return;
  }

  if (action === "translate") {
    await reply(ctx, "🌐 Traduciendo al español…", { voice: false });
    const out = await translateToSpanish(draft, { context: "texto para /trad" });
    session.pendingTradText = { step: "choose", draft: out };
    await reply(ctx, `✅ Traducción:\n\n${out}`, { voice: false });
    await askTradTextChoice(ctx, out);
    return;
  }

  if (action === "search") {
    if (!isTavilyEnabled()) {
      throw new Error("Tavily no está configurado (TAVILY_API_KEY en .env).");
    }
    await reply(ctx, "🔍 Buscando información con Tavily…", { voice: false });
    const topic = draft.length > 280 ? draft.slice(0, 280) : draft;
    const research = await tavilyResearchTopic(topic, {
      onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
    });
    if (!research) {
      throw new Error("Tavily no devolvió resultados.");
    }

    const answer = String(research.answer || "").trim();
    const sources = (research.results || [])
      .slice(0, 4)
      .map((r, i) => `${i + 1}. ${r.title || "Fuente"}\n${r.url || ""}`)
      .filter(Boolean)
      .join("\n\n");

    const briefParts = [];
    if (answer) briefParts.push(answer);
    if (research.researchText) {
      briefParts.push(String(research.researchText).slice(0, 5000));
    }
    const researchBrief = briefParts.join("\n\n");

    const infoMsg = [
      "🔎 Hallazgos Tavily:",
      answer ? `\n${answer.slice(0, 1500)}` : "\n(Sin resumen automático)",
      sources ? `\n\nFuentes:\n${sources}` : "",
    ].join("");
    await reply(ctx, infoMsg.slice(0, 3900), { voice: false });

    await reply(ctx, "✍️ Enriqueciendo tu texto con esos datos…", { voice: false });
    const out = await enrichTradTextWithResearch(draft, researchBrief);
    session.pendingTradText = {
      step: "choose",
      draft: out,
      researchBrief,
    };
    await reply(ctx, `✅ Texto enriquecido:\n\n${out}`, { voice: false });
    await askTradTextChoice(ctx, out);
    return;
  }

  if (action === "audio") {
    await askTradTextAudioConfirm(ctx, draft);
    return;
  }

  if (action === "audio_yes") {
    await generateTradTextAudio(ctx, draft);
    session.pendingTradText = { step: "choose", draft };
    await askTradTextChoice(ctx, draft);
    return;
  }

  if (action === "audio_edit") {
    session.pendingTradText = { ...pending, step: "await_audio_text", draft };
    await reply(
      ctx,
      "✏️ Envía ahora el texto exacto que quieres en el audio (o /cancelar).",
      { voice: false }
    );
    return;
  }

  if (action === "audio_back") {
    session.pendingTradText = { ...pending, step: "choose", draft };
    await askTradTextChoice(ctx, draft);
    return;
  }

  throw new Error(`Acción /trad texto desconocida: ${action}`);
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
    await reply(ctx, "🇪🇸 Video en español — no se tradujo, solo reel 9:16.", {
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
  const dest = session.publishDest || "fvdigital";
  const hashtag =
    dest === "f1rd"
      ? config.f1rdWebhook?.hashtag || "#Formula1RD"
      : config.publishWebhook?.hashtag || "#fvdigital";
  const captionSeed =
    built.socialCaptionSeed ||
    built.headline ||
    built.translation?.slice(0, 280) ||
    built.description?.slice(0, 280) ||
    built.title ||
    (built.overlayOnly ? "Video" : "Video traducido");
  const rawCaption = await generateSocialCaption(
    built.title || "Video",
    captionSeed,
    { hashtag, stickToSource: true }
  ).catch(() =>
    typeof captionSeed === "string" ? captionSeed.slice(0, 400) : "Video"
  );
  const caption = ensureCaptionHashtag(rawCaption, dest);
  await archiveProcessedVideoSafe({
    buffer: built.buffer,
    caption,
    url: videoUrl,
    nameHint: key.match(/(\d{8}-\d{6})/)?.[1] || "",
  });

  const pending = {
    kind: "trad",
    videoUrl,
    r2Key: key,
    title: built.headline || built.title,
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
    publishNews: destIncludesFv(dest),
  };
  await attachWpNewsToPending(pending, {
    videoBuffer: built.buffer,
    textSeed: captionSeed,
    titleHint: built.headline || built.title,
    dest,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });
  session.pendingSocialVideo = pending;
  session.lastVideo = {
    title: pending.title,
    caption: pending.caption,
    videoUrl: pending.videoUrl,
    at: new Date().toISOString(),
  };

  await askSocialVideoConfirm(ctx, pending);
}

async function askDubHeadlineConfirm(ctx, job) {
  const text = [
    "📰 Titular propuesto:",
    `«${job.headline || "(sin titular)"}»`,
    "",
    "Doblaje ElevenLabs listo (voz clonada → español).",
    "",
    "¿Pongo este titular sobre el video?",
  ].join("\n");

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Sí, con titular", "dub:headline:yes"),
        Markup.button.callback("Sin titular", "dub:headline:no"),
      ],
      [Markup.button.callback("❌ Cancelar", "dub:headline:cancel")],
    ])
  );
}

async function finishDubAfterHeadlineChoice(ctx, includeHeadline) {
  const session = getSession(ctx.chat.id);
  const job = session.pendingDubJob;
  if (!job) {
    throw new Error("No hay preparación /dub pendiente. Vuelve a enviar /dub URL.");
  }

  session.pendingDubJob = null;
  session.pendingSocialVideo = null;

  const built = await finalizeDubJob(job, {
    includeHeadline,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  await reply(ctx, "📦 Subiendo reel 9:16 a R2…", { voice: false });
  const key =
    built.r2KeyHint ||
    buildSocialVideoR2Key(built.ext).replace("videos/fv-", "videos/dub-");
  const videoUrl = await uploadToR2(built.buffer, key, built.contentType);
  if (!isPublicR2Url(videoUrl)) {
    throw new Error(
      "La URL generada no es la pública de R2. Revisa R2_PUBLIC_BASE_URL."
    );
  }

  await reply(ctx, "✍️ Generando caption…", { voice: false });
  const dest = session.publishDest || "fvdigital";
  const hashtag =
    dest === "f1rd"
      ? config.f1rdWebhook?.hashtag || "#Formula1RD"
      : config.publishWebhook?.hashtag || "#fvdigital";
  const captionSeed =
    built.socialCaptionSeed ||
    built.headline ||
    built.description?.slice(0, 280) ||
    built.title ||
    "Video doblado";
  const rawCaption = await generateSocialCaption(
    built.title || "Video",
    captionSeed,
    { hashtag, stickToSource: true }
  ).catch(() =>
    typeof captionSeed === "string" ? captionSeed.slice(0, 400) : "Video"
  );
  const caption = ensureCaptionHashtag(rawCaption, dest);
  await archiveProcessedVideoSafe({
    buffer: built.buffer,
    caption,
    url: videoUrl,
    nameHint: key.match(/(\d{8}-\d{6})/)?.[1] || "",
  });

  const pending = {
    kind: "dub",
    videoUrl,
    r2Key: key,
    title: built.headline || built.title,
    caption,
    sourceUrl: built.sourceUrl,
    platform: built.platform,
    bytes: built.bytes,
    language: built.language,
    headline: built.headline,
    includeHeadline: built.includeHeadline,
    step: "confirm",
    publishNews: destIncludesFv(dest),
  };
  await attachWpNewsToPending(pending, {
    videoBuffer: built.buffer,
    textSeed: captionSeed,
    titleHint: built.headline || built.title,
    dest,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });
  session.pendingSocialVideo = pending;
  session.lastVideo = {
    title: pending.title,
    caption: pending.caption,
    videoUrl: pending.videoUrl,
    at: new Date().toISOString(),
  };

  await askSocialVideoConfirm(ctx, pending);
}

async function processDubVideoUrl(ctx, sourceUrl) {
  const dest = getSession(ctx.chat.id).publishDest || "fvdigital";
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  assertDestWebhooksReady(dest);
  if (!config.dub?.elevenApiKey) {
    throw new Error("Falta ELEVENLABS_API_KEY en .env para /dub.");
  }
  if (!isSupportedSocialVideoUrl(sourceUrl)) {
    throw new Error(
      "URL no soportada. Usa YouTube, Instagram, Facebook, Dailymotion o X."
    );
  }

  const session = getSession(ctx.chat.id);
  if (session.pendingDubJob) {
    await discardDubJob(session.pendingDubJob);
    session.pendingDubJob = null;
  }
  if (session.pendingTradJob) {
    await discardTradJob(session.pendingTradJob);
    session.pendingTradJob = null;
  }
  session.pendingSocialVideo = null;

  await reply(
    ctx,
    "⏳ /dub: descargando video y enviando a ElevenLabs Dubbing…",
    { voice: false }
  );

  const job = await prepareDubJob(sourceUrl, {
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  session.pendingDubJob = job;
  session.pendingSocialVideo = {
    kind: "dub",
    step: "ask_headline",
    sourceUrl: job.sourceUrl,
    headline: job.headline,
  };

  await askDubHeadlineConfirm(ctx, job);
}

async function processNdigitalVideoUrl(ctx, sourceUrl) {
  if (!isSupportedSocialVideoUrl(sourceUrl)) {
    throw new Error(
      "URL no soportada. Usa YouTube, Instagram, Facebook, Dailymotion o X."
    );
  }

  const session = getSession(ctx.chat.id);
  if (session.pendingNdigitalJob) {
    await discardNdigitalJob(session.pendingNdigitalJob);
    session.pendingNdigitalJob = null;
  }
  session.pendingSocialVideo = null;

  await reply(ctx, "⏳ /ndigital: descargando y recortando…", { voice: false });

  const job = await prepareNdigitalJob(sourceUrl, {
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  await reply(ctx, "✍️ Generando titular según el tema…", { voice: false });
  const headline = await generateNdigitalHeadline(job).catch(
    () => job.title || "Video"
  );
  job.headline = headline;

  session.pendingNdigitalJob = job;
  session.pendingSocialVideo = {
    kind: "ndigital",
    step: "await_dest",
    sourceUrl: job.sourceUrl,
    platform: job.platform,
    title: job.title,
    headline,
    bytes: job.bytes,
  };

  await reply(
    ctx,
    [
      `Titular propuesto:`,
      `«${headline}»`,
      "",
      "Elige destino (logo FV o F1RD) y te mando el preview con marca.",
    ].join("\n"),
    { voice: false }
  );
  await askPublishDest(ctx, {
    url: job.sourceUrl,
    resume: "ndigital_brand",
  });
}

async function brandAndPreviewNdigital(ctx) {
  const session = getSession(ctx.chat.id);
  const dest = session.publishDest || "fvdigital";
  const job = session.pendingNdigitalJob;
  if (!job?.localPath) {
    throw new Error("No hay recorte /ndigital pendiente. Usa /ndigital con una URL.");
  }

  // Si ya brandearon y cambian destino, recompone desde el crop limpio.
  if (job.croppedPath && existsSync(job.croppedPath)) {
    job.localPath = job.croppedPath;
    job.branded = false;
  }

  const logoDest = dest === "f1rd" ? "f1rd" : "fvdigital";
  await composeNdigitalBranded(job, {
    headline: job.headline,
    dest: logoDest,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  session.pendingNdigitalJob = job;
  session.pendingSocialVideo = {
    kind: "ndigital",
    step: "preview",
    sourceUrl: job.sourceUrl,
    platform: job.platform,
    title: job.title,
    headline: job.headline,
    bytes: job.bytes,
  };

  const mb = (job.bytes / 1024 / 1024).toFixed(1);
  const caption = [
    `✂️ /ndigital listo (${job.cropTop}px↑ / ${job.cropBottom}px↓ / −${job.trimEndSec}s)`,
    `Logo: ${logoDest === "f1rd" ? "F1RD" : "FV Digital"} · ${mb} MB`,
    `Titular: «${job.headline}»`,
    "Revisa el video. Si está bien, toca Publicar.",
  ].join("\n");

  try {
    await ctx.replyWithVideo(Input.fromLocalFile(job.localPath), {
      caption,
      supports_streaming: true,
      ...ndigitalPreviewKeyboard(),
    });
  } catch (err) {
    await reply(
      ctx,
      `${caption}\n\n⚠️ No pude adjuntar el preview (${err.message}). Aún puedes publicar o cancelar.`,
      { voice: false, ...ndigitalPreviewKeyboard() }
    );
  }
}

async function publishNdigitalAfterDest(ctx) {
  const session = getSession(ctx.chat.id);
  const dest = session.publishDest || "fvdigital";
  const job = session.pendingNdigitalJob;
  if (!job?.localPath) {
    throw new Error("No hay recorte /ndigital pendiente. Usa /ndigital con una URL.");
  }
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  assertDestWebhooksReady(dest);

  // Asegura marca según destino elegido
  if (!job.branded || (dest === "f1rd" && job.dest !== "f1rd") || (dest !== "f1rd" && job.dest === "f1rd")) {
    if (job.croppedPath && existsSync(job.croppedPath)) {
      job.localPath = job.croppedPath;
      job.branded = false;
    }
    await composeNdigitalBranded(job, {
      headline: job.headline,
      dest: dest === "f1rd" ? "f1rd" : "fvdigital",
      onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
    });
  }

  await reply(ctx, "📦 Subiendo a R2…", { voice: false });
  const { readFile } = await import("node:fs/promises");
  const buffer = job.buffer || (await readFile(job.localPath));
  const key = buildNdigitalR2Key(".mp4");
  const videoUrl = await uploadToR2(buffer, key, "video/mp4");
  if (!isPublicR2Url(videoUrl)) {
    throw new Error(
      "La URL generada no es la pública de R2. Revisa R2_PUBLIC_BASE_URL."
    );
  }

  await reply(ctx, "✍️ Generando caption según el tema…", { voice: false });
  const hashtag =
    dest === "f1rd"
      ? config.f1rdWebhook?.hashtag || "#Formula1RD"
      : config.publishWebhook?.hashtag || "#fvdigital";
  const rawCaption = await generateSocialCaption(
    job.headline || job.title,
    job.description || job.title,
    { hashtag, stickToSource: true }
  ).catch(() => job.headline || job.title);
  const caption = ensureCaptionHashtag(rawCaption, dest);
  await archiveProcessedVideoSafe({
    buffer,
    caption,
    url: videoUrl,
    nameHint: key.match(/(\d{8}-\d{6})/)?.[1] || "",
  });

  await discardNdigitalJob(job);
  session.pendingNdigitalJob = null;

  const pending = {
    kind: "ndigital",
    videoUrl,
    r2Key: key,
    title: job.headline || job.title,
    caption,
    sourceUrl: job.sourceUrl,
    platform: job.platform,
    bytes: buffer.length,
    step: "confirm",
    publishNews: destIncludesFv(dest),
  };
  await attachWpNewsToPending(pending, {
    videoBuffer: buffer,
    textSeed: job.description || job.headline || job.title || caption,
    titleHint: job.headline || job.title,
    dest,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });
  session.pendingSocialVideo = pending;
  session.lastVideo = {
    title: pending.title,
    caption: pending.caption,
    videoUrl: pending.videoUrl,
    at: new Date().toISOString(),
  };

  await askSocialVideoConfirm(ctx, pending);
}

async function processLocalVideoUpload(ctx, buffer, fileName = "video.mp4") {
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  if (!config.audio?.mistralApiKey && !config.audio?.openaiApiKey) {
    throw new Error("Falta MISTRAL_API_KEY o OPENAI_API_KEY para /local.");
  }

  const session = getSession(ctx.chat.id);
  if (session.pendingLocalJob) {
    await discardLocalJob(session.pendingLocalJob);
    session.pendingLocalJob = null;
  }
  session.pendingSocialVideo = null;

  await reply(ctx, "⏳ /local: procesando video del equipo…", { voice: false });

  const job = await prepareLocalVideoJob(buffer, {
    fileName,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  session.pendingLocalJob = job;
  session.pendingSocialVideo = {
    kind: "local",
    step: "await_dest",
    sourceUrl: job.sourceUrl,
    platform: "local",
    title: job.title,
    headline: job.headline,
    bytes: job.bytes,
  };

  const langNote = job.translated
    ? `Idioma: ${job.language || "otro"} → traducido al español.`
    : `Idioma: español (${job.language || "es"}).`;

  await reply(
    ctx,
    [
      langNote,
      "",
      "Titular propuesto:",
      `«${job.headline}»`,
      "",
      "Elige destino (logo FV o F1RD) y te mando el preview con marca.",
    ].join("\n"),
    { voice: false }
  );
  await askPublishDest(ctx, {
    url: job.sourceUrl,
    resume: "local_brand",
  });
}

async function brandAndPreviewLocal(ctx) {
  const session = getSession(ctx.chat.id);
  const dest = session.publishDest || "fvdigital";
  const job = session.pendingLocalJob;
  if (!job?.localPath) {
    throw new Error("No hay video /local pendiente. Usa /local y envía el archivo.");
  }

  if (job.croppedPath && existsSync(job.croppedPath)) {
    job.localPath = job.croppedPath;
    job.branded = false;
  }

  const logoDest = dest === "f1rd" ? "f1rd" : "fvdigital";
  await brandLocalVideo(job, {
    headline: job.headline,
    dest: logoDest,
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  session.pendingLocalJob = job;
  session.pendingSocialVideo = {
    kind: "local",
    step: "preview",
    sourceUrl: job.sourceUrl,
    platform: "local",
    title: job.title,
    headline: job.headline,
    bytes: job.bytes,
  };

  const mb = (job.bytes / 1024 / 1024).toFixed(1);
  const caption = [
    `📁 /local listo · ${mb} MB`,
    `Logo: ${logoDest === "f1rd" ? "F1RD" : "FV Digital"}`,
    job.translated
      ? `Audio: ${job.language || "otro"} → ES`
      : "Audio: español",
    `Titular: «${job.headline}»`,
    "También publicaré noticia WP (frame del video) + gráfico a redes.",
    "Revisa el video. Si está bien, toca Publicar.",
  ].join("\n");

  if (job.frameBuffer) {
    try {
      await ctx.replyWithPhoto(Input.fromBuffer(job.frameBuffer, "frame.jpg"), {
        caption: "🖼️ Frame para WordPress / redes",
      });
    } catch (err) {
      console.warn("local frame preview:", err.message);
    }
  }

  try {
    await ctx.replyWithVideo(Input.fromLocalFile(job.localPath), {
      caption,
      supports_streaming: true,
      ...localPreviewKeyboard(),
    });
  } catch (err) {
    await reply(
      ctx,
      `${caption}\n\n⚠️ No pude adjuntar el preview (${err.message}). Aún puedes publicar o cancelar.`,
      { voice: false, ...localPreviewKeyboard() }
    );
  }
}

async function publishLocalAfterDest(ctx) {
  const session = getSession(ctx.chat.id);
  const dest = session.publishDest || "fvdigital";
  const job = session.pendingLocalJob;
  if (!job?.localPath) {
    throw new Error("No hay video /local pendiente. Usa /local y envía el archivo.");
  }
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  assertDestWebhooksReady(dest);

  if (
    !job.branded ||
    (dest === "f1rd" && job.dest !== "f1rd") ||
    (dest !== "f1rd" && job.dest === "f1rd")
  ) {
    if (job.croppedPath && existsSync(job.croppedPath)) {
      job.localPath = job.croppedPath;
      job.branded = false;
    }
    await brandLocalVideo(job, {
      headline: job.headline,
      dest: dest === "f1rd" ? "f1rd" : "fvdigital",
      onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
    });
  }

  await reply(ctx, "📦 Subiendo a R2…", { voice: false });
  const { readFile } = await import("node:fs/promises");
  const buffer = job.buffer || (await readFile(job.localPath));
  const key = buildLocalR2Key(".mp4");
  const videoUrl = await uploadToR2(buffer, key, "video/mp4");
  if (!isPublicR2Url(videoUrl)) {
    throw new Error(
      "La URL generada no es la pública de R2. Revisa R2_PUBLIC_BASE_URL."
    );
  }

  await reply(ctx, "✍️ Generando caption y noticia desde la transcripción…", {
    voice: false,
  });
  const hashtag =
    dest === "f1rd"
      ? config.f1rdWebhook?.hashtag || "#Formula1RD"
      : config.publishWebhook?.hashtag || "#fvdigital";
  const captionSeed =
    job.transcriptEs || job.transcript || job.headline || job.title;
  const rawCaption = await generateSocialCaption(
    job.headline || job.title,
    captionSeed,
    { hashtag, stickToSource: true }
  ).catch(() => job.headline || job.title);
  const caption = ensureCaptionHashtag(rawCaption, dest);

  let bodyHtml = "";
  let newsTitle = job.headline || job.title;
  try {
    const formatted = await formatNewsBodyHtml({
      text: captionSeed,
      title: newsTitle,
      topic: "video local",
    });
    bodyHtml = finalizeNewsHtml(coerceArticleHtml(formatted.content_html), {
      skipSource: true,
    });
    newsTitle = formatted.title || newsTitle;
  } catch (err) {
    console.warn("local news body:", err.message);
    const paras = String(captionSeed)
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map((p) => `<p>${p.replace(/</g, "&lt;")}</p>`)
      .join("\n");
    bodyHtml = finalizeNewsHtml(paras || `<p>${newsTitle}</p>`, {
      skipSource: true,
    });
  }

  const frameBuffer = job.frameBuffer || null;
  await archiveProcessedVideoSafe({
    buffer,
    caption,
    url: videoUrl,
    nameHint: key.match(/(\d{8}-\d{6})/)?.[1] || "",
  });
  await discardLocalJob(job);
  session.pendingLocalJob = null;

  const pending = {
    kind: "local",
    videoUrl,
    r2Key: key,
    title: newsTitle,
    caption,
    sourceUrl: job.sourceUrl,
    platform: "local",
    bytes: buffer.length,
    step: "confirm",
    dest,
    frameBuffer,
    body_html: bodyHtml,
    excerpt: String(captionSeed).slice(0, 280),
    publishNews: true,
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
  const dest = getSession(ctx.chat.id).publishDest || "fvdigital";
  if (!config.r2?.enabled) {
    throw new Error("R2 no está configurado. Revisa R2_* en .env.");
  }
  assertDestWebhooksReady(dest);
  if (!config.audio.mistralApiKey) {
    throw new Error("Falta MISTRAL_API_KEY para /trad.");
  }
  if (!isSupportedSocialVideoUrl(sourceUrl)) {
    throw new Error(
      "URL no soportada. Usa YouTube, Instagram, Facebook, Dailymotion o X."
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
    "⏳ /trad: descargando video y detectando audio/caption…",
    { voice: false }
  );

  const inspected = await inspectTradVideo(sourceUrl, {
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  session.pendingTradJob = inspected;
  session.pendingSocialVideo = {
    kind: "trad",
    step: "await_source_mode",
    sourceUrl: inspected.sourceUrl,
  };

  // Siempre preguntar: audio / caption / pegar texto
  await askTradSourceMode(ctx, inspected);
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

  const dest = pending.dest || session.publishDest || "fvdigital";
  session.publishDest = dest;
  // Fuerza hashtag correcto antes de enviar (F1RD = #Formula1RD para n8n).
  // Videos: caption en el idioma original (NO se fuerza inglés).
  const caption =
    dest === "both"
      ? ensureCaptionHashtag(pending.caption, "both")
      : captionForTarget(pending.caption, dest === "f1rd" ? "f1rd" : "fvdigital");
  const mediaType =
    pending.mediaType === "IMAGE" || pending.kind === "termometro"
      ? "IMAGE"
      : "VIDEO";
  const results = await publishToDestinations(dest, {
    caption,
    title: pending.title || caption,
    videoUrl: pending.videoUrl,
    r2Key: pending.r2Key || null,
    mediaType,
  });

  session.pendingSocialVideo = null;
  const sentCaption = results.find((r) => r.caption)?.caption || caption;
  const failed = results.filter((r) => !r.ok);
  const ok = results.filter((r) => r.ok);
  if (!ok.length) {
    throw new Error(failed[0]?.error || `HTTP ${failed[0]?.status}`);
  }
  const queued = ok.some((r) => r.queued);
  const sieNote = pending.sieName ? `\nSIE: ${pending.sieName}` : "";
  const note = queued
    ? `Video (R2) encolado en n8n (${destLabel(dest)}).`
    : `Video enviado a ${destLabel(dest)}.`;
  await ctx.reply(`${note}${sieNote}\n\n${pending.videoUrl}\n\n${sentCaption}`, {
    disable_web_page_preview: true,
  });
  if (failed.length) {
    await ctx.reply(
      `Falló: ${failed.map((f) => f.target).join(", ")} — ${failed[0].error || failed[0].status}`
    );
  }

  // Cualquier VIDEO a redes (FV) → también noticia WP (titular + 1280×720 + fv/tweet2/tema)
  const wantNews =
    pending.publishNews !== false &&
    mediaType === "VIDEO" &&
    destIncludesFv(dest) &&
    pending.kind !== "termometro";
  if (wantNews) {
    try {
      await publishLocalNewsBundle(ctx, {
        title: pending.newsTitle || pending.headline || pending.title,
        bodyHtml: pending.body_html,
        excerpt: pending.excerpt || pending.caption,
        frameBuffer: pending.frameBuffer,
        dest,
        sourceLabel: `${pending.kind || "video"}-news`,
        skipSocialCard: true,
        videoUrl: pending.videoUrl || "",
      });
    } catch (err) {
      console.error("noticia tras video:", err);
      await ctx.reply(`⚠️ Video ok, pero falló la noticia WP: ${err.message}`);
    }
  }

  session.publishDest = "fvdigital";
}

/** Noticia WordPress a partir del frame + texto del video. */
async function publishLocalNewsBundle(
  ctx,
  {
    title,
    bodyHtml,
    excerpt = "",
    frameBuffer = null,
    dest = "fvdigital",
    extraCategorySlugs = [],
    sourceLabel = "local-news",
    skipSocialCard = false,
    videoUrl = "",
  } = {}
) {
  const spanishTitle = String(title || "").trim() || "Video";
  let html = withNewsVideoPlayer(coerceArticleHtml(bodyHtml || ""), videoUrl);
  const doWp = destIncludesFv(dest);
  let featuredMediaId = 0;

  let featuredFrame = frameBuffer;
  if (featuredFrame) {
    try {
      featuredFrame = await toFeatured1280x720(featuredFrame);
    } catch (err) {
      console.warn("toFeatured1280x720:", err.message);
    }
  }

  if (featuredFrame) {
    try {
      await ctx.replyWithPhoto(Input.fromBuffer(featuredFrame, "frame-1280x720.jpg"), {
        caption: `🖼️ Destacada 1280×720 → «${spanishTitle}»`,
      });
    } catch {
      // ignore preview fail
    }
  }

  if (doWp && featuredFrame) {
    await reply(ctx, "📰 Subiendo destacada 1280×720 a WordPress…", {
      voice: false,
    });
    try {
      const media = await uploadImageFromBuffer(
        featuredFrame,
        `video-frame-1280x720-${Date.now()}.jpg`,
        "image/jpeg"
      );
      featuredMediaId = media.id;
    } catch (error) {
      console.warn("video WP frame:", error.message);
      await reply(ctx, `⚠️ WordPress no recibió el frame: ${error.message}`, {
        voice: false,
      });
    }
  }

  if (!doWp) {
    await reply(ctx, "F1RD: no publico en WordPress.", { voice: false });
    return;
  }

  await reply(
    ctx,
    "📰 Publicando noticia WP (categorías fv + tweet2 + tema)…",
    { voice: false }
  );
  const postStatus = config.autoPublishUrls ? "publish" : config.defaultPostStatus;
  try {
    const result = await createPost({
      title: spanishTitle,
      text: excerpt || htmlToPlainText(html).slice(0, 280),
      htmlContent: html,
      featuredMediaId,
      extraCategorySlugs,
      status: postStatus,
      autoTopic: true,
    });
    const verified = await getPost(result.post.id);
    if (!verified?.id) throw new Error("WordPress no confirmó el post.");
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
      formatUploadedPost(verified, {
        categories: result.categories,
        tags: result.tags,
      }),
      { voice: false }
    );
    rememberFeedPublished(
      dest || "fvdigital",
      verified.link || result.post?.link,
      spanishTitle,
      sourceLabel
    );
  } catch (error) {
    console.error("video WP post:", error);
    await reply(ctx, `⚠️ WordPress: ${error.message}`, { voice: false });
    return;
  }

  if (!skipSocialCard) {
    await reply(ctx, "📤 Enviando gráfico a redes…", { voice: false });
    await sendSocialCard(ctx, {
      title: spanishTitle,
      imageBuffer: featuredFrame || frameBuffer,
      bodyText:
        excerpt ||
        htmlToPlainText(html).slice(0, 600) ||
        spanishTitle,
    });
  }
}

/**
 * Noticia desde video social (IG/YT/FB/X): descarga → STT → frame → WP + tarjeta.
 */
async function processVideoNewsUrl(ctx, sourceUrl, extraCategorySlugs = []) {
  const session = getSession(ctx.chat.id);
  const dest = session.publishDest || "fvdigital";
  if (!isSupportedSocialVideoUrl(sourceUrl)) {
    throw new Error(
      "URL no soportada. Usa YouTube, Instagram, Facebook, Dailymotion o X."
    );
  }

  await reply(ctx, "⏳ Descargando video para armar la noticia…", {
    voice: false,
  });
  const downloaded = await downloadSocialVideo(sourceUrl, {
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  const ext = downloaded.ext || ".mp4";
  const fileName = `social-news${ext.startsWith(".") ? ext : `.${ext}`}`;
  await reply(ctx, "📝 Sacando texto del audio y un frame…", { voice: false });
  const job = await prepareLocalVideoJob(downloaded.buffer, {
    fileName,
    titleHint: downloaded.title || "",
    descriptionHint: downloaded.description || "",
    onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
  });

  try {
    job.sourceUrl = downloaded.sourceUrl || sourceUrl;
    job.platform = downloaded.platform || job.platform;

    const captionSeed =
      job.transcriptEs || job.transcript || job.headline || job.title;
    let newsTitle = job.headline || job.title || downloaded.title || "Video";
    let bodyHtml = "";
    try {
      const formatted = await formatNewsBodyHtml({
        text: captionSeed,
        title: newsTitle,
        topic: "noticia en video",
      });
      bodyHtml = finalizeNewsHtml(coerceArticleHtml(formatted.content_html), {
        skipSource: true,
      });
      newsTitle = formatted.title || newsTitle;
    } catch (err) {
      console.warn("video news body:", err.message);
      const paras = String(captionSeed)
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .slice(0, 8)
        .map((p) => `<p>${p.replace(/</g, "&lt;")}</p>`)
        .join("\n");
      bodyHtml = finalizeNewsHtml(paras || `<p>${newsTitle}</p>`, {
        skipSource: true,
      });
    }

    if (!job.frameBuffer) {
      await reply(
        ctx,
        "⚠️ No pude capturar frame; la noticia irá sin imagen destacada.",
        { voice: false }
      );
    }

    let playerUrl = downloaded.sourceUrl || sourceUrl || "";
    if (config.r2?.enabled && downloaded.buffer?.length > 1000) {
      try {
        await reply(ctx, "📦 Subiendo video a R2 para el player de la noticia…", {
          voice: false,
        });
        const key = buildSocialVideoR2Key(downloaded.ext || ".mp4");
        const uploaded = await uploadToR2(
          downloaded.buffer,
          key,
          "video/mp4"
        );
        if (isPublicR2Url(uploaded)) playerUrl = uploaded;
      } catch (err) {
        console.warn("video-news R2:", err.message);
      }
    }

    await publishLocalNewsBundle(ctx, {
      title: newsTitle,
      bodyHtml,
      excerpt: String(captionSeed).slice(0, 280),
      frameBuffer: job.frameBuffer,
      dest,
      extraCategorySlugs,
      sourceLabel: "video-news",
      videoUrl: playerUrl,
    });
  } finally {
    await discardLocalJob(job).catch(() => {});
  }
}

/** Si el destino incluye FV y hay bumpers SIE, pregunta antes de enviar. */
async function maybeAskSieThenSend(ctx) {
  const session = getSession(ctx.chat.id);
  const pending = session.pendingSocialVideo;
  if (!pending?.videoUrl) {
    throw new Error("No hay video pendiente de envío.");
  }
  // Congela el destino del pendiente (no heredar un F1RD viejo/nuevo a medias).
  const dest = pending.dest || session.publishDest || "fvdigital";
  pending.dest = dest;
  session.publishDest = dest;
  session.pendingSocialVideo = pending;

  if (pending.kind === "termometro" || pending.mediaType === "IMAGE") {
    await reply(ctx, "ℹ️ Imagen (no video) → envío sin bumper SIE.", {
      voice: false,
    });
    await sendPendingSocialVideoToWebhook(ctx);
    return;
  }

  if (!destIncludesFv(dest)) {
    await reply(
      ctx,
      `ℹ️ Destino ${destLabel(dest)} (sin FV) → envío sin bumper SIE.`,
      { voice: false }
    );
    await sendPendingSocialVideoToWebhook(ctx);
    return;
  }

  if (!sieBumperAvailable()) {
    await reply(
      ctx,
      "⚠️ SIE no disponible (carpeta vacía o desactivado). Envío sin bumper.",
      { voice: false }
    );
    await sendPendingSocialVideoToWebhook(ctx);
    return;
  }

  let pick;
  try {
    pick = pickNextSieVideo();
  } catch (err) {
    await reply(ctx, `⚠️ SIE no disponible (${err.message}). Envío sin bumper.`, {
      voice: false,
    });
    await sendPendingSocialVideoToWebhook(ctx);
    return;
  }

  pending.step = "ask_sie";
  pending.siePick = { path: pick.path, name: pick.name };
  session.pendingSocialVideo = pending;

  const left = pick.remainingAfter;
  console.log(
    `[SIE] ask chat=${ctx.chat?.id} dest=${dest} next=${pick.name} left=${left}`
  );
  await ctx.reply(
    [
      "🎬 ¿Concateno un video SIE al final?",
      "",
      `Siguiente: ${pick.name}`,
      left > 0
        ? `Quedan ${left} sin usar en este ciclo (luego se reinicia).`
        : "Es el último del ciclo; el próximo reinicia la lista.",
      "",
      "Destino: " + destLabel(dest),
    ].join("\n"),
    { ...sieConcatKeyboard(), disable_web_page_preview: true }
  );
}

async function applySieConcatAndSend(ctx) {
  const session = getSession(ctx.chat.id);
  const pending = session.pendingSocialVideo;
  if (!pending?.videoUrl) {
    throw new Error("No hay video pendiente de envío.");
  }
  const pick = pending.siePick || pickNextSieVideo();
  await reply(ctx, `🔗 Concatenando SIE: ${pick.name}…`, { voice: false });

  let result;
  try {
    result = await concatVideoWithSie({
      mainUrl: pending.videoUrl,
      siePath: pick.path,
      onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
    });
    const key = buildSocialVideoR2Key(".mp4").replace(
      "videos/fv-",
      "videos/fv-sie-"
    );
    await reply(ctx, "📦 Subiendo video+SIE a R2…", { voice: false });
    const videoUrl = await uploadToR2(result.buffer, key, "video/mp4");
    if (!isPublicR2Url(videoUrl)) {
      throw new Error("La URL R2 del video+SIE no es pública.");
    }
    await archiveProcessedVideoSafe({
      buffer: result.buffer,
      caption: pending.caption || pick.name,
      url: videoUrl,
      nameHint: key.match(/(\d{8}-\d{6})/)?.[1] || "",
    });
    markSieUsed(pick.name);
    pending.videoUrl = videoUrl;
    pending.r2Key = key;
    pending.bytes = result.bytes;
    pending.sieName = pick.name;
    pending.siePick = null;
    pending.step = "confirm";
    session.pendingSocialVideo = pending;
    await sendPendingSocialVideoToWebhook(ctx);
  } finally {
    await discardSieWork(result);
  }
}

async function handleTermometroPhoto(ctx, imageBuffer, mimeType) {
  const session = getSession(ctx.chat.id);
  const flow = getTermometroData(session);
  if (!flow) return;

  setTermometroPhoto(session, imageBuffer, mimeType);

  const name = flow.name;
  const institution = flow.institution;

  const job = await createVideoJob(ctx, {
    tool: "Termómetro",
    label: `Imagen Termómetro: ${name}`,
    detail: `${institution}`,
  });

  let workDir;
  try {
    await withTyping(ctx, async () => {
      let lastLine = "Quitando fondo y recortando figura…";

      const { outputPath } = await generateTermometroVideo({
        name,
        institution,
        photoBuffer: imageBuffer,
        onProgress: (line) => {
          lastLine = `⏳ ${line}`;
          job.update(lastLine).catch(() => {});
        },
      });

      workDir = outputPath ? outputPath.replace(/termometro\.png$/, "") : null;

      if (!config.r2?.enabled) {
        await ctx.replyWithPhoto(Input.fromLocalFile(outputPath), {
          caption: `🌡️ Termómetro: ${name} en ${institution}`,
        });
        await job.finish({
          ok: true,
          message: "✅ Imagen Termómetro generada (R2 no configurado, enviado directo por Telegram).",
        });
        return;
      }

      job.update("⏳ Subiendo a R2…").catch(() => {});
      const r2Key = `termometro/termometro-${Date.now()}.png`;
      const imageBufferOut = readFileSync(outputPath);
      const imageUrl = await uploadToR2(imageBufferOut, r2Key, "image/png");

      const caption = ensureCaptionHashtag(`🌡️ Termómetro FV Digital: ${name} en ${institution}`);

      session.lastVideo = {
        title: `${name} en ${institution}`,
        caption,
        videoUrl: imageUrl,
        r2Key,
        mediaType: "IMAGE",
      };

      await job.finish({
        ok: true,
        message: "✅ Imagen Termómetro lista",
        imageUrl,
      });

      session.pendingSocialVideo = {
        kind: "termometro",
        step: "confirm",
        sourceUrl: "Termómetro FV Digital",
        videoUrl: imageUrl,
        r2Key,
        caption,
        title: `${name} en ${institution}`,
        bytes: imageBufferOut.length,
      };

      await askSocialVideoConfirm(ctx, session.pendingSocialVideo);
    });
  } catch (error) {
    console.error("handleTermometroPhoto:", error);
    await job.finish({
      ok: false,
      message: `❌ Termómetro: ${error.message}`,
    });
  } finally {
    cancelTermometroFlow(session);
    if (workDir) {
      cleanupTermometroWorkDir(workDir);
    }
  }
}

async function handleReporteCommand(ctx) {
  if (unauthorized(ctx)) return;
  rememberChat(ctx);
  await reply(ctx, "Armando REPORTE Intrant (fuentes del día → Word + correo)…", {
    voice: false,
  });
  try {
    const result = await runIntrantReport({
      onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
    });
    await reply(ctx, formatReporteTelegram(result), { voice: false });
  } catch (error) {
    console.error("/reporte:", error);
    await reply(ctx, `❌ REPORTE: ${error.message}`, { voice: false });
  }
}

async function handleBuscaCommand(ctx, headline = "") {
  if (unauthorized(ctx)) return;
  rememberChat(ctx);
  const q = String(headline || "").trim();
  if (!q) {
    await reply(
      ctx,
      "Uso: /busca [titular]\nEjemplo: /busca INTRANT anuncia operativo en la Duarte",
      { voice: false }
    );
    return;
  }
  await reply(ctx, `Buscando dónde se publicó:\n«${q}»\n(Tavily + Brave)…`, {
    voice: false,
  });
  try {
    const result = await searchHeadlineSources(q, {
      send: true,
      onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
    });
    await reply(ctx, formatBuscaTelegram(result), { voice: false });
  } catch (error) {
    console.error("/busca:", error);
    await reply(ctx, `❌ /busca: ${error.message}`, { voice: false });
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

const INTENT_LABELS = {
  write_news: "redactar noticia",
  wp: "artículo WordPress",
  periodista: "modo periodista",
  termometro: "imagen Termómetro",
  pic: "lower-third /pic",
  reporte: "REPORTE Intrant",
  busca: "buscar titular / medios",
  heygen: "video HeyGen",
  hyperframes: "HyperFrames",
  remotion: "Remotion",
  video_status: "estado de video",
  trad: "traducir / doblar",
  noticia_ocr: "noticia desde captura",
  nota: "nota desde documento",
  recortar: "recortar imagen",
  help: "ayuda",
  estado: "estado del bot",
  cancel: "cancelar",
};

/**
 * Ejecuta una orden clasificada (voz o texto).
 * @returns {Promise<boolean>} true si se despachó
 */
async function dispatchCommandIntent(ctx, intent) {
  if (!intent?.action || intent.action === "chat") return false;
  const session = getSession(ctx.chat.id);

  try {
    switch (intent.action) {
      case "help":
        await reply(ctx, helpText());
        return true;

      case "estado":
        await reply(
          ctx,
          [
            `Modo: ${session.mode}`,
            `Voz: ${session.voiceReplies ? "on" : "off"}`,
            `STT: ${getSpeechProviderLabel()}`,
            `Último post: ${session.lastPostId || "ninguno"}`,
          ].join("\n")
        );
        return true;

      case "cancel": {
        if (session.writeFlow) cancelWriteFlow(session);
        if (session.hyperFlow) cancelHyperFlow(session);
        if (session.termometroFlow) session.termometroFlow = null;
        if (session.encuestaFlow) cancelEncuestaFlow(session);
        if (session.pendingSocialVideo) session.pendingSocialVideo = null;
        if (session.pendingTradJob) {
          await discardTradJob(session.pendingTradJob);
          session.pendingTradJob = null;
        }
        if (session.pendingTradText) session.pendingTradText = null;
        await reply(ctx, "Listo, cancelé lo que estaba en curso.");
        return true;
      }

      case "write_news":
        await askPublishDest(ctx, {
          resume: "escribir",
          text: intent.topic ? `/escribir ${intent.topic}` : "/escribir",
        });
        return true;

      case "wp":
        await askPublishDest(ctx, {
          resume: "wp",
          text: intent.topic ? `/wp ${intent.topic}` : "/wp",
        });
        return true;

      case "periodista":
        await askPublishDest(ctx, {
          resume: "periodista",
          text: intent.title ? `/periodista ${intent.title}` : "/periodista",
        });
        return true;

      case "termometro": {
        session.termometroFlow = emptyTermometroFlow();
        await reply(ctx, termometroIntroText());
        return true;
      }

      case "pic": {
        session.picFlow = emptyPicFlow();
        const title = intent.raw.replace(/^\/pic\s*/i, "").trim();
        if (title) session.picFlow.headline = title;
        await reply(ctx, picIntroText(Boolean(title)), { voice: false });
        return true;
      }

      case "reporte":
        await handleReporteCommand(ctx);
        return true;

      case "busca": {
        const headline =
          intent.headline ||
          intent.title ||
          intent.raw.replace(/^\/busca\s*/i, "").trim();
        await handleBuscaCommand(ctx, headline);
        return true;
      }

      case "heygen":
        await handleHeyGenCommand(ctx, intent.prompt || "");
        return true;

      case "hyperframes":
        await handleHyperframesCommand(ctx, {
          render: intent.render !== false,
          prompt: intent.prompt || "",
        });
        return true;

      case "remotion":
        await handleRemotionCommand(ctx, { render: Boolean(intent.render) });
        return true;

      case "video_status":
        await handleVideoStatus(ctx);
        return true;

      case "trad":
        session.pendingSocialVideo = { kind: "trad", step: "await_url" };
        await reply(
          ctx,
          "🎙️ /trad por voz: envía ahora el enlace del video o pega el texto a narrar."
        );
        return true;

      case "dub":
        session.pendingSocialVideo = { kind: "dub", step: "await_url" };
        await reply(
          ctx,
          "🎧 /dub por voz: envía ahora el enlace del video a doblar con ElevenLabs."
        );
        return true;

      case "noticia_ocr":
        await askPublishDest(ctx, { resume: "noticia" });
        return true;

      case "nota":
        await askPublishDest(ctx, {
          resume: "nota",
          text: intent.raw.replace(/^\/nota\s*/i, "").trim(),
        });
        return true;

      case "recortar":
        session.photoIntent = "crop";
        await reply(ctx, "✂️ Modo recorte: envía la imagen a recortar.");
        return true;

      default:
        return false;
    }
  } catch (error) {
    console.error("dispatchCommandIntent:", error);
    await reply(ctx, `❌ No pude ejecutar la orden: ${error.message}`);
    return true;
  }
}

/**
 * Clasifica y despacha órdenes naturales (texto o voz).
 * @returns {Promise<boolean>}
 */
async function tryNaturalCommand(ctx, text) {
  const intent = await resolveCommandIntent(text, { useAi: true });
  if (!intent || intent.action === "chat") return false;

  const label = INTENT_LABELS[intent.action] || intent.action;
  const detail = intent.topic || intent.title || intent.prompt || "";
  await ctx
    .reply(
      detail
        ? `🎯 Orden detectada: ${label} — ${String(detail).slice(0, 120)}`
        : `🎯 Orden detectada: ${label}`
    )
    .catch(() => {});

  return dispatchCommandIntent(ctx, intent);
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

      // Siempre analizar el titular (reglas ≤12 palabras); en webs también,
      // para no dejar leads de medio (AGENDA56, datelines, etc.).
      await status(ctx, "2/4 🧠 Analizando y redactando titular...");
      const headlineForFormat = await generateNewsHeadline(cleanBody, {
        platform: platformLabel || "",
        fallbackTitle: article.title,
      }).catch(() => article.title);

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
          sourceUrl: url,
        };

        await ctx.reply(
          [
            `✅ Publicación de ${platformLabel} procesada.`,
            `Titular: ${spanishTitle}`,
            `Destino: ${destLabel(session.publishDest || "fvdigital")}.`,
            "",
            destIncludesFv(session.publishDest)
              ? "Elige la foto destacada (siempre la verás antes de publicar)."
              : "Elige la imagen para el gráfico de redes (F1RD no publica en WordPress).",
          ].join("\n"),
          { voice: false }
        );
        await askFeaturedImage(ctx, session);
        return;
      }

      let featuredMediaId = 0;
      const dest = getSession(ctx.chat.id).publishDest || "fvdigital";
      const doWp = destIncludesFv(dest);
      if (doWp && article.imageUrl) {
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
      } else if (doWp) {
        await status(ctx, "3/4 ℹ️ Continúo sin imagen destacada.");
      }

      const postStatus = config.autoPublishUrls ? "publish" : config.defaultPostStatus;
      let wpError = null;
      if (!doWp) {
        await reply(
          ctx,
          "F1RD: no publico en WordPress. Sigo con redes.",
          { voice: false }
        );
      } else {
      await status(ctx, "4/4 📤 Subiendo a WordPress...");
      try {
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
        rememberFeedPublished(
          session.publishDest || "fvdigital",
          verified.link || result.post?.link,
          spanishTitle,
          "news-url"
        );
      } catch (error) {
        wpError = error;
        console.error("handleNewsFromUrl WP:", error);
        await reply(
          ctx,
          `⚠️ WordPress: ${error.message}\nSigo enviando a redes.`,
          { voice: false }
        );
      }
      }

      await status(ctx, "📤 Enviando gráfico a redes...");
      await sendSocialCard(ctx, {
        title: spanishTitle,
        imageUrl: article.imageUrl || null,
        bodyText: cleanBody,
      });

      if (wpError && !config.socialCard.enabled) {
        throw wpError;
      }
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
  if (wf.step === "headline" || wf.step === "headline_confirm") {
    await ctx.reply("Siguiente paso: confirma el titular (*sí* / *original*) o envíalo.");
  } else if (wf.step === "title") {
    await ctx.reply("Siguiente paso: responde 1, 2, 3 o escribe tu titular.");
  } else if (wf.step === "topic") {
    await ctx.reply("Siguiente paso: envía el tema a desarrollar.");
  } else if (wf.step === "preview") {
    await ctx.reply(
      "Siguiente paso: Continuar, Reescribir, Opinión o Cancelar."
    );
  } else if (wf.step === "preview_feedback") {
    await ctx.reply(askRewriteOpinionText());
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

async function generateWpDraft(ctx, session, { rewriteNotes = "" } = {}) {
  const wf = session.writeFlow;
  const notes = String(rewriteNotes || wf.rewriteNotes || "").trim();
  wf.step = "generating";

  try {
    if (!wf.research) {
      wf.research = await Promise.race([
        researchWithStatus(ctx, wf.topic),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Búsqueda web tardó demasiado")), 60000)
        ),
      ]).catch((error) => {
        console.warn("researchTopic wp:", error.message);
        return { researchText: "", similarNews: [], articleBodies: [], imageUrl: null };
      });
    }

    if (wf.research.imageUrl && !wf.imageUrl) {
      wf.imageUrl = wf.research.imageUrl;
    }

    await status(
      ctx,
      notes ? "✍️ Reescribiendo con tu opinión..." : "✍️ Redactando titular y contenido..."
    );

    // Si ya hay titular (reescribir / opinión), no inventar otro.
    if (!wf.selectedTitle) {
      const titles = await suggestNewsTitles(wf.topic, wf.research.researchText || "");
      wf.titles = titles;
      wf.selectedTitle = titles[0] || wf.topic;
    }

    const draft = await writeOriginalNews({
      topic: wf.topic,
      title: wf.selectedTitle,
      researchText: wf.research.researchText || "",
      rewriteNotes: notes,
    });

    wf.body_html = finalizeNewsHtml(coerceArticleHtml(draft.body_html), {
      skipSource: true,
    });
    wf.excerpt = draft.excerpt || "";
    wf.rewriteNotes = "";
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
      lockTitle: false,
    }),
    { voice: false }
  );
  await ctx.reply("Elige una opción:", articlePreviewKeyboard());
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

function periodistaIntroText() {
  return [
    "✍️ /periodista — tu titular manda",
    "",
    "1) Me das el titular → solo corrijo ortografía (no cambio la esencia)",
    "2) Me das el tema y lo desarrollo",
    "3) Pedimos foto",
    "4) Subo a WordPress y al webhook de redes",
    "",
    "Envía el titular ahora, o /cancelar.",
  ].join("\n");
}

async function acceptPeriodistaHeadline(ctx, session, rawTitle) {
  const original = String(rawTitle || "").trim();
  if (original.length < 8) {
    await ctx.reply("El titular es muy corto. Escríbelo completo.", { voice: false });
    return false;
  }

  const wf = session.writeFlow;
  wf.originalTitle = original;
  await status(ctx, "📝 Revisando ortografía del titular (sin cambiar el sentido)...");
  let corrected = original;
  try {
    corrected = await correctHeadlineSpelling(original);
  } catch (error) {
    console.warn("correctHeadlineSpelling:", error.message);
  }

  wf.selectedTitle = corrected || original;
  wf.step = "headline_confirm";

  if (normalizeHeadline(corrected) === normalizeHeadline(original)) {
    await ctx.reply(
      [
        `Titular (sin cambios de sentido):`,
        wf.selectedTitle,
        "",
        "Responde *sí* para continuar, o envía el titular tal como lo quieres.",
      ].join("\n"),
      { voice: false }
    );
    return true;
  }

  await ctx.reply(
    [
      "Solo corrección ortográfica (la esencia no se toca):",
      "",
      `Original: ${original}`,
      `Corregido: ${wf.selectedTitle}`,
      "",
      "• *sí* — usar el corregido",
      "• *original* — usar el tuyo tal cual",
      "• o envía el titular exactamente como lo quieres",
    ].join("\n"),
    { voice: false }
  );
  return true;
}

function normalizeHeadline(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function startPeriodistaFlow(ctx, text = "") {
  const session = getSession(ctx.chat.id);
  if (session.hyperFlow) cancelHyperFlow(session);

  const initial = String(text || "")
    .replace(/^\/periodista(?:@\w+)?\s*/i, "")
    .trim();

  session.writeFlow = emptyWriteFlow();
  session.writeFlow.source = "periodista";
  session.writeFlow.step = "headline";
  session.writeFlow.extraCategorySlugs = parseExtraCategories(initial);

  const headline = stripCategoryDirective(initial);
  await ctx.reply(periodistaIntroText(), { voice: false });

  if (headline.length >= 8) {
    await acceptPeriodistaHeadline(ctx, session, headline);
  }
}

async function generatePeriodistaDraft(ctx, session, { rewriteNotes = "" } = {}) {
  const wf = session.writeFlow;
  const notes = String(rewriteNotes || wf.rewriteNotes || "").trim();
  wf.step = "generating";
  const lockedTitle = String(wf.selectedTitle || wf.originalTitle || "").trim();
  if (!lockedTitle) {
    wf.step = "headline";
    await ctx.reply("Falta el titular. Envíalo de nuevo.", { voice: false });
    return;
  }

  try {
    if (!wf.research) {
      wf.research = await Promise.race([
        researchWithStatus(ctx, wf.topic || lockedTitle),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Búsqueda web tardó demasiado")), 60000)
        ),
      ]).catch((error) => {
        console.warn("researchTopic periodista:", error.message);
        return { researchText: "", similarNews: [], articleBodies: [], imageUrl: null };
      });
    }

    if (wf.research.imageUrl && !wf.imageUrl) {
      wf.imageUrl = wf.research.imageUrl;
    }

    await status(
      ctx,
      notes
        ? "✍️ Reescribiendo con tu opinión (titular intacto)..."
        : "✍️ Desarrollando el tema (titular bloqueado)..."
    );
    const draft = await writeOriginalNews({
      topic: wf.topic || lockedTitle,
      title: lockedTitle,
      researchText: wf.research.researchText || "",
      rewriteNotes: notes,
    });

    wf.selectedTitle = lockedTitle;
    wf.body_html = finalizeNewsHtml(coerceArticleHtml(draft.body_html), {
      skipSource: true,
    });
    wf.excerpt = draft.excerpt || "";
    wf.rewriteNotes = "";
    wf.step = "preview";

    await reply(
      ctx,
      formatPeriodistaPreview({
        title: lockedTitle,
        excerpt: wf.excerpt,
        bodyPlain: htmlToPlainText(wf.body_html),
      }),
      { voice: false }
    );
    await ctx.reply("Elige una opción:", articlePreviewKeyboard());
  } catch (error) {
    console.error("generatePeriodistaDraft:", error);
    wf.step = "topic";
    await ctx.reply(`❌ Error al redactar: ${error.message}`, { voice: false });
  }
}

async function askArticleOpinion(ctx, session) {
  const wf = session.writeFlow;
  wf.step = "preview_feedback";
  await ctx.reply(askRewriteOpinionText(), { voice: false });
}

async function rewriteArticleFromPreview(ctx, session, notes = "") {
  const wf = session.writeFlow;
  wf.rewriteNotes = String(notes || "").trim();
  if (wf.source === "periodista") {
    await generatePeriodistaDraft(ctx, session, { rewriteNotes: wf.rewriteNotes });
    return;
  }
  if (wf.source === "wp") {
    await generateWpDraft(ctx, session, { rewriteNotes: wf.rewriteNotes });
    return;
  }
  await ctx.reply("Este flujo no admite reescritura aquí.", { voice: false });
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
    wf.source === "wp" || wf.source === "periodista"
      ? "¿Foto destacada para publicar en WordPress?"
      : "¿Foto destacada para el artículo?",
    "• Envía una imagen",
    "• Escribe *buscar* — busco otra en la web",
  ];

  if ((wf.source === "ocr" || wf.source === "nota") && wf.captureBuffer) {
    lines.push(
      wf.source === "nota"
        ? "• Escribe *documento* — usar imagen sacada del documento"
        : "• Escribe *captura* — usar imagen del screenshot"
    );
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

  if (wf.imageBuffer) {
    await previewFeaturedImage(ctx, {
      buffer: wf.imageBuffer,
      wf,
      caption:
        wf.source === "nota"
          ? "Imagen del documento. Responde *sí*, *buscar* otra, o envía tu foto."
          : "Imagen candidata. Responde *sí*, *buscar* otra, o envía tu foto.",
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
      } else if (wf.source === "periodista") {
        await status(ctx, "1/3 ✍️ Preparando artículo...");
        // El titular del periodista no se reescribe: solo la corrección ya aceptada.
        spanishTitle = String(wf.selectedTitle || wf.originalTitle || "").trim();
        html = finalizeNewsHtml(coerceArticleHtml(wf.body_html), { skipSource: true });
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
      const dest = session.publishDest || "fvdigital";
      if (!session.publishDest) {
        console.warn("publishWrittenNews: publishDest vacío; usando fvdigital");
      }
      const doWp = destIncludesFv(dest);

      if (doWp && wf.imageBuffer) {
        await status(
          ctx,
          wf.source === "ocr" ||
            wf.source === "social" ||
            wf.source === "wp" ||
            wf.source === "periodista"
            ? "2/3 🖼️ Subiendo imagen destacada..."
            : "3/4 🖼️ Subiendo tu imagen..."
        );
        try {
          const media = await uploadImageFromBuffer(
            wf.imageBuffer,
            `noticia-${Date.now()}.jpg`,
            wf.imageMimeType || "image/jpeg"
          );
          featuredMediaId = media.id;
        } catch (error) {
          console.warn("Imagen destacada WP:", error.message);
          await status(ctx, `⚠️ WordPress no recibió la imagen: ${error.message}`);
        }
      } else if (doWp && wf.imageUrl) {
        await status(
          ctx,
          wf.source === "ocr" ||
            wf.source === "social" ||
            wf.source === "wp" ||
            wf.source === "periodista"
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
          wf.source === "ocr" ||
            wf.source === "social" ||
            wf.source === "wp" ||
            wf.source === "periodista"
            ? "2/3 ℹ️ Sin imagen destacada."
            : "3/4 ℹ️ Sin imagen destacada."
        );
      }

      html = coerceArticleHtml(html);
      let wpError = null;
      if (!doWp) {
        await reply(
          ctx,
          "F1RD: no publico en WordPress. Sigo con redes.",
          { voice: false }
        );
      } else {
      await status(
        ctx,
        wf.source === "ocr" ||
          wf.source === "social" ||
          wf.source === "wp" ||
          wf.source === "periodista"
          ? "3/3 📤 Subiendo a WordPress..."
          : "4/4 📤 Subiendo a WordPress..."
      );
      const postStatus = config.autoPublishUrls ? "publish" : config.defaultPostStatus;
      try {
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
        rememberFeedPublished(
          session.publishDest || "fvdigital",
          verified.link || result.post?.link,
          spanishTitle,
          "write-news"
        );
      } catch (error) {
        wpError = error;
        console.error("publishWrittenNews WP:", error);
        await reply(
          ctx,
          `⚠️ WordPress: ${error.message}\nSigo enviando a redes.`,
          { voice: false }
        );
      }
      }

      const cardImageBuffer = wf.imageBuffer || wf.captureBuffer || null;
      const cardImageUrl = wf.imageUrl || null;
      const captionSource =
        [excerpt, htmlToPlainText(html)].filter(Boolean).join(" ").trim() ||
        excerpt;

      if (!wpError) {
        session.writeFlow = null;
      } else {
        wf.step = "photo";
      }

      await status(ctx, "📤 Enviando gráfico a redes...");
      await sendSocialCard(ctx, {
        title: spanishTitle,
        imageBuffer: cardImageBuffer,
        imageUrl: cardImageUrl,
        bodyText: captionSource,
      });
      // No heredar destino a la siguiente publicación
      session.publishDest = "fvdigital";
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

  if (/^(captura|usar captura|documento|usar documento)$/i.test(lower)) {
    if (!wf.captureBuffer) {
      await ctx.reply(
        wf.source === "nota"
          ? "No hay imagen del documento. Envía una foto o escribe *buscar*."
          : "No hay captura guardada. Envía una foto o escribe *buscar*."
      );
      return;
    }
    wf.imageBuffer = wf.captureBuffer;
    wf.imageMimeType = wf.captureMime || "image/jpeg";
    wf.imageUrl = null;
    await previewFeaturedImage(ctx, {
      buffer: wf.imageBuffer,
      caption:
        wf.source === "nota"
          ? "Imagen del documento. Responde *sí* para publicar, *buscar* otra, o envía otra foto."
          : "Imagen del screenshot. Responde *sí* para publicar, *buscar* otra, o envía otra foto.",
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
    "Envía una foto, escribe *buscar*, *captura*/*documento* (si aplica), *sin foto*, o *sí* si ya viste la imagen."
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
      const wasArticle = wf.source === "wp" || wf.source === "periodista";
      cancelWriteFlow(session);
      await ctx.reply(wasArticle ? "Artículo cancelado." : "Redacción cancelada.");
      return;
    }

    if (wf.step === "headline") {
      await acceptPeriodistaHeadline(ctx, session, text);
      return;
    }

    if (wf.step === "headline_confirm") {
      const lower = text.toLowerCase().trim();
      if (/^(sí|si|ok|dale|usar|corregido)$/i.test(lower)) {
        wf.step = "topic";
        await ctx.reply(
          [
            `Titular fijado: ${wf.selectedTitle}`,
            "",
            "Ahora dime el tema o ángulo a desarrollar (no cambio el titular).",
          ].join("\n"),
          { voice: false }
        );
        return;
      }
      if (/^(original|así|asi|no|tal cual)$/i.test(lower)) {
        wf.selectedTitle = wf.originalTitle || wf.selectedTitle;
        wf.step = "topic";
        await ctx.reply(
          [
            `Titular fijado: ${wf.selectedTitle}`,
            "",
            "Ahora dime el tema o ángulo a desarrollar (no cambio el titular).",
          ].join("\n"),
          { voice: false }
        );
        return;
      }
      await acceptPeriodistaHeadline(ctx, session, text);
      return;
    }

    if (wf.step === "topic") {
      wf.topic = cleanWriteTopic(text.trim());
      if (!wf.topic) {
        await ctx.reply(
          wf.source === "wp"
            ? "Indica el tema del artículo."
            : wf.source === "periodista"
              ? "Indica el tema o ángulo a desarrollar."
              : "Indica el tema de la noticia."
        );
        return;
      }
      if (wf.source === "wp") {
        await generateWpDraft(ctx, session);
        return;
      }
      if (wf.source === "periodista") {
        await generatePeriodistaDraft(ctx, session);
        return;
      }
      await askWriteTitles(ctx, session);
      return;
    }

    if (wf.step === "generating") {
      await ctx.reply("Estoy redactando el artículo, un momento...", { voice: false });
      return;
    }

    if (wf.step === "preview_feedback") {
      const notes = text.trim();
      if (notes.length < 8) {
        await ctx.reply(
          "Cuéntame un poco más qué cambiar (mín. unas palabras), o /cancelar.",
          { voice: false }
        );
        return;
      }
      await rewriteArticleFromPreview(ctx, session, notes);
      return;
    }

    if (wf.step === "preview") {
      if (isWpPreviewConfirm(text)) {
        await askFeaturedImage(ctx, session);
        return;
      }
      if (isWpPreviewRewrite(text)) {
        await rewriteArticleFromPreview(ctx, session, "");
        return;
      }
      if (isWpPreviewOpinion(text)) {
        await askArticleOpinion(ctx, session);
        return;
      }
      if (wf.source === "periodista") {
        await ctx.reply(
          "Usa los botones o escribe *sí*, *reescribir*, *opinión* o *cancelar*.",
          { voice: false }
        );
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
        wf.step = "preview";
        await showWpPreview(ctx, session);
        return;
      }
      await ctx.reply(
        "Usa los botones o escribe *sí*, *reescribir*, *opinión*, un titular nuevo, o *cancelar*.",
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

async function handleNoteFromDocument(
  ctx,
  fileBuffer,
  mimeType,
  fileName = "",
  userHint = "",
  extraCategorySlugs = []
) {
  try {
    await status(ctx, "1/3 📄 Leyendo el documento...");
    const { text, images } = await ocrDocument(fileBuffer, mimeType);

    await status(ctx, "2/3 ✍️ Extrayendo información y redactando la nota...");
    const draft = await buildNoteFromDocument({
      docText: text,
      userHint,
      fileName,
    });

    const session = getSession(ctx.chat.id);
    const docImage = images?.[0] || null;

    session.writeFlow = {
      ...emptyWriteFlow(),
      source: "nota",
      step: "photo",
      topic: draft.title,
      selectedTitle: draft.title,
      excerpt: draft.excerpt || "",
      body_html: finalizeNewsHtml(coerceArticleHtml(draft.body_html), {
        skipSource: true,
      }),
      captureBuffer: docImage?.buffer || null,
      captureMime: docImage?.mimeType || "image/jpeg",
      imageBuffer: docImage?.buffer || null,
      imageMimeType: docImage?.mimeType || null,
      extraCategorySlugs,
      research: null,
    };
    session.photoIntent = null;

    const lines = [
      "✅ Documento leído.",
      `Titular: ${draft.title}`,
    ];
    if (draft.summary) {
      lines.push("", "Puntos clave:", draft.summary);
    }
    lines.push("");

    if (docImage?.buffer) {
      lines.push(
        "Saqué una imagen del documento. La uso como candidata a foto destacada."
      );
      await ctx.reply(lines.join("\n"), { voice: false });
      await askFeaturedImage(ctx, session);
      return;
    }

    lines.push(
      "No encontré foto en el documento. Envía una imagen destacada, escribe *buscar* o *sin foto*."
    );
    await ctx.reply(lines.join("\n"), { voice: false });
    await askFeaturedImage(ctx, session);
  } catch (error) {
    console.error("handleNoteFromDocument:", error);
    await ctx.reply(`❌ Nota: ${error.message}`);
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

      rememberFeedPublished(
        session.publishDest || "fvdigital",
        result.post?.link,
        result.post.title?.rendered || title || text.slice(0, 90),
        "telegram-flush"
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
  const session = getSession(ctx.chat.id);
  session.fromVoice = !transcribeOnly;
  await ctx.reply("🎧 Escuchando tu audio…", { voice: false });

  try {
    const { buffer, ext } = await downloadTelegramFile(ctx, fileId);
    const text = await transcribeAudio(buffer, ext, {
      onStatus: (msg) => reply(ctx, msg, { voice: false }).catch(() => {}),
    });

    if (!text) {
      await reply(ctx, "No pude entender el audio.");
      return;
    }

    const trimmed = text.trim();

    if (transcribeOnly) {
      await reply(ctx, `📝 Entendí:\n${trimmed}`, { voice: false });
      return;
    }

    await ctx.reply(`📝 Entendí:\n${trimmed}`).catch(() => {});

    // Misma tubería que texto: flujos activos → órdenes naturales → chat
    const url = extractFirstUrl(trimmed);
    if (url) {
      if (await maybeAskPublishDest(ctx, url, parseExtraCategories(trimmed), "link")) {
        return;
      }
      if (await maybeAskSocialLinkChoice(ctx, url, parseExtraCategories(trimmed))) {
        return;
      }
      if (session.writeFlow) cancelWriteFlow(session);
      await handleNewsFromUrl(ctx, url, parseExtraCategories(trimmed));
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

    if (isTermometroActive(session)) {
      const handled = handleTermometroText(session, trimmed);
      if (handled) {
        await reply(ctx, handled.reply);
        return;
      }
    }

    if (isEncuestaFlowActive(session)) {
      if (await handleEncuestaFlowText(ctx, trimmed)) return;
    }

    if (isPicFlowActive(session)) {
      if (await handlePicFlowText(ctx, trimmed)) return;
    }

    if (session.pendingSocialVideo?.step === "await_url") {
      const kind =
        session.pendingSocialVideo.kind === "trad"
          ? "trad"
          : session.pendingSocialVideo.kind === "dub"
            ? "dub"
            : session.pendingSocialVideo.kind === "ndigital"
              ? "ndigital"
              : "video";
      if (kind === "trad" && trimmed.length >= 8 && !extractFirstUrl(trimmed)) {
        session.pendingSocialVideo = null;
        const draft = startTradTextFlow(ctx, trimmed);
        await askTradTextChoice(ctx, draft);
        return;
      }
      await reply(
        ctx,
        kind === "trad"
          ? "Envía un enlace de video o un texto más largo para /trad."
          : kind === "dub"
            ? "Envía un enlace válido de video para /dub."
            : kind === "ndigital"
              ? "Envía un enlace válido de video para /ndigital."
              : "Envía un enlace válido de video."
      );
      return;
    }

    if (await tryNaturalCommand(ctx, trimmed)) return;

    if (await tryRouteVideoIntent(ctx, trimmed)) return;

    // Charla / pregunta libre → DeepSeek + respuesta en audio
    await handleChatText(ctx, trimmed, { showThinking: false });
  } catch (error) {
    await reply(ctx, `❌ Audio: ${error.message}`);
  } finally {
    session.fromVoice = false;
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

    if (termometroAwaitingPhoto(session)) {
      await handleTermometroPhoto(ctx, imageBuffer, mimeType);
      return;
    }

    if (
      isEncuestaFlowActive(session) &&
      (encuestaAwaitingPhoto(session) ||
        session.encuestaFlow?.step === "awaiting_photos" ||
        /^\/encuesta(?:doble)?\b/i.test(caption))
    ) {
      await handleEncuestaPhoto(ctx, imageBuffer, mimeType, caption);
      return;
    }

    if (
      isPicFlowActive(session) ||
      picAwaitingPhoto(session) ||
      picAwaitingTitle(session) ||
      /^\/pic\b/i.test(caption)
    ) {
      if (!session.picFlow) session.picFlow = emptyPicFlow();
      await handlePicPhoto(ctx, imageBuffer, mimeType, caption);
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
    const doNota = wantsNota(caption, session.photoIntent);

    if (doCrop) {
      const cropped = await processCrop(ctx, imageBuffer, mimeType, caption);
      imageBuffer = cropped.buffer;
      mimeType = cropped.mimeType;
    }

    if (doNota) {
      const extra = [
        ...session.buffer.extraCategories,
        ...parseExtraCategories(caption),
      ];
      await handleNoteFromDocument(
        ctx,
        imageBuffer,
        mimeType,
        "foto-documento.jpg",
        caption,
        extra
      );
      session.photoIntent = null;
      return;
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
  bot.use(async (ctx, next) => {
    const orig = ctx.reply.bind(ctx);
    ctx.reply = async (text, extra) => {
      const chunks = splitTelegramChunks(text);
      let last;
      for (let i = 0; i < chunks.length; i++) {
        last = await orig(chunks[i], i === 0 ? extra : undefined);
      }
      return last;
    };
    return next();
  });

  bot.start(async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    getSession(ctx.chat.id).mode = "auto";
    await reply(ctx, helpText(), { voice: false });
  });
  bot.command(["ayuda", "help", "comandos"], async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    await reply(ctx, helpText(), { voice: false });
  });

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
          "Envía el enlace del video (YouTube, Instagram, Facebook, Dailymotion o X).",
          { voice: false }
        );
        return;
      }
      if (await maybeAskPublishDest(ctx, url, [], "video")) return;
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
      if (url) {
        if (await maybeAskPublishDest(ctx, url, [], "trad")) return;
        await processTradVideoUrl(ctx, url);
        return;
      }
      if (arg) {
        // Texto pegado junto al comando (sin URL).
        const draft = startTradTextFlow(ctx, arg);
        await askTradTextChoice(ctx, draft);
        return;
      }
      const session = getSession(ctx.chat.id);
      session.pendingTradText = null;
      session.pendingSocialVideo = { step: "await_url", kind: "trad" };
      await reply(
        ctx,
        [
          "Envía el enlace del video (YouTube, Instagram, Facebook, Dailymotion o X)",
          "o pega un texto para mejorarlo con IA (corregir / traducir / buscar Tavily / audio).",
          "",
          "Video: si NO está en español → doblaje pabmatos; si YA es ES → reel 9:16.",
          "Titular del reel: igual que ahora (propuesta + Sí/No).",
        ].join("\n"),
        { voice: false }
      );
    } catch (error) {
      console.error("/trad:", error);
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.command("dub", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const arg = (ctx.message.text || "")
      .replace(/^\/dub(@\w+)?\s*/i, "")
      .trim();
    const url = extractFirstUrl(arg) || extractUrlFromMessage(ctx);
    try {
      if (url) {
        if (await maybeAskPublishDest(ctx, url, [], "dub")) return;
        await processDubVideoUrl(ctx, url);
        return;
      }
      const session = getSession(ctx.chat.id);
      session.pendingSocialVideo = { step: "await_url", kind: "dub" };
      await reply(
        ctx,
        [
          "🎧 /dub — doblaje ElevenLabs (clonación de voz + traducción).",
          "",
          "Envía el enlace del video (YouTube, Instagram, Facebook, Dailymotion o X).",
          "Siempre dobla a español (es). Requiere ELEVENLABS_API_KEY.",
          "Luego: titular Sí/No → R2 → webhook.",
        ].join("\n"),
        { voice: false }
      );
    } catch (error) {
      console.error("/dub:", error);
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.command("ndigital", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const arg = (ctx.message.text || "")
      .replace(/^\/ndigital(@\w+)?\s*/i, "")
      .trim();
    const url = extractFirstUrl(arg) || extractUrlFromMessage(ctx);
    try {
      if (url) {
        await processNdigitalVideoUrl(ctx, url);
        return;
      }
      const session = getSession(ctx.chat.id);
      session.pendingSocialVideo = { step: "await_url", kind: "ndigital" };
      await reply(
        ctx,
        [
          "📺 /ndigital — limpia reels N Digital",
          "",
          "Envía el enlace del reel (Instagram, YouTube, etc.).",
          `Recorte: ${config.ndigital.cropTop}px arriba · ${config.ndigital.cropBottom}px abajo · −${config.ndigital.trimEndSec}s al final.`,
          "Te mando el preview antes de publicar.",
        ].join("\n"),
        { voice: false }
      );
    } catch (error) {
      console.error("/ndigital:", error);
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.command(["local", "clip"], async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    if (session.pendingLocalJob) {
      await discardLocalJob(session.pendingLocalJob);
      session.pendingLocalJob = null;
    }
    session.pendingSocialVideo = { kind: "local", step: "await_file" };
    await reply(
      ctx,
      [
        "📁 /local — video del equipo",
        "",
        "Envía el video como archivo o como video de Telegram (máx. ~18 MB).",
        "Lo transcribo; si no está en español, lo paso a español.",
        "Luego: logo arriba + titular rojo abajo + caption.",
        "También saco un frame → noticia WordPress + gráfico a redes.",
        "",
        "Formatos: MP4, MOV, MKV, WEBM (máx. ~18 MB). O /cancelar.",
      ].join("\n"),
      { voice: false }
    );
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

  bot.command(["feeds", "feed"], async (ctx) => {
    await reply(ctx, formatGraphicsFeedHelp(), { voice: false });
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

  bot.command("reporte", async (ctx) => {
    await handleReporteCommand(ctx);
  });

  bot.command("busca", async (ctx) => {
    const headline = ctx.message.text.replace(/^\/busca(@\w+)?\s*/i, "").trim();
    await handleBuscaCommand(ctx, headline);
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
    await askPublishDest(ctx, { resume: "auto" });
  });

  bot.command("echo", async (ctx) => {
    getSession(ctx.chat.id).mode = "echo";
    await ctx.reply("Modo ECO — solo devuelvo el texto que envías.");
  });

  bot.command("post", async (ctx) => {
    await askPublishDest(ctx, { resume: "auto" });
  });

  bot.command("copiar", async (ctx) => {
    getSession(ctx.chat.id).mode = "copiar";
    await reply(ctx, "Modo COPIAR activado.");
  });

  bot.command("escribir", async (ctx) => {
    const text = ctx.message.text.replace(/^\/escribir\s*/i, "").trim();
    await askPublishDest(ctx, {
      resume: "escribir",
      text: text ? `/escribir ${text}` : "/escribir",
    });
  });

  bot.command("periodista", async (ctx) => {
    try {
      await askPublishDest(ctx, {
        resume: "periodista",
        text: ctx.message.text || "/periodista",
      });
    } catch (error) {
      console.error("periodista dest:", error);
      await ctx.reply(`❌ Error: ${error.message}`, { voice: false });
    }
  });

  bot.command("wp", async (ctx) => {
    try {
      await askPublishDest(ctx, {
        resume: "wp",
        text: ctx.message.text || "/wp",
      });
    } catch (error) {
      console.error("wp dest:", error);
      await ctx.reply(`❌ Error: ${error.message}`, { voice: false });
    }
  });

  bot.command("cancelar", async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (session.pendingTradText) {
      session.pendingTradText = null;
      session.pendingSocialVideo = null;
      await reply(ctx, "/trad texto cancelado.", { voice: false });
      return;
    }
    if (session.pendingTradJob) {
      await discardTradJob(session.pendingTradJob);
      session.pendingTradJob = null;
      session.pendingSocialVideo = null;
      await reply(ctx, "Preparación /trad cancelada.", { voice: false });
      return;
    }
    if (session.pendingDubJob) {
      await discardDubJob(session.pendingDubJob);
      session.pendingDubJob = null;
      session.pendingSocialVideo = null;
      await reply(ctx, "Preparación /dub cancelada.", { voice: false });
      return;
    }
    if (session.pendingNdigitalJob) {
      await discardNdigitalJob(session.pendingNdigitalJob);
      session.pendingNdigitalJob = null;
      session.pendingSocialVideo = null;
      await reply(ctx, "Recorte /ndigital cancelado.", { voice: false });
      return;
    }
    if (session.pendingLocalJob) {
      await discardLocalJob(session.pendingLocalJob);
      session.pendingLocalJob = null;
      session.pendingSocialVideo = null;
      await reply(ctx, "Preparación /local cancelada.", { voice: false });
      return;
    }
    if (session.pendingSocialVideo) {
      session.pendingSocialVideo = null;
      await reply(ctx, "Envío de /video, /trad, /dub, /ndigital o /local cancelado.", { voice: false });
      return;
    }
    if (session.pendingDestChoice) {
      const wasEncuesta =
        session.pendingDestChoice.resume === "encuesta_manual";
      session.pendingDestChoice = null;
      session.publishDest = "fvdigital";
      if (wasEncuesta) cancelEncuestaFlow(session);
      await reply(ctx, "Destino cancelado.", { voice: false });
      return;
    }
    if (isEncuestaFlowActive(session)) {
      cancelEncuestaFlow(session);
      await reply(ctx, encuestaCancelText(), { voice: false });
      return;
    }
    if (session.pendingLinkChoice) {
      session.pendingLinkChoice = null;
      await reply(ctx, "Enlace cancelado.", { voice: false });
      return;
    }
    if (session.hyperFlow) {
      cancelHyperFlow(session);
      await reply(ctx, "Modo HyperFrames cancelado.", { voice: false });
      return;
    }
    if (isTermometroActive(session)) {
      cancelTermometroFlow(session);
      await reply(ctx, termometroCancelText(), { voice: false });
      return;
    }
    if (isPicFlowActive(session)) {
      cancelPicFlow(session);
      await reply(ctx, picCancelText(), { voice: false });
      return;
    }
    if (!session.writeFlow) {
      await reply(ctx, "No hay redacción, enlace, /video, /trad, /dub, /ndigital ni modo /hyper en curso.", {
        voice: false,
      });
      return;
    }
    const wasWp =
      session.writeFlow.source === "wp" || session.writeFlow.source === "periodista";
    cancelWriteFlow(session);
    await reply(
      ctx,
      wasWp ? "Artículo cancelado." : "Redacción cancelada.",
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
    await askPublishDest(ctx, { resume: "noticia" });
  });

  bot.command("nota", async (ctx) => {
    const hint = ctx.message.text.replace(/^\/nota(?:@\w+)?\s*/i, "").trim();
    await askPublishDest(ctx, { resume: "nota", text: hint });
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

  bot.command("foto", async (ctx) => {
    const session = getSession(ctx.chat.id);
    session.termometroFlow = emptyTermometroFlow();
    const initial = ctx.message.text.replace(/^\/foto\s*/i, "").trim();
    if (initial) {
      const handled = handleTermometroText(session, initial);
      await reply(ctx, handled.reply, { voice: false });
      return;
    }
    await reply(ctx, termometroIntroText(), { voice: false });
  });

  bot.command("pic", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const arg = ctx.message.text.replace(/^\/pic\s*/i, "").trim();

    // Reenvía el último /pic guardado (mismo flujo de gráficos → redes)
    if (/^(last|último|ultimo|enviar|reenviar)$/i.test(arg)) {
      const saved = loadLastPic();
      if (!saved) {
        await reply(
          ctx,
          "No hay un /pic guardado. Genera la vista previa con /pic primero.",
          { voice: false }
        );
        return;
      }
      try {
        await publishPicToSocial(ctx, saved);
      } catch (error) {
        console.error("/pic last:", error);
        await ctx.reply(`❌ /pic last: ${error.message}`);
      }
      return;
    }

    session.picFlow = emptyPicFlow();
    if (arg) session.picFlow.headline = arg;
    await reply(ctx, picIntroText(Boolean(arg)), { voice: false });
  });

  bot.command("encuesta", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    if (session.picFlow) cancelPicFlow(session);
    if (session.termometroFlow) cancelTermometroFlow(session);
    session.encuestaFlow = emptyEncuestaFlow();
    const arg = ctx.message.text.replace(/^\/encuesta(?:@\w+)?\s*/i, "").trim();
    if (arg.length >= 5) {
      await reply(
        ctx,
        "Pregunta guardada. Ahora envía la foto de la encuesta.",
        { voice: false }
      );
      session.encuestaFlow.question = normalizeEncuestaQuestion(arg);
      session.encuestaFlow.step = "awaiting_photo";
      return;
    }
    await reply(ctx, encuestaIntroText(), { voice: false });
  });

  bot.command("encuestadoble", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    if (session.picFlow) cancelPicFlow(session);
    if (session.termometroFlow) cancelTermometroFlow(session);
    session.encuestaFlow = emptyEncuestaDobleFlow();
    const arg = ctx.message.text
      .replace(/^\/encuestadoble(?:@\w+)?\s*/i, "")
      .trim();
    const n = parseEncuestaPhotoCount(arg);
    if ([2, 3, 4].includes(n)) {
      session.encuestaFlow.photoCount = n;
      session.encuestaFlow.photos = [];
      session.encuestaFlow.step = "awaiting_photos";
      await reply(
        ctx,
        `Encuesta de ${n} fotos.\n${encuestaAskNextPhotoText(session.encuestaFlow)}`,
        { voice: false }
      );
      return;
    }
    await reply(ctx, encuestaDobleIntroText(), { voice: false });
  });

  bot.command("encuestas", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    await askPublishDest(ctx, { resume: "encuestas" });
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

  bot.on("video", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    if (isEchoMode(session)) {
      await ctx.reply("video");
      return;
    }
    if (session.pendingSocialVideo?.kind !== "local" || session.pendingSocialVideo?.step !== "await_file") {
      return;
    }
    const vid = ctx.message.video;
    if (!vid?.file_id) {
      await ctx.reply("No pude leer ese video.");
      return;
    }
    try {
      if (vid.file_size && vid.file_size > 18 * 1024 * 1024) {
        await ctx.reply("El video es muy pesado (máx. ~18 MB por límite de Telegram).");
        return;
      }
      await reply(ctx, "⬇️ Descargando video…", { voice: false });
      const { buffer, ext } = await downloadTelegramFile(ctx, vid.file_id);
      await processLocalVideoUpload(ctx, buffer, `video.${ext || "mp4"}`);
    } catch (error) {
      console.error("video/local:", error);
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.on("document", async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    if (isEchoMode(session)) {
      await ctx.reply(ctx.message.document?.file_name || "documento");
      return;
    }

    const doc = ctx.message.document;
    if (!doc?.file_id) {
      await ctx.reply("No pude leer ese archivo.");
      return;
    }

    const mime = String(doc.mime_type || "").toLowerCase();
    const name = doc.file_name || "documento";
    const caption = ctx.message.caption || session.buffer.text || "";

    const awaitingLocal =
      session.pendingSocialVideo?.kind === "local" &&
      session.pendingSocialVideo?.step === "await_file";
    const isVideoFile =
      mime.startsWith("video/") ||
      /\.(mp4|mov|mkv|webm|m4v)$/i.test(name);

    if (awaitingLocal) {
      if (!isVideoFile) {
        await ctx.reply(
          "Para /local necesito un video (MP4/MOV/MKV/WEBM). O /cancelar."
        );
        return;
      }
      try {
        if (doc.file_size && doc.file_size > 18 * 1024 * 1024) {
          await ctx.reply("El archivo es muy pesado (máx. ~18 MB).");
          return;
        }
        await reply(ctx, "⬇️ Descargando archivo…", { voice: false });
        const { buffer, ext } = await downloadTelegramFile(ctx, doc.file_id);
        const fileName = name || `video.${ext || "mp4"}`;
        await processLocalVideoUpload(ctx, buffer, fileName);
      } catch (error) {
        console.error("document/local:", error);
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    const waitingNota =
      session.photoIntent === "nota" ||
      session.writeFlow?.source === "nota" ||
      /\bnota\b/i.test(caption);

    const isPdf = mime.includes("pdf") || /\.pdf$/i.test(name);
    const isImage =
      mime.startsWith("image/") ||
      /\.(jpe?g|png|webp|gif)$/i.test(name);

    if (!waitingNota && !isPdf) {
      await ctx.reply(
        "Si quieres convertir un documento en nota, usa /nota y luego envía el PDF o la foto.\nPara un video del PC: /local"
      );
      return;
    }

    if (!isPdf && !isImage) {
      await ctx.reply(
        "Formato no soportado. Envía un PDF o una imagen del documento (JPG/PNG)."
      );
      return;
    }

    try {
      if (doc.file_size && doc.file_size > 18 * 1024 * 1024) {
        await ctx.reply("El archivo es muy pesado (máx. ~18 MB).");
        return;
      }
      const { buffer, ext } = await downloadTelegramFile(ctx, doc.file_id);
      const mimeType =
        mime ||
        (isPdf ? "application/pdf" : mimeFromBuffer(buffer) || `image/${ext || "jpeg"}`);
      const extra = [
        ...session.buffer.extraCategories,
        ...parseExtraCategories(caption),
      ];
      session.buffer.text = "";
      await handleNoteFromDocument(ctx, buffer, mimeType, name, caption, extra);
      session.photoIntent = null;
    } catch (error) {
      console.error("document/nota:", error);
      await ctx.reply(`❌ ${error.message}`);
    }
  });

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

  bot.action(/^trad:source:(audio|caption|text|cancel)$/, async (ctx) => {
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

      const pending = session.pendingTradJob;
      if (
        !pending ||
        (pending.step !== "await_source_mode" &&
          pending.step !== "await_custom_text")
      ) {
        await ctx.answerCbQuery("No hay /trad pendiente");
        await ctx.reply("No hay video pendiente. Usa /trad con una URL.");
        return;
      }

      if (choice === "text") {
        session.pendingTradJob = {
          ...pending,
          step: "await_custom_text",
        };
        session.pendingSocialVideo = {
          kind: "trad",
          step: "await_custom_text",
          sourceUrl: pending.sourceUrl,
        };
        await ctx.answerCbQuery("Pega el texto");
        await ctx.reply(
          [
            "📋 Pega aquí el texto que quieres narrar.",
            "Lo traduzco al español, genero el audio y el caption a partir de ese texto.",
            "",
            "Mín. 8 caracteres. O /cancelar.",
          ].join("\n")
        );
        return;
      }

      if (pending.step !== "await_source_mode") {
        await ctx.answerCbQuery("Elige otra opción o cancela");
        await ctx.reply(
          "Estoy esperando el texto pegado. Envía el guion o /cancelar."
        );
        return;
      }

      const mode =
        choice === "caption" ? "from_caption" : "translate_audio";
      await ctx.answerCbQuery(
        choice === "caption" ? "Desde caption" : "Traducir audio"
      );
      await reply(
        ctx,
        choice === "caption"
          ? "📝 Traduciendo caption a español y creando audio…"
          : "🌐 Traduciendo el audio…",
        { voice: false }
      );

      const job = await continueTradJob(pending, {
        mode,
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
    } catch (error) {
      console.error("trad:source:", error);
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

  bot.action(/^dub:headline:(yes|no|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const choice = ctx.match[1];

    try {
      if (choice === "cancel") {
        if (session.pendingDubJob) {
          await discardDubJob(session.pendingDubJob);
          session.pendingDubJob = null;
        }
        session.pendingSocialVideo = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("/dub cancelado.");
        return;
      }

      if (!session.pendingDubJob) {
        await ctx.answerCbQuery("No hay /dub pendiente");
        await ctx.reply("No hay preparación pendiente. Usa /dub con una URL.");
        return;
      }

      await ctx.answerCbQuery(choice === "yes" ? "Con titular" : "Sin titular");
      await finishDubAfterHeadlineChoice(ctx, choice === "yes");
    } catch (error) {
      console.error("dub:headline:", error);
      if (session.pendingDubJob) {
        await discardDubJob(session.pendingDubJob);
        session.pendingDubJob = null;
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

  bot.action(
    /^trad:text:(correct|translate|search|audio|audio_yes|audio_edit|audio_back|cancel)$/,
    async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const action = ctx.match[1];
    try {
      const labels = {
        correct: "Corregir",
        translate: "Traducir",
        search: "Buscar",
        audio: "Audio",
        audio_yes: "Generar",
        audio_edit: "Editar",
        audio_back: "Volver",
        cancel: "Cancelar",
      };
      await ctx.answerCbQuery(labels[action] || "OK");
      await applyTradTextAction(ctx, action);
    } catch (error) {
      console.error("trad:text:", error);
      try {
        await ctx.answerCbQuery("Error");
      } catch {
        // ignore
      }
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.action(/^write:(continue|rewrite|opinion|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) return;
    rememberChat(ctx);
    const action = ctx.match[1];
    const session = getSession(ctx.chat.id);
    const wf = session.writeFlow;
    if (!wf || (wf.step !== "preview" && wf.step !== "preview_feedback")) {
      await ctx.answerCbQuery("No hay borrador pendiente");
      return;
    }
    try {
      if (action === "cancel") {
        const wasArticle = wf.source === "wp" || wf.source === "periodista";
        cancelWriteFlow(session);
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply(wasArticle ? "Artículo cancelado." : "Redacción cancelada.", {
          voice: false,
        });
        return;
      }
      if (action === "continue") {
        await ctx.answerCbQuery("Continuar");
        await askFeaturedImage(ctx, session);
        return;
      }
      if (action === "rewrite") {
        await ctx.answerCbQuery("Reescribir");
        await rewriteArticleFromPreview(ctx, session, "");
        return;
      }
      if (action === "opinion") {
        await ctx.answerCbQuery("Opinión");
        await askArticleOpinion(ctx, session);
      }
    } catch (error) {
      console.error("write action:", error);
      await ctx.answerCbQuery("Error");
      await ctx.reply(`❌ ${error.message}`, { voice: false });
    }
  });

  bot.action(/^pic:(fvdigital|f1rd|done|change|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const action = ctx.match[1];
    try {
      if (action === "cancel") {
        cancelPicFlow(session);
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Modo /pic cancelado.");
        return;
      }
      if (action === "done") {
        const flow = session.picFlow;
        if (!flow?.previewCard && !flow?.photoBuffer) {
          const saved = loadLastPic();
          if (!saved) {
            await ctx.answerCbQuery("No hay vista previa");
            await ctx.reply("No hay vista previa activa. Usa /pic de nuevo.");
            return;
          }
          await ctx.answerCbQuery("Enviando último…");
          cancelPicFlow(session);
          await publishPicToSocial(ctx, saved);
          return;
        }
        if (!flow?.photoBuffer || !flow?.headline) {
          await ctx.answerCbQuery("No hay vista previa");
          await ctx.reply("No hay vista previa activa. Usa /pic de nuevo.");
          return;
        }
        const dest = flow.dest || "fvdigital";
        const title = flow.headline || "Gráfico";
        const photoBuffer = flow.photoBuffer;
        await ctx.answerCbQuery("Enviando…");
        cancelPicFlow(session);
        // Mismo flujo que el resto de gráficos (sendSocialCard → webhook)
        await publishPicToSocial(ctx, { title, photoBuffer, dest });
        return;
      }
      if (action === "change") {
        if (!session.picFlow) {
          await ctx.answerCbQuery("No hay /pic activo");
          return;
        }
        session.picFlow.step = "awaiting_dest";
        session.picFlow.dest = null;
        session.picFlow.previewCard = null;
        await ctx.answerCbQuery("Otra marca");
        await ctx.reply(picAskDestText(session.picFlow.headline), picDestKeyboard());
        return;
      }
      if (!session.picFlow?.photoBuffer || session.picFlow?.step !== "awaiting_dest") {
        await ctx.answerCbQuery("No hay foto pendiente");
        await ctx.reply("No hay foto pendiente. Usa /pic y envía una imagen.");
        return;
      }
      await ctx.answerCbQuery(destLabel(action));
      await showPicPreview(ctx, action);
    } catch (error) {
      console.error("pic choice:", error);
      try {
        await ctx.answerCbQuery("Error");
      } catch {
        // ignore
      }
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.action(/^dest:(fvdigital|f1rd|both|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const pending = session.pendingDestChoice;
    const action = ctx.match[1];
    try {
      if (action === "cancel") {
        session.pendingDestChoice = null;
        session.publishDest = "fvdigital";
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Destino cancelado.");
        return;
      }
      if (!pending?.resume) {
        await ctx.answerCbQuery("Nada pendiente");
        await ctx.reply("No hay publicación pendiente. Vuelve a lanzar el comando.");
        return;
      }
      const needsUrl = ["video", "trad", "dub", "link"].includes(pending.resume);
      if (needsUrl && !pending.url) {
        await ctx.answerCbQuery("No hay enlace");
        await ctx.reply("No hay enlace pendiente. Pega de nuevo la URL.");
        return;
      }
      await ctx.answerCbQuery(destLabel(action));
      await resumeAfterPublishDest(ctx, action, pending);
    } catch (error) {
      console.error("dest choice:", error);
      try {
        await ctx.answerCbQuery("Error");
      } catch {
        // ignore
      }
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.action(/^link:(video|news|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);

    const session = getSession(ctx.chat.id);
    const pending = session.pendingLinkChoice;
    const action = ctx.match[1];

    try {
      if (action === "cancel") {
        session.pendingLinkChoice = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Enlace cancelado.");
        return;
      }
      if (!pending?.url) {
        await ctx.answerCbQuery("No hay enlace pendiente");
        await ctx.reply(
          "No hay enlace pendiente. Pega un URL de YouTube, Instagram, Facebook o X."
        );
        return;
      }

      session.pendingLinkChoice = null;
      if (action === "video") {
        await ctx.answerCbQuery("Video");
        await processSocialVideoUrl(ctx, pending.url);
        return;
      }

      await ctx.answerCbQuery("Noticia");
      await handleNewsFromUrl(ctx, pending.url, pending.extraCategories || []);
    } catch (error) {
      console.error("link choice:", error);
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
        if (session.pendingNdigitalJob) {
          await discardNdigitalJob(session.pendingNdigitalJob);
          session.pendingNdigitalJob = null;
        }
        if (session.pendingLocalJob) {
          await discardLocalJob(session.pendingLocalJob);
          session.pendingLocalJob = null;
        }
        session.pendingSocialVideo = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Envío de /video, /trad, /dub, /ndigital o /local cancelado.");
        return;
      }

      if (!pending?.videoUrl) {
        await ctx.answerCbQuery("No hay video pendiente");
        await ctx.reply("No hay video pendiente. Usa /video, /trad, /dub, /ndigital o /local.");
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
        await ctx.answerCbQuery("Siguiente…");
        await maybeAskSieThenSend(ctx);
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

  bot.action(/^sie:(yes|no|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const action = ctx.match[1];
    const pending = session.pendingSocialVideo;

    try {
      if (action === "cancel") {
        session.pendingSocialVideo = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Envío cancelado.");
        return;
      }
      if (!pending?.videoUrl) {
        await ctx.answerCbQuery("Sin video");
        await ctx.reply("No hay video pendiente. Usa /video, /trad, /dub, /ndigital o /local.");
        return;
      }
      if (action === "no") {
        pending.siePick = null;
        pending.step = "confirm";
        session.pendingSocialVideo = pending;
        await ctx.answerCbQuery("Sin SIE");
        await sendPendingSocialVideoToWebhook(ctx);
        return;
      }
      await ctx.answerCbQuery("Concatenando…");
      await applySieConcatAndSend(ctx);
    } catch (error) {
      console.error("sie callback:", error);
      try {
        await ctx.answerCbQuery("Error");
      } catch {
        // ignore
      }
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.action(/^ndigital:(publish|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const action = ctx.match[1];

    try {
      if (action === "cancel") {
        if (session.pendingNdigitalJob) {
          await discardNdigitalJob(session.pendingNdigitalJob);
          session.pendingNdigitalJob = null;
        }
        session.pendingSocialVideo = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Recorte /ndigital cancelado.");
        return;
      }

      const job = session.pendingNdigitalJob;
      if (!job?.localPath) {
        await ctx.answerCbQuery("Sin recorte");
        await ctx.reply("No hay recorte pendiente. Usa /ndigital con una URL.");
        return;
      }

      await ctx.answerCbQuery("Publicando…");
      await publishNdigitalAfterDest(ctx);
    } catch (error) {
      console.error("ndigital callback:", error);
      try {
        await ctx.answerCbQuery("Error");
      } catch {
        // ignore
      }
      await ctx.reply(`❌ ${error.message}`);
    }
  });

  bot.action(/^local:(publish|cancel)$/, async (ctx) => {
    if (unauthorized(ctx)) {
      await ctx.answerCbQuery("No autorizado");
      return;
    }
    rememberChat(ctx);
    const session = getSession(ctx.chat.id);
    const action = ctx.match[1];

    try {
      if (action === "cancel") {
        if (session.pendingLocalJob) {
          await discardLocalJob(session.pendingLocalJob);
          session.pendingLocalJob = null;
        }
        session.pendingSocialVideo = null;
        await ctx.answerCbQuery("Cancelado");
        await ctx.reply("Preparación /local cancelada.");
        return;
      }

      const job = session.pendingLocalJob;
      if (!job?.localPath) {
        await ctx.answerCbQuery("Sin video");
        await ctx.reply("No hay video pendiente. Usa /local y envía el archivo.");
        return;
      }

      await ctx.answerCbQuery("Publicando…");
      await publishLocalAfterDest(ctx);
    } catch (error) {
      console.error("local callback:", error);
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

    // /video, /trad, /dub o /ndigital: esperando URL (o texto si es /trad)
    if (session.pendingSocialVideo?.step === "await_url") {
      const videoUrl = url || extractFirstUrl(trimmed);
      const pendingKind = session.pendingSocialVideo.kind || "video";
      const kind =
        pendingKind === "trad"
          ? "trad"
          : pendingKind === "dub"
            ? "dub"
            : pendingKind === "ndigital"
              ? "ndigital"
              : "video";
      if (!videoUrl) {
        if (kind === "trad" && trimmed.length >= 8) {
          try {
            session.pendingSocialVideo = null;
            const draft = startTradTextFlow(ctx, trimmed);
            await askTradTextChoice(ctx, draft);
          } catch (error) {
            console.error("pendingTradText:", error);
            await ctx.reply(`❌ ${error.message}`);
          }
          return;
        }
        await ctx.reply(
          kind === "trad"
            ? "Envía un enlace de video o pega un texto (mín. 8 caracteres). O /cancelar."
            : kind === "dub"
              ? "Necesito un enlace válido para /dub (YouTube, Instagram, Facebook, Dailymotion o X). O /cancelar."
              : kind === "ndigital"
                ? "Necesito un enlace válido para /ndigital. O /cancelar."
                : "Necesito un enlace válido (YouTube, Instagram, Facebook, Dailymotion o X). O /cancelar."
        );
        return;
      }
      try {
        session.pendingSocialVideo = null;
        if (kind === "ndigital") {
          await processNdigitalVideoUrl(ctx, videoUrl);
          return;
        }
        if (await maybeAskPublishDest(ctx, videoUrl, [], kind)) return;
        if (kind === "trad") {
          await processTradVideoUrl(ctx, videoUrl);
        } else if (kind === "dub") {
          await processDubVideoUrl(ctx, videoUrl);
        } else {
          await processSocialVideoUrl(ctx, videoUrl);
        }
      } catch (error) {
        console.error("pendingSocialVideo URL:", error);
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    // /trad video: esperando texto pegado para audio + caption
    if (
      (session.pendingTradJob?.step === "await_custom_text" ||
        session.pendingSocialVideo?.step === "await_custom_text") &&
      !url
    ) {
      const pending = session.pendingTradJob;
      if (!pending || pending.step !== "await_custom_text") {
        await ctx.reply("No hay /trad esperando texto. Usa /trad con una URL.");
        return;
      }
      if (trimmed.length < 8) {
        await ctx.reply(
          "El texto es muy corto (mín. 8 caracteres). Pega el guion completo o /cancelar."
        );
        return;
      }
      try {
        await reply(
          ctx,
          "📋 Texto recibido. Traduzco, genero audio y preparo caption…",
          { voice: false }
        );
        const job = await continueTradJob(pending, {
          mode: "from_text",
          customText: trimmed,
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
      } catch (error) {
        console.error("trad custom text:", error);
        if (session.pendingTradJob) {
          await discardTradJob(session.pendingTradJob);
          session.pendingTradJob = null;
        }
        session.pendingSocialVideo = null;
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    // /trad texto: esperando el guion exacto del audio
    if (session.pendingTradText?.step === "await_audio_text" && !url) {
      const next = trimmed;
      if (next.length < 3) {
        await ctx.reply("El texto del audio es muy corto. Envía el texto completo o /cancelar.");
        return;
      }
      try {
        session.pendingTradText = {
          ...session.pendingTradText,
          step: "confirm_audio",
          draft: next,
        };
        await askTradTextAudioConfirm(ctx, next);
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    // /trad texto: nuevo borrador pegado mientras hay menú activo
    if (session.pendingTradText?.step === "choose" && !url && trimmed.length >= 8) {
      try {
        const draft = startTradTextFlow(ctx, trimmed);
        await askTradTextChoice(ctx, draft);
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    // /video: editando caption
    if (session.pendingSocialVideo?.step === "edit_caption") {
      const pending = session.pendingSocialVideo;
      let pasted = trimmed;
      try {
        pasted = await ensureSpanishCaption(trimmed);
        if (pasted !== trimmed) await ctx.reply("🌐 Caption traducido al español.");
      } catch (error) {
        console.warn("ensureSpanishCaption:", error.message);
      }
      pending.caption = ensureCaptionHashtag(pasted, session.publishDest || "fvdigital");
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
      try {
        if (await maybeAskPublishDest(ctx, url, parseExtraCategories(trimmed), "link")) {
          return;
        }
        if (await maybeAskSocialLinkChoice(ctx, url, parseExtraCategories(trimmed))) {
          return;
        }
        if (session.writeFlow) cancelWriteFlow(session);
        await handleNewsFromUrl(ctx, url, parseExtraCategories(trimmed));
      } catch (error) {
        console.error("text handler URL:", error);
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
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    if (isTermometroActive(session)) {
      try {
        const handled = handleTermometroText(session, trimmed);
        if (handled) {
          await reply(ctx, handled.reply, { voice: false });
          return;
        }
      } catch (error) {
        console.error("termometroFlow text:", error);
        await ctx.reply(`❌ ${error.message}`);
      }
      return;
    }

    if (isEncuestaFlowActive(session)) {
      try {
        if (await handleEncuestaFlowText(ctx, trimmed)) return;
      } catch (error) {
        console.error("encuestaFlow text:", error);
        await ctx.reply(`❌ ${error.message}`);
        return;
      }
    }

    if (isPicFlowActive(session)) {
      try {
        if (await handlePicFlowText(ctx, trimmed)) return;
      } catch (error) {
        console.error("picFlow text:", error);
        await ctx.reply(`❌ ${error.message}`);
        return;
      }
    }

    try {
      if (await tryNaturalCommand(ctx, trimmed)) return;
    } catch (error) {
      console.error("tryNaturalCommand:", error);
      await ctx.reply(`❌ Error: ${error.message}`);
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

  /** Heartbeat Telegram: si getMe falla repetido, el proceso sale y keepalive lo levanta. */
  let lastTelegramOkAt = Date.now();
  let telegramFailStreak = 0;
  const TELEGRAM_FAIL_LIMIT = 3;

  async function pingTelegramApi() {
    try {
      await bot.telegram.getMe();
      lastTelegramOkAt = Date.now();
      telegramFailStreak = 0;
      return true;
    } catch (error) {
      telegramFailStreak += 1;
      console.warn(
        `telegram getMe falló (${telegramFailStreak}/${TELEGRAM_FAIL_LIMIT}):`,
        error.message || error
      );
      return false;
    }
  }

  const httpServer = await startHttpServer({
    port: config.server.port,
    getStatus: () => {
      const ageSec = Math.floor((Date.now() - lastTelegramOkAt) / 1000);
      const telegramOk = ageSec < 180 && telegramFailStreak < TELEGRAM_FAIL_LIMIT;
      return {
        ok: telegramOk,
        telegram: telegramOk ? "online" : "degraded",
        telegramOk,
        lastTelegramOkAgeSec: ageSec,
        telegramFailStreak,
        activeSessions: sessions.size,
        lastPicPending: Boolean(loadLastPic()?.pending),
        video: {
          hyperframes: config.video.hyperframes.enabled,
          remotion: config.video.remotion.enabled,
          heygen: config.video.heygen.enabled && Boolean(config.video.heygen.apiKey),
        },
      };
    },
    onRequest: async (req, res, path) => {
      const feedBrand = graphicsFeedBrandFromPath(path);
      if (feedBrand && (req.method === "GET" || req.method === "HEAD")) {
        const xml = renderGraphicsFeedXml(feedBrand);
        res.writeHead(200, {
          "Content-Type": "application/rss+xml; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        });
        if (req.method !== "HEAD") res.end(xml);
        else res.end();
        return true;
      }
      if ((path === "/feed" || path === "/feeds") && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify(
            {
              ok: true,
              fvdigital: "/feed/fvdigital.xml",
              f1rd: "/feed/f1rd.xml",
            },
            null,
            2
          )
        );
        return true;
      }
      if (path !== "/pic/publish-last" || req.method !== "POST") return false;
      const saved = loadLastPic();
      if (!saved) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "no hay /pic guardado" }));
        return true;
      }
      let chatId = null;
      try {
        chatId = JSON.parse(readFileSync(LAST_CHAT_FILE, "utf8")).chatId;
      } catch {
        // ignore
      }
      if (!chatId) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "falta .last-chat.json" }));
        return true;
      }
      const ctx = {
        chat: { id: chatId },
        telegram: bot.telegram,
        reply: (text, extra) => bot.telegram.sendMessage(chatId, text, extra),
        replyWithPhoto: (photo, extra) => bot.telegram.sendPhoto(chatId, photo, extra),
        sendChatAction: (action) => bot.telegram.sendChatAction(chatId, action),
      };
      await publishPicToSocial(ctx, saved);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, title: saved.title, dest: saved.dest }));
      return true;
    },
  });

  try {
    await bot.telegram.setMyCommands([
      { command: "ayuda", description: "Lista de comandos" },
      { command: "escribir", description: "Redactar noticia" },
      { command: "periodista", description: "Noticia con tu titular" },
      { command: "wp", description: "Artículo guiado a WP" },
      { command: "noticia", description: "OCR captura → WP" },
      { command: "alertas", description: "Sync Google Alerts Intrant" },
      { command: "reporte", description: "REPORTE Intrant Word + correo" },
      { command: "busca", description: "Localizar titular + borrador correo" },
      { command: "encuestas", description: "1 encuesta pendiente FV" },
      { command: "video", description: "Video redes → webhook" },
      { command: "trad", description: "Video doblaje/overlay o texto IA" },
      { command: "dub", description: "Doblaje ElevenLabs a español" },
      { command: "ndigital", description: "Reel N Digital → crop + preview" },
      { command: "local", description: "Video PC → STT + WP + redes + webhook" },
      { command: "foto", description: "Video Termómetro" },
      { command: "pic", description: "Foto + texto → tarjeta redes" },
      { command: "feeds", description: "RSS gráficos FV y F1RD" },
      { command: "publicar", description: "Publicar borrador" },
      { command: "estado", description: "Estado del bot" },
      { command: "cancelar", description: "Cancelar flujo" },
    ]);
  } catch (e) {
    console.warn("setMyCommands:", e.message);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Reintenta polling si DNS/red cae (ENOTFOUND, ETIMEDOUT, etc.). */
  async function launchWithRetry() {
    let delayMs = 3000;
    for (let attempt = 1; ; attempt++) {
      try {
        await bot.launch({ dropPendingUpdates: attempt === 1 });
        return;
      } catch (error) {
        const code = error.response?.error_code;
        const msg = error.message || String(error);
        if (code === 409) {
          console.error(
            "409 Conflict: hay otra instancia del bot. Ejecuta: npm run bot:stop"
          );
          cleanupPidFile();
          httpServer.close();
          process.exit(1);
        }
        console.error(
          `bot.launch intento ${attempt} falló: ${msg} — reintento en ${Math.round(delayMs / 1000)}s`
        );
        await sleep(delayMs);
        delayMs = Math.min(delayMs * 1.6, 60000);
      }
    }
  }

  // En Telegraf 4, launch() no resuelve mientras el bot está vivo — no hacer await.
  launchWithRetry().catch((error) => {
    console.error("bot.launch fatal:", error.message);
    cleanupPidFile();
    httpServer.close();
    process.exit(1);
  });

  // Ping API cada 45s; 3 fallos → salir para que keepalive reinicie
  setInterval(async () => {
    const ok = await pingTelegramApi();
    if (!ok && telegramFailStreak >= TELEGRAM_FAIL_LIMIT) {
      console.error("Telegram API caída — reinicio del proceso (keepalive lo levantará)");
      cleanupPidFile();
      try {
        httpServer.close();
      } catch {
        // ignore
      }
      try {
        bot.stop("telegram-degraded");
      } catch {
        // ignore
      }
      process.exit(1);
    }
  }, 45_000);

  // Primera comprobación al arrancar
  pingTelegramApi().catch(() => {});

  console.log(
    `JARVIS online — FV Digital (Telegram + DeepSeek + Mistral) — http://127.0.0.1:${config.server.port}`
  );

  const shutdown = async (signal) => {
    console.log(`Deteniendo (${signal})...`);
    httpServer.close();
    await bot.stop(signal).catch(() => {});
    cleanupPidFile();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    console.error("uncaughtException (bot sigue):", error?.message || error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(
      "unhandledRejection (bot sigue):",
      reason?.message || reason
    );
  });
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
