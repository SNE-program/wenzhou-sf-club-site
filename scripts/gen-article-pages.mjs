// ============================================
// 静态文章页生成器 + 默认分享图
// 读取 site/data/*.json，为每条活动/作品生成带完整分享 meta 的
// 静态页面 site/articles/<id>.html（微信/浏览器转发时可正确展示卡片）。
// 同时生成 site/images/og-default.png（无封面时的默认分享图）。
// 用法：node scripts/gen-article-pages.mjs   （部署时由 GitHub Actions 自动执行）
// ============================================

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(__dirname, "..", "site");
const OUT_DIR = path.join(SITE_DIR, "articles");
const IMG_DIR = path.join(SITE_DIR, "images");

// 站点线上地址（域名确定后替换即可）
const BASE_URL = "https://sne-program.github.io/wenzhou-sf-club-site";

// ---------- 工具 ----------
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function meta(name, content) {
  const v = String(content ?? "").trim();
  if (!v) return "";
  return `  <meta name="${name}" content="${escHtml(v)}">\n`;
}
function og(prop, content) {
  const v = String(content ?? "").trim();
  if (!v) return "";
  return `  <meta property="og:${prop}" content="${escHtml(v)}">\n`;
}

// ---------- PNG 生成（无第三方依赖，zlib 内置） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function writePng(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// 确定性随机数（保证每次生成的分享图一致）
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 深空风格 1200x630 分享图：渐变 + 星云 + 星点 + 光弧
function buildOgImage() {
  const W = 1200, H = 630;
  const rand = mulberry32(20260806);
  const stars = [];
  for (let i = 0; i < 260; i++) {
    stars.push({ x: rand() * W, y: rand() * H, r: 0.6 + rand() * 2.2, a: 0.25 + rand() * 0.75 });
  }
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      let r = 5 + 14 * t, g = 7 + 16 * t, b = 15 + 44 * t;
      // 星云光斑
      const blob = (cx, cy, cr, dr, dg, db, alpha) => {
        const d = Math.hypot(x - cx, y - cy) / cr;
        if (d < 1) { const a = (1 - d) * (1 - d) * alpha; r += dr * a; g += dg * a; b += db * a; }
      };
      blob(880, 130, 430, 88, 58, 255, 0.55);   // 紫
      blob(240, 170, 400, 42, 225, 255, 0.5);   // 青
      blob(600, 620, 520, 20, 70, 255, 0.4);    // 靛
      // 中心光弧（椭圆环）
      const ex = (x - 600) / 400, ey = (y - 300) / 165;
      const ring = Math.abs(Math.hypot(ex, ey) - 1);
      if (ring < 0.05) { const a = (1 - ring / 0.05) * 0.85; r += 130 * a; g += 220 * a; b += 255 * a; }
      // 星点
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < s.r * 3) { const a = (1 - d / (s.r * 3)) * s.a; r += 255 * a; g += 255 * a; b += 255 * a; }
      }
      const i = (y * W + x) * 4;
      px[i] = Math.min(255, r) | 0;
      px[i + 1] = Math.min(255, g) | 0;
      px[i + 2] = Math.min(255, b) | 0;
      px[i + 3] = 255;
    }
  }
  return writePng(W, H, px);
}

// ---------- 文章页模板 ----------
function articlePageHTML({ id, type, title, summary, date, image }) {
  const absUrl = `${BASE_URL}/articles/${encodeURIComponent(id)}.html`;
  // 封面可能是本地相对路径（images/covers/…）或绝对外链；og 分享需要绝对地址
  const absImage = image
    ? /^https?:\/\//i.test(image)
      ? image
      : `${BASE_URL}/${image.replace(/^\.\.\//, "")}`
    : `${BASE_URL}/images/og-default.png`;
  const img = absImage;
  const typeLabel = type === "activities" ? "活动" : "作品";
  const backHref = type === "activities" ? "../activities.html" : "../works.html";
  const siteDesc = summary || "温州中学科学及幻想文学社 —— 读科幻、写幻想、观星象、聊未来。";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} · 温州中学科学及幻想文学社</title>
${meta("description", siteDesc)}
  <meta name="robots" content="index,follow">
