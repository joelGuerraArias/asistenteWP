/**
 * Banner 1280×300: estado reputacional del director.
 * Neutro se suma a positivo (favorable vs negativo).
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1280;
const H = 300;

export const MENDEZ_PHOTO = join(ROOT, "assets", "mendez.jpg");
export const INTRANT_LOGO = join(ROOT, "assets", "intrant-logo.png");

async function logoOnNavy(path, height = 56) {
  if (!existsSync(path)) return null;
  const buf = await sharp(path, { failOn: "none" })
    .resize({ height, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = buf;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r < 28 && g < 28 && b < 28) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function circlePortrait(path, size = 236) {
  const portrait = await sharp(path, { failOn: "none" })
    .rotate()
    .resize(size, size, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const r = size / 2;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - 3}" fill="white"/></svg>`
  );
  const circled = await sharp(portrait)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  const ring = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="none" stroke="#FDE68A" stroke-width="5"/></svg>`
  );
  return sharp(circled).composite([{ input: ring, blend: "over" }]).png().toBuffer();
}

function escapeXml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function reputMix(stats = {}) {
  const posRaw = Number(stats.bySentiment?.positivo || 0);
  const neu = Number(stats.bySentiment?.neutro || 0);
  const neg = Number(stats.bySentiment?.negativo || 0);
  const favorable = posRaw + neu;
  const total = Number(stats.total || favorable + neg) || 1;
  return {
    total,
    favorable,
    negativo: neg,
    pctFav: Math.round((favorable / total) * 1000) / 10,
    pctNeg: Math.round((neg / total) * 1000) / 10,
    net: Number(stats.net || 0),
  };
}

export async function renderReputBanner({
  stats = {},
  displayDate = "",
  photoPath = MENDEZ_PHOTO,
  logoPath = INTRANT_LOGO,
  counts = {},
} = {}) {
  const mix = reputMix(stats);
  const gmail = counts.gmail ?? stats.byGroup?.prensa ?? 0;
  const ig = counts.instagram ?? 0;
  const yt = counts.youtube ?? 0;
  const radio = counts.radio ?? 0;

  const photo = existsSync(photoPath)
    ? await circlePortrait(photoPath, 236)
    : null;
  const logo = existsSync(logoPath) ? await logoOnNavy(logoPath, 52) : null;

  const barX = 320;
  const barY = 188;
  const barW = 900;
  const barH = 28;
  const wNeg = Math.max(10, Math.round((barW * mix.negativo) / mix.total));
  const wFav = barW - wNeg;
  const netTxt = mix.net >= 0 ? `+${mix.net}` : String(mix.net);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1F3A"/>
      <stop offset="55%" stop-color="#123056"/>
      <stop offset="100%" stop-color="#1B4F6B"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="320" y="38" fill="#93C5FD" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="2.2">INTRANT · ESTADO REPUTACIONAL DEL DIRECTOR</text>
  <text x="320" y="78" fill="#FFFFFF" font-family="Segoe UI,Arial,sans-serif" font-size="32" font-weight="800">Juan Manuel Méndez</text>
  <text x="320" y="104" fill="#CBD5E1" font-family="Segoe UI,Arial,sans-serif" font-size="15">Director Ejecutivo · ${escapeXml(displayDate)} · ${mix.total} menciones</text>

  <rect x="320" y="122" rx="10" ry="10" width="150" height="44" fill="#0F2744"/>
  <text x="395" y="140" text-anchor="middle" fill="#94A3B8" font-size="10" font-family="Segoe UI,Arial" font-weight="700" letter-spacing="1">NETO</text>
  <text x="395" y="158" text-anchor="middle" fill="#FDE68A" font-size="18" font-family="Segoe UI,Arial" font-weight="800">${netTxt}</text>

  <rect x="482" y="122" rx="10" ry="10" width="150" height="44" fill="#0F2744"/>
  <text x="557" y="140" text-anchor="middle" fill="#94A3B8" font-size="10" font-family="Segoe UI,Arial" font-weight="700" letter-spacing="1">FAVORABLE</text>
  <text x="557" y="158" text-anchor="middle" fill="#4ADE80" font-size="18" font-family="Segoe UI,Arial" font-weight="800">${mix.pctFav}%</text>

  <rect x="644" y="122" rx="10" ry="10" width="168" height="44" fill="#0F2744"/>
  <text x="728" y="140" text-anchor="middle" fill="#94A3B8" font-size="10" font-family="Segoe UI,Arial" font-weight="700" letter-spacing="1">PRENSA</text>
  <text x="728" y="158" text-anchor="middle" fill="#FFFFFF" font-size="18" font-family="Segoe UI,Arial" font-weight="800">${gmail}</text>

  <rect x="824" y="122" rx="10" ry="10" width="168" height="44" fill="#0F2744"/>
  <text x="908" y="140" text-anchor="middle" fill="#94A3B8" font-size="10" font-family="Segoe UI,Arial" font-weight="700" letter-spacing="1">INSTAGRAM</text>
  <text x="908" y="158" text-anchor="middle" fill="#FFFFFF" font-size="18" font-family="Segoe UI,Arial" font-weight="800">${ig}</text>

  <rect x="1004" y="122" rx="10" ry="10" width="216" height="44" fill="#0F2744"/>
  <text x="1112" y="140" text-anchor="middle" fill="#94A3B8" font-size="10" font-family="Segoe UI,Arial" font-weight="700" letter-spacing="1">YOUTUBE · RADIO</text>
  <text x="1112" y="158" text-anchor="middle" fill="#FFFFFF" font-size="18" font-family="Segoe UI,Arial" font-weight="800">${yt} · ${radio}</text>

  <text x="${barX}" y="${barY - 8}" fill="#E2E8F0" font-size="12" font-family="Segoe UI,Arial" font-weight="700">Sentimiento (neutro cuenta como positivo)</text>
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="14" fill="#1E3A5F"/>
  <rect x="${barX}" y="${barY}" width="${wFav}" height="${barH}" fill="#16A34A"/>
  <rect x="${barX + wFav}" y="${barY}" width="${wNeg}" height="${barH}" fill="#DC2626"/>
  <text x="${barX}" y="${barY + 52}" fill="#4ADE80" font-size="14" font-family="Segoe UI,Arial" font-weight="700">Positivo ${mix.pctFav}% (${mix.favorable})</text>
  <text x="${barX + 420}" y="${barY + 52}" fill="#F87171" font-size="14" font-family="Segoe UI,Arial" font-weight="700">Negativo ${mix.pctNeg}% (${mix.negativo})</text>
</svg>`;

  const layers = [];
  if (photo) layers.push({ input: photo, left: 32, top: 32 });
  if (logo) {
    const meta = await sharp(logo).metadata();
    layers.push({
      input: logo,
      left: Math.max(320, W - 24 - (meta.width || 180)),
      top: 16,
    });
  }

  return sharp(Buffer.from(svg)).png().composite(layers).png().toBuffer();
}
