// ============================================
// 公共导航 / 页脚注入 + 当前页高亮 + 主题切换 + 站内搜索入口
// ============================================
(function () {
  // 站点数据已由 GitHub Actions 构建时从 Notion 生成静态 data/*.json（见 scripts/gen-site-data.mjs），
  // 前端直接读取本地 JSON，不再依赖运行时 API（避免国内访问 *.workers.dev 被墙导致内容加载不出来）。
  // 如需接入自定义域名的 API，可在部署前设置 window.SITE_API 覆盖默认值。

  const NAV_ITEMS = [
    { href: "index.html", label: "首页" },
    { href: "activities.html", label: "活动" },
    { href: "contests.html", label: "竞赛" },
    { href: "works.html", label: "作品" },
    { href: "submit.html", label: "投稿" },
    { href: "members.html", label: "成员" },
    { href: "about.html", label: "关于" },
  ];
  const THEME_KEY = "wzsf-theme";
  const STYLE_KEY = "wzsf-style";
  const MINIMAL_KEY = "wzsf-minimal";
  const ARMILLARY_KEY = "wzsf-armillary";

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
    // 首帧前应用极简模式（无图片 / 纯文字排版）
    if (localStorage.getItem(MINIMAL_KEY) === "1") {
      document.documentElement.classList.add("minimal");
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
            <button type="button" class="icon-btn" id="ui-settings" aria-label="显示设置" title="显示设置">⚙</button>
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

    // ---------- 显示设置：极简版 / 浑天仪开关 ----------
    function minimalOn() {
      try { return localStorage.getItem(MINIMAL_KEY) === "1"; } catch (e) { return false; }
    }
    function armillaryOn() {
      try { return localStorage.getItem(ARMILLARY_KEY) !== "0"; } catch (e) { return true; }
    }
    function injectSettings() {
      if (document.getElementById("settings-pop")) return;
      const hasArm = !!document.querySelector("#armillary");
      const pop = document.createElement("div");
      pop.className = "settings-pop";
      pop.id = "settings-pop";
      pop.hidden = true;
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "显示设置");
      pop.innerHTML = `
        <div class="settings-title">显示设置</div>
        <div class="settings-row">
          <label for="minimal-switch">
            <span class="settings-label">极简版</span>
            <span class="settings-desc">隐藏图片与装饰，纯文字排版</span>
          </label>
          <input type="checkbox" id="minimal-switch" class="switch">
        </div>
        ${hasArm ? `
        <div class="settings-row" id="armillary-row">
          <label for="armillary-switch">
            <span class="settings-label">浑天仪动画</span>
            <span class="settings-desc">首页标题下方的三维动画</span>
          </label>
          <input type="checkbox" id="armillary-switch" class="switch">
        </div>` : ""}
      `;
      document.body.appendChild(pop);

      const minSwitch = pop.querySelector("#minimal-switch");
      const armSwitch = pop.querySelector("#armillary-switch");
      const syncArmDisabled = () => {
        if (!armSwitch) return;
        const on = document.documentElement.classList.contains("minimal");
        armSwitch.disabled = on;
        armSwitch.classList.toggle("disabled", on);
      };

      if (minSwitch) {
        minSwitch.checked = minimalOn();
        minSwitch.addEventListener("change", () => {
          const on = minSwitch.checked;
          try { localStorage.setItem(MINIMAL_KEY, on ? "1" : "0"); } catch (e) { /* 忽略 */ }
          document.documentElement.classList.toggle("minimal", on);
          syncArmDisabled();
          window.dispatchEvent(new CustomEvent("wzsf:minimal", { detail: { on } }));
        });
      }
      if (armSwitch) {
        armSwitch.checked = armillaryOn();
        armSwitch.addEventListener("change", () => {
          const on = armSwitch.checked;
          try { localStorage.setItem(ARMILLARY_KEY, on ? "1" : "0"); } catch (e) { /* 忽略 */ }
          window.dispatchEvent(new CustomEvent("wzsf:armillary", { detail: { on } }));
        });
      }
      syncArmDisabled();

      const btn = document.getElementById("ui-settings");
      if (btn) {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          pop.hidden = !pop.hidden;
          btn.classList.toggle("active", !pop.hidden);
        });
        document.addEventListener("click", (e) => {
          if (!pop.hidden && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            pop.hidden = true;
            btn.classList.remove("active");
          }
        });
      }
    }
    injectSettings();
  });
})();
