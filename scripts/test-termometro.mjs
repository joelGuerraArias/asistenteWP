import { readFileSync } from "node:fs";
import { generateTermometroVideo, cleanupTermometroWorkDir } from "../src/termometro-video.mjs";

const name = process.argv[2] || "Guido Gómez Mazara";
const institution = process.argv[3] || "Indotel";
const photoPath = process.argv[4] || "assets/termometro-frame.png";

(async () => {
  try {
    console.log(`Generando video Termómetro: ${name} en ${institution}`);
    const photoBuffer = readFileSync(photoPath);
    const { outputPath, workDir } = await generateTermometroVideo({
      name,
      institution,
      photoBuffer,
      onProgress: (msg) => console.log(`⏳ ${msg}`),
    });
    console.log("✅ Video generado:", outputPath);
    // Limpieza opcional: comenta la siguiente línea si quieres revisar la carpeta temporal
    // cleanupTermometroWorkDir(workDir);
  } catch (error) {
    console.error("❌", error.message);
    process.exit(1);
  }
})();
