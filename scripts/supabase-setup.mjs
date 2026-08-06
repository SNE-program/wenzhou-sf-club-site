// ============================================
// Supabase 初始化脚本（建表 / RLS / 触发器 / Auth 配置）
// 用法：
//   node scripts/supabase-setup.mjs <postgres连接串>
// 连接串示例（事务连接池）：
//   postgresql://postgres.项目名:密码@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/supabase-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
BEGIN;

-- 扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ 用户资料 ============
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname   text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ 评论（每人每篇一条）============
CREATE TABLE IF NOT EXISTS public.comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id text NOT NULL,
  content    text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  edited_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 仅未删除的评论占位（删除后可重新评论）
CREATE UNIQUE INDEX IF NOT EXISTS one_active_comment_per_article
  ON public.comments(user_id, article_id) WHERE status = 'active';

-- ============ 表态（up=1 / no=0 / down=-1）============
CREATE TABLE IF NOT EXISTS public.votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id text NOT NULL,
  value      smallint NOT NULL CHECK (value IN (-1, 0, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_vote_per_article UNIQUE (user_id, article_id)
);

-- ============ 举报 ============
CREATE TABLE IF NOT EXISTS public.reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ 索引 ============
CREATE INDEX IF NOT EXISTS idx_comments_article ON public.comments(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_article    ON public.votes(article_id);
CREATE INDEX IF NOT EXISTS idx_reports_status   ON public.reports(status);

-- ============ 注册时自动创建用户资料 ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nickname)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1))
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ============ RLS 开启 ============
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports  ENABLE ROW LEVEL SECURITY;

-- profiles：所有人可读，仅本人可改
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- comments：可读未删除；登录用户可写自己的
DROP POLICY IF EXISTS comments_select ON public.comments;
CREATE POLICY comments_select ON public.comments FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS comments_insert ON public.comments;
CREATE POLICY comments_insert ON public.comments FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS comments_update ON public.comments;
CREATE POLICY comments_update ON public.comments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS comments_delete ON public.comments;
CREATE POLICY comments_delete ON public.comments FOR DELETE USING (auth.uid() = user_id);

-- votes：可读；本人可写自己的
DROP POLICY IF EXISTS votes_select ON public.votes;
CREATE POLICY votes_select ON public.votes FOR SELECT USING (true);
DROP POLICY IF EXISTS votes_insert ON public.votes;
CREATE POLICY votes_insert ON public.votes FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS votes_update ON public.votes;
CREATE POLICY votes_update ON public.votes FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS votes_delete ON public.votes;
CREATE POLICY votes_delete ON public.votes FOR DELETE USING (auth.uid() = user_id);

-- reports：登录用户可提交；状态管理由管理员（后续）
DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============ Auth：关闭注册邮箱确认（简化体验）============
DO $$
BEGIN
  BEGIN
    UPDATE auth.config SET enable_confirmations = false;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    UPDATE auth.config SET mailer_autoconfirm = true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

COMMIT;
`;

try {
  await client.query(sql);
  console.log("初始化成功：4 张表 + RLS 策略 + 注册触发器 + Auth 配置已完成");
} catch (e) {
  console.error("初始化失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
