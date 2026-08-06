// ============================================
// 公共导航 / 页脚注入 + 当前页高亮 + 主题切换 + 站内搜索入口
// ============================================
(function () {
  const NAV_ITEMS = [
    { href: "index.html", label: "首页" },
    { href: "activities.html", label: "活动" },
    { href: "works.html", label: "作品" },
    { href: "members.html", label: "成员" },
    { href: "about.html", label: "关于" },
  ];
  const THEME_KEY = "wzsf-theme";

  function currentPage() {
    return location.pathname.split("/").pop() || "index.html";
  }

  function navHTML() {
    const cur = currentPage();
    const links = NAV_ITEMS.map(
      (it) =>
        `<a href="${it.href}" class="${it.href === cur ? "active" : ""}"${it.href === cur ? ' aria-current="page"' : ""}>${it.label}</a>`
    ).join("");
    return `
      <div class="nav">
        <div class="nav-inner">
          <a class="brand" href="index.html" aria-label="首页">
            <span class="brand-mark">幻</span>
            <span>温中科幻社</span>
          </a>
          <button class="nav-toggle" aria-label="展开菜单" aria-expanded="false">☰</button>
          <nav class="nav-links" id="nav-links">${links}</nav>
          <div class="nav-tools">
            <button type="button" class="icon-btn" id="theme-toggle" aria-label="切换浅色/深色模式" title="切换主题">☀️</button>
            <form class="nav-search" id="nav-search" role="search" action="search.html" method="get">
              <input type="search" name="q" placeholder="搜索…" aria-label="站内搜索" autocomplete="off">
              <button type="submit" aria-label="搜索">⌕</button>
            </form>
          </div>
        </div>
      </div>`;
  }

  function footerHTML() {
    const year = new Date().getFullYear();
    return `
      <footer class="footer">
        <div class="foot-brand">温州中学科学及幻想文学社</div>
        <div>以科学与幻想为翼 · © ${year}</div>
      </footer>`;
  }

  // ---------- 主题 ----------
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }
  function syncThemeButton() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const dark = currentTheme() === "dark";
    btn.textContent = dark ? "☀️" : "🌙"; // 显示"将要切换到"的模式
    btn.setAttribute("aria-label", dark ? "切换到浅色模式" : "切换到深色模式");
  }
  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
    syncThemeButton();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const navSlot = document.querySelector("[data-nav]");
    const footSlot = document.querySelector("[data-footer]");
    if (navSlot) navSlot.outerHTML = navHTML();
    if (footSlot) footSlot.outerHTML = footerHTML();

    syncThemeButton();
    const themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

    // 移动端菜单开关
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector("#nav-links");
    if (toggle && links) {
      toggle.addEventListener("click", () => {
        const open = links.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      });
    }
  });
})();
