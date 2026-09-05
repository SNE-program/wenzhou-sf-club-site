// ============================================
// 类世界观独立页渲染（worlds/<worldId>.html 使用）
// 数据：window.META_CTX = { worldId }，运行时读 worlds.json + works.json
// 结构：面包屑「类世界观」→ 封面/名称/徽标 → 简介 → 设定正文（Markdown）→ 作品列表
// （作品列表 = 全部无中心页作品的杂文，自动并入该类世界观）
// ============================================
(function () {
  const P = window.META_CTX || {};
  const root = document.getElementById("hub-root");
  if (!root || !P.worldId) {
    if (root) root.innerHTML = `<div class="state">类世界观参数缺失</div>`;
    return;
  }

  // ---------- 工具（与 hub.js / api.js 保持一致） ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function sanitizeHtml(html, allowStyle) {
    const text = String(html == null ? "" : html);
    if (!text) return "";
    try {
      if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
        return window.DOMPurify.sanitize(text, {
          USE_PROFILES: { html: true },
          ...(allowStyle ? { ADD_ATTR: ["style"] } : { FORBID_ATTR: ["style"] }),
          FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "link", "meta", "form", "input", "button", "textarea", "template", "svg", "math"],
        });
      }
    } catch (e) { /* 降级 */ }
    try {
      const tpl = document.createElement("template");
      tpl.innerHTML = text;
      tpl.content
        .querySelectorAll("script,iframe,object,embed,style,link,meta,form,input,button,textarea")
        .forEach((el) => el.remove());
      tpl.content.querySelectorAll("*").forEach((el) => {
        for (const a of [...el.attributes]) {
          const n = a.name.toLowerCase();
          if (n.startsWith("on") || n === "srcdoc" || (n === "href" && /^\s*javascript:/i.test(a.value))) {
            el.removeAttribute(a.name);
          }
        }
      });
      return tpl.innerHTML;
    } catch (e) {
      return text.replace(/<[^>]*>/g, "");
    }
  }
  function renderMarkdown(src) {
    const md = window.marked && typeof window.marked.parse === "function" ? window.marked.parse : null;
    const text = String(src == null ? "" : src);
    if (!md) return text.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");
    return sanitizeHtml(md(text, { breaks: true, gfm: true }));
  }
  function catArr(it) {
    const c = it.category;
    return Array.isArray(c) ? c : (c ? [c] : []);
  }

  (async function init() {
    try {
      const [worlds, works] = await Promise.all([fetchSection("worlds"), fetchSection("works")]);
      const world = (worlds || []).find((w) => w.id === P.worldId && w.kind === "meta");
      if (!world) {
        root.innerHTML = `<div class="state">类世界观不存在或已停用</div>`;
        return;
      }

      const metaWorks = (works || []).filter((w) => w.worldId === world.id);

      // 面包屑 + 头部
      const headHTML = `
        <p class="hub-breadcrumb">
          <a class="back-link" href="worlds.html">← 返回世界观</a>
          <span class="crumbs">世界观 → 类世界观 · ${esc(world.name)}</span>
        </p>
        <div class="hub-head">
          <div class="hub-cover" style="${coverStyle(world, world.name)}"><span class="cover-title">${esc(coverText(world.name))}</span></div>
          <div class="hub-info">
            <h1>${esc(world.name)}</h1>
            <span class="hub-theme">类世界观</span>
            ${world.summary ? `<p class="hub-summary">${esc(world.summary)}</p>` : ""}
          </div>
        </div>`;

      // 设定正文 + 作品
      const bodyHTML = `
        ${world.body ? `
          <h2 class="section-title">设定正文</h2>
          <div class="detail-body hub-body">${renderMarkdown(world.body)}</div>` : ""}
        <h2 class="section-title">作品 · ${metaWorks.length} 篇</h2>
        <div class="grid" id="hub-works">
          ${metaWorks.length
            ? metaWorks.map((it) => `
                <a class="card" href="articles/${encodeURIComponent(it.id)}.html">
                  <div class="card-cover" style="${coverStyle(it, it.title)}"><span class="cover-title">${esc(coverText(it.title))}</span></div>
                  <div class="card-body">
                    <h3>${esc(it.title)}</h3>
                    ${it.author ? `<div class="card-meta"><span>${esc(it.author)}</span><span>${esc(catArr(it).join("、") || "作品")}</span></div>` : ""}
                  </div>
                </a>`).join("")
            : `<div class="state">暂无无中心页作品</div>`}
        </div>`;

      root.innerHTML = headHTML + bodyHTML;
      document.title = `${world.name} · 类世界观 · 温州中学科学及幻想文学社`;
    } catch (e) {
      root.innerHTML = `<div class="state">类世界观加载失败：${esc(e.message)}<br><br><button class="btn" type="button" id="meta-retry">重试</button></div>`;
      const retry = document.getElementById("meta-retry");
      if (retry) retry.addEventListener("click", () => location.reload());
    }
  })();
})();
