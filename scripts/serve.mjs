// ============================================
// 本地预览服务器（无需安装任何依赖）
// 用法：在 网站/ 目录下运行  node scripts/serve.mjs
// 打开 http://localhost:8080/
// ============================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../site");
const port = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain",
};

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400); res.end("Bad Request"); return;
    }
    if (urlPath === "/") urlPath = "/index.html";
    const file = path.join(siteRoot, urlPath);
    if (!file.startsWith(siteRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => {
    console.log(`本地预览已启动: http://localhost:${port}/`);
  });
