// ============================================
// 公共导航 / 页脚注入 + 当前页高亮
// ============================================
(function () {
  const NAV_ITEMS = [
    { href: "index.html", label: "首页" },
    { href: "activities.html", label: "活动" },
    { href: "works.html", label: "作品" },
    { href: "members.html", label: "成员" },
    { href: "about.html", label: "关于" },
  ];

  function currentPage() {
    const name = location.pathname.split("/").pop() || "index.html";
    return name;
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

  document.addEventListener("DOMContentLoaded", () => {
    const navSlot = document.querySelector("[data-nav]");
    const footSlot = document.querySelector("[data-footer]");
    if (navSlot) navSlot.outerHTML = navHTML();
    if (footSlot) footSlot.outerHTML = footerHTML();

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