${og("type", "article")}
${og("site_name", "温州中学科学及幻想文学社")}
${og("title", `${title} · 温州中学科学及幻想文学社`)}
${og("description", siteDesc)}
${og("image", img)}
${og("url", absUrl)}
${meta("twitter:card", "summary_large_image")}
  <script>
    (function () {
      try {
        var t = localStorage.getItem("wzsf-theme");
        if (!t) t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", t);
      } catch (e) {}
    })();
  </script>
  <base href="../">
  <link rel="stylesheet" href="css/style.css?v=20">
</head>
<body>
  <div data-nav></div>

  <main class="container">
    <p><a class="back-link" id="back-link" href="${backHref}">← 返回${typeLabel}</a></p>

    <article class="detail" id="detail">
      <div class="state"><div class="spinner"></div>正在加载文章……</div>
    </article>

    <!-- 表态区 -->
    <section class="vote-box" id="vote-box" hidden>
      <span class="vote-label">你的表态</span>
      <button class="vote-btn" data-v="1" id="vote-up" type="button">▲ <span id="cnt-up">0</span></button>
      <button class="vote-btn" data-v="-1" id="vote-down" type="button">▼ <span id="cnt-down">0</span></button>
      <button class="vote-btn vote-reset" data-v="0" id="vote-reset" type="button">取消表态</button>
      <span class="vote-hint" id="vote-hint"></span>
    </section>

    <!-- 评论区 -->
    <section class="comments" id="comments-sec" hidden>
      <h2 class="section-title">评论</h2>
      <div class="comment-form" id="comment-form">
        <textarea id="c-input" maxlength="1200" rows="3" placeholder="写下你的想法…（登录后可评论，支持 Markdown）"></textarea>
        <div class="c-bar">
          <button class="btn" id="c-submit" type="button">发表评论</button>
          <span class="c-hint" id="c-hint"></span>
        </div>
      </div>
      <div id="c-list"></div>
    </section>
  </main>

  <div data-footer></div>

  <script>window.ARTICLE_CTX = { id: ${JSON.stringify(id)}, type: ${JSON.stringify(type)} };</script>
  <script src="js/common.js?v=8"></script>
  <script src="js/api.js?v=5"></script>
  <script src="js/supabase.js?v=8"></script>
  <script src="js/auth.js?v=10"></script>
  <script src="js/vendor/marked.min.js"></script>
  <script src="js/vendor/dompurify.min.js"></script>
  <script src="js/article.js?v=10"></script>
</body>
</html>
`;
}

// ---------- 主流程 ----------
const [site, activities, works] = await Promise.all([
  readFile(path.join(SITE_DIR, "data", "site.json"), "utf8").then(JSON.parse).catch(() => ({})),
  readFile(path.join(SITE_DIR, "data", "activities.json"), "utf8").then(JSON.parse).catch(() => []),
  readFile(path.join(SITE_DIR, "data", "works.json"), "utf8").then(JSON.parse).catch(() => []),
]);

await mkdir(OUT_DIR, { recursive: true });
await mkdir(IMG_DIR, { recursive: true });

// 默认分享图（确定性生成，幂等）
await writeFile(path.join(IMG_DIR, "og-default.png"), buildOgImage());

let count = 0;
const validIds = new Set();
for (const item of activities || []) {
  if (!item || !item.id) continue;
  validIds.add(item.id);
  const html = articlePageHTML({
    id: item.id,
    type: "activities",
    title: item.title,
    summary: item.summary,
    date: item.date,
    image: item.cover || null,
  });
  await writeFile(path.join(OUT_DIR, `${item.id}.html`), html);
  count++;
}
for (const item of works || []) {
  if (!item || !item.id) continue;
  validIds.add(item.id);
  const html = articlePageHTML({
    id: item.id,
    type: "works",
    title: item.title,
    summary: item.summary,
    date: item.date,
    image: item.cover || null,
  });
  await writeFile(path.join(OUT_DIR, `${item.id}.html`), html);
  count++;
}

// 清理孤儿文章页：已下架/已删除内容对应的静态页一并移除，避免旧链接残留
let removed = 0;
const existing = await readdir(OUT_DIR).catch(() => []);
for (const f of existing) {
  if (!/\.html$/.test(f)) continue;
  const id = f.slice(0, -5);
  if (!validIds.has(id)) {
    await unlink(path.join(OUT_DIR, f)).catch(() => {});
    removed++;
  }
}

console.log(`[生成器] 完成：${count} 个静态文章页 + images/og-default.png（清理孤儿页 ${removed} 个）`);
console.log(`[生成器] 站点名称：${site.name || "(未读取到 site.json)"}`);
