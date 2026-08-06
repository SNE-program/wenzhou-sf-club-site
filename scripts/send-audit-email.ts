// ============================================
// Supabase Edge Function：审核结果邮件通知
// 部署方式（Supabase Dashboard 在线编辑，无需本地 CLI）：
//   1) 打开 https://supabase.com/dashboard → 选择项目 edfxoxcvprjzbemojshr
//   2) 左侧 Edge Functions → Create a new function → 名称填 send-audit-email
//   3) 把本文件内容整体粘贴到在线编辑器，Deploy
//   4) 在该函数的 Settings → Environment variables 添加以下密钥：
//        SUPABASE_URL = https://edfxoxcvprjzbemojshr.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY = <service_role 密钥（见 权限.txt）>
//        SMTP_HOST     = smtp.qq.com（以你所用邮箱为准）
//        SMTP_PORT     = 465
//        SMTP_USER     = 你的邮箱地址（如 xxxx@qq.com）
//        SMTP_PASS     = SMTP 授权码（QQ/163 邮箱需开启 SMTP 服务后生成）
//        MAIL_FROM     = 与 SMTP_USER 相同（发件人地址）
//   5) 重新 Deploy 使密钥生效
// 说明：函数会先校验调用者是「管理员」，再发送邮件，避免被滥用为垃圾邮件中转。
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { email, nickname, status } = body || {};
  if (!email || !status) return json({ error: "缺少参数 email/status" }, 400);
  if (!["approved", "rejected"].includes(status)) {
    return json({ error: "status 只能是 approved 或 rejected" }, 400);
  }

  // 校验调用者是管理员
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) return json({ error: "未登录" }, 401);
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me || !me.is_admin) return json({ error: "无管理员权限" }, 403);

  // 发送邮件
  const smtp = new SmtpClient();
  try {
    await smtp.connect({
      hostname: Deno.env.get("SMTP_HOST") || "",
      port: Number(Deno.env.get("SMTP_PORT") || 465),
      tls: true,
      username: Deno.env.get("SMTP_USER") || "",
      password: Deno.env.get("SMTP_PASS") || "",
    });
    const passText = status === "approved" ? "已通过" : "未通过";
    await smtp.send({
      from: Deno.env.get("MAIL_FROM") || "",
      to: email,
      subject: `温州中学科学及幻想文学社 · 账号审核${status === "approved" ? "通过" : "结果"}`,
      content:
        `你好${nickname ? "，" + nickname : ""}！\n\n` +
        `你的账号审核${passText}。\n` +
        (status === "approved"
          ? "现在可以登录网站发表评论、表态和举报了。\n"
          : "如有疑问，请联系社团管理人员。\n") +
        `\n—— 温州中学科学及幻想文学社`,
    });
    await smtp.close();
    return json({ ok: true });
  } catch (e) {
    try { await smtp.close(); } catch { /* ignore */ }
    return json({ error: String((e && e.message) || e) }, 500);
  }
});
