// ============================================
// Supabase 初始化验证（排障用）
// 用法：
//   node scripts/verify-supabase.mjs <DB_URL> <PROJECT_URL> <ANON_KEY>
// 检查：表结构 / RLS / 注册流程（免邮件确认?）/ profiles 自动创建
// ============================================
import pg from "pg";

const [dbUrl, projectUrl, anonKey] = process.argv.slice(2);
if (!dbUrl || !projectUrl || !anonKey) {
  console.error("用法: node scripts/verify-supabase.mjs <DB_URL> <PROJECT_URL> <ANON_KEY>");
  process.exit(1);
}

// ---- 连接数据库 ----
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

// ---- 0. schemas ----
const schemas = await client.query(
  `SELECT schema_name FROM information_schema.schemata ORDER BY 1`
);
console.log("=== schemas ===");
console.log("  " + schemas.rows.map((r) => r.schema_name).join(", "));

// ---- 1. 数据库结构 ----

const tables = await client.query(
  `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
);
console.log("=== 表结构（含 RLS 状态）===");
for (const t of tables.rows) {
  console.log(`  ${t.tablename} | RLS: ${t.rowsecurity}`);
}

try {
  const cfg = await client.query(`SELECT name FROM auth.config ORDER BY name`);
  const names = cfg.rows.map((r) => r.name);
  console.log("=== auth.config 关键项 ===");
  for (const n of ["enable_confirmations", "mailer_autoconfirm"]) {
    if (names.includes(n)) {
      const v = await client.query(`SELECT value FROM auth.config WHERE name=$1`, [n]);
      console.log(`  ${n} = ${v.rows[0]?.value}`);
    } else {
      console.log(`  ${n} = (不存在此字段)`);
    }
  }
} catch (e) {
  console.log("auth.config 查询失败:", e.message);
}

// ---- 2. 注册流程测试 ----
console.log("=== 注册流程测试 ===");
const email = `verify_${Date.now()}@gmail.com`;
const signup = await fetch(`${projectUrl}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: anonKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "password123", data: { nickname: "测试用户" } }),
});
const sj = await signup.json();
console.log("注册状态:", signup.status);
console.log("  响应体:", JSON.stringify(sj).slice(0, 300));
console.log("  user id:", sj.user?.id);
console.log("  session(免确认?):", sj.session ? "有 → 免邮件确认已生效" : "无 → 仍需邮件确认");
console.log("  email:", sj.user?.email);

if (sj.session) {
  const token = sj.session.access_token;
  // 3. profiles 是否自动创建 + RLS 可读
  const prof = await fetch(`${projectUrl}/rest/v1/profiles?user_id=eq.${sj.user.id}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  const pj = await prof.json();
  console.log("=== profiles 自动创建 ===");
  console.log("  ", JSON.stringify(pj));

  // 清理测试数据
  console.log("=== 清理测试用户 ===");
  await client.query(`DELETE FROM auth.users WHERE id=$1`, [sj.user.id]);
  console.log("  已删除测试用户");
}

await client.end();
