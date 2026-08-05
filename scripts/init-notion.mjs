// ============================================
// Notion 内容结构初始化脚本（可重复执行）
// 用法：
//   node scripts/init-notion.mjs <NOTION_TOKEN> <父页面ID>
// 作用：在父页面下创建 4 张数据库（站点信息/活动/作品/成员）
//       写入占位数据，输出各数据库 id（填入 worker/wrangler.toml）
// ============================================
const [token, parentPageId] = process.argv.slice(2);
if (!token || !parentPageId) {
  console.error("用法: node scripts/init-notion.mjs <NOTION_TOKEN> <父页面ID>");
  process.exit(1);
}

const API = "https://api.notion.com/v1";
const headers = {
  Authorization: `Bearer ${token}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

async function api(path, body, method = "POST") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

async function createDatabase(title, properties) {
  const r = await api("/databases", {
    parent: { page_id: parentPageId },
    title: [{ text: { content: title } }],
    properties,
  });
  return r;
}

async function addRow(dbId, properties) {
  await api("/pages", { parent: { database_id: dbId }, properties });
}

const rt = (content) => ({ rich_text: [{ text: { content } }] });
const t = (content) => ({ title: [{ text: { content } }] });

// ---- 创建 4 张数据库 ----
console.log("== 创建数据库 ==");

const dbSite = await createDatabase("站点信息", {
  名称: { title: {} },
  标语: { rich_text: {} },
  简介: { rich_text: {} },
  联系邮箱: { rich_text: {} },
});
console.log("站点信息:", dbSite.id);

const dbActs = await createDatabase("活动", {
  标题: { title: {} },
  日期: { date: {} },
  地点: { rich_text: {} },
  简介: { rich_text: {} },
  标签: { multi_select: {} },
  封面: { files: {} },
});
console.log("活动:", dbActs.id);

const dbWorks = await createDatabase("作品", {
  标题: { title: {} },
  作者: { rich_text: {} },
  分类: { select: {} },
  简介: { rich_text: {} },
  封面: { files: {} },
});
console.log("作品:", dbWorks.id);

const dbMembers = await createDatabase("成员", {
  姓名: { title: {} },
  角色: { select: {} },
  简介: { rich_text: {} },
});
console.log("成员:", dbMembers.id);

// ---- 写入占位数据 ----
console.log("== 写入占位数据 ==");

await addRow(dbSite.id, {
  名称: t("温州中学科学及幻想文学社"),
  标语: rt("以科学与幻想为翼"),
  简介: rt("温州中学科学及幻想文学社，是一群热爱科学与幻想的伙伴共同经营的社团。我们读科幻、写幻想、观星象、聊未来，也一起把脑洞变成作品。"),
  联系邮箱: rt("请填写社团联系邮箱"),
});

const actRows = [
  { 标题: "新学期招新 · 科幻社开放日", 日期: "2026-09-15", 地点: "教学楼一楼大厅", 简介: "一年一度的招新开放日。现场有社团成果展示、社员交流区与趣味互动小游戏，欢迎对科学与幻想感兴趣的同学前来了解。", 标签: ["招新"] },
  { 标题: "科幻读书会 · 《沙丘》共读", 日期: "2026-10-12", 地点: "社团活动室", 简介: "围绕《沙丘》的生态、政治与宗教隐喻展开讨论，由社员轮流领读章节，并延伸推荐相关科幻作品。", 标签: ["读书会"] },
  { 标题: "原创科幻征文比赛", 日期: "2026-11-20", 地点: "线上投稿", 简介: "面向全校的科幻主题征文，主题不限，鼓励奇思妙想。优秀作品将收录进社团作品集并在网站上展示。", 标签: ["比赛"] },
];
for (const a of actRows) {
  await addRow(dbActs.id, {
    标题: t(a.标题),
    日期: { date: { start: a.日期 } },
    地点: rt(a.地点),
    简介: rt(a.简介),
    标签: { multi_select: a.标签.map((name) => ({ name })) },
  });
}

const workRows = [
  { 标题: "《星际邮差》", 作者: "社内投稿", 分类: "短篇小说", 简介: "在光速通信被信使垄断的未来，一名见习星际邮差踏上送往银河边缘的最后一封信。" },
  { 标题: "《城市上空的鲸》", 作者: "社内投稿", 分类: "世界观设定", 简介: "漂浮都市、生态穹顶与共生鲸群——一份关于未来滨海城市的设定集节选。" },
  { 标题: "《黎明前的观测日志》", 作者: "社内投稿", 分类: "科普随笔", 简介: "一次观星活动的记录，从双筒望远镜里的木星聊到黑暗森林。" },
];
for (const w of workRows) {
  await addRow(dbWorks.id, {
    标题: t(w.标题),
    作者: rt(w.作者),
    分类: { select: { name: w.分类 } },
    简介: rt(w.简介),
  });
}

const memberRows = [
  { 姓名: "示例成员 · 社长", 角色: "社长", 简介: "负责社团整体运营与活动策划。" },
  { 姓名: "示例成员 · 编辑", 角色: "编辑部部长", 简介: "负责社刊与作品收录审校。" },
  { 姓名: "示例成员 · 观测", 角色: "观测部部长", 简介: "组织观星活动与天文科普。" },
];
for (const m of memberRows) {
  await addRow(dbMembers.id, {
    姓名: t(m.姓名),
    角色: { select: { name: m.角色 } },
    简介: rt(m.简介),
  });
}

console.log("");
console.log("完成！请把以下数据库 id 填入 worker/wrangler.toml：");
console.log(`DB_SITE = "${dbSite.id}"`);
console.log(`DB_ACTIVITIES = "${dbActs.id}"`);
console.log(`DB_WORKS = "${dbWorks.id}"`);
console.log(`DB_MEMBERS = "${dbMembers.id}"`);
