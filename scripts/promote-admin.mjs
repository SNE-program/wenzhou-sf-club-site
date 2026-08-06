// ============================================
// 将某注册用户提升为管理员（初始化首个管理员用）
// 用法：
//   node scripts/promote-admin.mjs <postgres连接串> <用户邮箱>
// 示例：
//   node scripts/promote-admin.mjs "postgresql://postgres:密码@db.项目.supabase.co:5432/postgres" 社长邮箱@example.com
// 说明：首个管理员无法自己授权自己，需用本脚本（或 Supabase 后台 SQL 编辑器）初始化。
// 提升后该用户同时标记为「已通过审核」，登录后导航会出现「审核」入口。
// ============================================
import pg from "pg";

const conn = process.argv[2];
const email = process.argv[3];
if (!conn || !email) {
  console.error("用法: node scripts/promote-admin.mjs <postgres连接串> <用户邮箱>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const found = await client.query("SELECT id FROM auth.users WHERE email = $1", [email]);
  if (!found.rowCount) {
    console.error(`未找到该邮箱的注册用户：${email}（请先注册并完成邮箱验证）`);
    process.exit(1);
  }
  const uid = found.rows[0].id;
  await client.query("SELECT set_config('request.jwt.claim.sub', $1::text, false)", [uid]);
  await client.query("SELECT set_config('request.jwt.claims', $1::text, false)", [
    JSON.stringify({ sub: uid }),
  ]);
  // 首个管理员无法通过「管理员判定」自我提升，初始化时临时禁用守卫触发器
  await client.query("ALTER TABLE public.profiles DISABLE TRIGGER on_profile_update");
  try {
    const r = await client.query(
      "UPDATE public.profiles SET is_admin = true, status = 'approved' WHERE user_id = $1 RETURNING nickname, status, is_admin",
      [uid]
    );
    if (!r.rowCount) {
      console.error("已找到用户但资料不存在（触发器未执行？）");
      process.exit(1);
    }
    console.log(`已提升为管理员：${email}（昵称 ${r.rows[0].nickname}，状态 ${r.rows[0].status}）`);
  } finally {
    await client.query("ALTER TABLE public.profiles ENABLE TRIGGER on_profile_update");
  }
} catch (e) {
  console.error("提升失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
