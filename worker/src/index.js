// ============================================
// 温州中学科幻社 · Notion 数据中转 Worker
// 端点：
//   GET /api/site        站点信息
//   GET /api/activities  活动列表
//   GET /api/works       作品列表
//   GET /api/contests    竞赛列表
//   GET /api/members     成员列表
// 绑定（部署时注入，作为全局变量）：
//   NOTION_TOKEN   Notion 内部连接令牌（ntn_ 开头）
//   DB_SITE        Notion「站点信息」数据库 id
//   DB_ACTIVITIES  Notion「活动」数据库 id
//   DB_WORKS       Notion「作品」数据库 id
//   DB_CONTESTS    Notion「竞赛」数据库 id
//   DB_MEMBERS     Notion「成员」数据库 id
// 使用传统格式（addEventListener），兼容所有部署方式。
// ============================================

const NOTION_VERSION = "2022-06-28";
const CACHE_TTL = 60; // 秒

// ---------- CORS ----------
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function jsonHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
  };
}

// ---------- Notion 字段取值 ----------
function propText(p) {
  if (!p) return "";
  switch (p.type) {
    case "title":
      return p.title.map((t) => t.plain_text).join("");
    case "rich_text":
      return p.rich_text.map((t) => t.plain_text).join("");
    case "select":
      return p.select ? p.select.name : "";
    case "date":
      return p.date ? p.date.start || "" : "";
    case "multi_select":
      return p.multi_select.map((s) => s.name);
    default:
      return "";
  }
}

function propCover(p) {
  if (!p || p.type !== "files" || !p.files || !p.files.length) return null;
  const f = p.files[0];
  return f.type === "external" ? f.external.url : f.file ? f.file.url : null;
}

// ---------- 行 → 前端数据 ----------
function mapActivity(row) {
  const p = row.properties || {};
  return {
    id: row.id,
    title: propText(p["标题"]),
    date: propText(p["日期"]),
    location: propText(p["地点"]),
    summary: propText(p["简介"]),
    tags: p["标签"] && p["标签"].type === "multi_select" ? p["标签"].multi_select.map((s) => s.name) : [],
    cover: propCover(p["封面"]),
  };
}

function mapWork(row) {
  const p = row.properties || {};
  return {
    id: row.id,
    title: propText(p["标题"]),
    author: propText(p["作者"]),
    category: propText(p["分类"]),
    tags: p["标签"] && p["标签"].type === "multi_select" ? p["标签"].multi_select.map((s) => s.name) : [],
    summary: propText(p["简介"]),
    cover: propCover(p["封面"]),
  };
}

function mapContest(row) {
  const p = row.properties || {};
  return {
    id: row.id,
    title: propText(p["标题"]),
    status: propText(p["状态"]),
    deadline: propText(p["投稿截止"]),
    topic: propText(p["主题"]),
    rules: propText(p["规则"]),
    awards: propText(p["奖项设置"]),
    winners: propText(p["获奖名单"]),
  };
}

function mapMember(row) {
  const p = row.properties || {};
  return {
    name: propText(p["姓名"]),
    role: propText(p["角色"]),
    bio: propText(p["简介"]),
  };
}

// ---------- 查询 Notion ----------
async function queryDatabase(dbId, body) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || { page_size: 100 }),
  });
  if (!res.ok) throw new Error(`Notion API ${res.status}`);
  return res.json();
}

async function loadSection(route) {
  switch (route) {
    case "site": {
      const data = await queryDatabase(DB_SITE);
      const p = (data.results[0] || {}).properties || {};
      return {
        name: propText(p["名称"]) || "温州中学科学及幻想文学社",
        slogan: propText(p["标语"]),
        intro: propText(p["简介"]),
        contactEmail: propText(p["联系邮箱"]),
      };
    }
    case "activities": {
      const data = await queryDatabase(DB_ACTIVITIES, {
        page_size: 100,
        sorts: [{ property: "日期", direction: "descending" }],
      });
      return data.results.map(mapActivity).filter((x) => x.title);
    }
    case "works": {
      const data = await queryDatabase(DB_WORKS, { page_size: 100 });
      return data.results.map(mapWork).filter((x) => x.title);
    }
    case "contests": {
      const data = await queryDatabase(DB_CONTESTS, {
        page_size: 100,
        sorts: [{ property: "投稿截止", direction: "ascending" }],
      });
      return data.results.map(mapContest).filter((x) => x.title);
    }
    case "members": {
      const data = await queryDatabase(DB_MEMBERS, { page_size: 100 });
      return data.results.map(mapMember).filter((x) => x.name);
    }
    default:
      throw new Error("unknown section");
  }
}

// ---------- 主入口 ----------
async function handleRequest(request, event) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
  }

  const route = url.pathname.replace(/^\/api\//, "");
  if (!["site", "activities", "works", "contests", "members"].includes(route)) {
    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  }

  // 缓存（60 秒）
  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (res) return res;

  try {
    const data = await loadSection(route);
    res = new Response(JSON.stringify(data), {
      headers: { ...jsonHeaders(), "Cache-Control": `public, max-age=${CACHE_TTL}` },
    });
    event.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: jsonHeaders(),
    });
  }
}

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request, event));
});
