import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { config } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SIZE = 1080;
const TMP_BASE = join(tmpdir(), "asistente-wp-termometro");

function ensureTmp() {
  if (!existsSync(TMP_BASE)) mkdirSync(TMP_BASE, { recursive: true });
}

function tmpDir() {
  ensureTmp();
  const dir = join(TMP_BASE, randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function rmDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failure
  }
}

function getFfmpegPath() {
  return config.trad?.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
}

/**
 * Elimina el fondo de una imagen usando rembg via Python.
 * Requiere que rembg esté instalado: pip install rembg[cpu]
 * Devuelve un buffer PNG con transparencia.
 */
export async function removeImageBackground(buffer) {
  const { execFile } = await import("node:child_process");
  const inputPath = join(TMP_BASE, `${randomUUID()}-input.png`);
  const outputPath = join(TMP_BASE, `${randomUUID()}-output.png`);
  ensureTmp();
  writeFileSync(inputPath, buffer);

  await new Promise((resolve, reject) => {
    const child = execFile("rembg", ["i", inputPath, outputPath], {
      windowsHide: true,
      timeout: 120000,
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`rembg salió con código ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve();
    });
  });

  const out = readFileSync(outputPath);
  try { rmSync(inputPath); } catch {}
  try { rmSync(outputPath); } catch {}
  return out;
}

/**
 * Recorta la figura humana eliminando el mayor margen transparente posible,
 * luego escala para encajar en el hueco del frame base (zona derecha).
 */
async function prepareFigureForFrame(buffer) {
  const trimmed = await sharp(buffer, { failOn: "none" })
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 10,
    })
    .toBuffer();

  const meta = await sharp(trimmed).metadata();
  const aspect = (meta.width || 1) / (meta.height || 1);

  // El hueco del frame base es aproximadamente 540x1080 en la mitad derecha.
  // La figura debe verse completa, no tapar el termómetro y llegar hasta abajo.
  let targetWidth = Math.round(SIZE * 0.44);
  let targetHeight = Math.round(targetWidth / aspect);
  if (targetHeight > SIZE * 0.92) {
    targetHeight = Math.round(SIZE * 0.92);
    targetWidth = Math.round(targetHeight * aspect);
  }

  return sharp(trimmed)
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: "fill",
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();
}

/**
 * Renderiza un frame compuesto:
 * - fondo: frame base
 * - figura: funcionario recortado, posicionado a la derecha
 * - texto: pregunta parcial o completa con efecto máquina de escribir
 */
async function renderFrame({ frameBuffer, figureBuffer, text, textProgress }) {
  const question = text.slice(0, textProgress);

  const frameMeta = await sharp(frameBuffer).metadata();
  const frameW = frameMeta.width || SIZE;
  const frameH = frameMeta.height || SIZE;

  const svgWidth = frameW;
  const svgHeight = frameH;
  // En el ejemplo el texto es prominente pero no enorme; ajustado para 1080px.
  const fontSize = Math.round(frameW * 0.046);
  const maxTextWidth = frameW * 0.54;
  const lineHeight = fontSize * 1.2;
  const marginLeft = Math.round(frameW * 0.045);
  const marginBottom = Math.round(frameH * 0.045);

  // Envuelve el texto en líneas.
  const words = question.split(" ");
  const lines = [];
  let current = "";
  const maxCharsPerLine = Math.floor(maxTextWidth / (fontSize * 0.52));
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const totalTextHeight = lines.length * lineHeight;
  const startY = svgHeight - marginBottom - totalTextHeight + lineHeight * 0.8;

  const textEls = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      // Sombra sutil para legibilidad.
      return `
        <text x="${marginLeft + 3}" y="${y + 3}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#000000" opacity="0.35">${escapeXml(line)}</text>
        <text x="${marginLeft}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>
      `;
    })
    .join("");

  const svg = `
    <svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      ${textEls}
    </svg>
  `;

  const figureMeta = await sharp(figureBuffer).metadata();
  const figureWidth = figureMeta.width || Math.round(frameW * 0.46);
  const figureHeight = figureMeta.height || frameH;

  // Asegurar que la figura no exceda las dimensiones del frame.
  const safeFigureWidth = Math.min(figureWidth, frameW);
  const safeFigureHeight = Math.min(figureHeight, frameH);
  // Pegada a la derecha y al fondo, con un pequeño margen derecho.
  let figureLeft = frameW - safeFigureWidth - Math.round(frameW * 0.01);
  let figureTop = frameH - safeFigureHeight;
  figureLeft = Math.max(0, Math.min(figureLeft, frameW - safeFigureWidth));
  figureTop = Math.max(0, Math.min(figureTop, frameH - safeFigureHeight));

  // Redimensionar la figura al tamaño seguro, por si acaso.
  const safeFigureBuffer = await sharp(figureBuffer)
    .resize(safeFigureWidth, safeFigureHeight, { fit: "fill" })
    .png()
    .toBuffer();

  // Redimensionar SVG al tamaño del frame para evitar desajustes.
  const svgBuffer = await sharp(Buffer.from(svg), { density: 72 })
    .resize(frameW, frameH, { fit: "fill" })
    .png()
    .toBuffer();

  return sharp(frameBuffer)
    .resize(frameW, frameH, { fit: "fill" })
    .composite([
      {
        input: safeFigureBuffer,
        left: figureLeft,
        top: figureTop,
      },
      {
        input: svgBuffer,
        left: 0,
        top: 0,
      },
    ])
    .toColorspace("srgb")
    .png({ compressionLevel: 6 })
    .toBuffer();
}

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Genera el video Termómetro completo.
 * @returns {Promise<string>} ruta del MP4 generado.
 */
export async function generateTermometroVideo({
  name,
  institution,
  photoBuffer,
  onProgress,
} = {}) {
  if (!name || !institution || !photoBuffer) {
    throw new Error("Faltan nombre, institución o foto");
  }

  const framePath = config.termometro?.framePath || join(config.root, "assets", "termometro-frame.png");
  if (!existsSync(framePath)) {
    throw new Error(`Frame base no encontrado: ${framePath}`);
  }

  const rawFrameBuffer = readFileSync(framePath);
  // Asegurar que el frame base sea 1080x1080 para el video final 1:1.
  const frameBuffer = await sharp(rawFrameBuffer, { failOn: "none" })
    .resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" })
    .toBuffer();

  const duration = config.termometro?.durationSeconds || 30;
  const fps = config.termometro?.fps || 30;
  const typewriterStart = config.termometro?.typewriterStartSeconds || 3;
  const typewriterDuration = config.termometro?.typewriterDurationSeconds || 4;
  const totalFrames = duration * fps;
  const typewriterStartFrame = Math.round(typewriterStart * fps);
  const typewriterEndFrame = Math.round((typewriterStart + typewriterDuration) * fps);

  const text = `¿Cómo lo ha hecho ${name} en ${institution}?`;

  if (onProgress) onProgress("Quitando fondo a la foto…");
  const noBgBuffer = await removeImageBackground(photoBuffer);

  if (onProgress) onProgress("Recortando figura…");
  const figureBuffer = await prepareFigureForFrame(noBgBuffer);

  const workDir = tmpDir();
  const framesDir = join(workDir, "frames");
  mkdirSync(framesDir, { recursive: true });

  if (onProgress) onProgress("Generando frames…");
  const textLength = text.length;

  for (let i = 0; i < totalFrames; i += 1) {
    let textProgress = 0;
    if (i >= typewriterEndFrame) {
      textProgress = textLength;
    } else if (i >= typewriterStartFrame) {
      const progress = (i - typewriterStartFrame) / (typewriterEndFrame - typewriterStartFrame);
      textProgress = Math.max(1, Math.ceil(progress * textLength));
    }

    const frame = await renderFrame({
      frameBuffer,
      figureBuffer,
      text,
      textProgress,
    });

    const frameNumber = String(i + 1).padStart(5, "0");
    writeFileSync(join(framesDir, `frame-${frameNumber}.png`), frame);

    if (onProgress && i % 30 === 0) {
      onProgress(`Frame ${i + 1}/${totalFrames}`);
    }
  }

  // Guardar solo el frame final como PNG (sin generar video).
  const outputPath = join(workDir, "termometro.png");
  const finalFrame = await renderFrame({
    frameBuffer,
    figureBuffer,
    text,
    textProgress: text.length,
  });
  writeFileSync(outputPath, finalFrame);

  // Borramos frames intermedios.
  rmDir(framesDir);

  return { outputPath, workDir };
}

/**
 * Limpia la carpeta temporal generada para el video.
 */
export function cleanupTermometroWorkDir(workDir) {
  if (workDir) rmDir(workDir);
}
