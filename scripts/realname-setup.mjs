// ============================================
// 实名认证（途径一：名册自动核验）数据库迁移（幂等，可重复执行）
// 功能：
//   - student_roster 表：在校名册（学号仅存 crypt(bf) 哈希 + 脱敏掩码，无明文）
//   - student_verifications 表：学号绑定（student_hash 唯一 → 一人一号）
//   - profile_names 视图：公开输出实名（仅已核验学生），学号永不公开
//   - 注册/邮箱确认触发器：建档时自动按名册核验 → approved / rejected
//   - RPC：verify_student（补录/修正重试）、admin_unbind_student（解绑）、
//          admin_bind_student（线下核实代绑）、admin_list_verifications（管理员读取）
// 关键点：
//   - 实名信息不写入 profiles（避免与 guard_profile_update 冲突，用户无法自改实名）
//   - 状态写入经 set_profile_status()（session_replication_role 旁路用户触发器，
//     session_replication_role 仅超级用户可设置，用户无法自行模拟绕过守卫）
// 用法：
//   node scripts/realname-setup.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/realname-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ 1. 在校名册表（RLS 开启、零公开策略；仅 SECURITY DEFINER / 服务端可访问）============
CREATE TABLE IF NOT EXISTS public.student_roster (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_hash  text NOT NULL,          -- crypt('学号', gen_salt('bf'))，每行随机盐，不可逆
  display_mask  text NOT NULL,          -- 学号脱敏掩码（如 '27****08'），供管理员线下对册
  name          text NOT NULL,          -- 真实姓名
  grade_class   text,                   -- 班级/年级（可选）
  active        boolean NOT NULL DEFAULT true,
  imported_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roster_hash ON public.student_roster(student_hash);
ALTER TABLE public.student_roster ENABLE ROW LEVEL SECURITY;

-- ============ 2. 学号绑定表（RLS 开启、零公开策略；student_hash 唯一 → 一人一号）============
CREATE TABLE IF NOT EXISTS public.student_verifications (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  student_hash  text NOT NULL UNIQUE,   -- 与名册同一哈希（确定性），唯一约束实现一人一号
  display_mask  text NOT NULL,
  real_name     text NOT NULL,
  source        text NOT NULL DEFAULT 'roster',
  verified_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.student_verifications ENABLE ROW LEVEL SECURITY;

-- ============ 3. 公开昵称视图：实名仅对已核验学生输出（视图属主 postgres，可跨 RLS 表读取）============
DROP VIEW IF EXISTS public.profile_names;
CREATE VIEW public.profile_names AS
  SELECT p.user_id, p.nickname, v.real_name
  FROM public.profiles p
  LEFT JOIN public.student_verifications v ON v.user_id = p.user_id;
GRANT SELECT ON public.profile_names TO anon, authenticated;

-- ============ 4. 内部状态写入（旁路用户触发器；session_replication_role 仅超级用户可设）============
CREATE OR REPLACE FUNCTION public.set_profile_status(p_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 用户触发器 guard_profile_update 仅允许管理员改 status；
  -- 此处为系统内部写入（名册核验 / 管理员操作），临时旁路用户触发器。
  -- session_replication_role 只能由超级用户设置，普通用户无法自行模拟该旁路。
  SET LOCAL session_replication_role = 'replica';
  UPDATE public.profiles SET status = p_status WHERE user_id = p_user_id;
  RESET session_replication_role;
END;
$$;

-- ============ 5. 名册核验核心函数（建档时 / 补录时共用）============
CREATE OR REPLACE FUNCTION public.apply_student_verification(p_user_id uuid, p_metadata jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  sid   text := NULLIF(trim(p_metadata->>'student_id'), '');
  rname text := NULLIF(trim(p_metadata->>'real_name'), '');
  row   record;
BEGIN
  -- 未提供学号/姓名 → 非学生通道，保持 pending 交给人工审核
  IF sid IS NULL OR rname IS NULL THEN
    RETURN 'skipped';
  END IF;

  -- 名册匹配：crypt 复用库内随机盐比对（比对过程不出现明文学号）
  SELECT r.* INTO row
  FROM public.student_roster r
  WHERE r.active = true
    AND r.student_hash = crypt(sid, r.student_hash);

  -- 未命中或姓名不符
  IF row IS NULL OR row.name <> rname THEN
    PERFORM public.set_profile_status(p_user_id, 'rejected');
    RETURN 'no_match';
  END IF;

  -- 命中：绑定学号（student_hash 唯一约束兜底一人一号）
  BEGIN
    INSERT INTO public.student_verifications (user_id, student_hash, display_mask, real_name)
    VALUES (p_user_id, row.student_hash, row.display_mask, row.name);
  EXCEPTION WHEN unique_violation THEN
    -- 该学号已被其他账号绑定 → 拒绝（由管理员线下核实后解绑重绑）
    PERFORM public.set_profile_status(p_user_id, 'rejected');
    RETURN 'claimed';
  END;

  PERFORM public.set_profile_status(p_user_id, 'approved');
  RETURN 'ok';
END;
$$;

-- ============ 6. 注册触发器：建档时自动核验（保留封禁拦截 + 邮箱确认逻辑）============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.banned WHERE email = new.email) THEN
    RAISE EXCEPTION '该邮箱已被封禁，无法注册';
  END IF;
  IF new.email_confirmed_at IS NULL THEN
    RETURN new;
  END IF;
  INSERT INTO public.profiles (user_id, nickname, email)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1)),
    new.email
  );
  PERFORM public.apply_student_verification(new.id, new.raw_user_meta_data);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6.1 邮箱验证通过后建档（幂等）并自动核验
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS trigger AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.banned WHERE email = NEW.email) THEN
    RAISE EXCEPTION '该邮箱已被封禁，无法注册';
  END IF;
  INSERT INTO public.profiles (user_id, nickname, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  PERFORM public.apply_student_verification(NEW.id, NEW.raw_user_meta_data);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_email_confirmed();

-- ============ 7. RPC：实名补录 / 修正重试（登录用户自助，服务端按名册核验）============
CREATE OR REPLACE FUNCTION public.verify_student(p_student_id text, p_real_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  res text;
  rn  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  -- 已绑定 → 幂等返回
  IF EXISTS (SELECT 1 FROM public.student_verifications v WHERE v.user_id = auth.uid()) THEN
    SELECT real_name INTO rn FROM public.student_verifications WHERE user_id = auth.uid();
    RETURN jsonb_build_object('ok', true, 'already', true, 'real_name', rn);
  END IF;

  res := public.apply_student_verification(
    auth.uid(),
    jsonb_build_object('student_id', p_student_id, 'real_name', p_real_name)
  );

  IF res = 'ok' THEN
    SELECT real_name INTO rn FROM public.student_verifications WHERE user_id = auth.uid();
    RETURN jsonb_build_object('ok', true, 'real_name', rn);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', res);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_student(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_student(text, text) TO authenticated;

-- ============ 8. RPC：管理员解绑（冒认纠纷处理，可重绑）============
CREATE OR REPLACE FUNCTION public.admin_unbind_student(target_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION '无管理员权限';
  END IF;
  DELETE FROM public.student_verifications WHERE user_id = target_uid;
  -- 解除绑定后回到待审核，供正确学生重新认领
  PERFORM public.set_profile_status(target_uid, 'pending');
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unbind_student(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unbind_student(uuid) TO authenticated;

-- ============ 9. RPC：管理员线下核实后代绑（生僻字/姓名变动等兜底）============
CREATE OR REPLACE FUNCTION public.admin_bind_student(target_uid uuid, p_student_id text, p_real_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  res text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION '无管理员权限';
  END IF;
  res := public.apply_student_verification(
    target_uid,
    jsonb_build_object('student_id', p_student_id, 'real_name', p_real_name)
  );
  RETURN jsonb_build_object('ok', res = 'ok', 'result', res);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bind_student(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bind_student(uuid, text, text) TO authenticated;

-- ============ 10. RPC：管理员读取全部实名绑定（人员管理页展示用）============
CREATE OR REPLACE FUNCTION public.admin_list_verifications()
RETURNS TABLE (user_id uuid, display_mask text, real_name text, verified_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION '无管理员权限';
  END IF;
  RETURN QUERY
    SELECT v.user_id, v.display_mask, v.real_name, v.verified_at
    FROM public.student_verifications v
    ORDER BY v.verified_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_verifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_verifications() TO authenticated;

COMMIT;
`;

try {
  await client.query(sql);
  console.log("实名认证迁移成功：2 张表 + profile_names 视图 + 触发器 + 4 个 RPC");
} catch (e) {
  console.error("迁移失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
