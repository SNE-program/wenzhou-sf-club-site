// ============================================
// 入站审核迁移脚本
// 1) profiles 增加 status(待审核/通过/拒绝) + is_admin(管理员) + email
// 2) 评论/表态/举报写入仅限「审核通过」用户（RLS）
// 3) 公开昵称视图 profile_names（不暴露邮箱与状态）
// 4) 管理员可查看全部资料并修改他人状态（触发器+RLS 双重约束）
// 用法：
//   node scripts/migrate-audit.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/migrate-audit.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
BEGIN;

-- ============ profiles 扩展 ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status  text NOT NULL DEFAULT 'pending';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email   text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check CHECK (status IN ('pending','approved','rejected'));
  END IF;
END $$;

-- 管理员判定（SECURITY DEFINER：绕过 RLS 读取，避免策略互相引用）
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE user_id = uid), false)
$$;

-- 注册触发器：写入昵称 + 邮箱（默认 pending）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nickname, email)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1)),
    new.email
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 资料更新守卫：非管理员只能改昵称，禁止改状态/管理员标记/邮箱/user_id
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.email   IS DISTINCT FROM OLD.email
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION '普通用户只能修改昵称';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_update ON public.profiles;
CREATE TRIGGER on_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.guard_profile_update();

-- ============ 公开昵称视图（不暴露邮箱/状态，普通页面读它）============
DROP VIEW IF EXISTS public.profile_names;
CREATE VIEW public.profile_names AS
  SELECT user_id, nickname FROM public.profiles;
GRANT SELECT ON public.profile_names TO anon, authenticated;

-- ============ RLS：profiles ============
-- 普通用户仅可见/可改自己；管理员可见全部、可改他人状态
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT
USING (
  auth.uid() = user_id
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE
USING (
  auth.uid() = user_id
  OR public.is_admin(auth.uid())
)
WITH CHECK (
  auth.uid() = user_id
  OR public.is_admin(auth.uid())
);

-- ============ RLS：评论 / 表态 / 举报 写入仅限审核通过用户 ============
DROP POLICY IF EXISTS comments_insert ON public.comments;
CREATE POLICY comments_insert ON public.comments FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
);
DROP POLICY IF EXISTS comments_update ON public.comments;
CREATE POLICY comments_update ON public.comments FOR UPDATE
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
);
DROP POLICY IF EXISTS comments_delete ON public.comments;
CREATE POLICY comments_delete ON public.comments FOR DELETE
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
);

DROP POLICY IF EXISTS votes_insert ON public.votes;
CREATE POLICY votes_insert ON public.votes FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
);
DROP POLICY IF EXISTS votes_update ON public.votes;
CREATE POLICY votes_update ON public.votes FOR UPDATE
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
);
DROP POLICY IF EXISTS votes_delete ON public.votes;
CREATE POLICY votes_delete ON public.votes FOR DELETE
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
);

DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.status = 'approved')
);

COMMIT;
`;

try {
  await client.query(sql);
  console.log("迁移成功：审核状态/管理员/RLS/昵称视图 已完成");
} catch (e) {
  console.error("迁移失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
