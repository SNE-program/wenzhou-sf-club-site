// ============================================
// 将管理员降级为普通用户（移除管理员权限）
// 用法：
//   node scripts/revoke-admin.mjs <postgres连接串> <用户邮箱>
// 示例：
//   node scripts/revoke-admin.mjs "postgresql://postgres:密码@db.项目.supabase.co:5432/postgres" 某管理员@example.com
// 说明：管理员权限只能通过命令工具（promote-admin / revoke-admin）或 SQL 添加/移除，
//       管理后台界面不提供该能力，防止误操作。
// ============================================
import pg from "pg";

const conn = process.argv[2];
const email = process.argv[3];
if (!conn || !email) {
  console.error("用法: node scripts/revoke-admin.mjs <postgres连接串> <用户邮箱>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const found = await client.query("SELECT id FROM auth.users WHERE email = $1", [email]);
  if (!found.rowCount) {
    console.error(`未找到该邮箱的注册用户：${email}`);
    process.exit(1);
  }
  const uid = found.rows[0].id;
  await client.query("SELECT set_config('request.jwt.claim.sub', $1::text, false)", [uid]);
  await client.query("SELECT set_config('request.jwt.claims', $1::text, false)", [
    JSON.stringify({ sub: uid }),
  ]);
  // 降级时临时禁用守卫触发器（防止把自身降级视为非法修改）
  await client.query("ALTER TABLE public.profiles DISABLE TRIGGER on_profile_update");
  try {
    const r = await client.query(
      "UPDATE public.profiles SET is_admin = false WHERE user_id = $1 RETURNING nickname, status, is_admin",
      [uid]
    );
    if (!r.rowCount) {
      console.error("已找到用户但资料不存在（触发器未执行？）");
      process.exit(1);
    }
    console.log(`已移除管理员权限：${email}（昵称 ${r.rows[0].nickname}，is_admin=${r.rows[0].is_admin}）`);
  } finally {
    await client.query("ALTER TABLE public.profiles ENABLE TRIGGER on_profile_update");
  }
} catch (e) {
  console.error("操作失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
