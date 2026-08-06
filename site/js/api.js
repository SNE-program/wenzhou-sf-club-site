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
  members: "data/members.json",
};

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
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
    "radial-gradient(120% 130% at 18% 16%, rgba(110,231,249,0.5), transparent 55%),linear-gradient(135deg,#0b1f3a,#123a66 60%,#1e7ab0)",
    "radial-gradient(120% 130% at 82% 20%, rgba(167,139,250,0.55), transparent 55%),linear-gradient(135deg,#160f38,#33226b 60%,#7c5cd6)",
    "radial-gradient(120% 130% at 20% 80%, rgba(110,231,249,0.4), transparent 55%),linear-gradient(135deg,#0a2230,#0e4d5e 60%,#3fb7c9)",
    "radial-gradient(120% 130% at 80% 78%, rgba(245,200,119,0.35), transparent 55%),linear-gradient(135deg,#241038,#5a2a63 60%,#c97ba8)",
    "radial-gradient(120% 130% at 30% 22%, rgba(96,165,250,0.5), transparent 55%),linear-gradient(135deg,#0c1730,#1d3a6e 60%,#4a7fd4)",
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

function dateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
