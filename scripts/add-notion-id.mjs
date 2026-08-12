// 迁移：worlds/hubs 加 notion_id 列 + 按 Notion 真实 id 回填（供后台写回 Notion 用）
// 用法：NOTION_TOKEN=ntn_xxx node scripts/add-notion-id.mjs <pg连接串>
import pg from "pg";
const [, , conn] = process.argv;
if (!conn) { console.error("用法: NOTION_TOKEN=xxx node scripts/add-notion-id.mjs <pg连接串>"); process.exit(1); }
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
if (!NOTION_TOKEN) { console.error("缺少 NOTION_TOKEN"); process.exit(1); }
const NOTION_VERSION = "2022-06-28";
const DB_WORLDS = "3b739fd6-4004-8004-84ed-cf7fab7a1c5e";
const DB_HUBS = "3b739fd6-4004-80c5-8cb2-ead40207fe30";
const H = { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION };

async function notionIds(dbId) {
  const out = new Set();
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST", headers: H,
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (!res.ok) { console.error("Notion 查询失败", res.status, (await res.text()).slice(0, 200)); process.exit(1); }
    const data = await res.json();
    data.results.forEach((r) => out.add(r.id));
    cursor = data.has_cursor ? data.next_cursor : null;
  } while (cursor);
  return out;
}

const client = new pg.Client({ connectionString: conn });
await client.connect();
for (const t of ["worlds", "hubs"]) {
  await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS notion_id text`);
}
const worldIds = await notionIds(DB_WORLDS);
const hubIds = await notionIds(DB_HUBS);
const w = await client.query("UPDATE worlds SET notion_id = id::text WHERE notion_id IS NULL AND id::text = ANY($1::text[])", [[...worldIds]]);
const h = await client.query("UPDATE hubs SET notion_id = id::text WHERE notion_id IS NULL AND id::text = ANY($1::text[])", [[...hubIds]]);
console.log(`Notion worlds rows: ${worldIds.size} -> worlds 回填 ${w.rowCount}`);
console.log(`Notion hubs rows: ${hubIds.size} -> hubs 回填 ${h.rowCount}`);
const left = await client.query("SELECT count(*)::int c FROM worlds WHERE notion_id IS NULL OR notion_id = ''");
const leftH = await client.query("SELECT count(*)::int c FROM hubs WHERE notion_id IS NULL OR notion_id = ''");
console.log(`仍无 notion_id：worlds ${left.rows[0].c} / hubs ${leftH.rows[0].c}（后台新建、Notion 无对应，首次保存时自动创建）`);
await client.end();
