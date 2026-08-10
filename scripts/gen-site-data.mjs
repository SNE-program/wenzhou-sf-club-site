// ============================================
// 站点静态数据生成器：Notion → site/data/*.json
// 把 Worker API 的 6 个数据端点（site/activities/works/contests/members/worlds）
// 在构建时固化为静态 JSON，前端零运行时 API 依赖。
// 用法：NOTION_TOKEN=xxx node scripts/gen-site-data.mjs
// CI 中由 GitHub Actions 在部署前执行（secrets.NOTION_TOKEN）。
// ============================================

const NOTION_VERSION = "2022-06-28";
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
if (!NOTION_TOKEN) {
  console.error("[gen-site-data] 缺少环境变量 NOTION_TOKEN，跳过数据生成。");
  process.exit(0);
}

// ---------- 数据源切换 ----------
// DATA_SOURCE=supabase 时：世界观（worlds）/ 中心页（hubs）从 Supabase 读取
// （网站后台在线维护，Supabase 为准；仅读取报错时降级 Notion）。其余数据仍从 Notion 读取。
const DATA_SOURCE = process.env.DATA_SOURCE || "notion";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// 数据库 ID（与 worker/wrangler.toml 保持一致；ID 非机密，可随仓库提交）
const DBS = {
  site: process.env.DB_SITE || "3b339fd6-4004-81d9-b672-cda022e565bb",
  activities: process.env.DB_ACTIVITIES || "3b339fd6-4004-8157-9ea2-c126459645f4",
  works: process.env.DB_WORKS || "3b339fd6-4004-8111-aac9-cf77c0c99eab",
  contests: process.env.DB_CONTESTS || "3b439fd6-4004-8100-8d7e-e7e049dd49b5",
  members: process.env.DB_MEMBERS || "3b339fd6-4004-81a1-a3a5-f3933823fcd6",
  worlds: process.env.DB_WORLDS || "3b739fd6-4004-8004-84ed-cf7fab7a1c5e",
  hubs: process.env.DB_HUBS || "3b739fd6-4004-80c5-8cb2-ead40207fe30",
};

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(__dirname, "..", "site");
const DATA_DIR = path.join(SITE_DIR, "data");

// ---------- Notion 字段取值（与 Worker 保持一致） ----------
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

function propBool(p) {
  if (!p || p.type !== "checkbox") return false;
  return !!p.checkbox;
}

/** 附件：取 files 第一个元素，返回 {name, url}；无有效 http(s) 链接返回 null */
function propAttachment(p) {
  if (!p || p.type !== "files" || !p.files || !p.files.length) return null;
  const f = p.files[0];
  const url = f.type === "external" ? (f.external || {}).url : f.file ? (f.file || {}).url : "";
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return { name: f.name || "", url };
}

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
    attachment: propAttachment(p["附件"]),
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

// ---------- 世界观（根） / 中心页（枝干） 双表 ----------
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

// ---------- 查询 ----------
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
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Notion ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

async function loadSite() {
  const data = await queryDatabase(DBS.site);
  const p = (data.results[0] || {}).properties || {};
  return {
    name: propText(p["名称"]) || "温州中学科学及幻想文学社",
    slogan: propText(p["标语"]),
    intro: propText(p["简介"]),
    contactEmail: propText(p["联系邮箱"]),
  };
}

async function loadActivities() {
  const data = await queryDatabase(DBS.activities, {
    page_size: 100,
    sorts: [{ property: "日期", direction: "descending" }],
  });
  return data.results.map(mapActivity).filter((x) => x.title);
}

let cachedWorks = null;
async function loadWorks() {
  if (cachedWorks) return cachedWorks;
  const data = await queryDatabase(DBS.works, { page_size: 100 });
  cachedWorks = data.results.map(mapWork).filter((x) => x.title && x.status !== "已下架");
  await annotateWorks(cachedWorks); // 据「所属中心页」推导 hub/world/era 字段
  return cachedWorks;
}

