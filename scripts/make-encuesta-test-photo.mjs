import sharp from "sharp";
import { writeFileSync } from "node:fs";

const svg = `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#16213e"/>
  </linearGradient></defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <text x="540" y="540" fill="#ffffff" font-size="48" text-anchor="middle" font-family="Arial">Guido Gomez Mazara</text>
  <text x="540" y="610" fill="#aaaaaa" font-size="28" text-anchor="middle" font-family="Arial">foto prueba encuestas</text>
</svg>`;

const buf = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync("encuestas/guido-gomez-mazara.png", buf);
console.log("OK", buf.length);
