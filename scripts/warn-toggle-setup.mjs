// ============================================
// 警告系统改造：计数 → 开关（幂等，可重复执行）
//   1. profiles 增加 warned 布尔列（与封禁一致，不计数）
//   2. 现有 warning_count > 0 的用户回填为 warned = true
//   3. 删除 warning_count 列
// 用法：
//   node scripts/warn-toggle-setup.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/warn-toggle-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const ok = (msg) => console.log("  ✓ " + msg);
const fail = (msg) => { console.error("  ✗ " + msg); process.exitCode = 1; };

try {
  // 1. 新增 warned 列
  await client.query(`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS warned boolean NOT NULL DEFAULT false;`);
  ok("profiles.warned 列就绪（boolean 默认 false）");

  // 2. 回填现有被警告用户（warning_count > 0 → warned = true）
  const backfill = await client.query(
    `UPDATE public.profiles SET warned = true
       WHERE warning_count > 0 AND warned = false;`
  );
  ok(`回填历史警告用户 ${backfill.rowCount} 人`);

  // 3. 删除计数列
  const hasCount = await client.query(
    `SELECT count(*)::int c FROM information_schema.columns
      WHERE table_schema='public' AND table_name='profiles' AND column_name='warning_count'`
  );
  if (hasCount.rows[0].c > 0) {
    await client.query(`ALTER TABLE public.profiles DROP COLUMN IF EXISTS warning_count;`);
    ok("warning_count 列已删除");
  } else {
    ok("warning_count 列已不存在，跳过删除");
  }

  // 验证
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='profiles'
        AND column_name IN ('warned','warning_count') ORDER BY column_name`
  );
  const names = cols.rows.map((r) => r.column_name).join(",");
  const warnedN = await client.query(`SELECT count(*)::int c FROM public.profiles WHERE warned = true;`);
  if (names === "warned") {
    ok(`验证通过：profiles 列 ${names}，当前被警告用户 ${warnedN.rows[0].c} 人`);
  } else {
    fail(`列异常：${names}`);
  }
} catch (e) {
  fail(e.message);
} finally {
  await client.end();
}
