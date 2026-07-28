-- =============================================================================
-- 0026_link_existing_logins.sql
-- Doctor Visit Tracker — Phase 7 follow-up
--
-- THE BUG THIS MIGRATION FIXES
-- ---------------------------
-- Migration 0006 links a login to its application account with an AFTER INSERT
-- trigger on auth.users:
--
--     UPDATE public.app_user SET auth_user_id = NEW.id
--      WHERE lower(email) = lower(NEW.email) AND auth_user_id IS NULL;
--
-- That works in exactly one order: administrator provisions the account first,
-- person signs in second.
--
-- In the other order it fails permanently and silently. If somebody tries to
-- sign in BEFORE they are provisioned, Supabase creates their auth.users row,
-- the trigger fires, finds no app_user to match, and does nothing. When the
-- administrator adds the account afterwards, NOTHING fires again — the trigger
-- is on auth.users, and no new auth.users row is ever created for that person.
-- Their auth_user_id stays NULL for ever, every RLS policy denies them, and the
-- app shows «Таны бүртгэл идэвхжээгүй байна» no matter how many times they try.
--
-- The administrator sees a correct-looking row in app_user and no explanation.
--
-- Reported by the first administrator to hit it. It was never caught because
-- every test and every seed provisions before signing in — the happy order.
--
-- FIXED BY LINKING FROM BOTH SIDES
--   * 0006 keeps its trigger: sign-in after provisioning.
--   * this file adds the mirror: provisioning after sign-in.
--   * fn_relink_orphaned_users() repairs accounts already stuck.
--   * fn_diagnose_login() says exactly what is missing, in Mongolian.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The mirror of 0006's trigger: when an app_user row appears or its email
-- changes, adopt an auth.users row that is already waiting.
--
-- Guarded with to_regclass so the same file also applies to the plain
-- PostgreSQL used by CI, where the auth schema does not exist. Dynamic SQL for
-- the same reason: a direct reference would fail to parse there.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_app_user_adopt_existing_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_id uuid;
BEGIN
  -- Already linked, or nothing to link to.
  IF NEW.auth_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RETURN NEW;
  END IF;

  -- lower() on plain text, for the reason spelled out in 0006: under
  -- SET search_path = '' the citext '=' operator cannot be resolved, so a bare
  -- comparison silently becomes case-sensitive.
  EXECUTE
    'SELECT id FROM auth.users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1'
    INTO v_auth_id
    USING NEW.email::text;

  NEW.auth_user_id := v_auth_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_user_adopt_existing_login
  BEFORE INSERT OR UPDATE OF email ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.fn_app_user_adopt_existing_login();

COMMENT ON FUNCTION public.fn_app_user_adopt_existing_login IS
  'Links a new app_user to a login that already exists. The mirror of 0006''s auth.users trigger; without both, provisioning after a first sign-in attempt never links.';

