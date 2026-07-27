-- =============================================================================
-- 0006_email_domain_enforcement.sql
-- Doctor Visit Tracker — Phase 1
--
-- ACCEPTANCE CRITERIA 1 AND 2:
--   1. A representative can log in with an approved work email.
--   2. An unauthorised email cannot log in.
--
-- This is enforced in the DATABASE, on auth.users, not in the mobile app.
-- Someone calling the Supabase auth API directly with curl is refused exactly
-- the same way the app is.
--
-- Two layers:
--   Layer 1  BEFORE INSERT on auth.users  -> reject unapproved domains outright.
--   Layer 2  fn_current_app_user()        -> even an accepted auth user has no
--                                            access until an administrator has
--                                            provisioned an active app_user row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The rule itself, as a plain testable function (no auth schema required).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_is_email_domain_approved(p_email citext)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.approved_email_domain d
    WHERE d.is_active
      -- Compare with an explicit lower() on plain text rather than relying on
      -- citext's case-insensitive '=' operator.
      --
      -- WHY: this function runs with `SET search_path = ''` for security. The
      -- citext '=' operator lives in the public schema, so with an empty
      -- search_path PostgreSQL cannot resolve it, silently falls back to the
      -- implicit cast to text, and compares CASE-SENSITIVELY. That would have
      -- refused a perfectly valid 'Rep01@Monos.mn' at login. Regression-tested
      -- in tests/db/emailDomain.test.ts.
      AND lower(d.domain::text) = lower(substring(p_email::text from '[^@]+$'))
      -- reject anything that is not a single, well-formed address
      AND p_email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );
$$;

COMMENT ON FUNCTION public.fn_is_email_domain_approved IS
  'True only if the address is well formed and its domain is an active approved domain.';

-- -----------------------------------------------------------------------------
-- Keep app_user.email itself inside an approved domain.
-- Prevents an administrator from provisioning an account that could never log
-- in, and blocks a back-door user with an external address.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_app_user_check_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.fn_is_email_domain_approved(NEW.email) THEN
    RAISE EXCEPTION
      'email domain of "%" is not on the approved company domain list', NEW.email
      USING ERRCODE = 'check_violation',
            HINT    = 'An administrator must add the domain in approved_email_domain first.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_user_email_domain
  BEFORE INSERT OR UPDATE OF email ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.fn_app_user_check_email_domain();

-- -----------------------------------------------------------------------------
-- Layer 1: refuse the sign-up / login of an unapproved address.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auth_user_enforce_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NULL OR NOT public.fn_is_email_domain_approved(NEW.email::public.citext) THEN
    -- NOTE: we deliberately do NOT write an audit_log row here. Raising the
    -- exception aborts the transaction, which would roll the audit row back
    -- anyway. Rejected sign-in attempts are visible in Supabase's own auth
    -- logs; see docs/93-security-checklist.md.
    RAISE EXCEPTION
      'Sign-in is restricted to approved company email domains.'
      USING ERRCODE = 'insufficient_privilege',
            DETAIL  = format('Rejected address: %s', COALESCE(NEW.email, '<null>'));
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Layer 2: link a newly authenticated identity to its pre-provisioned app_user.
--
-- An administrator creates the app_user row first (with the work email). The
-- first time that person signs in, this fills in auth_user_id. If no row was
-- provisioned, the login succeeds at the auth layer but every RLS policy
-- denies access, and the app shows:
--   «Таны бүртгэл идэвхжээгүй байна. Админд хандана уу.»
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auth_user_link_app_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- lower() on text for the same reason as fn_is_email_domain_approved: with
  -- an empty search_path the citext '=' operator is not resolvable, so a
  -- bare comparison would be case-sensitive and 'Rep01@Monos.mn' would sign in
  -- without ever being linked to their app_user row.
  UPDATE public.app_user u
     SET auth_user_id = NEW.id
   WHERE lower(u.email::text) = lower(NEW.email)
     AND u.auth_user_id IS NULL;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Attach to auth.users when running on Supabase.
--
-- Guarded so the same migration file also applies to a plain PostgreSQL
-- instance in CI, where the auth schema does not exist. On Supabase both
-- triggers are created; the guard is a no-op.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_auth_user_enforce_domain ON auth.users';
    EXECUTE 'CREATE TRIGGER trg_auth_user_enforce_domain
               BEFORE INSERT ON auth.users
               FOR EACH ROW EXECUTE FUNCTION public.fn_auth_user_enforce_domain()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_auth_user_link_app_user ON auth.users';
    EXECUTE 'CREATE TRIGGER trg_auth_user_link_app_user
               AFTER INSERT ON auth.users
               FOR EACH ROW EXECUTE FUNCTION public.fn_auth_user_link_app_user()';

    RAISE NOTICE 'Email-domain enforcement attached to auth.users.';
  ELSE
    RAISE NOTICE 'auth.users not present — skipping trigger attachment (plain PostgreSQL / CI).';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Read-only helper the login screen calls BEFORE requesting an OTP, so the user
-- sees a clear Mongolian message instead of a silent failure.
-- Deliberately returns only a boolean: it must not become a way to enumerate
-- which company domains exist beyond a yes/no on an address the caller already
-- typed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_can_email_sign_in(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.fn_is_email_domain_approved(p_email::public.citext);
$$;
