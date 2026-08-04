import { existsSync, readFileSync, statSync } from "node:fs";
import { Input } from "telegraf";

const TELEGRAM_VIDEO_MAX = 48 * 1024 * 1024;

function formatElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

function buildProgressText({ tool, label, detail, status, elapsedMs }) {
  const lines = [`🎬 ${tool} — ${label}`];
  if (detail) lines.push(detail);
  lines.push("");
  lines.push(status);
  if (elapsedMs != null) lines.push(`⏱ ${formatElapsed(elapsedMs)}`);
  return lines.join("\n");
}

/**
 * Mensaje persistente mientras se genera un video; al terminar se edita y se envía el archivo.
 */
export async function createVideoJob(ctx, { tool, label, detail = "" }) {
  const startedAt = Date.now();
  let lastStatus = "⏳ Iniciando generación...";

  const initial = buildProgressText({
    tool,
    label,
    detail,
    status: lastStatus,
    elapsedMs: 0,
  });

  const msg = await ctx.reply(initial, { disable_notification: true });
  let showRunningHint = true;

  const refresh = async (status = lastStatus) => {
    lastStatus = status;
    const lines = [`🎬 ${tool} — ${label}`];
    if (detail) lines.push(detail);
    lines.push("");
    lines.push(status);
    if (showRunningHint && !/Completado|listo|❌/i.test(status)) {
      lines.push("");
      lines.push("🔄 Sigue renderizando — el .mp4 se enviará en este chat al terminar (30-90s).");
    }
    lines.push(`⏱ ${formatElapsed(Date.now() - startedAt)}`);
    const text = lines.join("\n");
    await ctx.telegram
      .editMessageText(ctx.chat.id, msg.message_id, undefined, text)
      .catch(() => {});
  };

  const tickTimer = setInterval(() => refresh(), 15000);

  return {
    async update(status) {
      await refresh(status);
    },
    async finish({ ok, message, videoPath, videoUrl }) {
      clearInterval(tickTimer);
      showRunningHint = false;
      const elapsed = formatElapsed(Date.now() - startedAt);
      const finalText = ok
        ? `${message}\n\n⏱ Completado en ${elapsed}`
        : `${message}\n\n⏱ ${elapsed}`;

      await ctx.telegram
        .editMessageText(ctx.chat.id, msg.message_id, undefined, finalText)
        .catch(() => {});

      if (!ok) return;

      let sent = false;

      if (videoPath && existsSync(videoPath)) {
        sent = await sendVideoFile(ctx, videoPath, videoUrl);
      } else if (videoUrl) {
        sent = await sendVideoUrl(ctx, videoUrl);
      }

      if (!sent) {
        await ctx.reply(
          "⚠️ El render terminó pero no pude enviar el video al chat. Revisa los logs del bot.",
          { disable_notification: true }
        );
      }
    },
  };
}

export function createThrottledProgress(onProgress, { minIntervalMs = 2500 } = {}) {
  let lastAt = 0;
  let lastLine = "";

  return (line) => {
    const clean = String(line)
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\r/g, "")
      .trim();
    if (!clean) return;

    const interesting =
      /%\s*\d|Capturing frame|Encoding|Rendered|complete|ffmpeg|muxing|Writing/i.test(clean);
    const now = Date.now();
    if (!interesting && now - lastAt < minIntervalMs && clean === lastLine) return;
    if (!interesting && now - lastAt < minIntervalMs) return;

    lastAt = now;
    lastLine = clean;
    onProgress(clean);
  };
}

async function sendVideoFile(ctx, videoPath, fallbackUrl) {
  const size = statSync(videoPath).size;
  if (size > TELEGRAM_VIDEO_MAX) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    await ctx.reply(
      `📦 Video generado (${mb} MB). Es demasiado grande para enviarlo por Telegram.${
        fallbackUrl ? `\n\nEnlace:\n${fallbackUrl}` : ""
      }`,
      { disable_notification: true }
    );
    return true;
  }

  try {
    const buffer = readFileSync(videoPath);
    await ctx.replyWithVideo(Input.fromBuffer(buffer, "video.mp4"), {
      caption: "✅ Video listo",
      supports_streaming: true,
    });
    return true;
  } catch (error) {
    console.error("sendVideoFile:", error);
    await ctx.reply(
      `✅ Video generado pero Telegram no aceptó el archivo: ${error.message}${
        fallbackUrl ? `\n\nEnlace:\n${fallbackUrl}` : ""
      }`,
      { disable_notification: true }
    );
    return true;
  }
}

async function sendVideoUrl(ctx, videoUrl) {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > TELEGRAM_VIDEO_MAX) {
      await ctx.reply(`✅ Video listo (enlace):\n${videoUrl}`, { disable_notification: true });
      return true;
    }
    await ctx.replyWithVideo(Input.fromBuffer(buffer, "video.mp4"), {
      caption: "✅ Video listo",
      supports_streaming: true,
    });
    return true;
  } catch (error) {
    console.error("sendVideoUrl:", error);
    await ctx.reply(`✅ Video listo (enlace):\n${videoUrl}`, { disable_notification: true });
    return true;
  }
}
