// ============================================
// 检查 Notion 数据连通性（排障用）
// 用法：
//   node scripts/check-notion.mjs <NOTION_TOKEN>
// 输出：4 张数据库前 2 条记录的关键字段
// ============================================
const [token] = process.argv.slice(2);
if (!token) {
  console.error("用法: node scripts/check-notion.mjs <NOTION_TOKEN>");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};
const pick = (p) => {
  if (!p) return "";
  switch (p.type) {
    case "title": return p.title.map((t) => t.plain_text).join("");
    case "rich_text": return p.rich_text.map((t) => t.plain_text).join("");
    case "select": return p.select ? p.select.name : "";
    case "date": return p.date ? p.date.start : "";
    case "multi_select": return p.multi_select.map((s) => s.name).join(", ");
    default: return "";
  }
};

const dbs = [
  ["站点信息", "3b339fd6-4004-81d9-b672-cda022e565bb"],
  ["活动", "3b339fd6-4004-8157-9ea2-c126459645f4"],
  ["作品", "3b339fd6-4004-8111-aac9-cf77c0c99eab"],
  ["成员", "3b339fd6-4004-81a1-a3a5-f3933823fcd6"],
];

for (const [label, id] of dbs) {
  const res = await fetch(`https://api.notion.com/v1/databases/${id}/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ page_size: 2 }),
  });
  if (!res.ok) {
    console.log(`【${label}】读取失败: ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const data = await res.json();
  console.log(`【${label}】共 ${data.results.length} 条（仅查 2 条展示）`);
  for (const row of data.results.slice(0, 2)) {
    const fields = [];
    for (const [k, v] of Object.entries(row.properties || {})) {
      fields.push(`${k}=${pick(v).slice(0, 30)}`);
    }
    console.log("  " + fields.join(" | "));
  }
}
