import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BRAND_RED = "#ED1C24";
const LOGO_PATH = join(__dirname, "assets", "logo_fv.png");

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Envuelve texto en líneas según ancho máximo estimado (px). */
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

/**
 * Elige el mayor tamaño de fuente (dentro del rango) que envuelve el titular
 * completo en <= maxLines. Como último recurso, trunca con elipsis.
 */
function fitTitle(text, { maxWidthPx, maxLines, minFont, maxFont, charFactor = 0.54 }) {
  for (let font = maxFont; font >= minFont; font -= 1) {
    const lines = wrapText(text, { maxWidthPx, fontSizePx: font, charFactor });
    if (lines.length <= maxLines) {
      return { fontSize: font, lines };
    }
  }
  const lines = wrapText(text, { maxWidthPx, fontSizePx: minFont, charFactor });
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, "")}…`;
  return { fontSize: minFont, lines: kept };
}

function formatDate(date = new Date()) {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Genera una tarjeta social a partir de una imagen de fondo.
 * @param {object} opts
 * @param {Buffer} opts.backgroundBuffer  imagen de fondo (obligatoria)
 * @param {string} opts.title             titular (lettering)
 * @param {string} opts.tag               etiqueta roja (1-3 palabras)
 * @param {number} [opts.size=400]        lado del cuadrado
 * @param {Date}   [opts.date]            fecha (default hoy)
 * @param {string} [opts.handle]          @usuario
 * @param {string} [opts.site]            sitio web
 * @returns {Promise<Buffer>} PNG
 */
export async function generateNewsCard({
  backgroundBuffer,
  title,
  tag = "",
  size = 400,
  date = new Date(),
  handle = "@fvdigital.do",
  site = "www.fvdigital.do",
}) {
  if (!backgroundBuffer) throw new Error("Falta backgroundBuffer");
  if (!title) throw new Error("Falta el titular");

  // 1) Fondo recortado a cuadrado
  const bg = await sharp(backgroundBuffer)
    .resize(size, size, { fit: "cover", position: "attention" })
    .toBuffer();

  // 2) Logo escalado
  const logoW = Math.round(size * 0.24);
  let logoBuffer = null;
  let logoMeta = null;
  if (existsSync(LOGO_PATH)) {
    logoBuffer = await sharp(LOGO_PATH)
      .resize({ width: logoW })
      .png()
      .toBuffer();
    logoMeta = await sharp(logoBuffer).metadata();
  }

  // 3) Layout de texto (auto-fit del titular)
  const pad = Math.round(size * 0.055);
  const { fontSize: titleFont, lines: titleLines } = fitTitle(title, {
    maxWidthPx: size - pad * 2,
    maxLines: 5,
    minFont: Math.round(size * 0.042),
    maxFont: Math.round(size * 0.07),
  });
  const titleLineH = Math.round(titleFont * 1.2);

  const socialFont = Math.round(size * 0.036);
  const dateFont = Math.round(size * 0.033);
  const tagFont = Math.round(size * 0.04);

  // Posición vertical: bloque de título anclado abajo, dejando espacio para redes
  const socialY = size - pad - Math.round(size * 0.02);
  const titleBlockBottom = socialY - Math.round(size * 0.07);
  const titleStartY = titleBlockBottom - (titleLines.length - 1) * titleLineH;

  // Tag rojo encima del título
  const tagText = (tag || "").toUpperCase().trim();
  const tagPadX = Math.round(tagFont * 0.7);
  const tagPadY = Math.round(tagFont * 0.45);
  const tagCharW = tagFont * 0.62;
  const tagW = Math.round(tagText.length * tagCharW + tagPadX * 2);
  const tagH = Math.round(tagFont + tagPadY * 2);
  const tagY = titleStartY - titleFont - Math.round(size * 0.05);

  // Badge FV circular
  const badgeR = Math.round(size * 0.058);
  const badgeCx = pad + badgeR;
  const badgeCy = pad + badgeR;
  const badgeFont = Math.round(badgeR * 0.85);

  const titleTspans = titleLines
    .map((line, i) => {
      const y = titleStartY + i * titleLineH;
      return `<text x="${pad}" y="${y}" class="title">${escapeXml(line)}</text>`;
    })
    .join("");

  const tagSvg = tagText
    ? `<rect x="${pad}" y="${tagY}" width="${tagW}" height="${tagH}" rx="${Math.round(
        tagH * 0.18
      )}" fill="${BRAND_RED}"/>
       <text x="${pad + tagPadX}" y="${tagY + tagH - tagPadY - Math.round(
        tagFont * 0.12
      )}" class="tag">${escapeXml(tagText)}</text>`
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="45%" stop-color="#000000" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.82"/>
    </linearGradient>
    <style>
      .title { fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:800;
               font-size:${titleFont}px; paint-order:stroke; stroke:#000000;
               stroke-width:${Math.max(2, Math.round(titleFont * 0.09))}px;
               stroke-opacity:0.55; stroke-linejoin:round; }
      .tag   { fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:800;
               font-size:${tagFont}px; letter-spacing:0.5px; }
      .badge { fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:800;
               font-size:${badgeFont}px; text-anchor:middle; }
      .social{ fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:700;
               font-size:${socialFont}px; }
      .date  { fill:#e8e8e8; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif; font-weight:600;
               font-size:${dateFont}px; text-anchor:end; }
    </style>
  </defs>

  <rect x="0" y="0" width="${size}" height="${size}" fill="url(#fade)"/>

  <circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${BRAND_RED}"/>
  <text x="${badgeCx}" y="${badgeCy + badgeFont * 0.35}" class="badge">FV</text>

  ${tagSvg}
  ${titleTspans}

  <text x="${pad}" y="${socialY}" class="social">${escapeXml(handle)}   ${escapeXml(site)}</text>
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
