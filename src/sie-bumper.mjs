/**
 * Bumper SIE: rotación sin repetir hasta agotar, luego reinicia.
 * Concatena un .mp4 de la carpeta sie al final del video principal (solo FV).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { config } from "./config.mjs";

function resolveFfmpeg() {
  const fromEnv = String(
    config.sieBumper?.ffmpegPath ||
      config.trad?.ffmpegPath ||
      config.ndigital?.ffmpegPath ||
      ""
  ).trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    process.env.FFMPEG_PATH,
    "C:\\Users\\Joel Guerra\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe",
    "ffmpeg",
    "ffmpeg.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (p === "ffmpeg" || p === "ffmpeg.exe") return p;
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

function runCmd(bin, args, { timeoutMs = 420_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`No pude ejecutar ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || `${bin} exit ${code}`).trim().slice(-600)));
        return;
      }
      resolve({ stderr });
    });
  });
}

function statePath() {
  return (
    config.sieBumper?.statePath ||
    join(config.root, ".sie-rotation.json")
  );
}

function sieDir() {
  return String(
    config.sieBumper?.dir ||
      "C:\\Users\\Joel Guerra\\Desktop\\VideoCreator\\sie"
  ).trim();
}

export function listSieVideos(dir = sieDir()) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.mp4$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
    .map((f) => join(dir, f));
}

function loadState() {
  const path = statePath();
  if (!existsSync(path)) return { used: [] };
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return { used: Array.isArray(data.used) ? data.used.map(String) : [] };
  } catch {
    return { used: [] };
  }
}

function saveState(state) {
  writeFileSync(
    statePath(),
    JSON.stringify({ used: state.used || [], updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

/**
 * Elige el siguiente bumper no usado. Al agotar la lista, reinicia el ciclo.
 * No marca como usado hasta markSieUsed().
 */
export function pickNextSieVideo(dir = sieDir()) {
  const all = listSieVideos(dir);
  if (!all.length) {
    throw new Error(
      `No hay videos .mp4 en la carpeta SIE:\n${dir || "(vacía)"}`
    );
  }
  const names = all.map((p) => basename(p));
  let state = loadState();
  let unused = all.filter((p) => !state.used.includes(basename(p)));
  if (!unused.length) {
    state = { used: [] };
    saveState(state);
    unused = all;
  }
  const chosen = unused[0];
  return {
    path: chosen,
    name: basename(chosen),
    remainingAfter: unused.length - 1,
    total: names.length,
    cycleReset: state.used.length === 0 && unused.length === all.length,
  };
}

export function markSieUsed(fileName) {
  const name = basename(String(fileName || ""));
  if (!name) return;
  const state = loadState();
  if (!state.used.includes(name)) {
    state.used.push(name);
    saveState(state);
  }
}

export function sieBumperAvailable() {
  if (config.sieBumper?.enabled === false) return false;
  return listSieVideos().length > 0;
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No pude descargar el video (${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
  return buf.length;
}

/**
 * Normaliza un clip a 1080x1920 / h264 / aac para poder concatenar.
 */
async function normalizeClip(inPath, outPath, { width = 1080, height = 1920 } = {}) {
  await runCmd(resolveFfmpeg(), [
    "-y",
    "-i",
    inPath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-ar",
    "44100",
    "-movflags",
    "+faststart",
    outPath,
  ]);
}

/**
 * Concatena main (path local o URL) + siePath → buffer mp4.
 */
export async function concatVideoWithSie({
  mainUrl,
  mainPath,
  siePath,
  onStatus,
} = {}) {
  if (!siePath || !existsSync(siePath)) {
    throw new Error(`Bumper SIE no encontrado: ${siePath || "(vacío)"}`);
  }
  const workDir = await mkdtemp(join(tmpdir(), "asistente-sie-"));
  const mainIn = join(workDir, "main-in.mp4");
  const sieIn = join(workDir, "sie-in.mp4");
  const mainN = join(workDir, "main-n.mp4");
  const sieN = join(workDir, "sie-n.mp4");
  const listPath = join(workDir, "list.txt");
  const outPath = join(workDir, "out.mp4");

  try {
    if (mainPath && existsSync(mainPath)) {
      await writeFile(mainIn, await readFile(mainPath));
    } else if (mainUrl) {
      onStatus?.("⬇️ Descargando video principal…");
      await downloadToFile(mainUrl, mainIn);
    } else {
      throw new Error("Falta video principal (URL o path) para concatenar SIE.");
    }

    // Copia bumper a workDir (ruta con espacios/acentos más segura)
    await writeFile(sieIn, await readFile(siePath));

    onStatus?.("🎞 Normalizando clips para concatenar…");
    await normalizeClip(mainIn, mainN);
    await normalizeClip(sieIn, sieN);

    const listBody = "file 'main-n.mp4'\nfile 'sie-n.mp4'\n";
    await writeFile(listPath, listBody, "utf8");

    onStatus?.("🔗 Concatenando bumper SIE al final…");
    await new Promise((resolve, reject) => {
      const bin = resolveFfmpeg();
      const args = [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "out.mp4",
      ];
      const child = spawn(bin, args, {
        cwd: workDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("ffmpeg concat timeout"));
      }, 420_000);
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error((stderr || `ffmpeg exit ${code}`).trim().slice(-600)));
          return;
        }
        resolve();
      });
    });

    if (!existsSync(outPath)) {
      throw new Error("ffmpeg no generó el video concatenado.");
    }
    const buffer = await readFile(outPath);
    return {
      buffer,
      bytes: buffer.length,
      contentType: "video/mp4",
      workDir,
      outPath,
    };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export async function discardSieWork(result) {
  if (result?.workDir) {
    await rm(result.workDir, { recursive: true, force: true }).catch(() => {});
  }
}
