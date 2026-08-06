// ============================================
// Supabase Edge Function：审核结果邮件通知（Resend 版）
// 基于 Supabase 官方 Resend 模板（jsr:@supabase/server + api.resend.com），
// 额外增加了：管理员身份校验、参数校验、发件人环境变量化。
//
// 部署方式（Supabase Dashboard 在线编辑，无需本地 CLI）：
//   1) https://supabase.com/dashboard → 项目 edfxoxcvprjzbemojshr
//   2) 左侧 Edge Functions → Create a new function → 名称填 send-audit-email
//   3) 把本文件内容整体粘贴到在线编辑器 → Deploy
//   4) 在该函数的 Settings → Environment variables 添加密钥（见下方「必配密钥」）
//   5) 密钥改动后需再点一次 Deploy 才会生效
//
// 必配密钥（Settings → Environment variables）：
//   RESEND_API_KEY           = Resend 控制台创建的 API Key（re_ 开头）
//   RESEND_FROM              = 发件人地址。测试期可填 onboarding@resend.dev
//                              正式需先在 Resend 验证域名后填 noreply@你的域名
//   SUPABASE_URL             = https://edfxoxcvprjzbemojshr.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = service_role 密钥（见 权限.txt，只存在于服务端）
//
// 调用方式（admin.html 已内置）：
//   POST {SUPABASE_URL}/functions/v1/send-audit-email
//   headers: Authorization: Bearer <管理员登录JWT>，apikey: <anon>
//   body: { email, nickname, status }   status ∈ approved | rejected
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "onboarding@resend.dev";

// 环境变量缺失时优雅降级（避免平台返回裸 500 且不带 CORS 头，导致浏览器报 CORS 错误）
function envCheck(): string | null {
  if (!RESEND_API_KEY) return "邮件服务未配置（缺少 RESEND_API_KEY，请在函数 Settings→Environment variables 中添加后重新 Deploy）";
  if (!Deno.env.get("SUPABASE_URL")) return "邮件服务未配置（缺少 SUPABASE_URL）";
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return "邮件服务未配置（缺少 SUPABASE_SERVICE_ROLE_KEY）";
  return null;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }

    // 参数校验
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad json" }, { status: 400 });
    }
    const { email, nickname, status } = body || {};
    if (!email || !status) {
      return Response.json({ error: "缺少参数 email/status" }, { status: 400 });
    }
    if (!["approved", "rejected"].includes(status)) {
      return Response.json({ error: "status 只能是 approved 或 rejected" }, { status: 400 });
    }

    // 管理员校验：withSupabase 只保证"已登录"，这里再确认调用者是管理员
    const envErr = envCheck();
    if (envErr) {
      return Response.json({ error: envErr }, { status: 501 });
    }
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

    // 组装邮件内容（HTML 样式 + 纯文本兜底）
    const passText = status === "approved" ? "已通过" : "未通过";
    const isApproved = status === "approved";
    const siteUrl = "https://sne-program.github.io/wenzhou-sf-club-site/";
    const escHtml = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
      );
    const subject = `温州中学科学及幻想文学社 · 账号审核${isApproved ? "通过" : "结果"}`;

    const text =
      `你好${nickname ? "，" + nickname : ""}！\n\n` +
      `你的账号审核${passText}。\n` +
      (isApproved
        ? "现在可以登录网站发表评论、表态和举报了：\n" + siteUrl + "\n"
        : "如有疑问，请联系社团管理人员。\n") +
      `\n—— 温州中学科学及幻想文学社`;

    const statusBadge = isApproved ? "🎉 审核通过" : "😔 审核未通过";
    const statusColor = isApproved ? "#22d3ee" : "#f87171";
    const html = `
      <div style="background:#0b1120;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#111a2e;border:1px solid #243049;border-radius:16px;padding:32px 28px;">
          <div style="font-size:15px;font-weight:700;color:#22d3ee;letter-spacing:1px;margin-bottom:20px;">✦ 温州中学科学及幻想文学社</div>
          <div style="font-size:22px;font-weight:700;color:${statusColor};margin-bottom:18px;">${statusBadge}</div>
          <div style="font-size:15px;line-height:1.8;color:#cbd5e1;margin-bottom:24px;">
            <p style="margin:0 0 10px;">你好，${escHtml(nickname || "星友")}！</p>
            <p style="margin:0 0 10px;">你的账号申请已<b style="color:#f1f5f9;">${passText}</b>。</p>
            ${isApproved
              ? `<p style="margin:0;">现在你已可以登录网站，发表评论、表态并举报违规内容了。</p>`
              : `<p style="margin:0;">如有疑问，请联系社团管理人员。</p>`}
          </div>
          ${isApproved
            ? `<a href="${siteUrl}" style="display:inline-block;background:linear-gradient(135deg,#22d3ee,#a78bfa);color:#081018;text-decoration:none;font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px;">🚀 进入网站</a>`
            : ""}
          <div style="margin-top:28px;padding-top:16px;border-top:1px solid #243049;font-size:12px;color:#64748b;">本邮件由系统自动发送，请勿直接回复。</div>
        </div>
      </div>`;

    // 通过 Resend API 发送
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject,
        html,
        text,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json({ error: (data && data.message) || "邮件发送失败" }, { status: 502 });
    }
    return Response.json({ ok: true });
  }),
};
