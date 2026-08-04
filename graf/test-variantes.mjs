import "../src/config.mjs";
import { writeFileSync } from "node:fs";
import { generateNewsCard, fetchImageBuffer } from "../src/social-card.mjs";

const casos = [
  {
    file: "prueba-1.png",
    img: "https://picsum.photos/id/1015/1200/1200",
    title: "Gobierno anuncia nuevas medidas económicas para el próximo año fiscal",
    tag: "ECONOMÍA",
  },
  {
    file: "prueba-2.png",
    img: "https://picsum.photos/id/1005/1200/1200",
    title: "Selección nacional clasifica a la final tras vencer 3-1",
    tag: "DEPORTES",
  },
  {
    file: "prueba-3.png",
    img: "https://picsum.photos/id/1043/1200/1200",
    title: "Aumentan las temperaturas y emiten alerta por ola de calor en todo el país",
    tag: "CLIMA",
  },
];

console.log("FONTCONFIG_FILE:", process.env.FONTCONFIG_FILE);

for (const c of casos) {
  try {
    const bg = await fetchImageBuffer(c.img);
    const card = await generateNewsCard({
      backgroundBuffer: bg,
      title: c.title,
      tag: c.tag,
    });
    writeFileSync("graf/" + c.file, card);
    console.log("OK", c.file, (card.length / 1024).toFixed(0) + "KB");
  } catch (e) {
    console.log("FALLO", c.file, e.message);
  }
}
