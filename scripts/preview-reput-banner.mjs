import { writeFileSync } from "node:fs";
import { renderReputBanner } from "../src/reput-banner.mjs";

const stats = {
  total: 46,
  net: -1,
  bySentiment: { positivo: 1, neutro: 43, negativo: 2 },
  byGroup: { prensa: 12, redes: 21, video: 10, broadcast: 3 },
};
const buf = await renderReputBanner({
  stats,
  displayDate: "viernes, 2 de octubre de 2026",
  counts: { gmail: 12, instagram: 21, youtube: 10, radio: 3 },
});
writeFileSync("muestra-reputacion-1280x300.png", buf);
console.log("ok", buf.length);
