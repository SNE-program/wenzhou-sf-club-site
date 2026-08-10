// ============================================
// 温州中学科幻社 · Notion 数据中转 Worker
// 端点：
//   GET /api/site        站点信息
//   GET /api/activities  活动列表
//   GET /api/works       作品列表
//   GET /api/contests    竞赛列表
//   GET /api/members     成员列表
//   GET /api/worlds      世界观列表（根 + 时代线 + 枝干中心页，聚合作品数）
//   定时任务（每 5 分钟，投稿闭环兜底 + 内容同步触发）：
//     已通过→自动转录发布+上架邮件；已拒绝→发送拒绝邮件
//     对比 Notion 与仓库 main 数据指纹，有变化则 repository_dispatch
//     触发 sync-notion 工作流重建静态数据（GitHub 定时任务不可靠，见下）
//   投稿审核操作由 Supabase Edge Function「submission-review」处理
//   （supabase.co 在国内可访问；workers.dev 不可达）
// 绑定（部署时注入，作为全局变量）：
//   NOTION_TOKEN   Notion 内部连接令牌（ntn_ 开头）
//   DB_SITE / DB_ACTIVITIES / DB_WORKS / DB_CONTESTS / DB_MEMBERS / DB_SUBMISSIONS
//   DB_WORLDS（世界观表=根）/ DB_HUBS（中心页表=枝干）
//   SITE_BASE      站内链接前缀（默认 github.io 地址）
//   RESEND_API_KEY（secret）/ RESEND_FROM  投稿结果邮件
//   GH_REPO（var）/ GH_TOKEN（secret） 内容同步触发 GitHub 工作流
// 使用传统格式（addEventListener），兼容所有部署方式。
// ============================================

const NOTION_VERSION = "2022-06-28";
const CACHE_TTL = 60; // 秒
// Cloudflare 将 vars 绑定以 const 注入，typeof 读取会触发 TDZ；改经 globalThis 安全读取
const SITE_BASE = (globalThis.SITE_BASE && typeof globalThis.SITE_BASE === "string")
  ? globalThis.SITE_BASE
  : "https://wzmssf.club";
const RESEND_FROM = (globalThis.RESEND_FROM && typeof globalThis.RESEND_FROM === "string")
  ? globalThis.RESEND_FROM
  : "onboarding@resend.dev";
// Supabase 绑定（[vars] 注入）：配置后世界观/中心页优先读库（后台在线维护），否则降级 Notion
const SUPABASE_URL = (globalThis.SUPABASE_URL && typeof globalThis.SUPABASE_URL === "string")
  ? globalThis.SUPABASE_URL
  : "";
const SUPABASE_ANON_KEY = (globalThis.SUPABASE_ANON_KEY && typeof globalThis.SUPABASE_ANON_KEY === "string")
  ? globalThis.SUPABASE_ANON_KEY
  : "";

// ---------- CORS ----------
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    body: propText(p["正文"]),
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
    body: propText(p["正文"]),
    cover: propCover(p["封面"]),
    status: propText(p["发布状态"]),
    hub: propText(p["所属中心页"]),
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

function propBool(p) {
  if (!p || p.type !== "checkbox") return false;
  return !!p.checkbox;
}

// ---------- 世界观（根）/ 中心页（枝干） 双表 ----------
/** 杂文保留名：挂到这些中心页名下的作品一律按杂文处理 */
const RESERVED_OUTSIDE = new Set(["宇宙与时间之外", "世界与时间之外"]);

/** 时代线解析（三处保持一致：gen-site-data / Worker / admin-worlds）：
 *  每条时代以「名称 | 时间段 | 简介首段」起头，其后可跟续段与引言行；
 *  以 “ 开头的行 → quote（引言），其余续行 → 追加到 desc 段落 */
