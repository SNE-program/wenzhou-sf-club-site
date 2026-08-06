// ============================================
// 公共导航 / 页脚注入 + 当前页高亮 + 主题切换 + 站内搜索入口
// ============================================
(function () {
  const NAV_ITEMS = [
    { href: "index.html", label: "首页" },
    { href: "activities.html", label: "活动" },
    { href: "contests.html", label: "竞赛" },
    { href: "works.html", label: "作品" },
    { href: "members.html", label: "成员" },
    { href: "about.html", label: "关于" },
  ];
  const THEME_KEY = "wzsf-theme";
  const STYLE_KEY = "wzsf-style";

  // 四套 SF 风格：黄铜星图（复古未来）/ 赛博霓虹（Cyberpunk 2077）/ 深空极光（原版深空）/ 复古计算（CRT 终端）
  const STYLES = [
    { id: "brass", name: "黄铜星图", icon: "◈" },
    { id: "neon", name: "赛博霓虹", icon: "⌬" },
    { id: "aurora", name: "深空极光", icon: "✧" },
    { id: "retro", name: "复古计算", icon: "▮" },
  ];

  // 首帧前应用已保存的风格，避免闪烁
  try {
    const savedStyle = localStorage.getItem(STYLE_KEY);
    if (savedStyle && STYLES.some((s) => s.id === savedStyle)) {
      document.documentElement.setAttribute("data-style", savedStyle);
    }
  } catch (e) { /* 忽略 */ }

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
            <select class="sf-style-select" id="style-select" aria-label="选择SF风格">
              ${STYLES.map((s) => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join("")}
            </select>
            <button type="button" class="icon-btn" id="theme-toggle" aria-label="切换日/夜模式">切换</button>
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
    // 固定文案“切换”，图标恒定，点击只切换日/夜形态
    btn.textContent = "切换";
    const dark = currentTheme() === "dark";
    btn.setAttribute("aria-label", dark ? "切换到日间模式" : "切换到夜间模式");
    btn.title = dark ? "切换日/夜模式：当前夜间 → 日间" : "切换日/夜模式：当前日间 → 夜间";
  }
  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
    syncThemeButton();
  }

  // ---------- SF 风格（下拉直接选择） ----------
  function currentStyle() {
    const cur = document.documentElement.getAttribute("data-style") || "brass";
    return STYLES.some((s) => s.id === cur) ? cur : "brass";
  }
  function syncStyleSelect() {
    const sel = document.getElementById("style-select");
    if (!sel) return;
    sel.value = currentStyle();
  }
  function selectStyle(value) {
    const next = STYLES.some((s) => s.id === value) ? value : "brass";
    document.documentElement.setAttribute("data-style", next);
    try { localStorage.setItem(STYLE_KEY, next); } catch (e) { /* 忽略 */ }
    syncStyleSelect();
    // 通知页面（如首页重建浑天仪配色）
    window.dispatchEvent(new CustomEvent("wzsf:style", { detail: { style: next } }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const navSlot = document.querySelector("[data-nav]");
    const footSlot = document.querySelector("[data-footer]");
    if (navSlot) navSlot.outerHTML = navHTML();
    if (footSlot) footSlot.outerHTML = footerHTML();

    syncThemeButton();
    const themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

    syncStyleSelect();
    const styleSel = document.getElementById("style-select");
    if (styleSel) styleSel.addEventListener("change", (e) => selectStyle(e.target.value));

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
