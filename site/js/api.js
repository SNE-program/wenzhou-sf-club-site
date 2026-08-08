// ============================================
// API 客户端：优先请求 Cloudflare Worker，
// 请求失败（未部署 / 网络异常）时自动降级到本地 data/*.json
// ============================================

// Worker 部署后，把下面地址换成你的 Worker 域名（如 https://xxx.workers.dev）
const API_BASE = (window.SITE_API || "").replace(/\/+$/, "");

const DATA_FILES = {
  site: "data/site.json",
  activities: "data/activities.json",
  works: "data/works.json",
  contests: "data/contests.json",
  members: "data/members.json",
};

// 3 秒超时兜底：即使 API 不可达，也绝不阻塞页面渲染
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 读取某一类数据；Worker 不可用时自动读本地占位数据 */
async function fetchSection(name) {
  if (API_BASE) {
    try {
      return await getJSON(`${API_BASE}/api/${name}`);
    } catch (e) {
      console.warn(`[站点] Worker 不可用，降级到本地数据：${name}`, e);
    }
  }
  return getJSON(DATA_FILES[name]);
}

/** 由封面 / 标题生成渐变背景（无真实图片时使用），返回内联样式 CSS 字符串 */
function coverStyle(item, seed) {
  if (item && item.cover) {
    return `background-image:url(${item.cover});background-size:cover;background-position:center;`;
  }
  const palettes = [
    "radial-gradient(120% 130% at 18% 16%, rgba(232,177,76,0.5), transparent 55%),linear-gradient(135deg,#1c1030,#5a2a1e 60%,#c9712e)",
    "radial-gradient(120% 130% at 82% 20%, rgba(63,216,197,0.5), transparent 55%),linear-gradient(135deg,#0f2430,#0e4d5e 60%,#3fb7c9)",
    "radial-gradient(120% 130% at 20% 80%, rgba(255,122,89,0.45), transparent 55%),linear-gradient(135deg,#2a1030,#7a2a4d 60%,#e06a8a)",
    "radial-gradient(120% 130% at 80% 78%, rgba(255,209,102,0.4), transparent 55%),linear-gradient(135deg,#201a30,#5a4a1e 60%,#c9a23e)",
    "radial-gradient(120% 130% at 30% 22%, rgba(190,140,255,0.45), transparent 55%),linear-gradient(135deg,#1c1030,#3a2a6e 60%,#7a5cd6)",
  ];
  const idx = Math.abs(String(seed || "").length) % palettes.length;
  return `background:${palettes[idx]};`;
}

/** HTML 转义 */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** 首个字符（用于封面大字） */
function initialOf(str) {
  return (str || "?").trim().charAt(0);
}

/** 自动封面文字：去掉首尾书名号《》，展示完整标题（避免封面全是"《"） */
function coverText(title) {
  const t = String(title == null ? "" : title).trim();
  if (!t) return "?";
  return t.replace(/^《(.*)》$/, "$1").replace(/^《/, "").replace(/》$/, "");
}

function dateLabel(dateStr) {
  if (!dateStr) return "未定";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
