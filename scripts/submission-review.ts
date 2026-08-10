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
//
// 重要：本文件所有中文字符串均以 \uXXXX 转义书写（纯 ASCII），
// 避免在 Dashboard 中复制粘贴时编码被破坏导致 Notion 查询 400。
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const NOTION_TOKEN = (Deno.env.get("NOTION_TOKEN") ?? "").trim();
const NOTION_VERSION = "2022-06-28";

// 环境变量缺失时优雅降级（避免平台返回裸 500 且不带 CORS 头）
function envCheck(): string | null {
  if (!NOTION_TOKEN) return "投稿服务未配置（缺少 NOTION_TOKEN）";
  if (!DB_SUBMISSIONS) return "投稿服务未配置（缺少 DB_SUBMISSIONS）";
  if (!Deno.env.get("SUPABASE_URL")) return "投稿服务未配置（缺少 SUPABASE_URL）";
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return "投稿服务未配置（缺少 SUPABASE_SERVICE_ROLE_KEY）";
  return null;
}

// DB_SUBMISSIONS：自动容错误填（如 Notion 页面/表单链接、32 位无连字符 ID、多余空格）
// 都能正确提取出标准数据库 ID；提取不到则留空，后续请求会给出清晰报错。
const _rawDb = (Deno.env.get("DB_SUBMISSIONS") ?? "").trim();
const _dbMatch = _rawDb.match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
const DB_SUBMISSIONS = _dbMatch
  ? _dbMatch[0].replace(
      /([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i,
      "$1-$2-$3-$4-$5"
    )
  : "";

// 中文字符串常量（\uXXXX 转义，粘贴安全）
const S = {
  status: "\u5ba1\u6838\u72b6\u6001", // 审核状态
  pending: "\u5f85\u5ba1\u6838", // 待审核
  approved: "\u5df2\u901a\u8fc7", // 已通过
  rejected: "\u5df2\u62d2\u7edd", // 已拒绝
  title: "\u4f5c\u54c1\u6807\u9898", // 作品标题
  author: "\u4f5c\u8005\u7b14\u540d", // 作者笔名
  types: "\u6295\u7a3f\u7c7b\u578b", // 投稿类型
  body: "\u6b63\u6587\u5185\u5bb9", // 正文内容
  cover: "\u5c01\u9762", // 封面
  email: "\u90ae\u7bb1", // 邮箱
  contests: "\u6240\u5c5e\u7ade\u8d5b", // 所属竞赛
  attachment: "\u9644\u4ef6", // 附件
  hub: "\u5c5e\u6240\u4e2d\u5fc3\u9875", // 所属中心页
  created: "\u63d0\u4ea4\u65f6\u95f4", // 提交时间
  rejectReason: "\u62d2\u7edd\u539f\u56e0", // 拒绝原因
  notLogin: "\u672a\u767b\u5f55", // 未登录
  noAdmin: "\u65e0\u7ba1\u7406\u5458\u6743\u9650", // 无管理员权限
  queryFailed: "\u67e5\u8be2\u5931\u8d25", // 查询失败
  patchFailed: "\u66f4\u65b0\u5931\u8d25", // 更新失败
  missingArgs: "\u7f3a\u5c11\u53c2\u6570 action/id", // 缺少参数 action/id
};

/** 构造 Notion 请求头 */
function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/** 把 Notion 响应错误拼进抛出的错误信息，便于排查 */
async function throwWithDetail(prefix, res) {
  const detail = await res.text().catch(() => "");
  throw new Error(`${prefix} ${res.status}${detail ? ": " + detail.slice(0, 300) : ""}`);
}

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
  const cover =
    p[S.cover] && p[S.cover].files && p[S.cover].files[0]
      ? p[S.cover].files[0].type === "external"
        ? p[S.cover].files[0].external.url
        : (p[S.cover].files[0].file || {}).url || ""
      : "";
  const attFile = p[S.attachment] && p[S.attachment].files && p[S.attachment].files[0] ? p[S.attachment].files[0] : null;
  const attachment = attFile
    ? {
        name: attFile.name || "",
        url: attFile.type === "external" ? attFile.external.url : (attFile.file || {}).url || "",
      }
    : null;
  return {
    id: row.id,
    title: get(S.title),
    author: get(S.author),
    types: get(S.types) || [],
    body: get(S.body),
    cover,
    attachment,
    email: get(S.email),
    contests: get(S.contests) || [],
    hub: get(S.hub), // 所属中心页（选填）
    created: get(S.created),
  };
}

/** 查询投稿箱中指定审核状态的投稿。filter 失败自动回退全量拉取 + 内存过滤。 */
async function notionQuery(status) {
  const url = `https://api.notion.com/v1/databases/${DB_SUBMISSIONS}/query`;
  // 首选：带 filter 的查询（省流量）
  const res = await fetch(url, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({
      page_size: 50,
      filter: { property: S.status, status: { equals: status } },
    }),
  });
  if (res.ok) return (await res.json()).results || [];

  // 回退：全量拉取后内存过滤（不依赖 filter 的 property 名）
  const fb = await fetch(url, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({ page_size: 100 }),
  });
  if (!fb.ok) await throwWithDetail(S.queryFailed, fb);
  const rows = (await fb.json()).results || [];
  return rows.filter((r) => {
    const st = r.properties && r.properties[S.status] ? r.properties[S.status].status : null;
    return st && st.name === status;
  });
}

async function notionPatch(pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) await throwWithDetail(S.patchFailed, res);
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

    // 环境变量缺失时优雅降级
    const envErr = envCheck();
    if (envErr) {
      return Response.json({ error: envErr }, { status: 501 });
    }

    // GET：待审核列表
    if (req.method === "GET") {
      try {
        const rows = await notionQuery(S.pending);
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
        return Response.json({ error: S.missingArgs }, { status: 400 });
      }
      try {
        if (action === "approve") {
          await notionPatch(id, { [S.status]: { status: { name: S.approved } } });
        } else {
          const properties = { [S.status]: { status: { name: S.rejected } } };
          if (reason) {
            properties[S.rejectReason] = {
              rich_text: [{ text: { content: String(reason).slice(0, 500) } }],
            };
          }
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
