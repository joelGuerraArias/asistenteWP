import "../src/config.mjs";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { generateNewsCard } from "../src/social-card.mjs";

// Fondo de prueba (degradado azul->negro) para ver el texto claramente.
const bg = await sharp({
  create: {
    width: 1200,
    height: 1200,
    channels: 3,
    background: { r: 20, g: 40, b: 80 },
  },
})
  .png()
  .toBuffer();

console.log("FONTCONFIG_FILE:", process.env.FONTCONFIG_FILE);

const card = await generateNewsCard({
  backgroundBuffer: bg,
  title: "Gobierno anuncia nuevas medidas económicas para el próximo año fiscal",
  tag: "ECONOMÍA",
});

writeFileSync("graf/test-montserrat.png", card);
console.log("Tarjeta generada: graf/test-montserrat.png", (card.length / 1024).toFixed(0) + "KB");
