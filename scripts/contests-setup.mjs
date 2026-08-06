// ============================================
// 竞赛系统：建表 + RLS（公开可读，仅管理员可增删改）
// 用法：
//   node scripts/contests-setup.mjs <postgres连接串>
// 连接串（直连）：
//   postgresql://postgres.项目ref:密码@db.项目ref.supabase.co:5432/postgres
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/contests-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
BEGIN;

CREATE TABLE IF NOT EXISTS public.contests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  status     text NOT NULL DEFAULT '报名中' CHECK (status IN ('报名中','评审中','已结束')),
  deadline   date,
  topic      text NOT NULL DEFAULT '',
  rules      text NOT NULL DEFAULT '',
  awards     text NOT NULL DEFAULT '',
  winners    text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contests_sort ON public.contests(sort_order);

ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY;

-- 所有人可读
DROP POLICY IF EXISTS contests_select ON public.contests;
CREATE POLICY contests_select ON public.contests FOR SELECT USING (true);

-- 仅管理员可写（profiles.is_admin = true）
DROP POLICY IF EXISTS contests_insert ON public.contests;
CREATE POLICY contests_insert ON public.contests FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin));
DROP POLICY IF EXISTS contests_update ON public.contests;
CREATE POLICY contests_update ON public.contests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin));
DROP POLICY IF EXISTS contests_delete ON public.contests;
CREATE POLICY contests_delete ON public.contests FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin));

-- 写入示例竞赛（便于上线即有内容）
INSERT INTO public.contests (title, status, deadline, topic, rules, awards, winners, sort_order)
SELECT '第一届「星际信使」科幻征文大赛', '报名中', '2026-12-31',
       '以「信」为核，写一个 3000 字以内的科幻短篇——一封跨越光年、时间或次元的信。',
       '面向全校同学，每人限投 1 篇；要求原创；投稿时选择类型「竞赛投稿」；由全体同学投票决出人气奖，评审团评出创意奖与文笔奖。',
       '创意奖 / 文笔奖 / 人气奖 各 1 名，获奖作品收入社刊并在网站展示。',
       '', 0
WHERE NOT EXISTS (SELECT 1 FROM public.contests);

COMMIT;
`;

try {
  await client.query(sql);
  console.log("初始化成功：contests 表 + RLS + 示例数据已完成");
} catch (e) {
  console.error("初始化失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
