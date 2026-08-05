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
    "linear-gradient(135deg,#22d3ee,#3b82f6)",
    "linear-gradient(135deg,#a78bfa,#6366f1)",
    "linear-gradient(135deg,#22d3ee,#a78bfa)",
    "linear-gradient(135deg,#f472b6,#8b5cf6)",
    "linear-gradient(135deg,#38bdf8,#22c55e)",
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
