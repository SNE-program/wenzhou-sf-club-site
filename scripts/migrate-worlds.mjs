// ============================================
// 世界观/中心页 迁移脚本：Notion → Supabase
// 幂等：表已存在则跳过建表；行按 id upsert（重复执行不产生重复数据）
// 用法（NOTION_TOKEN 必填）：
//   NOTION_TOKEN=ntn_xxx node scripts/migrate-worlds.mjs <postgres连接串>
// 可选环境变量：DB_WORLDS / DB_HUBS（默认取仓库内置数据库 ID）
// 说明：
//   - worlds.eras_text 存时代线原文（每行 `时代名 | 时间段 | 简介`），
//     读取端用 parseEras() 解析为 eras 数组（与 mapWorld 契约一致）
//   - 表结构/RLS 对齐 contests 先例：select 公开可读，增删改仅管理员
// ============================================
import pg from "pg";

const [, , conn] = process.argv;
if (!conn) {
  console.error("用法: NOTION_TOKEN=xxx node scripts/migrate-worlds.mjs <postgres连接串>");
  process.exit(1);
}

const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
if (!NOTION_TOKEN) {
  console.error("缺少环境变量 NOTION_TOKEN");
  process.exit(1);
}

const NOTION_VERSION = "2022-06-28";
const DB_WORLDS = process.env.DB_WORLDS || "3b739fd6-4004-8004-84ed-cf7fab7a1c5e";
const DB_HUBS = process.env.DB_HUBS || "3b739fd6-4004-80c5-8cb2-ead40207fe30";

// ---------- Notion 字段取值（与 gen-site-data / Worker 保持一致） ----------
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

function mapWorld(row) {
  const p = row.properties || {};
  return {
    id: row.id,
    name: propText(p["名称"]),
    kind: "world",
    summary: propText(p["简介"]),
    body: propText(p["设定正文"]),
    eras_text: propText(p["时代线"]),
    cover: propCover(p["封面"]) || "",
    shown: propBool(p["是否展示"]),
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
    cover: propCover(p["封面"]) || "",
    shown: propBool(p["是否展示"]),
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
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Notion ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

// Notion 页面 id 是合法 uuid（32 位 hex）；mock/异常 id 跳过
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 杂文保留名：这些中心页名不再是枝干，而是合成为「类世界观」根（kind='meta'）
const RESERVED_OUTSIDE = new Set(["宇宙与时间之外", "世界与时间之外"]);

// ---------- 建表（幂等）+ RLS ----------
const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS public.worlds (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'world',
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  eras_text text NOT NULL DEFAULT '',
  cover text NOT NULL DEFAULT '',
  shown boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hubs (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  world text NOT NULL DEFAULT '',
  era text NOT NULL DEFAULT '',
  theme text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0,
  cover text NOT NULL DEFAULT '',
  shown boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hubs ENABLE ROW LEVEL SECURITY;

-- 旧表补列（幂等）
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'world';

DROP POLICY IF EXISTS worlds_select ON public.worlds;
CREATE POLICY worlds_select ON public.worlds FOR SELECT USING (true);
DROP POLICY IF EXISTS worlds_insert ON public.worlds;
CREATE POLICY worlds_insert ON public.worlds FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin));
DROP POLICY IF EXISTS worlds_update ON public.worlds;
CREATE POLICY worlds_update ON public.worlds FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin));
DROP POLICY IF EXISTS worlds_delete ON public.worlds;
CREATE POLICY worlds_delete ON public.worlds FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin));

