// ============================================
// 移除昵称→邮箱查询（幂等，可重复执行）
// 背景：
//   为封闭任何昵称反查邮箱的通道，登录一律仅用邮箱。
//   删除 resolve_login_email RPC 及其执行权限。
// 用法：
//   node scripts/remove-nickname-login.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/remove-nickname-login.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

try {
  await client.query(`
    DROP FUNCTION IF EXISTS public.resolve_login_email(text);
  `);
  const exists = await client.query(
    `SELECT count(*)::int c FROM pg_proc WHERE proname = 'resolve_login_email' AND pronamespace = 'public'::regnamespace`
  );
  console.log(exists.rows[0].c === 0
    ? "resolve_login_email 已删除，昵称反查邮箱通道已封闭"
    : "警告：函数仍存在！");
} catch (e) {
  console.error("执行失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
