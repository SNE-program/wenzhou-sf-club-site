// ============================================
// Supabase Edge Function：管理员警告通知（Resend 版）
// 复用 send-audit-email 的部署方式与环境变量。
//
// 接口：
//   POST {SUPABASE_URL}/functions/v1/admin-warning
//   headers: Authorization: Bearer <管理员登录JWT>，apikey: <anon>
//   body: { target_uid: "<目标用户 uuid>", reason: "警告原因" }
//   → 向目标用户邮箱发送警告邮件，并将该用户 warned 置为 true（开关，不计数）
//
// 必配密钥（Settings → Environment variables，与 send-audit-email 相同）：
//   RESEND_API_KEY / RESEND_FROM / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "onboarding@resend.dev";

export default {
  fetch: withSupabase({ auth: "user" }, async (req) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method Not Allowed" }, { status: 405 });
    }
    if (!RESEND_API_KEY) {
      return Response.json({ error: "邮件服务未配置（缺少 RESEND_API_KEY）" }, { status: 501 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad json" }, { status: 400 });
    }
    const { target_uid, reason } = body || {};
    if (!target_uid || !String(reason || "").trim()) {
      return Response.json({ error: "缺少参数 target_uid/reason" }, { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 管理员校验
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

    // 读取目标用户资料
    const { data: target, error: tErr } = await supabase
      .from("profiles")
      .select("nickname, email, muted, banned")
      .eq("user_id", target_uid)
      .maybeSingle();
    if (tErr || !target || !target.email) {
      return Response.json({ error: "目标用户不存在或缺少邮箱" }, { status: 404 });
    }

    const escHtml = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
      );
    const reasonText = String(reason).trim().slice(0, 500);

    const text =
      `你好${target.nickname ? "，" + target.nickname : ""}！\n\n` +
      `你因以下原因收到一次社团管理警告：\n${reasonText}\n\n` +
      `请遵守网站站规（"关于"页可查看）。如对处理有异议，可通过"关于"页联系管理员申诉一次。\n\n` +
      `—— 温州中学科学及幻想文学社`;

    const html = `
      <div style="background:#0b1120;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#111a2e;border:1px solid #243049;border-radius:16px;padding:32px 28px;">
          <div style="font-size:15px;font-weight:700;color:#22d3ee;letter-spacing:1px;margin-bottom:20px;">✦ 温州中学科学及幻想文学社</div>
          <div style="font-size:22px;font-weight:700;color:#fbbf24;margin-bottom:18px;">⚠️ 管理警告</div>
          <div style="font-size:15px;line-height:1.8;color:#cbd5e1;margin-bottom:24px;">
            <p style="margin:0 0 10px;">你好，${escHtml(target.nickname || "星友")}！</p>
            <p style="margin:0 0 10px;">你因以下原因收到一次社团管理警告：</p>
            <p style="margin:0 0 10px;padding:10px 14px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.35);border-radius:10px;color:#fde68a;"><b>${escHtml(reasonText)}</b></p>
            <p style="margin:0;">请遵守网站站规（"关于"页可查看）。如对处理有异议，可通过"关于"页联系管理员申诉一次。</p>
          </div>
          <div style="margin-top:28px;padding-top:16px;border-top:1px solid #243049;font-size:12px;color:#64748b;">本邮件由系统自动发送，请勿直接回复。</div>
        </div>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [target.email],
        subject: "温州中学科学及幻想文学社 · 管理警告",
        html,
        text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json({ error: "邮件发送失败 " + res.status + (detail ? ": " + detail.slice(0, 200) : "") }, { status: 502 });
    }

    // 置警告开关（布尔，不计数）
    const { error: upErr } = await supabase
      .from("profiles")
      .update({ warned: true })
      .eq("user_id", target_uid);
    if (upErr) {
      return Response.json({ error: "警告已发送但记录失败：" + upErr.message }, { status: 502 });
    }

    return Response.json({ ok: true });
  }),
};