function parseEras(text) {
  const eras = [];
  let cur = null;
  for (const line of String(text || "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const parts = line.split("|");
    const isHead = parts.length >= 3 && parts[0].trim() && parts[1].trim();
    if (isHead) {
      if (cur) eras.push(cur);
      cur = { name: parts[0].trim(), range: parts[1].trim(), desc: parts.slice(2).join("|").trim(), quote: "" };
    } else if (cur) {
      if (line.startsWith("“")) cur.quote = (cur.quote ? cur.quote + "\n" : "") + line;
      else cur.desc = (cur.desc ? cur.desc + "\n" : "") + line;
    }
  }
  if (cur) eras.push(cur);
  return eras.filter((e) => e.name);
}

function mapWorld(row) {
  const p = row.properties || {};
  return {
    id: row.id,
    name: propText(p["名称"]),
    summary: propText(p["简介"]),
    body: propText(p["设定正文"]),
    eras: parseEras(propText(p["时代线"])),
    cover: propCover(p["封面"]),
    shown: propBool(p["是否展示"]),
    kind: "world", // Notion 世界观表无类型列；类世界观（宇宙与时间之外）由保留中心页合成
  };
}

function mapHub(row) {
  const p = row.properties || {};
  return {
    id: row.id,
    name: propText(p["名称"]),
    world: propText(p["所属世界观"]),
    era: propText(p["所属时代"]),
    theme: propText(p["主题"]),
    summary: propText(p["简介"]),
    body: propText(p["设定正文"]),
    sort: p["排序"] && p["排序"].type === "number" ? p["排序"].number || 0 : 0,
    cover: propCover(p["封面"]),
    shown: propBool(p["是否展示"]),
  };
}

/** 从 Supabase 读取某表全部行（配置了 SUPABASE_URL/ANON_KEY 时使用） */
async function querySupabase(table, select, order) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(order)}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function loadWorlds() {
  // 世界观优先读 Supabase（后台在线维护）；未配置或读取报错则降级 Notion
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const rows = await querySupabase(
        "worlds",
        "id,name,summary,body,eras_text,cover,shown,kind,sort_order",
        "sort_order.asc"
      );
      return rows
        .map((r) => ({
          id: r.id,
          name: r.name,
          summary: r.summary,
          body: r.body,
          eras: parseEras(r.eras_text),
          cover: r.cover || "",
          shown: !!r.shown,
          kind: r.kind === "meta" ? "meta" : "world",
        }))
        .filter((x) => x.name && x.shown);
    } catch (e) {
      console.warn("[api] Supabase worlds 读取失败，降级 Notion", e.message);
    }
  }
  const data = await queryDatabase(DB_WORLDS, { page_size: 100 });
  const worlds = data.results.map(mapWorld).filter((x) => x.name && x.shown);
  // Notion 模式：把保留名中心页（宇宙与时间之外等）合成为「类世界观」根
  const meta = await loadMetaWorldFromNotion();
  if (meta && meta.shown && !worlds.some((w) => w.name === meta.name)) {
    worlds.push(meta);
  }
  return worlds;
}

/** Notion 降级路径：从中心页表中把保留名行合成为一个类世界观根（kind='meta'，无时代线） */
async function loadMetaWorldFromNotion() {
  const data = await queryDatabase(DB_HUBS, { page_size: 100 });
  const rows = data.results.map(mapHub).filter((x) => x.name && RESERVED_OUTSIDE.has(x.name));
  if (!rows.length) return null;
  const pick = rows.find((r) => r.name === "宇宙与时间之外") || rows[0];
  return {
    id: pick.id,
    name: pick.name,
    summary: pick.summary,
    body: pick.body,
    eras: [],
    cover: pick.cover,
    shown: pick.shown,
    kind: "meta",
  };
}

