// ============================================
// 时代之树交互（worlds/<id>.html 使用）
// 数据由生成器内嵌在 window.WORLD_TREE（根名称/简介/时代线/枝干）
// 主舞台占满头部栏以下全部区域；时代切换/显示控件置于舞台底部（沉浸式「上升」）
// 无 JS / 数据缺失时降级为页面内静态时代目录（static-dir）
// ============================================
(function () {
  const DATA = window.WORLD_TREE || null;
  if (!DATA || !DATA.name) return;

  const ERAS = Array.isArray(DATA.eras) ? DATA.eras : []; // [{name, range, desc}]
  const HUBS = Array.isArray(DATA.hubs) ? DATA.hubs : []; // [{id,name,theme,era,sort,workCount}]
  const eraIdx = new Map(ERAS.map((e, i) => [e.name, i]));

  const stage = document.getElementById("stage");
  const scene = document.getElementById("scene");
  if (!stage || !scene) return;

  // JS 可用：隐藏无 JS 静态时代目录，启用交互舞台
  const dir = document.getElementById("static-dir");
  if (dir) dir.hidden = true;

  // ---------- 时代点坐标 ----------
  // exp(exp) 双指数参数曲线（与《_示意_时代之树》一致）：
  //   g(t) = (e^e^t − e) / (e^e − e)，g(0)=0 → g(1)=1，前期缓、后期急剧加速
  //   y 用 1−g(t)：底 → 顶，前期时代竖直间距小、越靠后急剧拉开（「上升」感）
  //   x 用 1−g(1−t)：左 → 右，前期横扫推进、后期收敛为竖直攀升
  //   曲线路径按 t 密集采样近似样条，恰好穿过每个时代点（避免折线）
  const X0 = 400, XW = 4200, YB = 180, YH = 4840;
  const EXP1 = Math.exp(1);                       // e
  const EXPEE = Math.exp(Math.exp(1));            // e^e
  const gg = (t) => (Math.exp(Math.exp(t)) - EXP1) / (EXPEE - EXP1);
  function pos(t) { return { x: X0 + XW * (1 - gg(1 - t)), y: YB + YH * (1 - gg(t)) }; }
  const PTS = ERAS.map((_, i) => pos(i / Math.max(1, ERAS.length - 1)));
  const SCENE_W = 5000;
  const SCENE_H = (PTS.length ? Math.max(...PTS.map((p) => p.y)) : 5000) + 600;

  // 时代视觉：随时代进步背景由深色纯色渐变到近纯白
  const eraIcons = [
    "hsl(215 60% 62%)", "hsl(180 55% 68%)", "hsl(252 45% 70%)",
    "hsl(12 62% 76%)", "hsl(140 42% 88%)", "hsl(45 50% 97%)",
  ];
  const HUB_THEME = [
    { bg: "hsl(215 55% 90%)", ink: "#1c2438", dim: "#4a5878", acc: "#2f5bb3" },
    { bg: "hsl(180 45% 93%)", ink: "#18302c", dim: "#4a6e66", acc: "#168a78" },
    { bg: "hsl(252 35% 94%)", ink: "#262040", dim: "#6b6391", acc: "#6a51d4" },
    { bg: "hsl(12 50% 96%)", ink: "#3a241b", dim: "#8a6248", acc: "#b35f38" },
    { bg: "hsl(140 30% 97%)", ink: "#1c2a20", dim: "#6b8a76", acc: "#26894f" },
    { bg: "hsl(45 35% 99%)", ink: "#262626", dim: "#96917c", acc: "#96741f" },
  ];
  function eraTheme(i) {
    return i >= 0 && i < HUB_THEME.length ? HUB_THEME[i] : HUB_THEME[HUB_THEME.length - 1];
  }

  // ---------- 场景与静态层（曲线 + 时代刻度） ----------
  scene.style.width = SCENE_W + "px";
  scene.style.height = SCENE_H + "px";
  const svgEl = scene.querySelector("svg");
  if (svgEl) {
    svgEl.setAttribute("width", SCENE_W);
    svgEl.setAttribute("height", SCENE_H);
    svgEl.setAttribute("viewBox", `0 0 ${SCENE_W} ${SCENE_H}`);
  }

  const cursor = document.createElement("div");
  cursor.className = "tree-cursor";
  scene.appendChild(cursor);

  if (svgEl) {
    // 光滑曲线：260 段密集采样近似样条，恰好穿过每个时代点（避免折线）
    const N = 260;
    const segs = [];
    for (let k = 0; k <= N; k++) {
      const p = pos(k / N);
      segs.push((k === 0 ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1));
    }
    svgEl.querySelector("path").setAttribute("d", segs.join(" "));
  }

  const eraEls = [];
  PTS.forEach((p, i) => {
    const dot = document.createElement("div");
    dot.className = "tree-era-dot" + (i === 0 ? " active" : "");
    dot.style.left = p.x + "px";
    dot.style.top = p.y + "px";
    dot.style.background = i === 0 ? "#7cc4ff" : eraIcons[i];
    dot.dataset.era = i;
    dot.addEventListener("click", () => eraClick(i));
    dot.style.cursor = "pointer";
    scene.appendChild(dot);
    const tag = document.createElement("div");
    tag.className = "tree-era-tag";
    tag.textContent = ERAS[i].name;
    tag.style.left = p.x + "px";
    tag.style.top = p.y + 30 + "px";
    tag.style.color = eraIcons[i];
    tag.addEventListener("click", () => eraClick(i));
    tag.style.cursor = "pointer";
    scene.appendChild(tag);
    eraEls.push({ dot, tag });
  });

  // ---------- 中心页节点（枝干） ----------
  const byEra = new Map(); // eraIdx -> [hub]
  const unassigned = []; // era 为空 → 根级未归档
  HUBS.forEach((h) => {
    const i = h.era ? eraIdx.get(h.era) : -1;
    if (i >= 0) {
      if (!byEra.has(i)) byEra.set(i, []);
      byEra.get(i).push(h);
    } else {
      unassigned.push(h);
    }
  });

  function hubNode(h, unanchored) {
    const el = document.createElement("div");
    el.className = "tree-hub" + (unanchored ? " unanchored" : "");
    const theme = (h.theme ? "主题 · " + h.theme : "根级未归档");
    el.innerHTML =
      `<div class="h-name">${esc(h.name)}</div>` +
      `<div class="h-theme">${esc(theme)}</div>` +
      `<div class="h-count">${h.workCount} 篇</div>`;
    scene.appendChild(el);
    el.addEventListener("click", () => { location.href = "worlds/" + encodeURIComponent(h.id) + ".html"; });
    return el;
  }

  const hubEls = []; // 可随时代切换的节点
  const unassignedEls = []; // 常驻的根级未归档节点
  byEra.forEach((list, i) => {
    list.forEach((h, k) => hubEls.push({ el: hubNode(h), h, era: i, idx: k, count: list.length }));
  });
  unassigned.forEach((h) => unassignedEls.push({ el: hubNode(h, true), h, era: -1 }));

  // ---------- 相机 + 节点切换 ----------
  let cur = 0;
  // 手机/窄屏：节点缩小、散布收敛、边界按真实视口约束（配合模板里的 @media 缩小 .tree-hub）
  const narrow = stage.clientWidth < 640;

  function placeHub(el, x, y, scale) {
    const hw = narrow ? 160 : 230; // 节点半宽余量（CSS 宽度 + 边距）
    x = Math.max(30, Math.min(SCENE_W - hw, x));
    y = Math.max(26, Math.min(SCENE_H - 120, y));
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.transform = `translate(-50%,-50%) scale(${scale || 1})`;
  }

  function viewClamp(p, x, y) {
    // 以当前时代点为中心的「实际可见窗口」：宽 = 舞台宽，高 = 舞台高（预留底部控件区）
    const vw = stage.clientWidth / 2;
    const vh = Math.min(280, Math.max(130, stage.clientHeight / 2 - 60));
    const vx0 = Math.max(0, p.x - vw), vx1 = Math.min(SCENE_W, p.x + vw);
    const vy0 = Math.max(0, p.y - vh), vy1 = Math.min(SCENE_H, p.y + vh);
    return {
      x: Math.max(vx0, Math.min(vx1, x)),
      y: Math.max(vy0, Math.min(vy1, y)),
    };
  }

  function showHub(el, h, era, idx, count) {
    const t = eraTheme(era);
    el.style.setProperty("--bg", t.bg);
    el.style.setProperty("--ink", t.ink);
    el.style.setProperty("--dim", t.dim);
    el.style.setProperty("--acc", t.acc);
    el.style.display = "block";
    const p = PTS[era];
    placeHub(el, p.x, p.y, 0.4);
    el.style.opacity = "0";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // 散布半径按视口缩放：窄屏（手机）收敛、桌面保持原节奏
      const spread = Math.min(narrow ? 150 : 270, (narrow ? 80 : 170) + count * 40);
      const dx = (idx - (count - 1) / 2) * spread;
      const dy = (narrow ? 34 : 90) + (idx % 2) * (narrow ? 50 : 90) - 45;
      const q = viewClamp(p, p.x + dx, p.y + dy);
      placeHub(el, q.x, q.y, 1);
      el.style.opacity = "1";
      el.style.borderColor = eraIcons[era] || t.acc;
    }));
  }

  function hideHub(el) {
    el.style.opacity = "0";
    setTimeout(() => { el.style.display = "none"; }, 240);
  }

  function moveFloating() {
    // 常驻的根级未归档枝干：不随时代消失，在当前时代点附近变换位置
    const p = PTS.length ? PTS[Math.min(cur, PTS.length - 1)] : { x: 400, y: 500 };
    const rnd = (a, b) => a + Math.random() * (b - a);
    unassignedEls.forEach((u) => {
      const el = u.el;
      el.style.display = "block";
      const k = narrow ? 0.5 : 1; // 窄屏：常驻节点散布范围收敛
      const q = viewClamp(p, p.x + rnd(-430, 430) * k, p.y + rnd(-170, 170) * k);
      placeHub(el, q.x, q.y, 1);
      el.style.opacity = "1";
    });
  }

  function go(next) {
    if (next < 0 || next >= PTS.length) return;
    cur = next;
    const t0 = eraTheme(cur);
    stage.style.background = t0.bg;
    stage.style.borderColor = t0.dim;
    const p = PTS[cur];
    const tx = stage.clientWidth / 2 - p.x;
    const ty = stage.clientHeight / 2 - p.y;
    scene.style.transform = `translate(${tx}px, ${ty}px)`;

    eraEls.forEach((e, i) => {
      e.dot.classList.toggle("active", i === cur);
      e.dot.style.background = i === cur ? t0.acc : eraIcons[i];
      e.dot.style.boxShadow = i === cur ? "0 0 22px 7px rgba(124,196,255,.85)" : "none";
      e.tag.classList.toggle("active", i === cur);
      if (i === cur) {
        e.tag.style.background = t0.bg;
        e.tag.style.color = t0.ink;
        e.tag.style.boxShadow = `0 0 0 2px ${t0.ink}`;
      } else {
        e.tag.style.background = "rgba(242,236,217,.3)";
        e.tag.style.color = "#3a3f4c";
        e.tag.style.boxShadow = "none";
      }
    });
    cursor.style.left = p.x + "px";
    cursor.style.top = p.y + "px";

    hubEls.forEach(({ el, h, era, idx, count }) => {
      if (era === cur) showHub(el, h, era, idx, count);
      else hideHub(el);
    });
    moveFloating();

    if (ERAS[cur]) {
      document.getElementById("era-label").innerHTML =
        esc(ERAS[cur].name) + `<small>${esc(ERAS[cur].range)}</small>`;
    } else {
      document.getElementById("era-label").textContent = "未归档";
    }
    fillEraPanel(cur);
    document.getElementById("btn-back").disabled = cur === 0;
    document.getElementById("btn-fwd").disabled = cur === PTS.length - 1;
  }

  // ▶ = 时代进步（向更未来）；◀ = 退回过去
  const btnBack = document.getElementById("btn-back");
  const btnFwd = document.getElementById("btn-fwd");
  if (btnBack) btnBack.addEventListener("click", () => go(cur - 1));
  if (btnFwd) btnFwd.addEventListener("click", () => go(cur + 1));

  // ---------- 时代详情折叠卡（左上角入口） ----------
  const eraPanel = document.getElementById("era-panel");
  const eraInfoBtn = document.getElementById("era-info-btn");
  const eraInfoArrow = document.getElementById("era-info-arrow");
  function setEraOpen(open) {
    if (!eraPanel) return;
    eraPanel.hidden = !open;
    if (eraInfoBtn) eraInfoBtn.classList.toggle("era-open", open);
    if (eraInfoArrow) eraInfoArrow.textContent = open ? "▴" : "▾";
  }
  function fillEraPanel(i) {
    if (!eraPanel) return;
    const e = ERAS[i];
    if (!e || !e.desc) { setEraOpen(false); return; }
    document.getElementById("ep-name").textContent = e.name;
    document.getElementById("ep-range").textContent = e.range || "";
    const q = document.getElementById("ep-quote");
    if (e.quote) {
      q.textContent = e.quote;
      q.hidden = false;
    } else {
      q.hidden = true;
    }
    document.getElementById("ep-desc").textContent = e.desc;
  }
  function openEraPanelIfAvail() {
    if (!eraPanel) return false;
    const e = ERAS[cur];
    if (!e || !e.desc) return false;
    fillEraPanel(cur);
    setEraOpen(true);
    return true;
  }
  function toggleEraPanel() {
    if (!eraPanel) return;
    if (eraPanel.hidden) openEraPanelIfAvail();
    else setEraOpen(false);
  }
  function eraClick(i) {
    if (cur === i) toggleEraPanel();
    else { go(i); openEraPanelIfAvail(); }
  }
  if (eraInfoBtn) eraInfoBtn.addEventListener("click", toggleEraPanel);
  const epClose = document.getElementById("ep-close");
  if (epClose) epClose.addEventListener("click", () => setEraOpen(false));

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- 启动 ----------
  if (PTS.length) {
    go(0);
  } else {
    // 无时代线：只显示未归档枝干
    stage.style.background = HUB_THEME[HUB_THEME.length - 1].bg;
    document.getElementById("era-label").textContent = "未归档";
    btnBack.disabled = true;
    btnFwd.disabled = true;
    moveFloating();
  }
})();
