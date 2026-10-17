import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../src/config.mjs";
import {
  rebuildGraphicsFeeds,
  formatGraphicsFeedHelp,
} from "../src/graphics-feed.mjs";

if (process.argv.includes("--reset")) {
  writeFileSync(
    join(config.root, ".graphics-feed.json"),
    JSON.stringify({ fvdigital: [], f1rd: [] }, null, 2),
    "utf8"
  );
  console.log("Feed vacío: solo gráficos nuevos a partir de ahora.");
}

const urls = await rebuildGraphicsFeeds();
console.log(formatGraphicsFeedHelp());
console.log("\nPublicados:", urls);
