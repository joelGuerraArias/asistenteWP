/**
 * Tarjeta encuesta multi-cara: 2–4 rostros en círculos sobre ALPHA FV,
 * pregunta en el recuadro azul de abajo.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { config } from "./config.mjs";
import { cropImageByPercent } from "./image.mjs";
import { detectCropBox } from "./vision.mjs";
import { ENCUESTAS_ALPHA_PATH } from "./encuesta-alpha-card.mjs";

const PHOTO_TOP = 80 / 450;
const QUESTION_BOX_TOP = 368 / 450;
const QUESTION_BOX_BOTTOM = 421 / 450;

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapTitleLines(text = "") {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length <= 2) return words;
  const joined = words.join(" ");
  if (joined.length > 78) {
    const thirds = Math.ceil(words.length / 3);
    return [
      words.slice(0, thirds).join(" "),
      words.slice(thirds, thirds * 2).join(" "),
      words.slice(thirds * 2).join(" "),
    ].filter(Boolean);
  }
  let best = 1;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const score = Math.abs(a.length - b.length) + Math.max(a.length, b.length) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

function toSquareBox(box) {
  const side = Math.min(box.width, box.height);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  let left = cx - side / 2;
  let top = cy - side / 2;
  left = Math.max(0, Math.min(left, 100 - side));
  top = Math.max(0, Math.min(top, 100 - side));
  // Un poco más de margen alrededor de la cara
  const pad = side * 0.12;
  let w = Math.min(100, side + pad * 2);
  let h = w;
  left = Math.max(0, Math.min(cx - w / 2, 100 - w));
  top = Math.max(0, Math.min(cy - h / 2, 100 - h));
  return { left, top, width: w, height: h };
}

async function circleFromPhoto(photoBuffer, diameter) {
  let cropped;
  try {
    const box = await detectCropBox(
      photoBuffer,
      "image/jpeg",
      "Recorta SOLO el rostro de la persona principal en un cuadrado centrado en la cara (ojos, nariz, boca). Excluye fondo amplio."
    );
    cropped = await cropImageByPercent(photoBuffer, toSquareBox(box));
  } catch {
    cropped = photoBuffer;
  }

  const mask = Buffer.from(
    `<svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="#fff"/>
    </svg>`
  );

  const ring = Buffer.from(
    `<svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2 - 3}"
        fill="none" stroke="#ffffff" stroke-width="6"/>
    </svg>`
  );

  const face = await sharp(cropped, { failOn: "none" })
    .rotate()
    .resize(diameter, diameter, {
      fit: "cover",
      position: "attention",
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();

  return sharp(face)
    .composite([
      { input: mask, blend: "dest-in" },
      { input: ring, blend: "over" },
    ])
    .png()
    .toBuffer();
}

/** Posiciones centradas para N círculos en el área útil. */
function layoutCircles(n, size, areaTop, areaBottom) {
  const areaH = areaBottom - areaTop;
  const areaMidY = areaTop + areaH / 2;
  const padX = Math.round(size * 0.06);
  const usableW = size - padX * 2;

  if (n === 2) {
    const d = Math.round(Math.min(size * 0.38, areaH * 0.78));
    const gap = Math.round(size * 0.06);
    const total = d * 2 + gap;
    const startX = Math.round((size - total) / 2);
    const y = Math.round(areaMidY - d / 2);
    return [
      { x: startX, y, d },
      { x: startX + d + gap, y, d },
    ];
  }

  if (n === 3) {
    const d = Math.round(Math.min(size * 0.28, areaH * 0.7));
    const gap = Math.round(size * 0.04);
    const total = d * 3 + gap * 2;
    const startX = Math.round((size - total) / 2);
    const y = Math.round(areaMidY - d / 2);
    return [0, 1, 2].map((i) => ({ x: startX + i * (d + gap), y, d }));
  }

  // 4 → 2×2
  const d = Math.round(Math.min(usableW / 2 - size * 0.03, areaH / 2 - size * 0.02));
  const gapX = Math.round(size * 0.05);
  const gapY = Math.round(size * 0.04);
  const totalW = d * 2 + gapX;
  const totalH = d * 2 + gapY;
  const startX = Math.round((size - totalW) / 2);
  const startY = Math.round(areaMidY - totalH / 2);
  return [
    { x: startX, y: startY, d },
    { x: startX + d + gapX, y: startY, d },
    { x: startX, y: startY + d + gapY, d },
    { x: startX + d + gapX, y: startY + d + gapY, d },
  ];
}

