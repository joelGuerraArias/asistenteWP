import sharp from "sharp";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BRAND_RED = "#ED1C24";
const TITLE_BG_RED = "#6B0F14";
const LOGO_PATH = join(__dirname, "..", "assets", "logo_fv.png");
export const LOGO_F1RD_PATH = join(__dirname, "..", "assets", "logo_f1rd.png");

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Reparte el texto en exactamente 2 líneas (lo más parejas posible), sin cortar palabras ni caracteres. */
function balanceTwoLines(text) {
  const words = String(text)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!words.length) return [""];
  if (words.length === 1) return [words[0]];

  let best = null;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(" ");
    const l2 = words.slice(i).join(" ");
    const diff = Math.abs(l1.length - l2.length);
    if (!best || diff < best.diff) {
      best = { diff, lines: [l1, l2] };
    }
  }
  return best.lines;
}

/**
 * Layout del titular en la tarjeta (45px):
 * - ≤5 palabras → 1 línea
 * - 6+ palabras → 2 líneas (máximo)
 */
function layoutTitle(text, { fontSizePx }) {
  const clean = String(text || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return { fontSize: fontSizePx, lines: [""] };

  if (words.length <= 5) {
    return { fontSize: fontSizePx, lines: [clean] };
  }

  let lines = balanceTwoLines(clean);
  if (lines.length > 2) {
    lines = [lines[0], lines.slice(1).join(" ")];
  }
  return { fontSize: fontSizePx, lines };
}

function formatDate(date = new Date()) {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

import { downloadImageFromUrl } from "./featured-image.mjs";

export async function fetchImageBuffer(url) {
  const { buffer } = await downloadImageFromUrl(url);
  return buffer;
}

/**
 * Encaja la foto en el área de contenido (arriba del pie).
 * Usa cover para llenar el área (foto grande, poco margen).
 * Recorta sobre todo desde arriba (position south) para conservar la parte baja
 * donde va el titular. El borde inferior = contentBottom.
 */
export async function prepareSquareBackground(
  buffer,
  size,
  { contentBottom = size, sideInset = 0 } = {}
) {
  const oriented = await sharp(buffer, { failOn: "none" }).rotate().toBuffer();

  const areaTop = sideInset;
  const areaLeft = sideInset;
  const areaW = Math.max(1, size - sideInset * 2);
  const areaH = Math.max(1, contentBottom - sideInset);
  const areaBottom = areaTop + areaH;

  const blurBg = await sharp(oriented, { failOn: "none" })
    .resize(size, size, {
      fit: "cover",
      position: "attention",
      kernel: "lanczos3",
    })
    .blur(32)
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .toBuffer();

  // Cover en todo el área de contenido; recorte preferente desde arriba.
  const covered = await sharp(oriented, { failOn: "none" })
    .resize(areaW, areaH, {
      fit: "cover",
      position: "south",
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();

  const out = await sharp(blurBg)
    .composite([{ input: covered, left: areaLeft, top: areaTop }])
    .toBuffer();

  return {
    buffer: out,
    contentRect: { x: areaLeft, y: areaTop, w: areaW, h: areaH, bottom: areaBottom },
  };
}

/**
 * Genera una tarjeta social cuadrada a partir de una imagen de fondo.
 * @returns {Promise<Buffer>} PNG
 */
export async function generateNewsCard({
  backgroundBuffer,
  title,
  tag = "",
  size = config.socialCard?.size || 1080,
  date = new Date(),
  handle = config.socialCard?.handle || "#fvdigital.do",
  site = config.socialCard?.site || "www.fvdigital.do",
  logoPath = LOGO_PATH,
  badgeText = "FV",
  logoWidthRatio = 0.24,
}) {
  if (!backgroundBuffer) throw new Error("Falta backgroundBuffer");
  if (!title) throw new Error("Falta el titular");

  const pad = Math.round(size * 0.055);
  const sideInset = Math.round(size * 0.01);
  // Banda inferior para web/fecha: el borde de la foto y del bkg del título caen aquí.
  const footerBand = Math.round(size * 0.105);
  const contentBottom = size - footerBand;

  const prepared = await prepareSquareBackground(backgroundBuffer, size, {
    contentBottom,
    sideInset,
  });
  const bg = prepared.buffer;
  const photoBottom = prepared.contentRect?.bottom ?? contentBottom;

  const logoW = Math.round(size * Math.min(0.55, Math.max(0.15, logoWidthRatio)));
  let logoBuffer = null;
  let logoMeta = null;
  const resolvedLogo = logoPath || LOGO_PATH;
  if (existsSync(resolvedLogo)) {
    logoBuffer = await sharp(resolvedLogo).resize({ width: logoW }).png().toBuffer();
    logoMeta = await sharp(logoBuffer).metadata();
  }

  // Letra fija 45px @1080; titular SIEMPRE ≤ 2 líneas (texto completo).
  const titleFontPx = Math.max(14, Math.round((45 * size) / 1080));
  const laid = layoutTitle(title, { fontSizePx: titleFontPx });
  const titleFont = laid.fontSize;
  const titleLines = laid.lines.slice(0, 2);
  const titleLineH = Math.round(titleFont * 1.2);

  const socialFont = Math.round(size * 0.036);
  const dateFont = Math.round(size * 0.033);

  // Pie centrado en la banda bajo el corte de la foto.
  const socialY = Math.round(
    photoBottom + (size - photoBottom) / 2 + socialFont * 0.35
  );

  // Bloque rojo: borde inferior = borde inferior de la foto (mismo corte).
  const charFactor = 0.56;
  const longest = Math.max(...titleLines.map((l) => l.length), 1);
  const titlePadX = Math.round(titleFont * 0.45);
  const titlePadY = Math.round(titleFont * 0.28);
  const titleBgW = Math.min(
    size - pad * 2,
    Math.round(longest * titleFont * charFactor + titlePadX * 2)
  );
  const titleBgH = Math.round(
    titleLines.length * titleLineH + titlePadY * 2 - titleFont * 0.15
  );
  const titleCx = Math.round(size / 2);
  const titleBgX = Math.round(titleCx - titleBgW / 2);
  const titleBgY = Math.round(photoBottom - titleBgH);
  const titleBgRx = Math.round(Math.min(10, titleFont * 0.18));
  const titleBgRect = `<rect x="${titleBgX}" y="${titleBgY}" width="${titleBgW}" height="${titleBgH}" rx="${titleBgRx}" ry="${titleBgRx}" fill="${TITLE_BG_RED}" fill-opacity="0.92"/>`;

  // Baseline del primer renglón: texto dentro del bloque, anclado al borde inferior.
  const titleStartY = Math.round(
    titleBgY + titlePadY + titleFont * 0.82
  );

  const badgeR = Math.round(size * 0.058);
  const badgeCx = pad + badgeR;
  const badgeCy = pad + badgeR;
  const badgeLabelRaw = String(badgeText || "FV").trim() || "FV";
  const badgeIsShort = badgeLabelRaw.length <= 3;
  const badgeLabel = badgeIsShort
    ? badgeLabelRaw.slice(0, 3).toUpperCase()
    : badgeLabelRaw;
  const badgeFont = badgeIsShort
    ? Math.round(badgeR * 0.85)
    : Math.round(size * 0.028);
  const badgePadX = Math.round(size * 0.018);
  const badgeH = Math.round(size * 0.07);
  const badgeW = badgeIsShort
    ? badgeR * 2
    : Math.round(badgeFont * badgeLabel.length * 0.62 + badgePadX * 2);
  const badgeX = pad;
  const badgeY = pad;
  const badgeTextX = badgeIsShort ? badgeCx : badgeX + badgeW / 2;
  const badgeTextY = badgeIsShort
    ? badgeCy + badgeFont * 0.35
    : badgeY + badgeH / 2 + badgeFont * 0.35;
  const badgeShape = badgeIsShort
    ? `<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${BRAND_RED}"/>`
    : `<rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${Math.round(
        badgeH / 2
      )}" ry="${Math.round(badgeH / 2)}" fill="${BRAND_RED}"/>`;

  const titleTspans = titleLines
    .map((line, i) => {
      const y = titleStartY + i * titleLineH;
      return `<text x="${titleCx}" y="${y}" class="title" filter="url(#soft)">${escapeXml(
        line
      )}</text>`;
    })
    .join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="45%" stop-color="#000000" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.82"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${(size * 0.006).toFixed(2)}" result="blur"/>
      <feOffset in="blur" dx="0" dy="${Math.max(1, Math.round(size * 0.0025))}" result="off"/>
      <feComponentTransfer in="off" result="sh">
        <feFuncA type="linear" slope="0.5"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode in="sh"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <style>
      .title { fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:800;
               font-size:${titleFont}px; text-anchor:middle; }
      .badge { fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:800;
               font-size:${badgeFont}px; text-anchor:middle; }
      .social{ fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:700;
               font-size:${socialFont}px; }
      .date  { fill:#e8e8e8; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:600;
               font-size:${dateFont}px; text-anchor:end; }
    </style>
  </defs>

  <rect x="0" y="0" width="${size}" height="${size}" fill="url(#fade)"/>

  ${badgeShape}
  <text x="${badgeTextX}" y="${badgeTextY}" class="badge">${escapeXml(badgeLabel)}</text>

  ${titleBgRect}
  ${titleTspans}

  <text x="${pad}" y="${socialY}" class="social">${escapeXml(site)}</text>
  <text x="${size - pad}" y="${socialY}" class="date">${escapeXml(formatDate(date))}</text>
</svg>`;

  const composites = [{ input: Buffer.from(svg), top: 0, left: 0 }];

  if (logoBuffer && logoMeta) {
    composites.push({
      input: logoBuffer,
      top: pad,
      left: size - pad - logoMeta.width,
    });
  }

  return sharp(bg).composite(composites).png().toBuffer();
}