DROP POLICY IF EXISTS hubs_select ON public.hubs;
CREATE POLICY hubs_select ON public.hubs FOR SELECT USING (true);
DROP POLICY IF EXISTS hubs_insert ON public.hubs;
CREATE POLICY hubs_insert ON public.hubs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin));
DROP POLICY IF EXISTS hubs_update ON public.hubs;
CREATE POLICY hubs_update ON public.hubs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin));
DROP POLICY IF EXISTS hubs_delete ON public.hubs;
CREATE POLICY hubs_delete ON public.hubs FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.is_admin));
`;

async function upsert(client, table, rows) {
  let ok = 0, skip = 0;
  for (const r of rows) {
    if (!UUID_RE.test(r.id)) { console.log(`  ↳ 跳过（非法 id）: ${r.id} ${r.name}`); skip++; continue; }
    await client.query(
      `INSERT INTO public.${table} (id, name, kind, summary, body, eras_text, cover, shown, sort_order, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, kind=EXCLUDED.kind, summary=EXCLUDED.summary, body=EXCLUDED.body,
         eras_text=EXCLUDED.eras_text, cover=EXCLUDED.cover, shown=EXCLUDED.shown,
         sort_order=EXCLUDED.sort_order, updated_at=now()`,
      [r.id, r.name, r.kind || "world", r.summary, r.body, r.eras_text || "", r.cover || "", r.shown, r.sort_order || 0]
    );
    ok++;
  }
  return { ok, skip };
}

// hubs 表列名不同（world/era/theme/sort），单独 upsert
async function upsertHubs(client, rows) {
  let ok = 0, skip = 0;
  for (const r of rows) {
    if (!UUID_RE.test(r.id)) { console.log(`  ↳ 跳过（非法 id）: ${r.id} ${r.name}`); skip++; continue; }
    await client.query(
      `INSERT INTO public.hubs (id, name, world, era, theme, summary, body, sort, cover, shown, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, world=EXCLUDED.world, era=EXCLUDED.era, theme=EXCLUDED.theme,
         summary=EXCLUDED.summary, body=EXCLUDED.body, sort=EXCLUDED.sort,
         cover=EXCLUDED.cover, shown=EXCLUDED.shown, updated_at=now()`,
      [r.id, r.name, r.world, r.era, r.theme, r.summary, r.body, r.sort, r.cover || "", r.shown]
    );
    ok++;
  }
  return { ok, skip };
}

// ---------- 主流程 ----------
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

try {
  await client.query(CREATE_SQL);
  console.log("✓ 建表完成（worlds / hubs，含 RLS 策略）");
} catch (e) {
  console.error("✗ 建表失败:", e.message.split("\n")[0]);
  await client.end();
  process.exit(1);
}

console.log("\n拉取 Notion 世界观（根）…");
const worldsData = await queryDatabase(DB_WORLDS, { page_size: 100 });
const worlds = worldsData.results.map(mapWorld).filter((x) => x.name);
console.log(`  共 ${worlds.length} 条`);

console.log("\n拉取 Notion 中心页（枝干）…");
const hubsData = await queryDatabase(DB_HUBS, { page_size: 100 });
const hubRows = hubsData.results.map(mapHub).filter((x) => x.name);
// 保留名行升级为「类世界观」根（kind='meta'，无时代线），不再作为枝干
const metaCandidates = hubRows.filter((x) => RESERVED_OUTSIDE.has(x.name));
const hubs = hubRows.filter((x) => !RESERVED_OUTSIDE.has(x.name));
const pick = metaCandidates.find((r) => r.name === "宇宙与时间之外") || metaCandidates[0];
const metaWorlds = pick
  ? [{
      id: pick.id,
      name: pick.name,
      kind: "meta",
      summary: pick.summary,
      body: pick.body,
      eras_text: "",
      cover: pick.cover,
      shown: pick.shown,
      sort_order: 10000, // 类世界观排在所有正常世界观之后
    }]
  : [];
console.log(`  共 ${hubRows.length} 条（保留名 ${metaCandidates.length} 条，升级为类世界观 ${metaWorlds.length} 条）`);

const w = await upsert(client, "worlds", [...worlds, ...metaWorlds]);
console.log(`\n✓ worlds 写入 ${w.ok} 条（含类世界观 ${metaWorlds.length}，跳过 ${w.skip}）`);
const h = await upsertHubs(client, hubs);
console.log(`✓ hubs 写入 ${h.ok} 条（跳过 ${h.skip}）`);

// 清理：hubs 表中历史残留的保留名行（仅管理员策略下直接删除）
const del = await client.query(`DELETE FROM public.hubs WHERE name = ANY($1)`, [[...RESERVED_OUTSIDE]]);
if (del.rowCount > 0) console.log(`  ↳ 已从 hubs 表清理保留名行 ${del.rowCount} 条`);

const chk = await client.query(
  `SELECT 'worlds' AS t, count(*) FROM public.worlds UNION ALL SELECT 'hubs', count(*) FROM public.hubs`
);
console.log("\n当前表行数：");
for (const r of chk.rows) console.log(`  ${r.t}: ${r.count}`);

await client.end();
console.log("\n迁移完成。");
