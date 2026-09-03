/**
 * Publica encuestas desde carpeta encuestas/ (TXT + fotos) a WordPress FV + redes FV Digital.
 * Cron: check 09:00 (foto) → publicar 10:00 (1 pendiente, nunca repetir).
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { Input, Telegraf } from "telegraf";
import { config } from "./config.mjs";
import { publishToWebhook } from "./publish-webhook.mjs";
import { isPublicR2Url, uploadToR2 } from "./r2.mjs";
import { generateNewsCard } from "./social-card.mjs";
import { createPost, uploadImageFromBuffer } from "./wordpress.mjs";

const STATE_FILE = join(config.root, ".encuestas-sent.json");
const LAST_CHAT_FILE = join(config.root, ".last-chat.json");
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const STOP_PARTS = new Set(["de", "del", "la", "el", "los", "las", "y"]);

function encuestasDir() {
  return config.encuestas?.dir || join(config.root, "encuestas");
}

function dailyLimit() {
  const n = Number(config.encuestas?.dailyCount ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function stripAccents(s = "") {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/gi, "c")
    .replace(/ñ/gi, "n");
}

/** Normaliza para emparejar nombres de archivo. */
export function slugifyName(text = "") {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function significantParts(slug = "") {
  return slug.split("-").filter((p) => p.length >= 2 && !STOP_PARTS.has(p));
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { sent: {} };
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { sent: data.sent && typeof data.sent === "object" ? data.sent : {} };
  } catch {
    return { sent: {} };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function surveyId(item) {
  return item.id || slugifyName(item.name || item.title) || item.title;
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
    await bot.telegram.sendPhoto(chatId, Input.fromBuffer(photoBuffer, "encuesta-card.png"), {
      caption,
    });
    const rest = lines.filter(Boolean).join("\n");
    if (rest && rest.length > caption.length + 20) {
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

function findTxtFile(dir) {
  const preferred = ["encuestas.txt", "encuesta.txt"];
  for (const name of preferred) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".txt"));
  if (!files.length) return null;
  files.sort();
  return join(dir, files[0]);
}

function listImages(dir) {
  return readdirSync(dir)
    .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
    .map((f) => ({
      file: f,
      path: join(dir, f),
      stem: slugifyName(basename(f, extname(f))),
    }));
}

function parseFotoLine(block) {
  const m = block.match(/^\s*foto\s*:\s*(.+)$/im);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

/** Prefijo corto de serie: "PRM 6 años en el Poder". */
export function seriesHeadlinePrefix(seriesTitle = "") {
  const s = String(seriesTitle || "");
  if (/prm/i.test(s) && /6\s*a[ñn]os/i.test(s)) {
    return "PRM 6 años en el Poder";
  }
  if (/prm/i.test(s)) return "PRM en el Poder";
  const cleaned = s
    .replace(/^ENCUESTAS?\s*[–—\-:]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 40) || "Encuesta";
}

/** Contexto corto del cargo (Indotel, Turismo, etc.). */
export function shortRoleContext(role = "", question = "") {
  const blob = `${role}\n${question}`;
  const paren = role.match(/\(([A-Za-zÁÉÍÓÚáéíóúÑñ0-9]{2,})\)/);
  if (paren) {
    const acr = paren[1];
    return acr.charAt(0).toUpperCase() + acr.slice(1).toLowerCase();
  }
  if (/gabinete de pol[ií]tica social/i.test(blob)) return "Gabinete de Política Social";
  if (/banco central/i.test(blob)) return "Banco Central";
  if (/relaciones exteriores/i.test(blob)) return "Relaciones Exteriores";
  if (/turismo/i.test(blob)) return "Turismo";
  if (/vivienda/i.test(blob)) return "Vivienda";
  if (/ministr[oa] de la mujer|ministerio de la mujer/i.test(blob)) {
    return "Ministerio de la Mujer";
  }
  if (/vicepresident/i.test(blob)) return "la Vicepresidencia";
  if (/presidente de la rep/i.test(blob)) return "la Presidencia";
  if (/educaci[oó]n/i.test(blob)) return "Educación";
  if (/indotel/i.test(blob)) return "Indotel";

  const cargo = String(role || "")
    .replace(/^Sin una nueva función[^.]*\.\s*/i, "")
    .replace(/^Fue\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cargo) return "";
  // "Ministro de Turismo" → "Turismo"
  const min = cargo.match(/ministr[oa]\s+de\s+(.+)$/i);
  if (min) return min[1].replace(/de la República Dominicana/gi, "").trim();
  return cargo.length > 48 ? `${cargo.slice(0, 45)}…` : cargo;
}

/**
 * Titular corto para WP + redes.
 * Ej: "PRM 6 años en el Poder, ¿Cómo lo ha hecho Guido Gómez Mazara en Indotel?"
 */
export function composeEncuestaTitle({ name, role = "", question = "", seriesTitle = "" } = {}) {
  const prefix = seriesHeadlinePrefix(seriesTitle);
  const who = String(name || "él").trim();
  const where = shortRoleContext(role, question);
  if (where) {
    return `${prefix}, ¿Cómo lo ha hecho ${who} en ${where}?`;
  }
  return `${prefix}, ¿Cómo lo ha hecho ${who}?`;
}

/** Token de archivo vs nombre (decamps ↔ de+camps, ito ⊂ nombre). */
function tokenInName(token, nameSlug, significant) {
  if (!token) return false;
  if (nameSlug.includes(token) || significant.includes(token)) return true;
  for (let i = 2; i <= token.length - 3; i++) {
    const a = token.slice(0, i);
    const b = token.slice(i);
    if (a === "de" && (significant.includes(b) || nameSlug.includes(b))) return true;
    if (significant.includes(a) && significant.includes(b)) return true;
  }
  return false;
}

/**
 * Parsea TXT de encuestas numeradas (ENCUESTA N + Nombre + Cargo + Pregunta)
 * o bloques separados por línea en blanco (primera línea = titular).
 */
export function parseEncuestasTxt(raw = "") {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return { seriesTitle: "", scale: "", items: [] };

  const seriesMatch = text.match(/^(.+?)(?:\n|$)/);
  const seriesTitle = (seriesMatch?.[1] || "").trim();

  let scale = "";
  const scaleMatch = text.match(/Escala sugerida[^\n]*\n+([^\n]+)/i);
  if (scaleMatch) scale = scaleMatch[1].trim();

  const numbered = [
    ...text.matchAll(/ENCUESTA\s+(\d+)\s*\n([\s\S]*?)(?=\nENCUESTA\s+\d+\s*\n|$)/gi),
  ];
  if (numbered.length) {
    const items = numbered.map((m) => {
      const num = Number(m[1]);
      const block = m[2].trim();
      const fotoHint = parseFotoLine(block);
      const name =
        block.match(/^\s*Nombre\s*:\s*(.+)$/im)?.[1]?.trim() || `Encuesta ${num}`;
      const role =
        block.match(/^\s*Cargo actual\s*:\s*(.+)$/im)?.[1]?.trim() ||
        block.match(/^\s*Situaci[oó]n actual\s*:\s*(.+)$/im)?.[1]?.trim() ||
        "";
      const question =
        block.match(/Pregunta\s*:\s*\n?([\s\S]+?)(?=\n\s*foto\s*:|$)/i)?.[1]?.trim() ||
        block.match(/Pregunta\s*:\s*(.+)$/im)?.[1]?.trim() ||
        "";
      const title = composeEncuestaTitle({ name, role, question, seriesTitle });
      return {
        id: `encuesta-${num}-${slugifyName(name)}`,
        number: num,
        name,
        role,
        question,
        title,
        bodyText: [name, role, "", question, scale ? `\nEscala: ${scale}` : ""]
          .filter(Boolean)
          .join("\n"),
        fotoHint,
        scale,
        seriesTitle,
      };
    });
    items.sort((a, b) => a.number - b.number);
    return { seriesTitle, scale, items };
  }

  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const items = [];
  for (const block of blocks) {
    if (/^escala sugerida/i.test(block)) continue;
    if (block === seriesTitle) continue;
    const fotoHint = parseFotoLine(block);
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !/^foto\s*:/i.test(l));
    if (!lines.length) continue;
    const title = lines[0];
    const bodyText = lines.slice(1).join("\n").trim() || title;
    items.push({
      id: slugifyName(title),
      number: items.length + 1,
      name: title,
      role: "",
      question: bodyText,
      title,
      bodyText,
      fotoHint,
      scale,
      seriesTitle,
    });
  }
  return { seriesTitle, scale, items };
}

/**
 * Busca foto en carpeta por match de nombre (prioridad: exacto > tokens > parcial).
 */
export function resolveImageForItem(item, images) {
  if (!images?.length) return null;

  if (item.fotoHint) {
    const hint = item.fotoHint.replace(/\\/g, "/");
    const base = basename(hint);
    const byName = images.find((img) => img.file.toLowerCase() === base.toLowerCase());
    if (byName) return byName;
    const hintStem = slugifyName(basename(base, extname(base)));
    const byStem = images.find((img) => img.stem === hintStem);
    if (byStem) return byStem;
  }

  const nameSlug = slugifyName(item.name);
  const significant = significantParts(nameSlug);

  const candidates = [
    nameSlug,
    significant.join("-"),
    significant.length >= 2
      ? `${significant[0]}-${significant[significant.length - 1]}`
      : "",
    significant.length >= 2 ? significant.slice(0, 2).join("-") : "",
    significant[significant.length - 1] || "",
    significant[0] || "",
    item.number ? `encuesta-${item.number}` : "",
    item.number ? String(item.number) : "",
  ].filter(Boolean);

  for (const stem of candidates) {
    const exact = images.find((img) => img.stem === stem);
    if (exact) return exact;
  }

  const scored = images
    .map((img) => {
      const parts = img.stem.split("-").filter(Boolean);
      if (!parts.length) return { img, score: 0 };
      const allInName = parts.every((p) => tokenInName(p, nameSlug, significant));
      if (!allInName) return { img, score: 0 };
      const orderBonus = parts.every((p, i) => {
        if (i === 0) return true;
        const prev = nameSlug.indexOf(parts[i - 1]);
        const cur = nameSlug.indexOf(p);
        return prev >= 0 && cur >= prev;
      })
        ? 5
        : 0;
      return { img, score: parts.length * 10 + img.stem.length + orderBonus };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored[0].img;

  const last = significant[significant.length - 1];
  if (last && last.length >= 4) {
    const soft = images
      .map((img) => {
        let score = 0;
        if (img.stem === last) score = 100;
        else if (img.stem.endsWith(`-${last}`)) score = 80;
        else if (img.stem.includes(last)) score = 40 + last.length;
        return { img, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (soft.length) return soft[0].img;
  }

  return null;
}

function buildHtml(item) {
  const parts = [
    item.seriesTitle ? `<p><strong>${escapeHtml(item.seriesTitle)}</strong></p>` : "",
    `<h2>${escapeHtml(item.name)}</h2>`,
    item.role ? `<p><em>${escapeHtml(item.role)}</em></p>` : "",
    item.question ? `<p>${escapeHtml(item.question)}</p>` : "",
    item.scale ? `<p><strong>Escala:</strong> ${escapeHtml(item.scale)}</p>` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mimeForPath(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/**
 * Carga TXT + fotos y devuelve la cola pendiente (orden ENCUESTA N, sin repetir).
 */
export function loadPendingEncuestas({ force = false, onlyId = "" } = {}) {
  const dir = encuestasDir();
  if (!existsSync(dir)) {
    throw new Error(`No existe la carpeta de encuestas: ${dir}`);
  }
  const txtPath = findTxtFile(dir);
  if (!txtPath) {
    throw new Error(`No hay ningún .txt en ${dir}`);
  }
  const raw = readFileSync(txtPath, "utf8");
  const parsed = parseEncuestasTxt(raw);
  const images = listImages(dir);
  const state = loadState();

  let items = parsed.items
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((item) => {
      const image = resolveImageForItem(item, images);
      return { ...item, image };
    });

  if (onlyId) {
    items = items.filter((item) => surveyId(item) === onlyId);
  } else if (!force) {
    items = items.filter((item) => !state.sent[surveyId(item)]);
  }

  return {
    dir,
    txtPath,
    images,
    state,
    seriesTitle: parsed.seriesTitle,
    allCount: parsed.items.length,
    items,
  };
}

/**
 * Check 09:00: verifica foto de la primera pendiente; si falta, pide por Telegram.
 */
export async function runEncuestasCheck({ notify = true } = {}) {
  const loaded = loadPendingEncuestas();
  const next = loaded.items[0] || null;

  if (!next) {
    const msg = "Encuestas check: no hay pendientes (todas enviadas).";
    console.log(msg);
    return { ok: true, pending: false, next: null, hasPhoto: false, message: msg };
  }

  const hasPhoto = Boolean(next.image);
  const example = `${slugifyName(next.name)}.jpg`;
  let message;
  if (hasPhoto) {
    message = `OK: lista para 10:00 — ${next.name} (foto: ${next.image.file})`;
    console.log(message);
  } else {
    message =
      `Falta foto para la encuesta de las 10:00: ${next.name}.\n` +
      `Ponla en la carpeta encuestas/ (ej. ${example} o tokens del nombre).`;
    console.warn(message);
  }

  if (notify) {
    try {
      if (!hasPhoto) {
        await notifyTelegram(["Encuestas — falta foto (check 9:00)", message]);
      } else {
        await notifyTelegram(["Encuestas check 9:00", message]);
      }
    } catch (e) {
      console.warn("Telegram check:", e.message);
    }
  }

  return {
    ok: hasPhoto,
    pending: true,
    next,
    hasPhoto,
    imageFile: next.image?.file || null,
    message,
    txtPath: loaded.txtPath,
  };
}

/**
 * @param {{
 *   dryRun?: boolean,
 *   limit?: number,
 *   force?: boolean,
 *   socialOnly?: boolean,
 *   previewOnly?: boolean,
 *   onlyId?: string,
 *   skipTelegram?: boolean,
 * }} opts
 */
export async function runEncuestas({
  dryRun = false,
  limit,
  force = false,
  socialOnly = false,
  previewOnly = false,
  onlyId = "",
  skipTelegram = false,
} = {}) {
  const loaded = loadPendingEncuestas({ force, onlyId });
  const { txtPath, state } = loaded;
  let items = loaded.items;

  console.log(`TXT: ${basename(txtPath)} (${loaded.allCount} encuestas, ${items.length} en cola)`);
  console.log(`Fotos en carpeta: ${loaded.images.length}`);

  const effectiveLimit =
    limit != null && Number(limit) > 0 ? Number(limit) : undefined;
  if (effectiveLimit != null) {
    items = items.slice(0, effectiveLimit);
  }

  if (!items.length) {
    if (!skipTelegram) {
      await notifyTelegram([
        "Encuestas",
        "No hay encuestas nuevas por publicar (todas enviadas o sin bloques).",
        txtPath,
      ]).catch((e) => console.warn(e.message));
    }
    return { published: [], skipped: [], noneNew: true, dryRun };
  }

  const published = [];
  const skipped = [];
  const errors = [];
  const hashtag = config.publishWebhook?.hashtag || "#fvdigital";

  for (const item of items) {
    console.log(`→ ${item.title.slice(0, 100)}${item.title.length > 100 ? "…" : ""}`);
    if (!item.image) {
      const msg = `Sin foto para: ${item.name} (ej. ${slugifyName(item.name)}.jpg)`;
      console.warn(msg);
      skipped.push({ item, reason: "sin-foto" });
      if (!skipTelegram) {
        await notifyTelegram(["Encuestas (omitida)", msg]).catch(() => {});
      }
      continue;
    }

    try {
      if (dryRun) {
        published.push({
          dryRun: true,
          item,
          imageFile: item.image.file,
        });
        if (!skipTelegram) {
          await notifyTelegram([
            "Encuesta (dry-run)",
            item.title,
            item.image.file,
            item.question?.slice(0, 200) || "",
          ]);
        }
        continue;
      }

      const buffer = readFileSync(item.image.path);
      const mime = mimeForPath(item.image.path);

      // Preview: solo tarjeta a Telegram (sin WP, R2 ni webhook).
      if (previewOnly) {
        const cardTitle = item.title;
        const caption = `${item.title}\n\n${hashtag}`.trim();
        const card = await generateNewsCard({
          backgroundBuffer: buffer,
          title: cardTitle,
        });
        await notifyTelegram(
          ["Encuesta (preview Telegram — sin webhook)", item.title, item.image.file],
          { photoBuffer: card, photoCaption: caption.slice(0, 1024) }
        );
        published.push({ previewOnly: true, item, cardTitle });
        continue;
      }

      const prev = state.sent[surveyId(item)];
      let postId = prev?.postId || null;
      let postLink = null;

      // Orden estricto: WordPress primero (salvo reenvío solo redes).
      if (!socialOnly) {
        const media = await uploadImageFromBuffer(buffer, item.image.file, mime, {
          title: item.title,
          altText: item.name,
        });
        const html = buildHtml(item);
        const result = await createPost({
          title: item.title,
          text: item.bodyText,
          htmlContent: html,
          featuredMediaId: media.id,
          status: config.autoPublishUrls ? "publish" : config.defaultPostStatus,
        });
        postId = result.post?.id || null;
        postLink = result.post?.link || null;
        if (!postId) {
          throw new Error("WordPress no devolvió post id");
        }
      } else if (!postId) {
        console.warn(
          `socialOnly sin post previo para ${item.name}; se crea el artículo WP primero.`
        );
        const media = await uploadImageFromBuffer(buffer, item.image.file, mime, {
          title: item.title,
          altText: item.name,
        });
        const html = buildHtml(item);
        const result = await createPost({
          title: item.title,
          text: item.bodyText,
          htmlContent: html,
          featuredMediaId: media.id,
          status: config.autoPublishUrls ? "publish" : config.defaultPostStatus,
        });
        postId = result.post?.id || null;
        postLink = result.post?.link || null;
        if (!postId) {
          throw new Error("WordPress no devolvió post id");
        }
      }

      // Redes: titular íntegro de la encuesta (pregunta), sin reescribir/acortar con IA.
      const cardTitle = item.title;
      const caption = `${item.title}\n\n${hashtag}`.trim();

      if (!config.r2?.enabled) {
        throw new Error("R2 no está configurado; no se puede enviar tarjeta a redes.");
      }

      const card = await generateNewsCard({
        backgroundBuffer: buffer,
        title: cardTitle,
      });
      const cardUrl = await uploadToR2(
        card,
        `cards/encuesta-${Date.now()}-${slugifyName(item.name).slice(0, 40)}.png`,
        "image/png"
      );
      if (!isPublicR2Url(cardUrl)) {
        throw new Error("URL R2 de tarjeta no es pública (r2.dev).");
      }

      const webhook = await publishToWebhook({
        title: cardTitle,
        caption,
        imageUrl: cardUrl,
        mediaType: "IMAGE",
        target: "fvdigital",
      });
      if (!webhook?.ok) {
        throw new Error(webhook?.error || `Webhook HTTP ${webhook?.status}`);
      }

      state.sent[surveyId(item)] = {
        title: item.title,
        name: item.name,
        image: item.image.file,
        postId,
        cardUrl,
        at: new Date().toISOString(),
        queued: Boolean(webhook.queued),
        socialOnly: Boolean(socialOnly && prev?.postId),
      };
      saveState(state);

      published.push({
        item,
        postId,
        cardUrl,
        webhook,
        cardBuffer: card,
        caption,
        cardTitle,
      });

      if (!skipTelegram) {
        await notifyTelegram(
          [
            "Encuesta → WP + redes FV",
            item.title,
            postLink || `post ${postId}`,
            cardUrl,
            webhook.queued ? "Webhook FV: encolado" : "Webhook FV: ok",
            caption,
          ],
          {
            photoBuffer: card,
            photoCaption: item.title,
          }
        );
      }
    } catch (error) {
      console.error(`Error ${item.name}:`, error.message);
      errors.push({ item, error: error.message });
      if (!skipTelegram) {
        await notifyTelegram(["Encuesta (error)", item.title, error.message]).catch(
          () => {}
        );
      }
    }
  }

  return { published, skipped, errors, dryRun, noneNew: false, txtPath };
}

/** Límite por defecto del cron diario (1). */
export function encuestasDailyLimit() {
  return dailyLimit();
}
