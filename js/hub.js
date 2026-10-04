// ============================================
// 枝干中心页渲染（worlds/<hubId>.html 使用）
// 数据：window.HUB_CTX = { worldId, hubId }，运行时读 worlds.json + works.json
// 结构：面包屑 → 封面/名称/主题徽标/时代 → 简介 → 设定正文（Markdown）→ 作品列表
// ============================================
(function () {
  const P = window.HUB_CTX || {};
  const root = document.getElementById("hub-root");
  if (!root || !P.worldId || !P.hubId) {
    if (root) root.innerHTML = `<div class="state">中心页参数缺失</div>`;
    return;
  }

  // ---------- 工具（与 api.js / article.js 保持一致） ----------
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
      const world = (worlds || []).find((w) => w.id === P.worldId);
      const hub = world && (world.hubs || []).find((h) => h.id === P.hubId);
      if (!hub) {
        root.innerHTML = `<div class="state">中心页不存在或已停用</div>`;
        return;
      }

      const backTree = `worlds/${encodeURIComponent(world.id)}.html`;
      const eraLabel = hub.era || "未归档";
      const eraInfo = (world.eras || []).find((e) => e.name === hub.era);
      const hubWorks = (works || []).filter((w) => w.hubId === hub.id);

      // 面包屑 + 头部
      const headHTML = `
        <p class="hub-breadcrumb">
          <a class="back-link" href="${backTree}">← 返回时代之树</a>
          <span class="crumbs">世界观 · ${esc(world.name)} → 时代 · ${esc(eraLabel)} → ${esc(hub.name)}</span>
        </p>
        <div class="hub-head">
          <div class="hub-cover" style="${coverStyle(hub, hub.name)}"><span class="cover-title">${esc(coverText(hub.name))}</span></div>
          <div class="hub-info">
            <h1>${esc(hub.name)}</h1>
            ${hub.theme ? `<span class="hub-theme">主题 · ${esc(hub.theme)}</span>` : ""}
            <span class="hub-era">时代 · ${esc(eraLabel)}</span>
            ${eraInfo && eraInfo.desc ? `<p class="hub-era-desc">${esc(eraInfo.desc)}</p>` : ""}
            ${hub.summary ? `<p class="hub-summary">${esc(hub.summary)}</p>` : ""}
          </div>
        </div>`;

      // 设定正文 + 作品
      const bodyHTML = `
        <h2 class="section-title">设定正文</h2>
        <div class="detail-body hub-body">${renderMarkdown(hub.body)}</div>
        <h2 class="section-title">作品 · ${hubWorks.length} 篇</h2>
        <div class="grid" id="hub-works">
          ${hubWorks.length
            ? hubWorks.map((it) => `
                <a class="card" href="articles/${encodeURIComponent(it.id)}.html">
                  <div class="card-cover" style="${coverStyle(it, it.title)}"><span class="cover-title">${esc(coverText(it.title))}</span></div>
                  <div class="card-body">
                    <h3>${esc(it.title)}</h3>
                    ${it.author ? `<div class="card-meta"><span>${esc(it.author)}</span><span>${esc(catArr(it).join("、") || "作品")}</span></div>` : ""}
                  </div>
                </a>`).join("")
            : `<div class="state">该中心页暂无作品</div>`}
        </div>`;

      root.innerHTML = headHTML + bodyHTML;
      document.title = `${hub.name} · 世界观 · 温州中学科学及幻想文学社`;
    } catch (e) {
      root.innerHTML = `<div class="state">中心页加载失败：${esc(e.message)}<br><br><button class="btn" type="button" id="hub-retry">重试</button></div>`;
      const retry = document.getElementById("hub-retry");
      if (retry) retry.addEventListener("click", () => location.reload());
    }
  })();
})();
