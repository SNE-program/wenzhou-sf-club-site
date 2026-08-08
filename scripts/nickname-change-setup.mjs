// ============================================
// 昵称修改功能迁移（幂等，可重复执行）
// 功能：
//   - profiles 增加 nickname_updated_at 列（记录建档/上次改名时间，用于 7 天频率限制）
//   - 建档触发器写入 nickname_updated_at = now()
//   - RPC change_nickname：校验唯一性（大小写不敏感）+ 7 天间隔，返回结构化结果
// 用法：
//   node scripts/nickname-change-setup.mjs <postgres连接串>
// ============================================
import pg from "pg";

const conn = process.argv[2];
if (!conn) {
  console.error("用法: node scripts/nickname-change-setup.mjs <postgres连接串>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const sql = `
BEGIN;

-- 1. 上次改名时间列 + 存量回填（以建档时间为基准）
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname_updated_at timestamptz;
UPDATE public.profiles
   SET nickname_updated_at = COALESCE(nickname_updated_at, created_at, now())
 WHERE nickname_updated_at IS NULL;

-- 2. 建档触发器：保留封禁拦截/昵称占用检查，并记录建档时间为改名频率基准
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
  INSERT INTO public.profiles (user_id, nickname, email, nickname_updated_at)
  VALUES (new.id, nick, new.email, now());
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
  INSERT INTO public.profiles (user_id, nickname, email, nickname_updated_at)
  VALUES (NEW.id, nick, NEW.email, now());
  PERFORM public.apply_student_verification(NEW.id, NEW.raw_user_meta_data);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 改名 RPC：唯一性（大小写不敏感）+ 7 天频率限制
CREATE OR REPLACE FUNCTION public.change_nickname(p_new_nickname text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_nick text := trim(coalesce(p_new_nickname, ''));
  cur      record;
  next_at  timestamptz;
BEGIN
  SELECT nickname, nickname_updated_at INTO cur
  FROM public.profiles
  WHERE user_id = auth.uid();
  IF cur.nickname IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF new_nick = '' OR char_length(new_nick) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF new_nick = cur.nickname THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles
             WHERE lower(nickname) = lower(new_nick) AND user_id <> auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END IF;
  IF cur.nickname_updated_at IS NOT NULL
     AND cur.nickname_updated_at > now() - interval '7 days' THEN
    next_at := cur.nickname_updated_at + interval '7 days';
    RETURN jsonb_build_object('ok', false, 'reason', 'too_soon',
                              'next_allowed', to_char(next_at, 'MM月DD日 HH24:MI'));
  END IF;
  UPDATE public.profiles
     SET nickname = new_nick, nickname_updated_at = now()
   WHERE user_id = auth.uid();
  RETURN jsonb_build_object('ok', true, 'nickname', new_nick);
END;
$$;
REVOKE ALL ON FUNCTION public.change_nickname(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_nickname(text) TO authenticated;

COMMIT;
`;

try {
  await client.query(sql);
  console.log("昵称修改功能迁移成功：nickname_updated_at 列 + 触发器 + change_nickname RPC");
} catch (e) {
  console.error("迁移失败：", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