async function loadHubs() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const rows = await querySupabase(
        "hubs",
        "id,name,world,era,theme,summary,body,sort,cover,shown",
        "world.asc,sort.asc"
      );
      // 保留名行（宇宙与时间之外 / 世界与时间之外）不视为枝干中心页，直接剔除
      return rows
        .map((r) => ({
          id: r.id,
          name: r.name,
          world: r.world,
          era: r.era,
          theme: r.theme,
          summary: r.summary,
          body: r.body,
          sort: r.sort || 0,
          cover: r.cover || "",
          shown: !!r.shown,
        }))
        .filter((x) => x.name && x.shown && !RESERVED_OUTSIDE.has(x.name));
    } catch (e) {
      console.warn("[api] Supabase hubs 读取失败，降级 Notion", e.message);
    }
  }
  const data = await queryDatabase(DB_HUBS, { page_size: 100 });
  // 保留名行（宇宙与时间之外 / 世界与时间之外）不视为枝干中心页，直接剔除
  return data.results
    .map(mapHub)
    .filter((x) => x.name && x.shown && !RESERVED_OUTSIDE.has(x.name));
}

/** 据「所属中心页」推导 hubId/world/worldId/era：
 *  中心页为空 / 为保留名 / 已停用或不存在 → 自动并入「类世界观」（kind='meta'），
 *  仅当类世界观未配置时保持杂文置空（hub 及衍生字段全部置空） */
async function annotateWorks(works) {
  const [worlds, hubs] = await Promise.all([loadWorlds(), loadHubs()]);
  const meta = worlds.find((x) => x.kind === "meta");
  const worldByName = new Map(worlds.map((w) => [w.name, w]));
  const hubByName = new Map(hubs.map((h) => [h.name, h]));
  for (const w of works) {
    const name = String(w.hub || "").trim();
    const hub = name && !RESERVED_OUTSIDE.has(name) ? hubByName.get(name) : null;
    if (!hub) {
      w.hub = "";
      w.hubId = "";
      w.era = "";
      if (meta) {
        w.world = meta.name;
        w.worldId = meta.id;
      } else {
        w.world = "";
        w.worldId = "";
      }
      continue;
    }
    const world = worldByName.get(hub.world);
    w.hubId = hub.id;
    w.world = hub.world;
    w.worldId = world ? world.id : "";
    w.era = hub.era;
  }
}

/** 聚合 worlds 数据（与 gen-site-data.mjs loadWorldsData 一致）：根 + 时代线 + 枝干（作品数） */
async function loadWorldsSection() {
  const [worlds, hubs, works] = await Promise.all([loadWorlds(), loadHubs(), loadWorksSection()]);
  const countByHub = new Map();
  const countByWorld = new Map();
  for (const wk of works) {
    if (wk.hubId) countByHub.set(wk.hubId, (countByHub.get(wk.hubId) || 0) + 1);
    if (wk.worldId) countByWorld.set(wk.worldId, (countByWorld.get(wk.worldId) || 0) + 1);
  }
  return worlds.map((w) => {
    const eraOrder = new Map(w.eras.map((e, i) => [e.name, i]));
    const hubList = hubs
      .filter((h) => h.world === w.name)
      .map((h) => ({
        id: h.id,
        name: h.name,
        theme: h.theme,
        era: eraOrder.has(h.era) ? h.era : "", // 不匹配根时代名 → 根级未归档兜底
        sort: h.sort,
        workCount: countByHub.get(h.id) || 0,
      }))
      .sort((a, b) => {
        const ai = a.era ? eraOrder.get(a.era) : -1;
        const bi = b.era ? eraOrder.get(b.era) : -1;
        return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi) || a.sort - b.sort || a.name.localeCompare(b.name, "zh");
      });
    return {
      id: w.id,
      name: w.name,
      kind: w.kind || "world",
      summary: w.summary,
      body: w.body,
      eras: w.eras,
      cover: w.cover,
      hubs: hubList,
      hubCount: hubList.length,
      workCount: countByWorld.get(w.id) || 0,
    };
  });
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
      const works = data.results.map(mapWork).filter((x) => x.title && x.status !== "已下架");
      // 世界观标注（hub/hubId/world/worldId/era）；双表不可用时容错为杂文
      try {
        await annotateWorks(works);
      } catch (e) {
        console.warn("[api] works 世界观标注失败（按杂文处理）", e.message);
      }
      return works;
    }
    case "worlds":
      return loadWorldsSection();
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

  const route = url.pathname.replace(/^\/api\//, "");

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
  }

  if (!["site", "activities", "works", "contests", "members", "worlds"].includes(route)) {
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

// ============================================
// 投稿自动发布模块（审核动作由 Supabase Edge Function 处理）
// ============================================

/** 从投稿行提取前端需要的字段 */
function mapSubmission(row) {
  const p = row.properties || {};
  const cover = propCover(p["封面"]);
  const attFile = p["附件"] && p["附件"].files && p["附件"].files[0] ? p["附件"].files[0] : null;
  const attachment = attFile
    ? {
        name: attFile.name || "",
        url: attFile.type === "external" ? attFile.external.url : (attFile.file || {}).url || "",
      }
    : null;
  return {
    id: row.id,
    title: propText(p["作品标题"]),
    author: propText(p["作者笔名"]),
    types: p["投稿类型"]?.type === "multi_select" ? p["投稿类型"].multi_select.map((s) => s.name) : [],
    body: propText(p["正文内容"]),
    cover, // null 或 {type:"external"|"file", url}
    attachment, // null 或 {name, url}
    email: propText(p["邮箱"]),
    contests: p["所属竞赛"]?.type === "multi_select" ? p["所属竞赛"].multi_select.map((s) => s.name) : [],
    hub: propText(p["所属中心页"]), // 所属中心页（选填）；空 = 杂文
    created: p["提交时间"]?.type === "created_time" ? p["提交时间"].created_time : "",
  };
}

async function notionPage(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION },
  });
  if (!res.ok) throw new Error(`Notion 读取失败 ${res.status}`);
  return res.json();
}

