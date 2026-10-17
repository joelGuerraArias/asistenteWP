import { createServer } from "node:http";

export function startHttpServer({ port, getStatus, onRequest } = {}) {
  const startedAt = Date.now();

  const server = createServer(async (req, res) => {
    const path = (req.url || "/").split("?")[0];

    if (path === "/" || path === "/health") {
      const extra = getStatus?.() || {};
      const payload = {
        ok: extra.ok !== false,
        service: "asistente-wp-jarvis",
        port,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        ...extra,
      };
      const code = payload.ok ? 200 : 503;
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (typeof onRequest === "function") {
      try {
        const handled = await onRequest(req, res, path);
        if (handled) return;
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: error.message }));
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
