// ============================================
// Supabase Edge Function：投稿审核（列表 + 通过 / 拒绝）
// 基于 jsr:@supabase/server，复用 send-audit-email 的部署方式。
//
// 接口：
//   GET  {SUPABASE_URL}/functions/v1/submission-review
//        → 待审核投稿列表（仅管理员）
//   POST {SUPABASE_URL}/functions/v1/submission-review
//        body: { action: "approve" | "reject", id: "<投稿行ID>", reason?: "拒绝原因" }
//        → 更新 Notion 投稿箱「审核状态」
//   headers: Authorization: Bearer <管理员登录JWT>，apikey: <anon>
//
// 审核通过后，Cloudflare Worker 定时任务（每 5 分钟）会自动：
//   转录到正式作品库 + 回填作品ID + 发送"已上架"邮件；
// 拒绝后会自动发送"未通过+原因"邮件。
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";
const DB_SUBMISSIONS = Deno.env.get("DB_SUBMISSIONS") ?? "";
const NOTION_VERSION = "2022-06-28";

/** Notion 行 → 前端字段 */
function mapRow(row) {
  const p = row.properties || {};
  const get = (key) => {
    const v = p[key];
    if (!v) return "";
    if (v.type === "title") return v.title.map((t) => t.plain_text).join("");
    if (v.type === "rich_text") return v.rich_text.map((t) => t.plain_text).join("");
    if (v.type === "multi_select") return v.multi_select.map((s) => s.name);
    if (v.type === "created_time") return v.created_time || "";
    return "";
  };
  const cover = p["封面"] && p["封面"].files && p["封面"].files[0]
    ? (p["封面"].files[0].type === "external"
        ? p["封面"].files[0].external.url
        : (p["封面"].files[0].file || {}).url || "")
    : "";
  return {
    id: row.id,
    title: get("作品标题"),
    author: get("作者笔名"),
    types: get("投稿类型") || [],
    body: get("正文内容"),
    cover,
    email: get("邮箱"),
    contests: get("所属竞赛") || [],
    created: get("提交时间"),
  };
}

async function notionQuery(status) {
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

async function notionPatch(pageId, properties) {
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

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    // 管理员校验
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return Response.json({ error: "未登录" }, { status: 401 });
    }
    const { data: me } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me || !me.is_admin) {
      return Response.json({ error: "无管理员权限" }, { status: 403 });
    }

    // GET：待审核列表
    if (req.method === "GET") {
      try {
        const rows = await notionQuery("待审核");
        return Response.json(rows.map(mapRow));
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502 });
      }
    }

    // POST：通过 / 拒绝
    if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "bad json" }, { status: 400 });
      }
      const { action, id, reason } = body || {};
      if (!["approve", "reject"].includes(action) || !id) {
        return Response.json({ error: "缺少参数 action/id" }, { status: 400 });
      }
      try {
        if (action === "approve") {
          await notionPatch(id, { "审核状态": { status: { name: "已通过" } } });
        } else {
          const properties = { "审核状态": { status: { name: "已拒绝" } } };
          if (reason) properties["拒绝原因"] = { rich_text: [{ text: { content: String(reason).slice(0, 500) } }] };
          await notionPatch(id, properties);
        }
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502 });
      }
    }

    return Response.json({ error: "Method Not Allowed" }, { status: 405 });
  }),
};
