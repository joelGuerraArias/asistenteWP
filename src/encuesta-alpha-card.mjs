/**
 * Tarjeta de encuesta temática: foto debajo del ALPHA FV Digital.
 * Pregunta centrada en el recuadro azul de abajo. Sin opciones en el gráfico.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ENCUESTAS_ALPHA_PATH = join(__dirname, "..", "assets", "encuestas-alpha.png");

/** Proporciones medidas sobre el PNG ALPHA 450×450. */
const ALPHA_SIZE = 450;
const PHOTO_TOP = 80 / ALPHA_SIZE;
const QUESTION_BOX_TOP = 368 / ALPHA_SIZE;
const QUESTION_BOX_BOTTOM = 421 / ALPHA_SIZE;

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Titular de encuesta: 2 líneas equilibradas; 3 si es muy largo. */
function wrapTitleLines(text = "") {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length === 1) return words;
  if (words.length === 2) return [words[0], words[1]];

  const joined = words.join(" ");
  if (joined.length > 78) {
    const thirds = Math.ceil(words.length / 3);
    const a = words.slice(0, thirds).join(" ");
    const b = words.slice(thirds, thirds * 2).join(" ");
    const c = words.slice(thirds * 2).join(" ");
    return [a, b, c].filter(Boolean);
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

/**
 * Suaviza la viñeta azul del ALPHA para que la foto se vea más nítida,
 * manteniendo opacos: cabecera blanca, recuadro de pregunta y franja roja.
 */
async function softenAlphaOverlay(alphaBuf, size) {
  const { data, info } = await sharp(alphaBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const photoTop = Math.round(size * PHOTO_TOP);
  const boxTop = Math.round(size * QUESTION_BOX_TOP);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      if (y < photoTop || y >= boxTop) continue;
      data[i + 3] = Math.round(a * 0.42);
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * @param {object} params
 * @param {Buffer} params.photoBuffer
 * @param {string} params.title
 * @param {number} [params.size]
 * @param {string} [params.alphaPath]
 * @returns {Promise<Buffer>} PNG
 */
export async function generateEncuestaAlphaCard({
  photoBuffer,
  title,
  size = config.socialCard?.size || 1080,
  alphaPath = ENCUESTAS_ALPHA_PATH,
} = {}) {
  if (!Buffer.isBuffer(photoBuffer) || photoBuffer.length < 100) {
    throw new Error("Falta foto para la tarjeta ALPHA de encuesta.");
  }
  if (!existsSync(alphaPath)) {
    throw new Error(`No existe el ALPHA de encuestas: ${alphaPath}`);
  }

  const photoTop = Math.round(size * PHOTO_TOP);
  const boxTop = Math.round(size * QUESTION_BOX_TOP);
  const boxBottom = Math.round(size * QUESTION_BOX_BOTTOM);
  const photoH = Math.max(1, boxTop - photoTop);
  const boxMid = Math.round((boxTop + boxBottom) / 2);

  const oriented = await sharp(photoBuffer, { failOn: "none" }).rotate().toBuffer();
  const photo = await sharp(oriented, { failOn: "none" })
    .resize(size, photoH, {
      fit: "cover",
      position: "north",
      kernel: "lanczos3",
    })
    .sharpen({ sigma: 1.05, m1: 1.1, m2: 0.55 })
    .png()
    .toBuffer();

  const alphaRaw = await sharp(alphaPath, { failOn: "none" })
    .resize(size, size, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const alpha = await softenAlphaOverlay(alphaRaw, size);

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

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .title { fill:#ffffff; font-family:'Montserrat','Segoe UI','DejaVu Sans','Arial',sans-serif;
               font-weight:800; font-size:${titleFont}px; text-anchor:middle; }
    </style>
  </defs>
  ${titleTspans ? `<text class="title">${titleTspans}</text>` : ""}
</svg>`;

  const base = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 10, g: 20, b: 60 },
    },
  })
    .composite([{ input: photo, left: 0, top: photoTop }])
    .png()
    .toBuffer();

  return sharp(base)
    .composite([
      { input: alpha, left: 0, top: 0 },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .sharpen({ sigma: 0.7, m1: 0.9, m2: 0.4 })
    .png()
    .toBuffer();
}