async function loadContests() {
  const data = await queryDatabase(DBS.contests, {
    page_size: 100,
    sorts: [{ property: "投稿截止", direction: "ascending" }],
  });
  return data.results.map(mapContest).filter((x) => x.title);
}

async function loadMembers() {
  const data = await queryDatabase(DBS.members, { page_size: 100 });
  return data.results.map(mapMember).filter((x) => x.name);
}

// ---------- 世界观（根）/ 中心页（枝干） 双表 ----------
let cachedWorlds = null;
let cachedHubs = null;

/** 从 Supabase 读取某表全部行（DATA_SOURCE=supabase 时使用） */
async function querySupabase(table, select, order) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(order)}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function loadWorlds() {
  if (cachedWorlds) return cachedWorlds;
  if (DATA_SOURCE === "supabase") {
    try {
      const rows = await querySupabase(
        "worlds",
        "id,name,summary,body,eras_text,cover,shown,kind,sort_order",
        "sort_order.asc"
      );
      cachedWorlds = rows
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
      console.log(`[gen-site-data] worlds 来自 Supabase（${cachedWorlds.length} 条）`);
      return cachedWorlds;
    } catch (e) {
      console.warn(`[gen-site-data] Supabase worlds 读取失败，降级 Notion：${e.message}`);
    }
  }
  const data = await queryDatabase(DBS.worlds, { page_size: 100 });
  cachedWorlds = data.results.map(mapWorld).filter((x) => x.name && x.shown);
  // Notion 模式：把保留名中心页（宇宙与时间之外等）合成为「类世界观」根
  const meta = await loadMetaWorldFromNotion();
  if (meta && meta.shown && !cachedWorlds.some((w) => w.name === meta.name)) {
    cachedWorlds.push(meta);
  }
  return cachedWorlds;
}