/**
 * @param {object} params
 * @param {Buffer[]} params.photoBuffers  2–4 fotos
 * @param {string} params.title
 * @param {number} [params.size]
 * @param {string} [params.alphaPath]
 */
export async function generateEncuestaDobleCard({
  photoBuffers = [],
  title,
  size = config.socialCard?.size || 1080,
  alphaPath = ENCUESTAS_ALPHA_PATH,
} = {}) {
  const photos = (photoBuffers || []).filter(
    (b) => Buffer.isBuffer(b) && b.length > 100
  );
  if (photos.length < 2 || photos.length > 4) {
    throw new Error("La encuesta doble necesita entre 2 y 4 fotos.");
  }
  if (!existsSync(alphaPath)) {
    throw new Error(`No existe el ALPHA de encuestas: ${alphaPath}`);
  }

  const areaTop = Math.round(size * PHOTO_TOP);
  const boxTop = Math.round(size * QUESTION_BOX_TOP);
  const boxBottom = Math.round(size * QUESTION_BOX_BOTTOM);
  const boxMid = Math.round((boxTop + boxBottom) / 2);
  const slots = layoutCircles(photos.length, size, areaTop, boxTop);

  const circles = [];
  for (let i = 0; i < photos.length; i++) {
    const circ = await circleFromPhoto(photos[i], slots[i].d);
    circles.push({ input: circ, left: slots[i].x, top: slots[i].y });
  }

  const alpha = await sharp(alphaPath, { failOn: "none" })
    .resize(size, size, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const titleLines = wrapTitleLines(title);
  const longest = Math.max(...titleLines.map((l) => l.length), 1);
  const nLines = titleLines.length;
  const titleFont = Math.round(
    size *
      (nLines >= 3
        ? longest > 36
          ? 0.022
          : 0.024
        : longest > 48
          ? 0.026
          : longest > 36
            ? 0.029
            : 0.032)
  );
  const titleLineH = Math.round(titleFont * 1.22);
  const titleBlockH = nLines * titleLineH;
  const titleStartY =
    boxMid - Math.round(titleBlockH / 2) + Math.round(titleFont * 0.82);

  const titleTspans = titleLines
    .map((line, i) => {
      const y = titleStartY + i * titleLineH;
      return `<tspan x="${size / 2}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  let vsSvg = "";
  if (photos.length === 2) {
    const a = slots[0];
    const b = slots[1];
    const cx = Math.round((a.x + a.d + b.x) / 2);
    const cy = Math.round(a.y + a.d / 2 + titleFont * 0.15);
    const vsFont = Math.round(size * 0.045);
    vsSvg = `<text x="${cx}" y="${cy}" text-anchor="middle"
      fill="#ffffff" font-family="Montserrat,Segoe UI,Arial,sans-serif"
      font-weight="900" font-size="${vsFont}px"
      stroke="#0a143c" stroke-width="4" paint-order="stroke">VS</text>`;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .title { fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif;
               font-weight:800; font-size:${titleFont}px; text-anchor:middle; }
    </style>
  </defs>
  ${vsSvg}
  ${titleTspans ? `<text class="title">${titleTspans}</text>` : ""}
</svg>`;

  const base = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 5, g: 10, b: 30 },
    },
  })
    .composite(circles)
    .png()
    .toBuffer();

  return sharp(base)
    .composite([
      { input: alpha, left: 0, top: 0 },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .sharpen({ sigma: 0.6, m1: 0.85, m2: 0.35 })
    .png()
    .toBuffer();
}
