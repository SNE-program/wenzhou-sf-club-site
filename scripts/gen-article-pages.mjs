// ============================================
// 静态文章页生成器 + 默认分享图 + 世界观页面
// 读取 site/data/*.json，为每条活动/作品生成带完整分享 meta 的
// 静态页面 site/articles/<id>.html（微信/浏览器转发时可正确展示卡片）。
// 同时为每个根世界观生成 site/worlds/<id>.html（时代之树）与
// site/worlds/<hubId>.html（枝干中心页）。
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
const WORLDS_DIR = path.join(SITE_DIR, "worlds");
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
  <link rel="stylesheet" href="css/style.css?v=23">
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
  <script src="js/common.js?v=10"></script>
  <script src="js/api.js?v=7"></script>
  <script src="js/supabase.js?v=9"></script>
  <script src="js/auth.js?v=16"></script>
  <script src="js/vendor/marked.min.js"></script>
  <script src="js/vendor/dompurify.min.js"></script>
  <script src="js/article.js?v=13"></script>
</body>
</html>
`;
}

// ---------- 时代之树页模板（worlds/<worldId>.html） ----------
// 主舞台占满头部栏以下全部区域（沉浸式「上升」），时代切换/显示控件置于舞台底部；
// 数据内嵌 JSON（window.WORLD_TREE），由 world-tree.js 渲染交互；无 JS 时回退为
// 页面内静态时代目录（static-dir）。
function worldTreePageHTML({ world }) {
  const absUrl = `${BASE_URL}/worlds/${encodeURIComponent(world.id)}.html`;
  const absImage = world.cover
    ? /^https?:\/\//i.test(world.cover)
      ? world.cover
      : `${BASE_URL}/${world.cover.replace(/^\.\.\//, "")}`
    : `${BASE_URL}/images/og-default.png`;
  const siteDesc = world.summary || "温州中学科学及幻想文学社 —— 以世界观为导向的时代之树。";

  // 内嵌交互数据（world-tree.js 契约：name/eras/hubs）
  const treeData = {
    name: world.name,
    summary: world.summary,
    eras: (world.eras || []).map((e) => ({ name: e.name, range: e.range, quote: e.quote, desc: e.desc })),
    hubs: (world.hubs || []).map((h) => ({
      id: h.id, name: h.name, theme: h.theme, era: h.era, sort: h.sort, workCount: h.workCount || 0,
    })),
  };
  const treeJson = JSON.stringify(treeData).replace(/</g, "\\u003c"); // 防 </script> 注入

  // 无 JS 降级：静态时代目录（与 world-tree.js 同规则分组）
  const eraOrder = new Map((world.eras || []).map((e, i) => [e.name, i]));
  const byEra = new Map();
  const unassigned = [];
  for (const h of world.hubs || []) {
    const i = h.era && eraOrder.has(h.era) ? eraOrder.get(h.era) : -1;
    if (i >= 0) {
      if (!byEra.has(i)) byEra.set(i, []);
      byEra.get(i).push(h);
    } else {
      unassigned.push(h);
    }
  }
  const hubLink = (h) =>
    `<li><a href="${encodeURIComponent(h.id)}.html">${escHtml(h.name)}</a><span class="dir-cnt">${h.workCount || 0} 篇</span></li>`;
  const dirHTML =
    (world.eras || [])
      .map((e, i) => `
        <section class="dir-era">
          <h3>${escHtml(e.name)}<small>${escHtml(e.range || "")}</small></h3>
          ${(e.quote || e.desc) ? `<p class="dir-desc">${escHtml(e.quote || e.desc)}</p>` : ""}
          ${(byEra.get(i) || []).length
            ? `<ul>${(byEra.get(i) || []).map(hubLink).join("")}</ul>`
            : `<p class="dir-empty">暂无枝干</p>`}
        </section>`).join("") +
    (unassigned.length ? `
        <section class="dir-era">
          <h3>根级未归档</h3>
          <ul>${unassigned.map(hubLink).join("")}</ul>
        </section>` : "");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(world.name)} · 时代之树 · 温州中学科学及幻想文学社</title>
${meta("description", siteDesc)}
  <meta name="robots" content="index,follow">
${og("type", "website")}
${og("site_name", "温州中学科学及幻想文学社")}
${og("title", `${escHtml(world.name)} · 时代之树 · 温州中学科学及幻想文学社`)}
${og("description", siteDesc)}
${og("image", absImage)}
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
  <link rel="stylesheet" href="css/style.css?v=23">
  <style>
    /* 沉浸式舞台：头部栏之下占满全部区域，页面不滚动 */
    html, body { height: 100%; }
    body { margin: 0; overflow: hidden; display: flex; flex-direction: column;
      background: #0a0e1a; color: #e6ecf5;
      font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    #stage { position: relative; flex: 1; min-height: 0; overflow: hidden;
      background: hsl(215 55% 90%); transition: background .9s ease; }
    #scene { position: absolute; left: 0; top: 0;
      transition: transform 1.1s cubic-bezier(.25, .85, .3, 1); }
    /* 时代刻度与曲线点 */
    .tree-era-tag { position: absolute; color: #3a3f4c; font-size: 12px; letter-spacing: 2px;
      transform: translate(-50%, 0); padding: 2px 10px; border-radius: 999px;
      background: rgba(242, 236, 217, .3); white-space: nowrap;
      transition: color .4s, font-size .4s, background .4s, box-shadow .4s; }
    .tree-era-tag.active { color: #fff; font-size: 16px; font-weight: 700; letter-spacing: 3px;
      box-shadow: 0 0 14px rgba(20, 30, 60, .35); }
    .tree-era-dot { position: absolute; width: 9px; height: 9px; border-radius: 50%;
      background: #3d5a7a; transform: translate(-50%, -50%); border: 1.5px solid rgba(25, 35, 55, .55);
      transition: box-shadow .4s, background .4s, width .4s, height .4s; }
    .tree-era-dot.active { width: 16px; height: 16px; background: #7cc4ff;
      box-shadow: 0 0 24px 7px rgba(124, 196, 255, .85); }
    .tree-cursor { position: absolute; width: 34px; height: 34px; border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, .92); transform: translate(-50%, -50%);
      pointer-events: none; z-index: 2; /* 位置由 world-tree.js 沿曲线逐帧驱动，无需 CSS 过渡 */
      box-shadow: 0 0 0 2px rgba(38, 46, 66, .45), 0 0 22px 8px rgba(120, 170, 255, .35); }
    .tree-cursor::after { content: ""; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px;
      border-radius: 50%; background: #eaf4ff; transform: translate(-50%, -50%); }
    /* 中心页节点（枝干） */
    .tree-hub { position: absolute; width: 196px; padding: 12px 15px; border-radius: 14px;
      background: var(--bg, rgba(17, 26, 46, .92)); color: var(--ink, #e6ecf5);
      border: 1px solid var(--line, #243049); cursor: pointer; display: none; opacity: 0; z-index: 3;
      transition: left .55s ease, top .55s ease, opacity .22s ease, transform .3s ease,
        border-color .2s, box-shadow .2s;
      box-shadow: 0 8px 26px rgba(0, 0, 0, .4); }
    .tree-hub:hover { transform: translate(-50%, -50%) translateY(-3px) scale(1.03) !important;
      z-index: 99; box-shadow: 0 12px 30px rgba(0, 0, 0, .5); }
    .tree-hub .h-name { font-size: 14px; font-weight: 700; line-height: 1.45; }
    .tree-hub .h-theme { margin-top: 5px; font-size: 11px; color: var(--dim, #8ea3c0); letter-spacing: .5px; }
    .tree-hub .h-count { margin-top: 7px; font-size: 11px; color: var(--acc, #7cc4ff); }
    /* 底部控件：沉浸式悬浮条 */
    .controls { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
      width: min(560px, 92vw); display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-radius: 999px;
      background: rgba(12, 19, 36, .6); border: 1px solid #243049; backdrop-filter: blur(6px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, .35); z-index: 5; }
    .controls button { width: 44px; height: 44px; border-radius: 50%; border: 1px solid #243049;
      background: #111a2e; color: #e6ecf5; font-size: 17px; cursor: pointer; transition: .2s; flex: none; }
    .controls button:hover { border-color: #7cc4ff; color: #7cc4ff; }
    .controls button:disabled { opacity: .35; cursor: not-allowed; }
    /* 中间文本区 flex 占满剩余宽度：无论时代名长短，控件条总宽度恒定，按钮位置不跳动 */
    .era-center { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: center; }
    #era-label { font-size: 15px; font-weight: 700; letter-spacing: 2px; text-align: center;
      color: #e6ecf5; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #era-label small { display: block; font-size: 11px; font-weight: 400; color: #8ea3c0;
      letter-spacing: 1px; margin-top: 2px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* 左上角「时代简介」折叠按钮（简介预览不再占用控件条） */
    #era-info-btn { position: absolute; left: 14px; top: 14px; z-index: 7;
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(12, 19, 36, .78); border: 1px solid #243049; color: #c6d3e6;
      font-size: 12px; letter-spacing: 1px; padding: 7px 14px; border-radius: 999px;
      cursor: pointer; backdrop-filter: blur(6px);
      transition: border-color .2s, color .2s, background .2s; }
    #era-info-btn:hover { border-color: #7cc4ff; color: #fff; }
    #era-info-btn.era-open { color: #7cc4ff; border-color: #7cc4ff; background: rgba(12, 19, 36, .92); }
    #era-info-btn .ep-btn-arrow { font-size: 10px; opacity: .7; }
    /* 时代详情折叠卡：从左上角按钮下方展开，再点按钮/✕ 收起 */
    #era-panel { position: absolute; left: 14px; top: 52px; z-index: 6;
      width: min(560px, 88vw); max-height: calc(100% - 200px); overflow: auto;
      background: rgba(12, 19, 36, .94); border: 1px solid #243049; border-radius: 14px;
      padding: 18px 22px; backdrop-filter: blur(8px);
      box-shadow: 0 18px 50px rgba(0, 0, 0, .45); animation: epIn .22s ease both; }
    @keyframes epIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    #era-panel .ep-close { position: absolute; right: 12px; top: 10px; border: none; background: transparent;
      color: #8ea3c0; font-size: 15px; cursor: pointer; padding: 4px 8px; border-radius: 8px; }
    #era-panel .ep-close:hover { color: #fff; background: rgba(255, 255, 255, .08); }
    #era-panel h3 { margin: 0 0 2px; font-size: 19px; letter-spacing: 1px; color: #e6ecf5; }
    #era-panel .ep-range { color: #7cc4ff; font-size: 12px; letter-spacing: 1px; margin-bottom: 10px; }
    #era-panel .ep-quote { color: #7cc4ff; font-size: 13.5px; line-height: 1.8; margin-bottom: 8px; opacity: .9; }
    #era-panel .ep-desc { color: #c6d3e6; font-size: 14px; line-height: 1.9; white-space: pre-wrap; }
    /* 无 JS 降级：静态时代目录 */
    #static-dir { position: absolute; inset: 0; overflow: auto; z-index: 1;
      padding: 40px max(20px, 8vw) 120px; background: rgba(10, 14, 26, .9); }
    #static-dir h2 { margin: 0 0 6px; font-size: 26px; letter-spacing: 2px; }
    #static-dir .dir-summary { color: #8ea3c0; font-size: 13px; margin: 0 0 22px; line-height: 1.8; }
    #static-dir .dir-era { margin-bottom: 20px; padding: 16px 18px; border: 1px solid #243049;
      border-radius: 12px; background: rgba(17, 26, 46, .6); }
    #static-dir h3 { margin: 0 0 4px; font-size: 16px; }
    #static-dir h3 small { font-weight: 400; font-size: 12px; color: #8ea3c0; margin-left: 8px; }
    #static-dir .dir-desc { font-size: 12.5px; color: #8ea3c0; margin: 2px 0 8px; line-height: 1.7; }
    #static-dir ul { margin: 0; padding: 0; list-style: none; }
    #static-dir li { margin: 6px 0; }
    #static-dir a { color: #7cc4ff; text-decoration: none; }
    #static-dir a:hover { text-decoration: underline; }
    #static-dir .dir-cnt { color: #8ea3c0; font-size: 12px; margin-left: 8px; }
    #static-dir .dir-empty { color: #8ea3c0; font-size: 12.5px; }
    /* 手机适配：枝干节点缩小、控件收紧、静态目录留足内边距 */
    @media (max-width: 640px) {
      .tree-hub { width: 148px; padding: 9px 11px; }
      .tree-hub .h-name { font-size: 12.5px; }
      .tree-hub .h-theme { font-size: 10px; margin-top: 3px; }
      .tree-hub .h-count { font-size: 10px; margin-top: 4px; }
      .controls { bottom: 10px; gap: 8px; padding: 8px 12px; }
      .controls button { width: 38px; height: 38px; font-size: 15px; }
      .era-center { flex: 1 1 auto; min-width: 0; }
      #era-label { font-size: 13px; }
      #era-label small { font-size: 10px; }
      #era-info-btn { left: 8px; top: 8px; font-size: 11px; padding: 6px 10px; }
      #era-panel { left: 8px; top: 46px; width: calc(100vw - 16px); padding: 16px 16px; }
      #era-panel h3 { font-size: 17px; }
      #era-panel .ep-desc { font-size: 13px; }
      .tree-era-tag { font-size: 10.5px; padding: 2px 8px; }
      #static-dir { padding: 26px 14px 110px; }
    }
  </style>
</head>
<body>
  <div data-nav></div>

  <div id="stage">
    <div id="scene">
      <svg width="5000" height="5300" viewBox="0 0 5000 5300"
           style="position:absolute;left:0;top:0;overflow:visible">
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="hsl(215 60% 38%)"/><stop offset=".3" stop-color="hsl(180 55% 42%)"/>
            <stop offset=".55" stop-color="hsl(252 45% 50%)"/><stop offset=".8" stop-color="hsl(12 62% 52%)"/>
            <stop offset="1" stop-color="hsl(40 55% 48%)"/>
          </linearGradient>
        </defs>
        <path d="" fill="none" stroke="url(#grad)" stroke-width="2.4" stroke-linecap="round"
              opacity=".85" style="filter:drop-shadow(0 0 8px rgba(124,196,255,.35))"/>
      </svg>
    </div>

    <!-- 无 JS 降级：静态时代目录 -->
    <div id="static-dir">
      <h2>${escHtml(world.name)} · 时代之树</h2>
      ${world.summary ? `<p class="dir-summary">${escHtml(world.summary)}</p>` : ""}
      ${dirHTML}
    </div>

    <!-- 左上角「时代简介」折叠入口（点击展开/收起时代详情） -->
    <button id="era-info-btn" type="button" title="时代简介">
      <span>✦ 时代简介</span><span class="ep-btn-arrow" id="era-info-arrow">▾</span>
    </button>

    <!-- 时代详情折叠卡：从左上角按钮下方展开 -->
    <div id="era-panel" hidden>
      <button class="ep-close" type="button" title="收起" id="ep-close">✕</button>
      <h3 id="ep-name"></h3>
      <div class="ep-range" id="ep-range"></div>
      <div class="ep-quote" id="ep-quote" hidden></div>
      <div class="ep-desc" id="ep-desc"></div>
    </div>

    <!-- 时代控件：舞台底部悬浮条（沉浸式，不占顶部空间） -->
    <div class="controls">
      <button id="btn-back" type="button" title="退回过去">◀</button>
      <div class="era-center">
        <div id="era-label"></div>
      </div>
      <button id="btn-fwd" type="button" title="时代进步（向右三角）">▶</button>
    </div>
  </div>

  <script>window.WORLD_TREE = ${treeJson};</script>
  <script src="js/common.js?v=10"></script>
  <script src="js/api.js?v=7"></script>
  <script src="js/supabase.js?v=9"></script>
  <script src="js/auth.js?v=16"></script>
  <script src="js/world-tree.js?v=10"></script>
</body>
</html>
`;
}

// ---------- 枝干中心页模板（worlds/<hubId>.html） ----------
// 运行时由 hub.js 读 worlds.json + works.json 渲染（面包屑 / 封面 / 设定正文 / 作品列表）。
function hubPageHTML({ world, hub }) {
  const absUrl = `${BASE_URL}/worlds/${encodeURIComponent(hub.id)}.html`;
  const siteDesc = hub.summary || `${hub.name} · ${world.name} · 温州中学科学及幻想文学社`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(hub.name)} · 世界观 · 温州中学科学及幻想文学社</title>
${meta("description", siteDesc)}
  <meta name="robots" content="index,follow">
${og("type", "website")}
${og("site_name", "温州中学科学及幻想文学社")}
${og("title", `${escHtml(hub.name)} · 世界观 · 温州中学科学及幻想文学社`)}
${og("description", siteDesc)}
${og("image", `${BASE_URL}/images/og-default.png`)}
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
  <link rel="stylesheet" href="css/style.css?v=23">
  <style>
    .hub-breadcrumb { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; margin-bottom: 18px; }
    .hub-breadcrumb .crumbs { font-size: 12.5px; color: var(--dim, #8ea3c0); }
    .hub-head { display: flex; gap: 20px; align-items: flex-end; margin-bottom: 22px; flex-wrap: wrap; }
    .hub-cover { width: min(320px, 100%); height: 180px; border-radius: 18px; overflow: hidden;
      display: flex; align-items: flex-end; padding: 16px; flex: none; }
    .hub-cover .cover-title { color: #fff; font-size: 22px; font-weight: 800; letter-spacing: 1px;
      text-shadow: 0 2px 12px rgba(0, 0, 0, .45); line-height: 1.3; }
    .hub-info { flex: 1; min-width: 240px; }
    .hub-info h1 { margin: 0 0 8px; font-size: 26px; }
    .hub-theme, .hub-era { display: inline-block; font-size: 12px; padding: 3px 10px;
      border-radius: 999px; border: 1px solid var(--line, #243049);
      color: var(--dim, #8ea3c0); margin-right: 8px; }
    .hub-summary { margin: 12px 0 0; color: var(--dim, #8ea3c0); font-size: 13.5px; line-height: 1.8; }
    .hub-era-desc { margin: 12px 0 0; padding: 10px 14px; font-size: 13px; line-height: 1.8;
      color: var(--dim, #8ea3c0); background: rgba(124, 196, 255, .06);
      border-left: 2px solid #7cc4ff; border-radius: 6px; }
    .hub-body { margin-top: 6px; }
  </style>
</head>
<body>
  <div data-nav></div>

  <main class="container">
    <div id="hub-root">
      <div class="state"><div class="spinner"></div>正在加载中心页……</div>
    </div>
  </main>

  <div data-footer></div>

  <script>window.HUB_CTX = { worldId: ${JSON.stringify(world.id)}, hubId: ${JSON.stringify(hub.id)} };</script>
  <script src="js/common.js?v=10"></script>
  <script src="js/api.js?v=7"></script>
  <script src="js/supabase.js?v=9"></script>
  <script src="js/auth.js?v=16"></script>
  <script src="js/vendor/marked.min.js"></script>
  <script src="js/vendor/dompurify.min.js"></script>
  <script src="js/hub.js?v=2"></script>
</body>
</html>
`;
}

// ---------- 类世界观独立页模板（worlds/<worldId>.html） ----------
// 与枝干中心页同目录复用；运行时由 meta.js 读 worlds.json + works.json 渲染
// （面包屑「类世界观」/ 隐藏时代与主题 / 作品列表 = 全部无中心页作品）。
function metaPageHTML({ world }) {
  const absUrl = `${BASE_URL}/worlds/${encodeURIComponent(world.id)}.html`;
  const siteDesc = world.summary || `${world.name} · 温州中学科学及幻想文学社`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(world.name)} · 类世界观 · 温州中学科学及幻想文学社</title>
${meta("description", siteDesc)}
  <meta name="robots" content="index,follow">
${og("type", "website")}
${og("site_name", "温州中学科学及幻想文学社")}
${og("title", `${escHtml(world.name)} · 类世界观 · 温州中学科学及幻想文学社`)}
${og("description", siteDesc)}
${og("image", `${BASE_URL}/images/og-default.png`)}
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
  <link rel="stylesheet" href="css/style.css?v=23">
  <style>
    .hub-breadcrumb { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; margin-bottom: 18px; }
    .hub-breadcrumb .crumbs { font-size: 12.5px; color: var(--dim, #8ea3c0); }
    .hub-head { display: flex; gap: 20px; align-items: flex-end; margin-bottom: 22px; flex-wrap: wrap; }
    .hub-cover { width: min(320px, 100%); height: 180px; border-radius: 18px; overflow: hidden;
      display: flex; align-items: flex-end; padding: 16px; flex: none; }
    .hub-cover .cover-title { color: #fff; font-size: 22px; font-weight: 800; letter-spacing: 1px;
      text-shadow: 0 2px 12px rgba(0, 0, 0, .45); line-height: 1.3; }
    .hub-info { flex: 1; min-width: 240px; }
    .hub-info h1 { margin: 0 0 8px; font-size: 26px; }
    .hub-theme, .hub-era { display: inline-block; font-size: 12px; padding: 3px 10px;
      border-radius: 999px; border: 1px solid var(--line, #243049);
      color: var(--dim, #8ea3c0); margin-right: 8px; }
    .hub-summary { margin: 12px 0 0; color: var(--dim, #8ea3c0); font-size: 13.5px; line-height: 1.8; }
    .hub-body { margin-top: 6px; }
  </style>
</head>
<body>
  <div data-nav></div>

  <main class="container">
    <div id="hub-root">
      <div class="state"><div class="spinner"></div>正在加载类世界观……</div>
    </div>
  </main>

  <div data-footer></div>

  <script>window.META_CTX = { worldId: ${JSON.stringify(world.id)} };</script>
  <script src="js/common.js?v=10"></script>
  <script src="js/api.js?v=7"></script>
  <script src="js/supabase.js?v=9"></script>
  <script src="js/auth.js?v=16"></script>
  <script src="js/vendor/marked.min.js"></script>
  <script src="js/vendor/dompurify.min.js"></script>
  <script src="js/meta.js?v=1"></script>
</body>
</html>
`;
}

// ---------- 主流程 ----------
const [site, activities, works, worlds] = await Promise.all([
  readFile(path.join(SITE_DIR, "data", "site.json"), "utf8").then(JSON.parse).catch(() => ({})),
  readFile(path.join(SITE_DIR, "data", "activities.json"), "utf8").then(JSON.parse).catch(() => []),
  readFile(path.join(SITE_DIR, "data", "works.json"), "utf8").then(JSON.parse).catch(() => []),
  readFile(path.join(SITE_DIR, "data", "worlds.json"), "utf8").then(JSON.parse).catch(() => []),
]);

await mkdir(OUT_DIR, { recursive: true });
await mkdir(WORLDS_DIR, { recursive: true });
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

// 世界观页面：每个根世界观生成时代之树页 + 全部枝干中心页；类世界观生成独立页（无时代线/枝干）
let worldCount = 0;
const validWorldIds = new Set(); // 根 + 枝干 id（用于清理孤儿世界观页）
for (const world of worlds || []) {
  if (!world || !world.id) continue;
  validWorldIds.add(world.id);
  if (world.kind === "meta") {
    await writeFile(path.join(WORLDS_DIR, `${world.id}.html`), metaPageHTML({ world }));
    worldCount++;
    continue;
  }
  await writeFile(path.join(WORLDS_DIR, `${world.id}.html`), worldTreePageHTML({ world }));
  worldCount++;
  for (const hub of world.hubs || []) {
    if (!hub || !hub.id) continue;
    validWorldIds.add(hub.id);
    await writeFile(path.join(WORLDS_DIR, `${hub.id}.html`), hubPageHTML({ world, hub }));
    worldCount++;
  }
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

// 清理孤儿世界观页：worlds/ 下不存在于 worlds.json（根 + 枝干）的页面一并移除
let removedWorlds = 0;
const existingWorlds = await readdir(WORLDS_DIR).catch(() => []);
for (const f of existingWorlds) {
  if (!/\.html$/.test(f)) continue;
  const id = f.slice(0, -5);
  if (!validWorldIds.has(id)) {
    await unlink(path.join(WORLDS_DIR, f)).catch(() => {});
    removedWorlds++;
  }
}

console.log(
  `[生成器] 完成：${count} 个静态文章页 + ${worldCount} 个世界观页 + images/og-default.png（清理孤儿页 ${removed} 个、孤儿世界观页 ${removedWorlds} 个）`
);
console.log(`[生成器] 站点名称：${site.name || "(未读取到 site.json)"}`);