async function updateSubmitRow(pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`Notion 更新失败 ${res.status}`);
  return res.json();
}

/** 查询投稿箱（按状态过滤） */
async function querySubmitDB(status) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DB_SUBMISSIONS}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_size: 50,
      filter: { property: "审核状态", status: { equals: status } },
    }),
  });
  if (!res.ok) throw new Error(`Notion 查询失败 ${res.status}`);
  return (await res.json()).results || [];
}

/** 把长文本按 ≤2000 字符切成多个 Notion rich_text 块（空串返回单空块） */
function chunkText(s, size = 2000) {
  const str = String(s ?? "");
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push({ text: { content: str.slice(i, i + size) } });
  }
  return chunks.length ? chunks : [{ text: { content: "" } }];
}

/** 在正式作品库创建作品条目，返回新条目 id */
async function createWorkPage(sub) {
  const cats = ["短篇小说", "世界观设定", "科普随笔"];
  // 分类已支持多选：写入所有命中分类；未命中时兜底"其他"
  const workCats = sub.types.filter((t) => cats.includes(t));
  const finalCats = [...new Set(workCats.length ? workCats : ["其他"])];
  const tags = sub.types.filter((t) => !cats.includes(t));
  if (sub.contests.length) tags.push(...sub.contests);

  const properties = {
    "标题": { title: [{ text: { content: sub.title } }] },
    "作者": { rich_text: [{ text: { content: sub.author || "匿名" } }] },
    "分类": { multi_select: finalCats.map((n) => ({ name: n })) },
    // 简介 = 短摘要（列表卡片展示）；正文 = 完整内容按 2000 分块（Notion rich_text 单块上限）
    "简介": { rich_text: [{ text: { content: String(sub.body || "").replace(/\s+/g, " ").trim().slice(0, 200) || sub.title } }] },
    "正文": { rich_text: chunkText(sub.body || "") },
    // 审核通过转录即发布：发布状态置为「已上架」（公开数据读取端仅排除「已下架」）
    "发布状态": { select: { name: "已上架" } },
  };
  if (tags.length) properties["标签"] = { multi_select: [...new Set(tags)].map((n) => ({ name: n })) };
  // 封面仅转录外部链接（避免 Notion 临时文件链接过期裂图）
  if (sub.cover && sub.cover.type === "external" && sub.cover.url) {
    properties["封面"] = { files: [{ name: "cover", external: { url: sub.cover.url } }] };
  }
  if (sub.attachment && sub.attachment.url) {
    properties["附件"] = {
      files: [{ name: sub.attachment.name || "attachment", external: { url: sub.attachment.url } }],
    };
  }
  // 所属中心页（选填）：转录时挂靠枝干，作品库无此列则容错为杂文
  if (sub.hub) {
    properties["所属中心页"] = { select: { name: String(sub.hub).slice(0, 50) } };
  }

  const mkBody = () =>
    JSON.stringify({ parent: { database_id: DB_WORKS }, properties });

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: mkBody(),
  });
  if (!res.ok) {
    // 作品库缺「附件」列时：去掉附件字段重试，保证作品创建成功（附件下次在投稿箱仍可查看）
    if (res.status === 400 && properties["附件"]) {
      delete properties["附件"];
      const retry = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: mkBody(),
      });
      if (retry.ok) return (await retry.json()).id;
    }
    // 作品库缺「正文」列时：正文并入「简介」（全文，兼容旧结构）
    if (res.status === 400 && properties["正文"]) {
      delete properties["正文"];
      properties["简介"] = { rich_text: chunkText(String(sub.body || "")) };
      const retry = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: mkBody(),
      });
      if (retry.ok) return (await retry.json()).id;
    }
    // 作品库缺「所属中心页」列时：去掉该字段重试（容错为杂文，不阻塞发布）
    if (res.status === 400 && properties["所属中心页"]) {
      delete properties["所属中心页"];
      const retry = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: mkBody(),
      });
      if (retry.ok) return (await retry.json()).id;
    }
    // 作品库缺「发布状态」列时：去掉该字段重试（不阻塞发布）
    if (res.status === 400 && properties["发布状态"]) {
      delete properties["发布状态"];
      const retry = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: mkBody(),
      });
      if (retry.ok) return (await retry.json()).id;
    }
    throw new Error(`创建作品失败 ${res.status}`);
  }
  return (await res.json()).id;
}

