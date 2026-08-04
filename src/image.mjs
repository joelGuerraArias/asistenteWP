import sharp from "sharp";

const MIN_WIDTH = 1200;
const JPEG_QUALITY = 88;
const OCR_MAX_WIDTH = 1400;
const OCR_JPEG_QUALITY = 82;

export async function prepareImageForOcr(buffer) {
  let image = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await image.metadata();

  if (!meta.width || !meta.height) {
    throw new Error("La imagen no es válida o está corrupta");
  }

  if (meta.width > OCR_MAX_WIDTH) {
    image = image.resize({ width: OCR_MAX_WIDTH, withoutEnlargement: true });
  }

  const output = await image
    .jpeg({ quality: OCR_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return { buffer: output, mimeType: "image/jpeg" };
}

export async function prepareImageForWordPress(buffer, filename = "image.jpg") {
  let image = sharp(buffer, { failOn: "none" }).rotate();

  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new Error("La imagen no es válida o está corrupta");
  }

  if (meta.width < MIN_WIDTH) {
    image = image.resize({ width: MIN_WIDTH, withoutEnlargement: false });
  }

  const output = await image.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();

  const baseName = filename.replace(/\.[^.]+$/, "") || "image";
  return {
    buffer: output,
    mimeType: "image/jpeg",
    filename: `${baseName}.jpg`,
  };
}

export async function cropImageByPercent(buffer, box) {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;

  const left = Math.round((box.left / 100) * w);
  const top = Math.round((box.top / 100) * h);
  const width = Math.round((box.width / 100) * w);
  const height = Math.round((box.height / 100) * h);

  const safeWidth = Math.min(width, w - left);
  const safeHeight = Math.min(height, h - top);

  return sharp(buffer)
    .extract({
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.max(1, safeWidth),
      height: Math.max(1, safeHeight),
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export function mimeFromBuffer(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[8] === 0x57 && buffer[9] === 0x45) return "image/webp";
  return "image/jpeg";
}
