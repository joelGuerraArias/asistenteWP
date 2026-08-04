import "../src/config.mjs";
import { writeFileSync } from "node:fs";
import { generateNewsCard, fetchImageBuffer } from "../src/social-card.mjs";
import { composeCardHeadline } from "../src/deepseek.mjs";

const casos = [
  {
    file: "head-1.png",
    img: "https://picsum.photos/id/1015/1200/1200",
    title:
      "Marcos Yaroide responde a comentarios de Nuria Piera y anuncia acciones legales para proteger su ministerio",
    body: "El cantante cristiano reaccionó a las declaraciones de la periodista y dijo que tomará medidas legales junto a su esposa.",
  },
  {
    file: "head-2.png",
    img: "https://picsum.photos/id/1043/1200/1200",
    title:
      "Aumentan las temperaturas y las autoridades emiten una alerta por ola de calor en todo el país durante el fin de semana",
    body: "El organismo meteorológico pidió a la población mantenerse hidratada y evitar exposición al sol.",
  },
  {
    file: "head-3.png",
    img: "https://picsum.photos/id/1005/1200/1200",
    title: "Selección nacional clasifica a la final",
    body: "El equipo venció 3-1 y jugará por el título.",
  },
];

for (const c of casos) {
  const headline = await composeCardHeadline(c.title, c.body);
  console.log("\nORIGINAL:", c.title);
  console.log("TARJETA :", headline, `(${headline.length} chars)`);
  const bg = await fetchImageBuffer(c.img);
  const card = await generateNewsCard({ backgroundBuffer: bg, title: headline });
  writeFileSync("graf/" + c.file, card);
  console.log("OK", c.file);
}