/** 发送邮件（Resend；未配置 key 时静默跳过） */
async function sendMail({ to, subject, html, text }) {
  if (!RESEND_API_KEY || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/** 已通过的投稿：转录到作品库 → 回填 → 发上架邮件 */
async function publishSubmission(pageId) {
  const row = await notionPage(pageId);
  const sub = mapSubmission(row);
  if (!sub.title) throw new Error("投稿缺少标题");

  const workId = await createWorkPage(sub);
  await updateSubmitRow(pageId, {
    "审核状态": { status: { name: "已发布" } },
    "作品ID": { rich_text: [{ text: { content: workId } }] },
    "同步时间": { date: { start: new Date().toISOString() } },
  });

  // 上架邮件（动态文章页链接，无需等静态页部署）
  if (sub.email) {
    const url = `${SITE_BASE}/article.html?id=${encodeURIComponent(workId)}&type=works`;
    await sendMail({
      to: sub.email,
      subject: `《${sub.title}》已上架 · 温州中学科学及幻想文学社`,
      text: `你好${sub.author ? "，" + sub.author : ""}！\n\n你的作品《${sub.title}》已通过审核并发布到社团网站：\n${url}\n\n—— 温州中学科学及幻想文学社`,
      html: `
      <div style="background:#0b1120;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#111a2e;border:1px solid #243049;border-radius:16px;padding:32px 28px;">
          <div style="font-size:15px;font-weight:700;color:#22d3ee;letter-spacing:1px;margin-bottom:20px;">✦ 温州中学科学及幻想文学社</div>
          <div style="font-size:22px;font-weight:700;color:#22d3ee;margin-bottom:18px;">🚀 作品已上架</div>
          <div style="font-size:15px;line-height:1.8;color:#cbd5e1;margin-bottom:24px;">
            <p style="margin:0 0 10px;">你好，${escHtml(sub.author || "星友")}！</p>
            <p style="margin:0 0 10px;">你的作品《<b style="color:#f1f5f9;">${escHtml(sub.title)}</b>》已通过审核，正式发布在社团网站。</p>
            <p style="margin:0;">快去看看吧，也欢迎分享给朋友：</p>
          </div>
          <a href="${escHtml(url)}" style="display:inline-block;background:linear-gradient(135deg,#22d3ee,#a78bfa);color:#081018;text-decoration:none;font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px;">📖 阅读作品</a>
          <div style="margin-top:28px;padding-top:16px;border-top:1px solid #243049;font-size:12px;color:#64748b;">本邮件由系统自动发送，请勿直接回复。</div>
        </div>
      </div>`,
    });
  }
  return workId;
}

/** 已拒绝的投稿：发拒绝邮件（含原因）并标记已通知 */
async function rejectAndNotify(pageId) {
  const row = await notionPage(pageId);
  const sub = mapSubmission(row);
  const reason = propText(row.properties["拒绝原因"]);
  if (sub.email) {
    await sendMail({
      to: sub.email,
      subject: `关于《${sub.title}》的投稿 · 温州中学科学及幻想文学社`,
      text: `你好${sub.author ? "，" + sub.author : ""}！\n\n你的作品《${sub.title}》暂未通过本次审核。${reason ? "原因：" + reason + "\n" : ""}\n如有疑问，可在网站的「关于」页联系我们。\n\n—— 温州中学科学及幻想文学社`,
      html: `
      <div style="background:#0b1120;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#111a2e;border:1px solid #243049;border-radius:16px;padding:32px 28px;">
          <div style="font-size:15px;font-weight:700;color:#22d3ee;letter-spacing:1px;margin-bottom:20px;">✦ 温州中学科学及幻想文学社</div>
          <div style="font-size:22px;font-weight:700;color:#f87171;margin-bottom:18px;">😔 投稿未通过</div>
          <div style="font-size:15px;line-height:1.8;color:#cbd5e1;margin-bottom:24px;">
            <p style="margin:0 0 10px;">你好，${escHtml(sub.author || "星友")}！</p>
            <p style="margin:0 0 10px;">你的作品《<b style="color:#f1f5f9;">${escHtml(sub.title)}</b>》暂未通过本次审核。</p>
            ${reason ? `<p style="margin:0 0 10px;">原因：<b style="color:#fbbf24;">${escHtml(reason)}</b></p>` : ""}
            <p style="margin:0;">如有疑问，可在网站「关于」页联系我们，期待你的下一次投稿。</p>
          </div>
          <div style="margin-top:28px;padding-top:16px;border-top:1px solid #243049;font-size:12px;color:#64748b;">本邮件由系统自动发送，请勿直接回复。</div>
        </div>
      </div>`,
    });
  }
  await updateSubmitRow(pageId, { "已通知": { checkbox: true } });
}

/** 定时任务：兜底处理"已通过未发布"和"已拒绝未通知" */
async function handleScheduled() {
  try {
    const approved = await querySubmitDB("已通过");
    for (const row of approved) {
      try {
        if (!propText(row.properties["作品ID"])) {
          await publishSubmission(row.id);
        }
      } catch (e) {
        console.error("[submit] 发布失败（下次重试）", row.id, e.message);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    const rejected = await querySubmitDB("已拒绝");
    for (const row of rejected) {
      try {
        if (!row.properties["已通知"]?.checkbox) {
          await rejectAndNotify(row.id);
        }
      } catch (e) {
        console.error("[submit] 拒绝通知失败（下次重试）", row.id, e.message);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) {
    console.error("[submit] 定时任务失败", e.message);
  }
  // 内容同步检查（内部自带 try/catch，失败不影响投稿兜底）
  await maybeTriggerSync();
}

// ============================================
// Notion → GitHub Pages 近实时内容同步
// GitHub Actions 的 schedule 不可靠（best-effort，且仓库闲置 60 天停摆），
// 因此由本 Worker 每 5 分钟对比 Notion 与仓库 main 分支的数据指纹，
// 内容变化时通过 repository_dispatch 触发 sync-notion 工作流重建静态数据
// 并提交回 main（push 自动触发 GitHub Pages 部署）。需配置密钥 GH_TOKEN。
// ============================================
const GH_REPO = (globalThis.GH_REPO && typeof globalThis.GH_REPO === "string")
  ? globalThis.GH_REPO
  : "SNE-program/wenzhou-sf-club-site";
const SYNC_FILES = {
  site: "site.json",
  activities: "activities.json",
  works: "works.json",
  contests: "contests.json",
  members: "members.json",
  worlds: "worlds.json",
};

/** 封面稳定标识：Notion 临时文件取 S3 路径（签名参数会轮换，忽略）；外链原样保留 */
function coverKeyOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/prod-files|amazonaws/i.test(u.hostname)) return u.pathname.replace(/^\//, "");
    return url;
  } catch {
    return url;
  }
}

/** 单条指纹：剔除会轮换/本地化的 cover、attachment 字段，保留稳定的 coverKey / attachmentKey */
function itemFingerprint(item) {
  const { cover, attachment, ...rest } = item || {};
  return {
    ...rest,
    coverKey: item && item.coverKey !== undefined ? item.coverKey : coverKeyOf(cover),
    attachmentKey:
      item && item.attachmentKey !== undefined
        ? item.attachmentKey
        : item && item.attachment && item.attachment.url
          ? coverKeyOf(item.attachment.url)
          : null,
  };
}

/** 区块指纹：数组按稳定键排序，消除 Notion 返回顺序波动 */
function sectionFingerprint(sections) {
  const out = {};
  for (const [k, v] of Object.entries(sections)) {
    out[k] = Array.isArray(v)
      ? v
          .map(itemFingerprint)
          .sort((a, b) =>
            String(a.id ?? a.name ?? JSON.stringify(a)).localeCompare(
              String(b.id ?? b.name ?? JSON.stringify(b))
            )
          )
      : itemFingerprint(v);
  }
  return JSON.stringify(out);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 触发 sync-notion 工作流重建静态数据 */
async function dispatchSync(reason) {
  if (typeof GH_TOKEN === "undefined" || !GH_TOKEN) {
    console.log("[sync] 未配置 GH_TOKEN 密钥，跳过自动触发（依赖 GitHub 定时任务兜底）");
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "sync-notion", client_payload: { reason } }),
  });
  if (!res.ok) {
    console.error(`[sync] 触发 GitHub 工作流失败 ${res.status}: ${(await res.text().catch(() => ""))}`);
  } else {
    console.log("[sync] 已触发 GitHub 数据重建（repository_dispatch:", reason + "）");
  }
}

/** 对比 Notion 与仓库 main 分支数据，发生变化时触发重建 */
async function maybeTriggerSync() {
  try {
    const fresh = {};
    for (const route of Object.keys(SYNC_FILES)) fresh[route] = await loadSection(route);
    const freshHash = await sha256Hex(sectionFingerprint(fresh));

    const repo = {};
    for (const [route, file] of Object.entries(SYNC_FILES)) {
      const res = await fetch(`https://raw.githubusercontent.com/${GH_REPO}/main/site/data/${file}`, {
        headers: { "User-Agent": "wzsf-site-sync" },
      });
      if (res.ok) repo[route] = await res.json();
      else if (res.status !== 404) throw new Error(`仓库数据 ${file} 读取失败 ${res.status}`);
    }
    const repoHash = await sha256Hex(sectionFingerprint(repo));

    if (freshHash !== repoHash) {
      await dispatchSync("notion-content-changed");
    } else {
      console.log("[sync] Notion 与仓库数据一致，无需重建");
    }
  } catch (e) {
    console.error("[sync] 同步检查失败（下轮重试）", e.message);
  }
}

addEventListener("scheduled", (event) => {
  event.waitUntil(handleScheduled());
});
