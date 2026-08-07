// ============================================
// Supabase Edge Function：站内投稿（仅登录用户）
// 复用 submission-review 的部署方式与环境变量（NOTION_TOKEN / DB_SUBMISSIONS）。
//
// 接口:
//   POST {SUPABASE_URL}/functions/v1/submit-work
//   body: {
//     title: string         必填，作品标题
//     types: string[]       投稿类型（短篇小说/世界观设定/科普随笔/其他…）
//     body: string          正文（必填）
//     cover?: string        封面图片直链 http/https（可选）
//     contests?: string[]   所属竞赛（可选）
//     nickname?: string     作者笔名（不传则用注册昵称）
//   }
//   headers: Authorization: Bearer <登录JWT>，apikey: <anon>
//   → 服务端校验登录（未登录 401）后写入 Notion 投稿箱（审核状态=待审核），
//     管理员在 admin-submissions.html 审核，Cloudflare Worker 定时任务完成发布闭环。
//
// 重要：本文件代码中的中文字符串常量均以 \uXXXX 转义书写（纯 ASCII），
// 避免在 Dashboard 复制粘贴时编码被破坏导致 Notion 请求 400。
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const NOTION_TOKEN = (Deno.env.get("NOTION_TOKEN") ?? "").trim();
const NOTION_VERSION = "2022-06-28";

// 环境变量缺失时优雅降级（避免裸 500 且不带 CORS 头）
function envCheck(): string | null {
  if (!NOTION_TOKEN) return "\u6295\u7a3f\u670d\u52a1\u672a\u914d\u7f6e\uff08\u7f3a\u5c11 NOTION_TOKEN\uff09";
  if (!DB_SUBMISSIONS) return "\u6295\u7a3f\u670d\u52a1\u672a\u914d\u7f6e\uff08\u7f3a\u5c11 DB_SUBMISSIONS\uff09";
  return null;
}

// DB_SUBMISSIONS：自动容错误填（如 Notion 页面/表单链接、32 位无连字符 ID、多余空格）
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
  title: "\u4f5c\u54c1\u6807\u9898", // 作品标题
  author: "\u4f5c\u8005\u7b14\u540d", // 作者笔名
  types: "\u6295\u7a3f\u7c7b\u578b", // 投稿类型
  body: "\u6b63\u6587\u5185\u5bb9", // 正文内容
  cover: "\u5c01\u9762", // 封面
  email: "\u90ae\u7bb1", // 邮箱
  contests: "\u6240\u5c5e\u7ade\u8d5b", // 所属竞赛
  status: "\u5ba1\u6838\u72b6\u6001", // 审核状态
  pending: "\u5f85\u5ba1\u6838", // 待审核
};

/** 写入 Notion 投稿箱（审核状态=待审核） */
async function createSubmitPage(data) {
  const properties = {
    [S.title]: { title: [{ text: { content: data.title } }] },
    [S.author]: { rich_text: [{ text: { content: data.author } }] },
    [S.types]: { multi_select: data.types.map((n) => ({ name: n })) },
    [S.body]: { rich_text: [{ text: { content: data.body } }] },
    [S.email]: { rich_text: [{ text: { content: data.email } }] },
    [S.status]: { status: { name: S.pending } },
  };
  if (data.cover) {
    properties[S.cover] = { files: [{ name: "cover", external: { url: data.cover } }] };
  }
  if (data.contests && data.contests.length) {
    properties[S.contests] = { multi_select: data.contests.map((n) => ({ name: n })) };
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: DB_SUBMISSIONS }, properties }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`\u6295\u7a3f\u5931\u8d25 ${res.status}${detail ? ": " + detail.slice(0, 300) : ""}`);
  }
  return res.json();
}

/** 清洗字符串并限长 */
function clean(str, max) {
  return String(str ?? "").trim().slice(0, max);
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    // 环境变量缺失时优雅降级
    const envErr = envCheck();
    if (envErr) {
      return Response.json({ error: envErr }, { status: 501 });
    }

    if (req.method !== "POST") {
      return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad json" }, { status: 400 });
    }

    const title = clean(body.title, 80);
    if (!title) {
      return Response.json({ error: "\u8bf7\u8f93\u5165\u6709\u6548\u6807\u9898" }, { status: 400 });
    }
    const rawBody = clean(body.body, 20000);
    if (!rawBody) {
      return Response.json({ error: "\u6b63\u6587\u5185\u5bb9\u8fc7\u957f" }, { status: 400 });
    }
    const types = Array.isArray(body.types)
      ? [...new Set(body.types.map((t) => clean(t, 20)).filter(Boolean))].slice(0, 5)
      : [];
    const contests = Array.isArray(body.contests)
      ? [...new Set(body.contests.map((t) => clean(t, 50)).filter(Boolean))].slice(0, 3)
      : [];
    let cover = clean(body.cover, 2000) || "";
    if (cover && !/^https?:\/\//i.test(cover)) cover = "";

    // 获取登录用户信息（笔名默认用注册昵称）
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
      return Response.json({ error: "\u672a\u767b\u5f55" }, { status: 401 });
    }
    const { data: me } = await supabase
      .from("profiles")
      .select("nickname")
      .eq("user_id", user.id)
      .maybeSingle();
    const nickname = clean(body.nickname, 20) || (me && me.nickname) || (user.user_metadata && user.user_metadata.nickname) || "\u661f\u5c18";

    try {
      const page = await createSubmitPage({
        title,
        author: nickname,
        types,
        body: rawBody,
        cover,
        email: user.email || "",
        contests,
      });
      return Response.json({ ok: true, id: page.id });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 502 });
    }
  }),
};
