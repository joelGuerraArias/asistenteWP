import sharp from "sharp";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BRAND_RED = "#ED1C24";
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

function wrapText(text, { maxWidthPx, fontSizePx, charFactor = 0.54 }) {
  const maxChars = Math.max(6, Math.floor(maxWidthPx / (fontSizePx * charFactor)));
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Reparte el texto en 2 líneas lo más parejas posible, sin cortar palabras. */
function balanceTwoLines(text) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  if (words.length < 2) return [text];

  const total = words.join(" ").length;
  let best = null;

  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(" ");
    const l2 = words.slice(i).join(" ");
    const diff = Math.abs(l1.length - l2.length);
    if (!best || diff < best.diff) {
      best = { diff, lines: [l1, l2], longest: Math.max(l1.length, l2.length) };
    }
  }

  return best.lines;
}

function fitTitle(text, { maxWidthPx, maxLines, minFont, maxFont, charFactor = 0.54 }) {
  // Con objetivo de 2 líneas, se balancean para que queden parejas.
  if (maxLines === 2) {
    const balanced = balanceTwoLines(text);
    const longest = Math.max(...balanced.map((l) => l.length));
    for (let font = maxFont; font >= minFont; font -= 1) {
      const fitsPerLine = Math.floor(maxWidthPx / (font * charFactor));
      if (longest <= fitsPerLine) {
        return { fontSize: font, lines: balanced };
      }
    }
    // No cabe ni al mínimo: usa el wrap normal (puede pasar a más líneas) sin "…".
    return {
      fontSize: minFont,
      lines: wrapText(text, { maxWidthPx, fontSizePx: minFont, charFactor }),
    };
  }

  for (let font = maxFont; font >= minFont; font -= 1) {
    const lines = wrapText(text, { maxWidthPx, fontSizePx: font, charFactor });
    if (lines.length <= maxLines) {
      return { fontSize: font, lines };
    }
  }
  return {
    fontSize: minFont,
    lines: wrapText(text, { maxWidthPx, fontSizePx: minFont, charFactor }),
  };
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
 * Encaja la foto en un cuadrado sin perder el contenido relevante.
 * - Casi cuadrada: cover centrado (recorte mínimo).
 * - Horizontal/vertical: imagen completa (contain) sobre un fondo
 *   difuminado de la misma foto, en lugar de un crop agresivo.
 */
export async function prepareSquareBackground(buffer, size) {
  const oriented = await sharp(buffer, { failOn: "none" }).rotate().toBuffer();
  const meta = await sharp(oriented, { failOn: "none" }).metadata();
  const w = meta.width || size;
  const h = meta.height || size;
  const aspect = w / h;

  // ±18% del cuadrado: un cover centrado apenas recorta
  if (aspect >= 0.82 && aspect <= 1.22) {
    return sharp(oriented, { failOn: "none" })
      .resize(size, size, {
        fit: "cover",
        position: "centre",
        kernel: "lanczos3",
      })
      .toBuffer();
  }

  const blurBg = await sharp(oriented, { failOn: "none" })
    .resize(size, size, {
      fit: "cover",
      position: "attention",
      kernel: "lanczos3",
    })
    .blur(32)
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .toBuffer();

  // Deja un pequeño margen (~3%) para que el sujeto no quede pegado al borde
  const inner = Math.round(size * 0.94);
  const fitted = await sharp(oriented, { failOn: "none" })
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();

  return sharp(blurBg)
    .composite([{ input: fitted, gravity: "centre" }])
    .toBuffer();
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

  const bg = await prepareSquareBackground(backgroundBuffer, size);

  const logoW = Math.round(size * Math.min(0.55, Math.max(0.15, logoWidthRatio)));
  let logoBuffer = null;
  let logoMeta = null;
  const resolvedLogo = logoPath || LOGO_PATH;
  if (existsSync(resolvedLogo)) {
    logoBuffer = await sharp(resolvedLogo).resize({ width: logoW }).png().toBuffer();
    logoMeta = await sharp(logoBuffer).metadata();
  }

  const pad = Math.round(size * 0.055);
  // Objetivo: 34px y 2 líneas. Si el titular es largo, baja la fuente
  // lo mínimo necesario para mantener 2 líneas.
  // Fuente proporcional al tamaño (equivale a 34px máx / 15px mín en 400px).
  const { fontSize: titleFont, lines: titleLines } = fitTitle(title, {
    maxWidthPx: size - pad * 2,
    maxLines: 2,
    minFont: Math.round(size * 0.0375),
    maxFont: Math.round(size * 0.085),
    charFactor: 0.6,
  });
  const titleLineH = Math.round(titleFont * 1.2);

  const socialFont = Math.round(size * 0.036);
  const dateFont = Math.round(size * 0.033);

  const socialY = size - pad - Math.round(size * 0.02);
  const titleBlockBottom = socialY - Math.round(size * 0.07);
  const titleStartY = titleBlockBottom - (titleLines.length - 1) * titleLineH;

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

  const titleCx = Math.round(size / 2);
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
