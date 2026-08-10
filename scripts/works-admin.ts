// ============================================
// Supabase Edge Function：作品管理（列表 + 下架 / 上架 / 删除）
// 基于 jsr:@supabase/server，复用 send-audit-email 的部署方式。
//
// 接口：
//   GET  {SUPABASE_URL}/functions/v1/works-admin
//        → 全部作品列表（含发布状态），仅管理员
//   POST {SUPABASE_URL}/functions/v1/works-admin
//        body: { action: "down" | "up" | "delete" | "set_hub", id: "<作品页ID>", hub?: "<中心页名>" }
//        → down: 下架（发布状态=已下架，前台隐藏；可恢复）
//           up:   上架（发布状态=已上架）
//           delete: 永久删除（Notion archive，不可恢复）
//           set_hub: 调整作品归属（所属中心页=hub；hub 传空串则归为杂文）
//   headers: Authorization: Bearer <管理员登录JWT>，apikey: <anon>
//
// 下架/上架改的是 Notion 作品库「发布状态」列；Worker 定时对比数据指纹后
// 触发重建，前台 works 列表与静态文章页会自动隐藏/恢复（约 5 分钟内生效）。
//
// 重要：本文件所有中文字符串均以 \uXXXX 转义书写（纯 ASCII），
// 避免在 Dashboard 中复制粘贴时编码被破坏导致 Notion 查询 400。
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const NOTION_TOKEN = (Deno.env.get("NOTION_TOKEN") ?? "").trim();
const NOTION_VERSION = "2022-06-28";
const DB_WORKS = (Deno.env.get("DB_WORKS") ?? "3b339fd6-4004-8111-aac9-cf77c0c99eab").trim();
const DB_SUBMISSIONS = (Deno.env.get("DB_SUBMISSIONS") ?? "3b439fd6-4004-8093-b745-c8ee4f27c1a0").trim();

// 中文字符串常量（\uXXXX 转义，粘贴安全）
const S = {
  status: "\u53d1\u5e03\u72b6\u6001", // 发布状态
  up: "\u5df2\u4e0a\u67b6", // 已上架
  down: "\u5df2\u4e0b\u67b6", // 已下架
  title: "\u6807\u9898", // 标题
  author: "\u4f5c\u8005", // 作者
  category: "\u5206\u7c7b", // 分类
  summary: "\u7b80\u4ecb", // 简介
  email: "\u90ae\u7bb1", // 邮箱
  workId: "\u4f5c\u54c1ID", // 作品ID
  hub: "\u6240\u5c5e\u4e2d\u5fc3\u9875", // 所属中心页
  notLogin: "\u672a\u767b\u5f55", // 未登录
  noAdmin: "\u65e0\u7ba1\u7406\u5458\u6743\u9650", // 无管理员权限
  missingArgs: "\u7f3a\u5c11\u53c2\u6570 action/id", // 缺少参数 action/id
  notFound: "\u4f5c\u54c1\u4e0d\u5b58\u5728", // 作品不存在
};

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function throwWithDetail(prefix, res) {
  const detail = await res.text().catch(() => "");
  throw new Error(`${prefix} ${res.status}${detail ? ": " + detail.slice(0, 300) : ""}`);
}

/** 读取 Notion 属性文本 */
function propText(p, key) {
  const v = p[key];
  if (!v) return "";
  if (v.type === "title") return v.title.map((t) => t.plain_text).join("");
  if (v.type === "rich_text") return v.rich_text.map((t) => t.plain_text).join("");
  if (v.type === "select") return v.select ? v.select.name : "";
  // 多选（如分类）：返回数组，供前端展示
  if (v.type === "multi_select") return v.multi_select.map((s) => s.name);
  return "";
}

/** Notion 行 → 前端字段 */
function mapRow(row) {
  const p = row.properties || {};
  return {
    id: row.id,
    title: propText(p, S.title),
    author: propText(p, S.author),
    category: propText(p, S.category),
    summary: propText(p, S.summary),
    status: propText(p, S.status) || S.up,
    hub: propText(p, S.hub),
    created: row.created_time || "",
  };
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
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return Response.json({ error: S.notLogin }, { status: 401 });
    }
    const { data: me } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me || !me.is_admin) {
      return Response.json({ error: S.noAdmin }, { status: 403 });
    }

    if (!NOTION_TOKEN) {
      return Response.json({ error: "works-admin not configured (NOTION_TOKEN)" }, { status: 501 });
    }

    // GET：全部作品列表（含投稿邮箱，来自投稿箱按作品ID关联）
    if (req.method === "GET") {
      try {
        const [worksRes, subsRes] = await Promise.all([
          fetch(`https://api.notion.com/v1/databases/${DB_WORKS}/query`, {
            method: "POST",
            headers: notionHeaders(),
            body: JSON.stringify({ page_size: 100 }),
          }),
          fetch(`https://api.notion.com/v1/databases/${DB_SUBMISSIONS}/query`, {
            method: "POST",
            headers: notionHeaders(),
            body: JSON.stringify({ page_size: 100 }),
          }),
        ]);
        if (!worksRes.ok) await throwWithDetail("query works failed", worksRes);
        if (!subsRes.ok) await throwWithDetail("query submissions failed", subsRes);
        const worksRows = (await worksRes.json()).results || [];
        const subRows = (await subsRes.json()).results || [];
        // 作品库无邮箱列：作品ID → 投稿邮箱（转录发布时回填的作品ID关联）
        const emailByWorkId = {};
        for (const r of subRows) {
          const p = r.properties || {};
          const workId = propText(p, S.workId);
          const email = propText(p, S.email);
          if (workId && email) emailByWorkId[workId] = email;
        }
        return Response.json(
          worksRows.map(mapRow).map((w) => ({ ...w, email: emailByWorkId[w.id] || "" }))
        );
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502 });
      }
    }

    // POST：下架 / 上架 / 删除
    if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "bad json" }, { status: 400 });
      }
      const { action, id, hub } = body || {};
      if (!["down", "up", "delete", "set_hub"].includes(action) || !id) {
        return Response.json({ error: S.missingArgs }, { status: 400 });
      }
      if (action === "set_hub" && typeof hub !== "string") {
        return Response.json({ error: S.missingArgs }, { status: 400 });
      }
      try {
        if (action === "delete") {
          const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
            method: "DELETE",
            headers: notionHeaders(),
          });
          if (!res.ok && res.status !== 404) await throwWithDetail("delete failed", res);
        } else {
          // set_hub：调整作品归属（所属中心页 select；hub 为空串则清除 → 归为杂文）
          const properties =
            action === "set_hub"
              ? { [S.hub]: hub ? { select: { name: hub } } : { select: null } }
              : { [S.status]: { select: { name: action === "down" ? S.down : S.up } } };
          const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
            method: "PATCH",
            headers: notionHeaders(),
            body: JSON.stringify({ properties }),
          });
          if (!res.ok) await throwWithDetail("update failed", res);
        }
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502 });
      }
    }

    return Response.json({ error: "Method Not Allowed" }, { status: 405 });
  }),
};
