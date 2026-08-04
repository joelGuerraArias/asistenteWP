import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.mjs";

const HEYGEN_BIN =
  process.env.HEYGEN_CLI_PATH ||
  (process.platform === "win32"
    ? join(process.env.USERPROFILE || "", ".local", "bin", "heygen.exe")
    : "heygen");

function projectExists(dir) {
  return Boolean(dir && existsSync(join(dir, "package.json")));
}

function resolveSpawn(bin) {
  if (bin === "npx") {
    return { bin: "npx", shell: true };
  }
  const isAbsolute = /[\\/]/.test(bin);
  return {
    bin,
    shell: process.platform === "win32" && !isAbsolute,
  };
}

function runProcess(bin, args, { cwd, env = {}, timeoutMs = 600000, onLine } = {}) {
  const { bin: spawnBin, shell } = resolveSpawn(bin);

  return new Promise((resolve, reject) => {
    const child = spawn(spawnBin, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";

    const emitLines = (chunk, isStderr = false) => {
      if (isStderr) stderr += chunk;
      else stdout += chunk;

      if (!onLine) return;
      lineBuffer += chunk;
      const parts = lineBuffer.split(/\r?\n/);
      lineBuffer = parts.pop() || "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s): ${bin} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout?.on("data", (d) => emitLines(d.toString()));
    child.stderr?.on("data", (d) => emitLines(d.toString(), true));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (lineBuffer.trim() && onLine) onLine(lineBuffer.trim());
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${bin} salió con código ${code}: ${(stderr || stdout).slice(0, 400)}`
          )
        );
      }
    });
  });
}

function findNewestMp4(dir, { maxDepth = 3 } = {}) {
  const results = [];

  function walk(current, depth) {
    if (depth > maxDepth || !existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/\.mp4$/i.test(entry.name)) {
        const { mtimeMs, size } = statSync(full);
        results.push({ path: full, mtimeMs, size });
      }
    }
  }

  walk(dir, 0);
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results[0]?.path || null;
}

function parseOutputPath(stdout) {
  const patterns = [
    /(?:output|wrote|saved|rendered)\s*(?:to\s*)?:?\s*["']?([^\s"']+\.mp4)/i,
    /([A-Za-z]:\\[^\s"']+\.mp4)/,
    /(\/[^\s"']+\.mp4)/,
  ];
  for (const pattern of patterns) {
    const match = stdout.match(pattern);
    if (match?.[1] && existsSync(match[1])) return match[1];
  }
  return null;
}

async function getHeyGenVersion() {
  if (!existsSync(HEYGEN_BIN) && HEYGEN_BIN === "heygen") {
    try {
      const { stdout } = await runProcess("heygen", ["--version"], { timeoutMs: 15000 });
      return stdout.trim();
    } catch {
      return null;
    }
  }
  if (!existsSync(HEYGEN_BIN)) return null;
  try {
    const { stdout } = await runProcess(HEYGEN_BIN, ["--version"], { timeoutMs: 15000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function getVideoToolsStatus() {
  const hf = config.video.hyperframes;
  const rm = config.video.remotion;
  const hg = config.video.heygen;

  const heygenVersion = await getHeyGenVersion();

  return {
    hyperframes: {
      enabled: hf.enabled,
      installed: projectExists(hf.dir),
      dir: hf.dir,
      scripts: ["dev", "check", "render"],
    },
    remotion: {
      enabled: rm.enabled,
      installed: projectExists(rm.dir),
      dir: rm.dir,
      scripts: ["dev", "build", "lint"],
    },
    heygen: {
      enabled: hg.enabled,
      installed: Boolean(heygenVersion),
      version: heygenVersion,
      hasApiKey: Boolean(hg.apiKey),
      avatarId: hg.avatarId || null,
      voiceId: hg.voiceId || null,
    },
  };
}

export function formatVideoToolsStatus(status) {
  const lines = ["🎬 Herramientas de video", ""];

  lines.push(
    status.hyperframes.installed
      ? `✅ HyperFrames — ${status.hyperframes.dir}`
      : `❌ HyperFrames — no instalado`
  );
  lines.push(
    status.remotion.installed
      ? `✅ Remotion — ${status.remotion.dir}`
      : `❌ Remotion — no instalado`
  );

  if (status.heygen.installed) {
    lines.push(`✅ HeyGen CLI — ${status.heygen.version || "ok"}`);
    lines.push(
      status.heygen.hasApiKey
        ? "✅ HEYGEN_API_KEY configurada"
        : "⚠️ Falta HEYGEN_API_KEY en .env"
    );
  } else {
    lines.push("❌ HeyGen CLI — no encontrado");
  }

  lines.push("");
  lines.push("Comandos:");
  lines.push("• /heygen [texto] — video presentador (última noticia o texto)");
  lines.push("• /remotion — composiciones Remotion");
  lines.push("• /hyperframes — estado del proyecto HTML");
  lines.push("");
  lines.push("Scripts locales:");
  lines.push("• npm run video:remotion");
  lines.push("• npm run video:hyperframes");

  return lines.join("\n");
}

export async function listRemotionCompositions() {
  const dir = config.video.remotion.dir;
  if (!projectExists(dir)) {
    throw new Error("Proyecto Remotion no encontrado en video/remotion");
  }
  const { stdout } = await runProcess("npx", ["remotion", "compositions"], {
    cwd: dir,
    timeoutMs: 120000,
  });
  return stdout.trim();
}

export async function checkHyperframesProject() {
  const dir = config.video.hyperframes.dir;
  if (!projectExists(dir)) {
    throw new Error("Proyecto HyperFrames no encontrado en video/hyperframes");
  }
  const { stdout } = await runProcess(
    "npx",
    ["--yes", "hyperframes@0.7.17", "lint"],
    { cwd: dir, timeoutMs: 120000 }
  );
  return stdout.trim();
}

function parseHeyGenJson(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Respuesta HeyGen no es JSON válido");
  }
}

function extractHeyGenVideoUrl(payload) {
  const data = payload?.data || payload;
  const candidates = [
    data?.video_url,
    data?.video?.url,
    data?.videos?.[0]?.url,
    data?.videos?.[0]?.video_url,
    data?.share_url,
    data?.url,
  ].filter(Boolean);
  return candidates[0] || null;
}

export async function createHeyGenVideo({
  prompt,
  orientation = "portrait",
  avatarId = "",
  voiceId = "",
  timeoutMs = 1200000,
  onProgress,
} = {}) {
  if (!config.video.heygen.enabled) {
    throw new Error("HeyGen deshabilitado (HEYGEN_VIDEO=false)");
  }
  if (!config.video.heygen.apiKey) {
    throw new Error("Falta HEYGEN_API_KEY en .env");
  }
  if (!prompt?.trim()) {
    throw new Error("Falta el texto/prompt del video");
  }

  const bin = existsSync(HEYGEN_BIN) ? HEYGEN_BIN : "heygen";
  const args = [
    "video-agent",
    "create",
    "--prompt",
    prompt.trim().slice(0, 9000),
    "--mode",
    "generate",
    "--orientation",
    orientation,
    "--wait",
  ];

  const av = avatarId || config.video.heygen.avatarId;
  const vo = voiceId || config.video.heygen.voiceId;
  if (av) args.push("--avatar-id", av);
  if (vo) args.push("--voice-id", vo);

  const { stdout } = await runProcess(bin, args, {
    env: { HEYGEN_API_KEY: config.video.heygen.apiKey },
    timeoutMs,
    onLine: (line) => {
      if (!onProgress) return;
      if (/generat|render|process|wait|queue|complete|video/i.test(line)) {
        onProgress(line.slice(0, 120));
      }
    },
  });

  const json = parseHeyGenJson(stdout);
  const videoUrl = extractHeyGenVideoUrl(json);
  return { json, videoUrl };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function writeHyperframesPrompt(prompt, { dir } = {}) {
  const projectDir = dir || config.video.hyperframes.dir;
  const text = (prompt || "FV Digital").trim();
  const safe = escapeHtml(text);
  const fontSize = text.length > 80 ? 48 : text.length > 40 ? 60 : 72;

  const html = `<!doctype html>
<html lang="es" data-resolution="square">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 1080px;
        height: 1080px;
        overflow: hidden;
        background: #000;
      }
      body { font-family: "Inter", "Segoe UI", sans-serif; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="8"
      data-width="1080"
      data-height="1080"
    >
      <div
        id="title"
        class="clip"
        data-start="0"
        data-duration="8"
        data-track-index="1"
        style="display:flex;align-items:center;justify-content:center;width:1080px;height:1080px;font-size:${fontSize}px;line-height:1.15;color:#fff;font-weight:700;text-align:center;padding:56px;background:linear-gradient(160deg,#07111f 0%,#163a63 55%,#0b1a30 100%);"
      >
        ${safe}
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#title", { opacity: 0, y: 48, duration: 1.2, ease: "power3.out" }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

  writeFileSync(join(projectDir, "index.html"), html, "utf8");
}

export async function renderHyperframesVideo({ prompt = "", onProgress, timeoutMs = 1800000 } = {}) {
  const dir = config.video.hyperframes.dir;
  if (!projectExists(dir)) {
    throw new Error("Proyecto HyperFrames no encontrado en video/hyperframes");
  }

  if (prompt?.trim()) {
    writeHyperframesPrompt(prompt.trim(), { dir });
  }

  const rendersDir = join(dir, "renders");
  if (!existsSync(rendersDir)) mkdirSync(rendersDir, { recursive: true });
  const fileName = `telegram-${Date.now()}.mp4`;
  const outputPath = join(rendersDir, fileName);
  const outputArg = `renders/${fileName}`;

  const { stdout } = await runProcess(
    "npx",
    ["--yes", "hyperframes@0.7.17", "render", "-o", outputArg, "-q", "draft", "-w", "2"],
    {
      cwd: dir,
      timeoutMs,
      onLine: onProgress,
    }
  );

  if (!existsSync(outputPath)) {
    const parsed = parseOutputPath(stdout);
    if (parsed && existsSync(parsed)) {
      return { outputPath: parsed, stdout };
    }
    throw new Error("HyperFrames terminó pero no encontré el archivo .mp4 generado");
  }

  return { outputPath, stdout };
}

export async function renderRemotionVideo({
  composition = "MyComp",
  onProgress,
  timeoutMs = 1800000,
} = {}) {
  const dir = config.video.remotion.dir;
  if (!projectExists(dir)) {
    throw new Error("Proyecto Remotion no encontrado en video/remotion");
  }

  const outDir = join(dir, "out");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, `telegram-${Date.now()}.mp4`);

  await runProcess(
    "npx",
    ["remotion", "render", composition, outputPath, "--log=verbose"],
    {
      cwd: dir,
      timeoutMs,
      onLine: (line) => {
        if (!onProgress) return;
        if (/render|frame|encode|download|bundle|%/i.test(line)) {
          onProgress(line.slice(0, 120));
        }
      },
    }
  );

  if (!existsSync(outputPath)) {
    throw new Error("Remotion terminó pero no se creó el archivo de salida");
  }

  return { outputPath, composition };
}
