// ============================================
// 昵称登录查询接口迁移（幂等，可重复执行）
// 背景：
//   profiles 表 RLS 已收紧为「本人或管理员可读」，anon 无法直接查表，
//   因此昵称→邮箱反查必须走专用 RPC（SECURITY DEFINER）。
//   该 RPC 仅支持按单个昵称查询（昵称本身公开），无法批量抓取全表邮箱。
// 功能：
//   resolve_login_email(p_nickname) → text（邮箱或 NULL）
// 用法：
//   node scripts/resolve-login-setup.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/resolve-login-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_nickname text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM public.profiles
  WHERE lower(nickname) = lower(btrim(coalesce(p_nickname, '')))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;
`;

try {
  await client.query(sql);
  console.log("resolve_login_email RPC 已就绪（仅按昵称单查，禁止批量）");
} catch (e) {
  console.error("迁移失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
