// ============================================
// 昵称唯一化迁移（幂等，可重复执行）
// 功能：
//   - profiles.nickname 建大小写不敏感唯一索引（lower(nickname)）
//   - 建档触发器 handle_new_user / handle_email_confirmed 预检查昵称占用，
//     冲突则注册失败并提示（唯一索引兜底，防竞态）
// 用法：
//   node scripts/nickname-unique-setup.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/nickname-unique-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
BEGIN;

-- 1. 预检：若存在重复昵称（含大小写不敏感），拒绝执行并列出，由管理员先处理
DO $$
DECLARE
  r RECORD;
  cnt int := 0;
BEGIN
  FOR r IN
    SELECT lower(nickname) AS key, count(*)::int AS n, min(nickname) AS sample
    FROM public.profiles
    GROUP BY lower(nickname)
    HAVING count(*) > 1
    ORDER BY n DESC
  LOOP
    cnt := cnt + 1;
    RAISE NOTICE '重复昵称: % (样本 "%" 出现 % 次)', r.key, r.sample, r.n;
  END LOOP;
  IF cnt > 0 THEN
    RAISE EXCEPTION '存在 % 组重复昵称，无法建唯一索引，请先处理后再执行', cnt;
  END IF;
END $$;

-- 2. 大小写不敏感唯一索引（空串、NULL 均按唯一处理）
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_nickname ON public.profiles (lower(nickname));

-- 3. 建档触发器：注册/邮箱确认时预检查昵称占用，给出友好中文提示
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  nick text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.banned WHERE email = new.email) THEN
    RAISE EXCEPTION '该邮箱已被封禁，无法注册';
  END IF;
  IF new.email_confirmed_at IS NULL THEN
    RETURN new;
  END IF;
  nick := COALESCE(NULLIF(trim(new.raw_user_meta_data->>'nickname'), ''), split_part(new.email, '@', 1));
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(nickname) = lower(nick)) THEN
    RAISE EXCEPTION '昵称「%」已被占用，请更换后重试', nick;
  END IF;
  INSERT INTO public.profiles (user_id, nickname, email)
  VALUES (new.id, nick, new.email);
  PERFORM public.apply_student_verification(new.id, new.raw_user_meta_data);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS trigger AS $$
DECLARE
  nick text;
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
  nick := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'nickname'), ''), split_part(NEW.email, '@', 1));
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(nickname) = lower(nick)) THEN
    RAISE EXCEPTION '昵称「%」已被占用，请更换后重试', nick;
  END IF;
  INSERT INTO public.profiles (user_id, nickname, email)
  VALUES (NEW.id, nick, NEW.email);
  PERFORM public.apply_student_verification(NEW.id, NEW.raw_user_meta_data);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
`;

try {
  await client.query(sql);
  console.log("昵称唯一化迁移成功：唯一索引 + 触发器预检查");
} catch (e) {
  console.error("迁移失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
