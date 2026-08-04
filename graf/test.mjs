import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateNewsCard } from "./card.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const bg = readFileSync(join(__dirname, "assets", "ejemplo.png"));

const out = await generateNewsCard({
  backgroundBuffer: bg,
  title:
    "Omar Fernández critica rapidez para aumentar impuestos y lentitud para aliviar la carga tributaria",
  tag: "Impuestos",
  size: 400,
});

const outPath = join(__dirname, "salida-400.png");
writeFileSync(outPath, out);
console.log("OK ->", outPath);
