-- =============================================================================
-- 0003_helper_functions.sql
-- Doctor Visit Tracker — Phase 1
--
-- Identity resolution + shared triggers.
--
-- IMPORTANT SECURITY NOTES
-- ------------------------
-- 1. Every function here is SECURITY DEFINER with `SET search_path = ''`.
--    An empty search_path means every object must be schema-qualified, which
--    removes the classic "shadow a function with a table in a schema you
--    control" privilege-escalation trick.
--
-- 2. fn_current_app_user() reads public.app_user. Because it is SECURITY
--    DEFINER and owned by the schema owner, it bypasses RLS. That is required
--    and intentional: if it were subject to RLS, the app_user policy — which
--    itself calls this function — would recurse infinitely.
--    This is also why FORCE ROW LEVEL SECURITY is deliberately NOT used
--    (see docs/03-roles-permissions.md §2). The owner role is never used to
--    serve application traffic; PostgREST connects as `anon`/`authenticated`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Who is calling?
-- -----------------------------------------------------------------------------

-- Returns the auth provider's subject id, or NULL when there is no session.
-- Wrapped so that swapping Supabase Auth for Entra ID touches exactly one
-- function instead of every policy in the database.
CREATE OR REPLACE FUNCTION public.fn_auth_uid()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- auth.uid() only exists on Supabase. Fall back to the request claim so the
  -- same migrations can run against a plain PostgreSQL instance in tests.
  BEGIN
    v_uid := auth.uid();
  EXCEPTION WHEN undefined_function OR invalid_schema_name THEN
    v_uid := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  END;
  RETURN v_uid;
END;
$$;

COMMENT ON FUNCTION public.fn_auth_uid() IS
  'The single point in the database that knows which identity provider is in use.';

-- The caller as an application user. NULL for anonymous or deactivated users.
CREATE OR REPLACE FUNCTION public.fn_current_app_user()
RETURNS public.app_user
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.*
  FROM public.app_user u
  WHERE u.auth_user_id = public.fn_auth_uid()
    AND u.is_active          -- a deactivated user instantly loses all access
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM public.app_user u
  WHERE u.auth_user_id = public.fn_auth_uid() AND u.is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_current_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.role
  FROM public.app_user u
  WHERE u.auth_user_id = public.fn_auth_uid() AND u.is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.fn_current_role() = 'administrator', false);
$$;

-- "Manager" in the permission sense includes administrators, because the
-- company has only three managers and administrators must be able to cover.
-- Every such action is audited.
CREATE OR REPLACE FUNCTION public.fn_is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.fn_current_role() IN ('manager', 'administrator'), false);
$$;

CREATE OR REPLACE FUNCTION public.fn_is_rep()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.fn_current_role() = 'representative', false);
$$;

-- Does the caller have authority over this representative?
CREATE OR REPLACE FUNCTION public.fn_manages(p_rep_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.fn_is_admin()
      OR EXISTS (
           SELECT 1
           FROM public.app_user r
           WHERE r.id = p_rep_id
             AND r.manager_id = public.fn_current_app_user_id()
         );
$$;

-- -----------------------------------------------------------------------------
-- Shared triggers: timestamps and created_by / updated_by
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_touch_audit_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.fn_current_app_user_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    -- Seed scripts and migrations run without a session; leave the column NULL
    -- rather than inventing an actor.
    NEW.created_by := COALESCE(NEW.created_by, v_actor);
    NEW.updated_by := COALESCE(NEW.updated_by, v_actor);
  ELSE
    NEW.created_at := OLD.created_at;   -- never rewritable
    NEW.created_by := OLD.created_by;   -- never rewritable
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(v_actor, OLD.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

-- Same as above for tables that only carry updated_at / updated_by.
CREATE OR REPLACE FUNCTION public.fn_touch_updated_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(public.fn_current_app_user_id(), NEW.updated_by);
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Geography: the Haversine distance used by the geofence.
--
-- The SERVER computes this. A distance supplied by a phone is never trusted —
-- see docs/07-risks.md G4. The mobile app has an identical implementation in
-- src/domain/geo.ts purely to disable a button early; the answer that decides
-- whether a visit may start is this one.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_haversine_metres(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  -- Mean Earth radius, metres (IUGG). Accurate to well under 1% at city scale,
  -- which is far tighter than a 150 m geofence needs.
  SELECT 2 * 6371008.8 * asin(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lon2 - p_lon1) / 2), 2)
    )
  );
$$;

COMMENT ON FUNCTION public.fn_haversine_metres IS
  'Great-circle distance in metres. Authoritative geofence calculation — client-supplied distances are ignored.';

-- -----------------------------------------------------------------------------
-- Local time helper. All business dates (which week, which day) are decided in
-- Asia/Ulaanbaatar, never in UTC, or a 08:00 visit would land on the wrong day.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_local_date(p_ts timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (p_ts AT TIME ZONE 'Asia/Ulaanbaatar')::date;
$$;