/** Notion 降级路径：从中心页表中把保留名行合成为一个类世界观根（kind='meta'，无时代线） */
async function loadMetaWorldFromNotion() {
  const data = await queryDatabase(DBS.hubs, { page_size: 100 });
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
  if (cachedHubs) return cachedHubs;
  if (DATA_SOURCE === "supabase") {
    try {
      const rows = await querySupabase(
        "hubs",
        "id,name,world,era,theme,summary,body,sort,cover,shown",
        "world.asc,sort.asc"
      );
      cachedHubs = rows
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
        // 保留名行（宇宙与时间之外 / 世界与时间之外）不视为枝干中心页，直接剔除
        .filter((x) => x.name && x.shown && !RESERVED_OUTSIDE.has(x.name));
      console.log(`[gen-site-data] hubs 来自 Supabase（${cachedHubs.length} 条）`);
      return cachedHubs;
    } catch (e) {
      console.warn(`[gen-site-data] Supabase hubs 读取失败，降级 Notion：${e.message}`);
    }
  }
  const data = await queryDatabase(DBS.hubs, { page_size: 100 });
  // 保留名行（宇宙与时间之外 / 世界与时间之外）不视为枝干中心页，直接剔除
  cachedHubs = data.results
    .map(mapHub)
    .filter((x) => x.name && x.shown && !RESERVED_OUTSIDE.has(x.name));
  return cachedHubs;
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

/** 聚合 worlds.json：每个根 = 时代线（eras）+ 枝干（hubs，含作品数、era 匹配根时代名） */
async function loadWorldsData() {
  const [worlds, hubs, works] = await Promise.all([loadWorlds(), loadHubs(), loadWorks()]);
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
        summary: h.summary,
        body: h.body,
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

// ---------- 主流程 ----------
const sections = {
  "site.json": loadSite,
  "activities.json": loadActivities,
  "works.json": loadWorks,
  "contests.json": loadContests,
  "members.json": loadMembers,
  "worlds.json": loadWorldsData,
};

/** 封面稳定标识：Notion 临时文件取 S3 路径（签名参数会轮换，忽略）；外链原样保留。
 *  Worker 同步指纹与 gen-site-data 共用同一规则，保证两侧可比。 */
function coverStableKey(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/prod-files|amazonaws/i.test(u.hostname)) return u.pathname.replace(/^\//, "");
    return url;
  } catch {
    return url;
  }
}

/** 把 Notion 临时封面链接下载缓存到本地（永久有效，不再过期裂图） */
async function persistCovers(items) {
  const COVER_DIR = path.join(SITE_DIR, "images", "covers");
  await mkdir(COVER_DIR, { recursive: true });
  for (const it of items) {
    if (!it.cover) continue;
    // 记录封面稳定标识（供 Worker 同步指纹对比；Notion 签名链接本身会轮换）
    it.coverKey = coverStableKey(it.cover);
    // 仅处理 Notion 临时文件（S3 签名 URL），外链图片原样保留
    if (!/prod-files|amazonaws|X-Amz-|x-amz-/i.test(it.cover)) continue;
    try {
      const res = await fetch(it.cover);
      if (!res.ok) { it.cover = null; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (res.headers.get("content-type") || "").split("/")[1] || "jpg";
      const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "jpg";
      const name = `${it.id}.${safeExt}`;
      await writeFile(path.join(COVER_DIR, name), buf);
      it.cover = `images/covers/${name}`;
      console.log(`[gen-site-data]   ↳ 封面已缓存：images/covers/${name}`);
    } catch {
      it.cover = null; // 下载失败则降级为渐变占位图
    }
  }
}

/** 把 Notion 临时附件链接下载缓存到本地（永久有效，签名 URL 不再过期） */
async function persistAttachments(items) {
  const FILE_DIR = path.join(SITE_DIR, "files");
  await mkdir(FILE_DIR, { recursive: true });
  for (const it of items) {
    const att = it.attachment;
    if (!att || !att.url) { it.attachmentKey = null; continue; }
    // 记录附件稳定标识（供 Worker 同步指纹对比；Notion 签名链接本身会轮换）
    it.attachmentKey = coverStableKey(att.url);
    // 仅处理 Notion 临时文件（S3 签名 URL），外链原样保留
    if (!/prod-files|amazonaws|X-Amz-|x-amz-/i.test(att.url)) continue;
    try {
      const res = await fetch(att.url);
      if (!res.ok) { it.attachment = null; it.attachmentKey = null; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get("content-type") || "").toLowerCase();
      const extMatch = mime.match(/(?:pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|md|jpg|jpeg|png)/);
      const ext = extMatch ? "." + extMatch[0] : "";
      const safeName = String(att.name || "attachment")
        .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
        .replace(/[^\x00-\x7F]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 50);
      const stem = safeName.replace(/\.[a-zA-Z0-9]+$/, "");
      const baseName = !/[a-zA-Z0-9]/.test(stem) ? "file" : safeName;
      const name = `${it.id.slice(0, 8)}_${baseName}${ext}`;
      await writeFile(path.join(FILE_DIR, name), buf);
      it.attachment = { name: att.name || name, url: `files/${name}` };
      console.log(`[gen-site-data]   ↳ 附件已缓存：files/${name}（${buf.length}B）`);
    } catch {
      it.attachment = null; it.attachmentKey = null; // 下载失败则降级隐藏
    }
  }
}

await mkdir(DATA_DIR, { recursive: true });
let total = 0;
for (const [file, loader] of Object.entries(sections)) {
  try {
    const data = await loader();
    if (Array.isArray(data) && (file === "works.json" || file === "activities.json" || file === "worlds.json")) {
      await persistCovers(data);
      if (file === "works.json") await persistAttachments(data);
    }
    await writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2) + "\n", "utf8");
    const n = Array.isArray(data) ? data.length : 1;
    total += n;
    console.log(`[gen-site-data] ✓ ${file} (${n} 条)`);
  } catch (e) {
    console.error(`[gen-site-data] ✗ ${file} 生成失败：${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`[gen-site-data] 完成，共 ${total} 条数据已写入 site/data/`);
