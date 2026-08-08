// ============================================
// 人员管理：数据库迁移（幂等，可重复执行）
// 功能：禁言（muted）/ 封禁（banned）/ 踢出（删除账户）
//   - profiles 增加 muted/banned 列
//   - banned 表：被封禁邮箱（注册时拦截，禁止重新入站）
//   - 注册触发器：封禁邮箱禁止注册
//   - 互动守卫：评论/表态/举报需已审核且未禁言/未封禁
//   - RPC：admin_delete_user（踢出，删除账户）、admin_set_banned（封禁/解封）
// 用法：
//   node scripts/user-manage-setup.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/user-manage-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
BEGIN;

-- 1) profiles 增加禁言 / 封禁标记
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS muted  boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false;

-- 2) 封禁邮箱表：仅安全定义者 RPC / 触发器可访问；RLS 开启且无策略 = 拒绝一切直接访问
CREATE TABLE IF NOT EXISTS public.banned (
  email      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.banned ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banned_all ON public.banned;

-- 3) 注册触发器：被封禁邮箱不允许注册 / 重新入站
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.banned WHERE email = new.email) THEN
    RAISE EXCEPTION '该邮箱已被封禁，无法注册';
  END IF;
  INSERT INTO public.profiles (user_id, nickname)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1))
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4) 资料更新守卫：非管理员只能改昵称（禁言/封禁字段同样受保护）
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    IF NEW.status   IS DISTINCT FROM OLD.status
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.email    IS DISTINCT FROM OLD.email
       OR NEW.user_id  IS DISTINCT FROM OLD.user_id
       OR NEW.muted    IS DISTINCT FROM OLD.muted
       OR NEW.banned   IS DISTINCT FROM OLD.banned THEN
      RAISE EXCEPTION '普通用户只能修改昵称';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS on_profile_update ON public.profiles;
CREATE TRIGGER on_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.guard_profile_update();

-- 5) 互动守卫：评论 / 表态 / 举报需「已审核 + 未禁言 + 未封禁」
CREATE OR REPLACE FUNCTION public.guard_interaction()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND status = 'approved'
      AND NOT muted
      AND NOT banned
  ) THEN
    RAISE EXCEPTION '账号未通过审核、已被禁言或封禁，无法执行此操作';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS guard_comments_insert ON public.comments;
CREATE TRIGGER guard_comments_insert BEFORE INSERT ON public.comments FOR EACH ROW EXECUTE PROCEDURE public.guard_interaction();
DROP TRIGGER IF EXISTS guard_votes_insert ON public.votes;
CREATE TRIGGER guard_votes_insert BEFORE INSERT ON public.votes FOR EACH ROW EXECUTE PROCEDURE public.guard_interaction();
DROP TRIGGER IF EXISTS guard_reports_insert ON public.reports;
CREATE TRIGGER guard_reports_insert BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE PROCEDURE public.guard_interaction();

-- 6) RPC：踢出（注销账户；删除后允许重新注册入站）
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION '无管理员权限';
  END IF;
  IF target_uid = auth.uid() THEN
    RAISE EXCEPTION '不能踢出自己';
  END IF;
  -- 若处于封禁状态，踢出时清除封禁记录（踢出允许重新入站）
  DELETE FROM public.banned b
  USING public.profiles p
  WHERE b.email = p.email AND p.user_id = target_uid;
  -- 显式删除 profile（不依赖 FK 级联，确保踢出后人员管理不再显示该用户）
  DELETE FROM public.profiles WHERE user_id = target_uid;
  DELETE FROM auth.users WHERE id = target_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

-- 7) RPC：封禁 / 解封（同时标记账号 + 维护封禁邮箱表，可撤销）
CREATE OR REPLACE FUNCTION public.admin_set_banned(target_uid uuid, banned_flag boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION '无管理员权限';
  END IF;
  IF target_uid = auth.uid() THEN
    RAISE EXCEPTION '不能封禁自己';
  END IF;
  IF banned_flag THEN
    INSERT INTO public.banned (email)
    SELECT email FROM public.profiles WHERE user_id = target_uid AND email IS NOT NULL AND email <> ''
    ON CONFLICT (email) DO NOTHING;
  ELSE
    DELETE FROM public.banned b
    USING public.profiles p
    WHERE b.email = p.email AND p.user_id = target_uid;
  END IF;
  UPDATE public.profiles SET banned = banned_flag WHERE user_id = target_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_banned(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_banned(uuid, boolean) TO authenticated;

-- 8) RPC：注册前查询邮箱是否被封禁（anon 可调用；注册被数据库触发器强制拦截为最终保障）
CREATE OR REPLACE FUNCTION public.check_email_banned(check_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.banned WHERE email = check_email);
END;
$$;
REVOKE ALL ON FUNCTION public.check_email_banned(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_banned(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_email_banned(text) TO authenticated;

COMMIT;
`;

try {
  await client.query(sql);
  console.log("人员管理迁移成功：muted/banned 列 + banned 表 + 触发器 + 3 个 RPC");
} catch (e) {
  console.error("迁移失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
