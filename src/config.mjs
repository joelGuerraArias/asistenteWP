import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Registrar las fuentes locales (Montserrat) para que sharp/librsvg las use.
// Debe ejecutarse antes de que sharp se cargue en cualquier módulo.
function setupFontconfig() {
  try {
    const fontsDir = join(root, "assets", "fonts");
    if (!existsSync(fontsDir)) return;
    const cacheDir = join(fontsDir, "cache");
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    const toPosix = (p) => p.replace(/\\/g, "/");
    const winFonts = toPosix(join(process.env.WINDIR || "C:/Windows", "Fonts"));
    const confPath = join(fontsDir, "fonts.conf");
    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${toPosix(fontsDir)}</dir>
  <dir>${winFonts}</dir>
  <cachedir>${toPosix(cacheDir)}</cachedir>
  <config></config>
</fontconfig>
`;
    writeFileSync(confPath, conf);

    if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = confPath;
    if (!process.env.FONTCONFIG_PATH) process.env.FONTCONFIG_PATH = fontsDir;
  } catch {
    // si falla, sharp usará las fuentes del sistema
  }
}

setupFontconfig();

function loadEnvFile() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const categoriesPath = join(root, "config", "categories.json");
const categoriesConfig = JSON.parse(readFileSync(categoriesPath, "utf8"));

export const config = {
  root,
  wp: {
    siteUrl: process.env.WORDPRESS_SITE_URL?.replace(/\/$/, ""),
    username: process.env.WORDPRESS_USERNAME,
    appPassword: process.env.WORDPRESS_APP_PASSWORD,
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    echoOnly: process.env.TELEGRAM_ECHO_ONLY === "true",
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  },
  defaultPostStatus: process.env.DEFAULT_POST_STATUS || "draft",
  autoPublishUrls: process.env.AUTO_PUBLISH_URLS !== "false",
  defaultCategorySlugs: (
    process.env.DEFAULT_CATEGORIES || categoriesConfig.defaultSlugs.join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  categoryAliases: categoriesConfig.aliases,
  categoryResolved: categoriesConfig.resolved,
  messageBufferMs: Number(process.env.TELEGRAM_BUFFER_MS || 12000),
  server: {
    port: Number(process.env.BOT_PORT || 9000),
  },
  audio: {
    provider: process.env.SPEECH_PROVIDER || "mistral",
    mistralApiKey: process.env.MISTRAL_API_KEY || "",
    mistralTranscribeModel:
      process.env.MISTRAL_TRANSCRIBE_MODEL || "voxtral-mini-latest",
    mistralTtsModel: process.env.MISTRAL_TTS_MODEL || "voxtral-mini-tts-2603",
    mistralTtsVoiceId: process.env.MISTRAL_TTS_VOICE_ID || "",
    mistralChatModel:
      process.env.MISTRAL_CHAT_MODEL || "mistral-small-latest",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    groqApiKey: process.env.GROQ_API_KEY || "",
    language: process.env.SPEECH_LANGUAGE || "es",
    ttsLang: process.env.TTS_LANGUAGE || "es",
    voiceReplies: process.env.VOICE_REPLIES !== "false",
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(
      /\/$/,
      ""
    ),
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
    thinking: process.env.DEEPSEEK_THINKING === "true",
    reasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT || "medium",
  },
  vision: {
    ocrModel: process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest",
    model: process.env.MISTRAL_VISION_MODEL || "pixtral-large-latest",
  },
  socialCard: {
    enabled: process.env.SOCIAL_CARD !== "false",
    size: Number(process.env.SOCIAL_CARD_SIZE || 1080),
    handle: process.env.SOCIAL_CARD_HANDLE || "#fvdigital.do",
    site: process.env.SOCIAL_CARD_SITE || "www.fvdigital.do",
  },
  publishWebhook: {
    enabled: process.env.PUBLISH_WEBHOOK !== "false",
    url:
      process.env.PUBLISH_WEBHOOK_URL ||
      "https://meny.app.n8n.cloud/webhook/fvdigital",
    hashtag: process.env.PUBLISH_WEBHOOK_HASHTAG || "#fvdigital",
    source: process.env.PUBLISH_WEBHOOK_SOURCE || "asistente-wp",
  },
  r2: {
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, ""),
    endpoint:
      (process.env.R2_ENDPOINT || "").replace(/\/$/, "") ||
      (process.env.R2_ACCOUNT_ID
        ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : ""),
    bucket: process.env.R2_BUCKET || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    get enabled() {
      return Boolean(
        this.endpoint &&
          this.bucket &&
          this.accessKeyId &&
          this.secretAccessKey &&
          this.publicBaseUrl
      );
    },
  },
  news: {
    authorSignature: process.env.NEWS_AUTHOR_SIGNATURE || "Milton Jerez",
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY || "",
    searchDepth: process.env.TAVILY_SEARCH_DEPTH || "advanced",
    maxResults: Math.min(20, Math.max(3, Number(process.env.TAVILY_MAX_RESULTS || 8))),
    timeRange: process.env.TAVILY_TIME_RANGE || "week",
    get enabled() {
      return Boolean(this.apiKey);
    },
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY || "",
    smtpUser: process.env.BREVO_SMTP_USER || "",
    smtpServer: process.env.BREVO_SMTP_SERVER || "smtp-relay.brevo.com",
    smtpPort: Number(process.env.BREVO_SMTP_PORT || 587),
    senderEmail: process.env.BREVO_SENDER_EMAIL || "",
    senderName: process.env.BREVO_SENDER_NAME || "FGJ Medios - Sistema de Análisis",
    get enabled() {
      return Boolean(this.smtpUser && process.env.BREVO_API_KEY && this.senderEmail);
    },
  },
  /**
   * Interruptor global Edesur (correos monitoreo, sheet eléctrico, telegram).
   * Intrant sigue normal con EDESUR_ENABLED=false.
   */
  edesurEnabled: process.env.EDESUR_ENABLED !== "false",
  informes: {
    dir:
      process.env.INFORMES_DIR ||
      "C:\\Users\\Joel Guerra\\Desktop\\informes",
    emailIntrant: process.env.INFORME_EMAIL_INTRANT || "",
    emailIntrantCc: process.env.INFORME_EMAIL_INTRANT_CC || "belgicajr@gmail.com",
    emailEdesur: process.env.INFORME_EMAIL_EDESUR || "",
    emailEdesurCc: process.env.INFORME_EMAIL_EDESUR_CC || "",
    /** Horarios locales HH:MM — por defecto 17:00 y 23:00 */
    cronTimes: (() => {
      const raw =
        process.env.INFORME_CRON_TIMES ||
        (process.env.INFORME_CRON_HOUR
          ? `${process.env.INFORME_CRON_HOUR}:${process.env.INFORME_CRON_MINUTE || "0"}`
          : "17:00,23:00");
      return String(raw)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          const [h, m = "0"] = t.split(":");
          return {
            hour: Math.min(23, Math.max(0, Number(h) || 0)),
            minute: Math.min(59, Math.max(0, Number(m) || 0)),
          };
        });
    })(),
  },
  googleAlerts: {
    gmail: {
      user: process.env.GMAIL_ALERTS_USER || "autosemana@gmail.com",
      appPassword: (process.env.GMAIL_ALERTS_APP_PASSWORD || "").replace(/\s+/g, ""),
    },
    oauth: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN || "",
    },
    sheetId: process.env.GOOGLE_ALERTS_SHEET_ID || "",
    sheetName: process.env.GOOGLE_ALERTS_SHEET_NAME || "Hoja 1",
    sheetFileName: process.env.GOOGLE_ALERTS_SHEET_FILE || "intrant",
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || "",
    serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || "",
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    filters: String(
      process.env.GOOGLE_ALERTS_FILTERS ||
        "intrant,digesett,rdvial,rd vial,seguridad vial,milton morrison,miltton morrison,juan manuel mendez,transporte,transportes,pasaje,licencia de conducir"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cronTimes: (() => {
      const raw = process.env.GOOGLE_ALERTS_CRON_TIMES || "08:30,16:30";
      return String(raw)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          if (t.startsWith("*:")) {
            return { hour: -1, minute: Number(t.slice(2)) || 0 };
          }
          const [h, m = "0"] = t.split(":");
          return {
            hour: Math.min(23, Math.max(0, Number(h) || 0)),
            minute: Math.min(59, Math.max(0, Number(m) || 0)),
          };
        });
    })(),
  },
  electricAlerts: {
    /** false cuando EDESUR_ENABLED=false */
    get enabled() {
      return process.env.EDESUR_ENABLED !== "false";
    },
    sheetId:
      process.env.ELECTRIC_ALERTS_SHEET_ID ||
      "1y1wYUf9SZf8RVPJt0PfGU69QFlBsd7f5we_FBGQRGYg",
    sheetName: process.env.ELECTRIC_ALERTS_SHEET_NAME || "Hoja 1",
    filters: String(
      process.env.ELECTRIC_ALERTS_FILTERS ||
        "edesur,edeeste,egehid,eted,cued,celso marranzini,apagones,punta catalina"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cronTimes: (() => {
      const raw = process.env.ELECTRIC_ALERTS_CRON_TIMES || "08:30,16:30";
      return String(raw)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          if (t.startsWith("*:")) {
            return { hour: -1, minute: Number(t.slice(2)) || 0 };
          }
          const [h, m = "0"] = t.split(":");
          return {
            hour: Math.min(23, Math.max(0, Number(h) || 0)),
            minute: Math.min(59, Math.max(0, Number(m) || 0)),
          };
        });
    })(),
  },
  video: {
    hyperframes: {
      enabled: process.env.HYPERFRAMES_ENABLED !== "false",
      dir: join(root, process.env.HYPERFRAMES_DIR || "video/hyperframes"),
    },
    remotion: {
      enabled: process.env.REMOTION_ENABLED !== "false",
      dir: join(root, process.env.REMOTION_DIR || "video/remotion"),
    },
    frase: {
      dir: join(root, process.env.FRASE_HYPERFRAMES_DIR || "video/frase-celebre"),
      cronTime: process.env.FRASE_CRON_TIME || "08:00",
    },
    heygen: {
      enabled: process.env.HEYGEN_VIDEO !== "false",
      apiKey: process.env.HEYGEN_API_KEY || "",
      avatarId: process.env.HEYGEN_AVATAR_ID || "",
      voiceId: process.env.HEYGEN_VOICE_ID || "",
      orientation: process.env.HEYGEN_ORIENTATION || "portrait",
    },
  },
  socialVideo: {
    ytdlpPath: process.env.YTDLP_PATH || "",
    cookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || "",
    /** Netscape cookies.txt (recomendado si Chrome bloquea DPAPI) */
    cookiesFile: process.env.YTDLP_COOKIES_FILE || "",
    maxMb: Math.min(
      200,
      Math.max(10, Number(process.env.SOCIAL_VIDEO_MAX_MB || 90))
    ),
  },
  termometro: {
    framePath: process.env.TERMOMETRO_FRAME_PATH
      ? join(root, process.env.TERMOMETRO_FRAME_PATH)
      : join(root, "assets", "termometro-frame.png"),
    durationSeconds: Math.min(60, Math.max(5, Number(process.env.TERMOMETRO_DURATION_SECONDS || 30))),
    fps: Math.min(60, Math.max(15, Number(process.env.TERMOMETRO_FPS || 30))),
    typewriterStartSeconds: Math.min(20, Math.max(0, Number(process.env.TERMOMETRO_TYPEWRITER_START_SECONDS || 3))),
    typewriterDurationSeconds: Math.min(20, Math.max(1, Number(process.env.TERMOMETRO_TYPEWRITER_DURATION_SECONDS || 4))),
  },
  dgcp: {
    url:
      process.env.DGCP_DIGEST_URL ||
      "https://comunidad.comprasdominicana.gob.do/Public/Tendering/ContractNoticeManagement/Index",
    to: process.env.DGCP_DIGEST_TO || "autosemana@gmail.com",
    keywords: String(
      process.env.DGCP_DIGEST_KEYWORDS ||
        "web,aplicación,aplicacion,aplicaciones,streaming,monitoreo,relaciones públicas,relaciones publicas,encuestas,python,react,montaje,eventos,tecnología,tecnologia,zoom,adobe,fortinet,openai,claude,inteligencia artificial,plataforma,informático,informatico,equipos informáticos,equipos informaticos,accesorios informáticos,accesorios informaticos,licencia,licencias,antivirus,suscripción,suscripcion,seguridad,comunicaciones,mantenimiento de vehículos,mantenimiento de vehiculos"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    /** Horarios locales HH:MM — por defecto 08:00 y 17:00 */
    cronTimes: (() => {
      const raw = process.env.DGCP_DIGEST_CRON_TIMES || "08:00,17:00";
      return String(raw)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          const [h, m = "0"] = t.split(":");
          return {
            hour: Math.min(23, Math.max(0, Number(h) || 0)),
            minute: Math.min(59, Math.max(0, Number(m) || 0)),
          };
        });
    })(),
  },
  /** /trad — doblaje + subtítulos 9:16 */
  trad: {
    voiceId:
      process.env.TRAD_VOICE_ID ||
      process.env.MISTRAL_TTS_VOICE_ID ||
      "cccea7b3-4ebc-42af-92a6-f4ac3ba8215d", // pabmatos
    originalVolume: Math.min(
      1,
      Math.max(0, Number(process.env.TRAD_ORIGINAL_VOLUME || 0.05))
    ),
    dubVolume: Math.min(
      4,
      Math.max(0.5, Number(process.env.TRAD_DUB_VOLUME || 2))
    ),
    headlineDelay: Math.min(
      30,
      Math.max(0, Number(process.env.TRAD_HEADLINE_DELAY || 7))
    ),
    headlineTypeSeconds: Math.min(
      10,
      Math.max(0.5, Number(process.env.TRAD_HEADLINE_TYPE_SECONDS || 2))
    ),
    headlineVisibleSeconds: Math.min(
      30,
      Math.max(3, Number(process.env.TRAD_HEADLINE_VISIBLE_SECONDS || 10))
    ),
    width: Number(process.env.TRAD_WIDTH || 1080),
    height: Number(process.env.TRAD_HEIGHT || 1920),
    ffmpegPath: process.env.FFMPEG_PATH || "",
    overlayPath: process.env.TRAD_OVERLAY_PATH || "",
  },
};

export function wpAuthHeader() {
  const { username, appPassword } = config.wp;
  const token = Buffer.from(`${username}:${appPassword}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export function isChatAllowed(chatId) {
  if (!config.telegram.allowedChatIds.length) return true;
  return config.telegram.allowedChatIds.includes(String(chatId));
}
