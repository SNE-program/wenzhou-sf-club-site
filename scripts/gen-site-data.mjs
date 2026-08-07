// ============================================
// 站点静态数据生成器：Notion → site/data/*.json
// 把 Worker API 的 5 个数据端点（site/activities/works/contests/members）
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

// 数据库 ID（与 worker/wrangler.toml 保持一致；ID 非机密，可随仓库提交）
const DBS = {
  site: process.env.DB_SITE || "3b339fd6-4004-81d9-b672-cda022e565bb",
  activities: process.env.DB_ACTIVITIES || "3b339fd6-4004-8157-9ea2-c126459645f4",
  works: process.env.DB_WORKS || "3b339fd6-4004-8111-aac9-cf77c0c99eab",
  contests: process.env.DB_CONTESTS || "3b439fd6-4004-8100-8d7e-e7e049dd49b5",
  members: process.env.DB_MEMBERS || "3b339fd6-4004-81a1-a3a5-f3933823fcd6",
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

async function loadWorks() {
  const data = await queryDatabase(DBS.works, { page_size: 100 });
  return data.results.map(mapWork).filter((x) => x.title);
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

// ---------- 主流程 ----------
const sections = {
  "site.json": loadSite,
  "activities.json": loadActivities,
  "works.json": loadWorks,
  "contests.json": loadContests,
  "members.json": loadMembers,
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

await mkdir(DATA_DIR, { recursive: true });
let total = 0;
for (const [file, loader] of Object.entries(sections)) {
  try {
    const data = await loader();
    if (Array.isArray(data) && (file === "works.json" || file === "activities.json")) {
      await persistCovers(data);
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
