import { createServer } from "node:http";

export function startHttpServer({ port, getStatus }) {
  const startedAt = Date.now();

  const server = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];

    if (path === "/" || path === "/health") {
      const payload = {
        ok: true,
        service: "asistente-wp-jarvis",
        port,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        ...(getStatus?.() || {}),
      };
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
