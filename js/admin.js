// ============================================
// 管理后台公共组件：统一导航 + 待办统计 + 确认/输入弹层
// 供全部 admin-*.html 使用。依赖 js/supabase.js / js/auth.js / js/api.js。
// ============================================
(function () {
  "use strict";

  // 兜底 esc（api.js 已全局定义，此处防御性复制）
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  const ADMIN_NAV = [
    { href: "admin.html", label: "首页", icon: "⌂", todo: "total" },
    { href: "admin-submissions.html", label: "投稿审核", icon: "✎", todo: "submissions" },
    { href: "admin-reports.html", label: "举报处理", icon: "⚑", todo: "reports" },
    { href: "admin-users.html", label: "入站/人员", icon: "☻", todo: "users" },
    { href: "admin-comments.html", label: "评论管理", icon: "☷" },
    { href: "admin-works.html", label: "作品管理", icon: "▤" },
    { href: "admin-worlds.html", label: "世界观", icon: "◈" },
    { href: "admin-contests.html", label: "竞赛管理", icon: "✦" },
  ];

  /** 当前登录用户是否为管理员（失败/未登录返回 false） */
  async function isAdmin() {
    const user = SB && SB.user();
    if (!user) return false;
    try {
      const me = await window.getMyProfile();
      return !!(me && me.is_admin);
    } catch (e) {
      return false;
    }
  }

  /**
   * 待办统计：投稿待审 / 举报待处理 / 入站待审
   * 仅管理员可查；任一查询失败静默降级为 0，不阻塞页面。
   */
  async function loadTodoStats() {
    const stats = { submissions: 0, reports: 0, users: 0 };
    if (!SB || !(await isAdmin())) return stats;
    try {
      // 复用 SB.request：自动带 apikey/Authorization，且 401 时自动续期重试一次
      const d = await SB.request("/functions/v1/submission-review");
      stats.submissions = Array.isArray(d) ? d.length : 0;
    } catch (e) { /* 忽略：静默降级为 0，不阻塞页面 */ }
    try {
      const rs = await SB.get("reports", "status=eq.pending&select=id&limit=500");
      stats.reports = Array.isArray(rs) ? rs.length : 0;
    } catch (e) { /* 忽略 */ }
    try {
      const ps = await SB.get("profiles", "status=eq.pending&select=user_id");
      stats.users = Array.isArray(ps) ? ps.length : 0;
    } catch (e) { /* 忽略 */ }
    return stats;
  }

  /**
   * 渲染统一管理导航到 #admin-nav（带待办徽标）。
   * stats 可选，缺省时自行拉取（非管理员静默不显示徽标）。
   */
  async function adminNav(current) {
    const slot = document.getElementById("admin-nav");
    if (!slot) return;
    const stats = arguments.length > 1 && arguments[1]
      ? arguments[1]
      : await loadTodoStats();
    const total = (stats.submissions || 0) + (stats.reports || 0) + (stats.users || 0);
    slot.innerHTML = `
      <div class="a-nav" role="navigation" aria-label="管理后台">
        ${ADMIN_NAV.map((it) => {
          let badge = "";
          if (it.todo === "total" && total) badge = `<span class="a-badge">${total}</span>`;
          else if (it.todo && it.todo !== "total" && stats[it.todo]) badge = `<span class="a-badge">${stats[it.todo]}</span>`;
          return `<a class="a-nav-item${it.href === current ? " active" : ""}" href="${it.href}"${it.href === current ? ' aria-current="page"' : ""}>${it.icon}<span>${it.label}</span>${badge}</a>`;
        }).join("")}
      </div>`;
  }

  // ---------- 确认 / 输入弹层（替代原生 confirm / prompt，移动端友好） ----------
  let modalResolve = null;

  function openModal(opts) {
    closeModal(null);
    const mask = document.createElement("div");
    mask.className = "a-modal-mask";
    mask.id = "a-modal";
    mask.innerHTML = `
      <div class="a-modal" role="dialog" aria-modal="true" aria-label="${esc(opts.title || "")}">
        <div class="a-modal-title">${esc(opts.title || "")}</div>
        ${opts.message ? `<div class="a-modal-msg">${opts.message}</div>` : ""}
        ${opts.input
          ? `<input class="a-modal-input" type="text" placeholder="${esc(opts.placeholder || "")}" value="${esc(opts.value || "")}" maxlength="${opts.maxlength || 500}">`
          : ""}
        <div class="a-modal-actions">
          <button type="button" class="a-btn ghost" data-act="cancel">取消</button>
          <button type="button" class="a-btn ${opts.danger ? "danger" : ""}" data-act="ok">${esc(opts.okText || "确定")}</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const input = mask.querySelector(".a-modal-input");
    if (input) input.focus();

    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(null); });
    mask.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal(null));
    mask.querySelector('[data-act="ok"]').addEventListener("click", () => {
      if (opts.input) {
        const v = (mask.querySelector(".a-modal-input").value || "").trim();
        if (opts.required && !v) { mask.querySelector(".a-modal-input").focus(); return; }
        closeModal(v);
      } else {
        closeModal(true);
      }
    });
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") mask.querySelector('[data-act="ok"]').click();
      });
    }
    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function closeModal(v) {
    const mask = document.getElementById("a-modal");
    if (mask) mask.remove();
    if (modalResolve) { modalResolve(v); modalResolve = null; }
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(null); });

  /** 确认弹层：adminConfirm({title, message, danger, okText}) → Promise<boolean> */
  window.adminConfirm = (opts) => openModal({ ...opts, input: false });
  /** 输入弹层：adminPrompt({title, message, placeholder, required, okText}) → Promise<string|null> */
  window.adminPrompt = (opts) => openModal({ ...opts, input: true });
  /** 只读全文弹层：adminView({title, body}) — 保留换行、可滚动，用于审核全文预览 */
  window.adminView = (opts) => {
    closeModal(null);
    const mask = document.createElement("div");
    mask.className = "a-modal-mask";
    mask.id = "a-modal";
    mask.innerHTML = `
      <div class="a-modal wide" role="dialog" aria-modal="true" aria-label="${esc(opts.title || "")}">
        <div class="a-modal-title">${esc(opts.title || "")}</div>
        <div class="a-modal-body">${esc(opts.body || "（无内容）")}</div>
        <div class="a-modal-actions">
          <button type="button" class="a-btn" data-act="close">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(null); });
    mask.querySelector('[data-act="close"]').addEventListener("click", () => closeModal(null));
  };

  window.isAdmin = isAdmin;
  window.loadTodoStats = loadTodoStats;
  window.adminNav = adminNav;
})();
