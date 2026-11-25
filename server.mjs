import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4180);
const HOST = process.env.HOST ?? "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? HOST}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = path.join(ROOT, path.normalize(pathname));
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("403 Forbidden");
      return;
    }

    const data = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store",
    });

    if (request.method === "HEAD") response.end();
    else response.end(data);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "404 Not Found" : "500 Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PICO WALKER → http://${HOST}:${PORT}`);
});
