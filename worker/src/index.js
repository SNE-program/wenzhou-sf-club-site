// ============================================
// 温州中学科幻社 · Notion 数据中转 Worker
// 端点：
//   GET /api/site        站点信息
//   GET /api/activities  活动列表
//   GET /api/works       作品列表
//   GET /api/contests    竞赛列表
//   GET /api/members     成员列表
//   定时任务（每 5 分钟，投稿闭环兜底）：
//     已通过→自动转录发布+上架邮件；已拒绝→发送拒绝邮件
//   投稿审核操作由 Supabase Edge Function「submission-review」处理
//   （supabase.co 在国内可访问；workers.dev 不可达）
// 绑定（部署时注入，作为全局变量）：
//   NOTION_TOKEN   Notion 内部连接令牌（ntn_ 开头）
//   DB_SITE / DB_ACTIVITIES / DB_WORKS / DB_CONTESTS / DB_MEMBERS / DB_SUBMISSIONS
//   SITE_BASE      站内链接前缀（默认 github.io 地址）
//   RESEND_API_KEY（secret）/ RESEND_FROM  投稿结果邮件
// 使用传统格式（addEventListener），兼容所有部署方式。
// ============================================

const NOTION_VERSION = "2022-06-28";
const CACHE_TTL = 60; // 秒
const SITE_BASE = typeof SITE_BASE !== "undefined" ? SITE_BASE : "https://sne-program.github.io/wenzhou-sf-club-site";
const RESEND_FROM = typeof RESEND_FROM !== "undefined" ? RESEND_FROM : "onboarding@resend.dev";

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

  const route = url.pathname.replace(/^\/api\//, "");

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
  }

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

// ============================================
// 投稿自动发布模块（审核动作由 Supabase Edge Function 处理）
// ============================================

/** 从投稿行提取前端需要的字段 */
function mapSubmission(row) {
  const p = row.properties || {};
  const cover = propCover(p["封面"]);
  return {
    id: row.id,
    title: propText(p["作品标题"]),
    author: propText(p["作者笔名"]),
    types: p["投稿类型"]?.type === "multi_select" ? p["投稿类型"].multi_select.map((s) => s.name) : [],
    body: propText(p["正文内容"]),
    cover, // null 或 {type:"external"|"file", url}
    email: propText(p["邮箱"]),
    contests: p["所属竞赛"]?.type === "multi_select" ? p["所属竞赛"].multi_select.map((s) => s.name) : [],
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

/** 在正式作品库创建作品条目，返回新条目 id */
async function createWorkPage(sub) {
  const cats = ["短篇小说", "世界观设定", "科普随笔"];
  const cat = sub.types.find((t) => cats.includes(t)) || "其他";
  const tags = sub.types.filter((t) => !cats.includes(t));
  if (sub.contests.length) tags.push(...sub.contests);

  const properties = {
    "标题": { title: [{ text: { content: sub.title } }] },
    "作者": { rich_text: [{ text: { content: sub.author || "匿名" } }] },
    "分类": { select: { name: cat } },
    "简介": { rich_text: [{ text: { content: sub.body || "" } }] },
  };
  if (tags.length) properties["标签"] = { multi_select: [...new Set(tags)].map((n) => ({ name: n })) };
  // 封面仅转录外部链接（避免 Notion 临时文件链接过期裂图）
  if (sub.cover && sub.cover.type === "external" && sub.cover.url) {
    properties["封面"] = { files: [{ name: "cover", external: { url: sub.cover.url } }] };
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: DB_WORKS }, properties }),
  });
  if (!res.ok) throw new Error(`创建作品失败 ${res.status}`);
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
}

addEventListener("scheduled", (event) => {
  event.waitUntil(handleScheduled());
});