-- -----------------------------------------------------------------------------
-- Repair for accounts already stuck.
--
-- Safe to run at any time: it only fills in a NULL auth_user_id where exactly
-- one login matches by email. It never re-points an account that is already
-- linked, and never invents a link.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_relink_orphaned_users()
RETURNS TABLE (email text, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  v_auth_id uuid;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'auth.users is not present — nothing to do'::text;
    RETURN;
  END IF;

  FOR r IN
    SELECT u.id, u.email::text AS addr
    FROM public.app_user u
    WHERE u.auth_user_id IS NULL
    ORDER BY u.email
  LOOP
    EXECUTE
      'SELECT id FROM auth.users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1'
      INTO v_auth_id USING r.addr;

    IF v_auth_id IS NULL THEN
      email := r.addr;
      outcome := 'no login yet — normal, they have not signed in';
      RETURN NEXT;
    ELSE
      UPDATE public.app_user SET auth_user_id = v_auth_id WHERE id = r.id;
      email := r.addr;
      outcome := 'LINKED — they can sign in now';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fn_relink_orphaned_users IS
  'Repairs accounts provisioned after their first sign-in attempt. Run in the Supabase SQL editor; zero "LINKED" rows means nothing was broken.';

-- -----------------------------------------------------------------------------
-- "Why can this person not sign in?"
--
-- Checks every condition in the order the system applies them and answers in
-- Mongolian, because the administrator reading it is Mongolian and the answer
-- is the point. Reads nothing beyond the account in question.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_diagnose_login(p_email text)
RETURNS TABLE (step text, ok boolean, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email     text := lower(btrim(p_email));
  v_user      public.app_user;
  v_auth_id   uuid;
  v_has_auth  boolean := to_regclass('auth.users') IS NOT NULL;
BEGIN
  -- 1. Is the domain approved? Enforced by a trigger on auth.users, so a
  --    failure here stops the person before a code is even sent.
  step := '1. И-мэйлийн домэйн зөвшөөрөгдсөн эсэх';
  ok   := public.fn_can_email_sign_in(v_email);
  detail := CASE WHEN ok
    THEN 'Зөв.'
    ELSE 'ЗӨВШӨӨРӨӨГҮЙ. approved_email_domain хүснэгтэд домэйныг нэмнэ үү.' END;
  RETURN NEXT;

  -- 2. Does the application account exist?
  SELECT * INTO v_user FROM public.app_user WHERE lower(email::text) = v_email;

  step := '2. app_user бүртгэл байгаа эсэх';
  ok   := v_user.id IS NOT NULL;
  detail := CASE WHEN ok
    THEN 'Байна. Эрх: ' || v_user.role::text
    ELSE 'БАЙХГҮЙ. Администратор энэ хүнийг бүртгээгүй байна.' END;
  RETURN NEXT;

  IF v_user.id IS NULL THEN
    RETURN;
  END IF;

  -- 3. Is it active? A deactivated account signs in and then reaches nothing.
  step := '3. Бүртгэл идэвхтэй эсэх';
  ok   := v_user.is_active;
  detail := CASE WHEN ok
    THEN 'Идэвхтэй.'
    ELSE 'ИДЭВХГҮЙ. Хэрэглэгчийн удирдлагаас идэвхжүүлнэ үү.' END;
  RETURN NEXT;

  -- 4. Has a login been created — i.e. have they ever entered a code?
  IF v_has_auth THEN
    EXECUTE 'SELECT id FROM auth.users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1'
      INTO v_auth_id USING v_email;
  END IF;

  step := '4. Нэвтрэх бүртгэл (auth.users) үүссэн эсэх';
  ok   := v_auth_id IS NOT NULL;
  detail := CASE WHEN ok
    THEN 'Үүссэн. Энэ хүн нэг удаа код оруулж үзсэн байна.'
    ELSE 'ҮҮСЭЭГҮЙ. Хэвийн — тэд аппаас и-мэйлээрээ код авч нэвтрэхэд үүснэ.' END;
  RETURN NEXT;

  -- 5. THE ONE THAT USED TO FAIL SILENTLY.
  step := '5. Хоёр бүртгэл хоорондоо холбогдсон эсэх';
  ok   := v_user.auth_user_id IS NOT NULL;
  detail := CASE
    WHEN v_user.auth_user_id IS NOT NULL THEN 'Холбогдсон. Нэвтрэх боломжтой.'
    WHEN v_auth_id IS NULL THEN 'Хараахан хэрэггүй — эхлээд нэвтэрч үзнэ үү.'
    ELSE 'ХОЛБОГДООГҮЙ БАЙНА. Энэ хүн бүртгэгдэхээсээ ӨМНӨ нэвтрэхийг оролдсон байна. '
         || 'Засах: SELECT * FROM public.fn_relink_orphaned_users();'
  END;
  RETURN NEXT;

  -- 6. The verdict.
  step := '6. ДҮГНЭЛТ';
  ok   := public.fn_can_email_sign_in(v_email)
          AND v_user.is_active
          AND (v_user.auth_user_id IS NOT NULL OR v_auth_id IS NULL);
  detail := CASE WHEN ok
    THEN 'Бүх зүйл зөв. Нэвтрэх боломжтой.'
    ELSE 'Дээрх ✗ тэмдэгтэй мөрийг засна уу.' END;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.fn_diagnose_login IS
  'Answers "why can this person not sign in?" against every condition in order. Administrator tool; run it in the Supabase SQL editor.';

-- -----------------------------------------------------------------------------
-- Grants. All three are administrator tools, run from the SQL editor as the
-- database owner — never reachable from the app.
--
-- fn_diagnose_login in particular reports whether an address is registered,
-- which is exactly the enumeration fn_can_email_sign_in was written to avoid
-- leaking.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_app_user_adopt_existing_login() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_relink_orphaned_users()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_diagnose_login(text)            FROM PUBLIC, anon, authenticated;
