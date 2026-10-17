import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, readFile as readFileP, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { transcribeAudio } from "../src/audio.mjs";
import { publicR2Url } from "../src/r2.mjs";
import {
  VIDEO_ARCHIVE_DIR,
  archiveProducedVideo,
  rememberArchivedUrl,
  encodeMp4ForX,
} from "../src/video-archive.mjs";

function ffmpegClip(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "ffmpeg",
      ["-y", "-i", input, "-t", "12", "-vn", "-ac", "1", "-ar", "16000", output],
      { stdio: "ignore" }
    );
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))
    );
  });
}

async function captionFromBuffer(buf) {
  const dir = await mkdtemp(join(tmpdir(), "vidcap-"));
  const mp4 = join(dir, "in.mp4");
  const wav = join(dir, "a.wav");
  try {
    await writeFile(mp4, buf);
    await ffmpegClip(mp4, wav);
    const wavBuf = await readFileP(wav);
    const text = await transcribeAudio(wavBuf, "wav");
    return String(text || "").trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const KEYS = [
  "videos/fv-20261007-202311.mp4",
  "videos/fv-20261007-172603.mp4",
  "videos/fv-20261007-171255.mp4",
  "videos/fv-20261007-165852.mp4",
  "videos/fv-20261007-150702.mp4",
];

function hintFromKey(key) {
  const m = String(key).match(/(\d{8}-\d{6})/);
  return m ? m[1] : "";
}

if (process.argv.includes("--reencode-folder")) {
  const files = readdirSync(VIDEO_ARCHIVE_DIR).filter((f) => f.endsWith(".mp4"));
  for (const name of files) {
    const path = join(VIDEO_ARCHIVE_DIR, name);
    console.log("recodificando", name);
    const buf = await readFile(path);
    const out = await encodeMp4ForX(buf);
    await writeFile(path, out);
    console.log("ok", name, out.length);
  }
  process.exit(0);
}

for (const key of KEYS) {
  const url = publicR2Url(key);
  console.log("bajando", key);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("falló", key, res.status);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let caption = "";
  try {
    caption = await captionFromBuffer(buf);
    console.log("stt:", caption.slice(0, 90));
  } catch (err) {
    console.warn("sin transcripción:", err.message);
    caption = `Video redes FV\n${url}`;
  }
  const saved = await archiveProducedVideo({
    buffer: buf,
    caption,
    ext: ".mp4",
    nameHint: hintFromKey(key),
  });
  rememberArchivedUrl(url);
  console.log("ok", saved.base);
}
