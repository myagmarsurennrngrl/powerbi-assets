-- =============================================================================
-- 0007_rls_policies.sql
-- Doctor Visit Tracker — Phase 1
--
-- Row Level Security for every table created so far.
--
-- PRINCIPLE: the mobile app may DISABLE a button for usability. The database
-- must REJECT the action independently. Nothing below relies on the client.
--
-- There is no permissive "allow all" fallback anywhere. A table with RLS on
-- and no matching policy denies the operation — that is the default we want.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_user              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_email_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_setting           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_clinic         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_brand_assignment  ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- app_user
-- =============================================================================

-- Read: yourself always; managers and administrators see everyone. A
-- representative can also see the names of colleagues, because the doctor
-- history screen must show "which representative visited this doctor".
CREATE POLICY app_user_select ON public.app_user
  FOR SELECT TO authenticated
  USING (
    id = public.fn_current_app_user_id()
    OR public.fn_is_manager()
    OR public.fn_is_rep()          -- name/role only in practice; see note below
  );

-- NOTE: PostgreSQL RLS is row-level, not column-level. Representatives can
-- therefore read colleague rows. Contact columns are not sensitive company-
-- internal data, but the API is additionally narrowed by the reporting views
-- and by the client only ever selecting id, full_name, role. If column-level
-- restriction becomes a requirement, add a `public.vw_colleague` view and
-- revoke direct SELECT on app_user from representatives.

CREATE POLICY app_user_insert_admin ON public.app_user
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_is_admin());

-- Administrators may change anything. A user may correct their own name and
-- phone — and nothing else. The column restriction is enforced by the trigger
-- below, because a policy cannot restrict columns on its own.
CREATE POLICY app_user_update ON public.app_user
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin() OR id = public.fn_current_app_user_id())
  WITH CHECK (public.fn_is_admin() OR id = public.fn_current_app_user_id());

CREATE OR REPLACE FUNCTION public.fn_app_user_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Administrators are unrestricted; migrations and seeds run with no session.
  IF public.fn_is_admin() OR public.fn_current_app_user_id() IS NULL THEN
    RETURN NEW;
  END IF;

  -- A non-administrator editing their own row may change ONLY these columns.
  IF NEW.role          IS DISTINCT FROM OLD.role
     OR NEW.is_active  IS DISTINCT FROM OLD.is_active
     OR NEW.email      IS DISTINCT FROM OLD.email
     OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
  THEN
    RAISE EXCEPTION
      'Only an administrator may change role, email, manager, or activation status.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_user_guard_self_update
  BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.fn_app_user_guard_self_update();

-- Audit role changes and deactivations explicitly — these are the two changes
-- a security review will always ask about.
CREATE OR REPLACE FUNCTION public.fn_app_user_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_audit('user_created', 'app_user', NEW.id, NULL, to_jsonb(NEW));
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      PERFORM public.fn_audit('user_role_changed', 'app_user', NEW.id,
                              jsonb_build_object('role', OLD.role),
                              jsonb_build_object('role', NEW.role));
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      PERFORM public.fn_audit('user_deactivated', 'app_user', NEW.id,
                              jsonb_build_object('is_active', OLD.is_active),
                              jsonb_build_object('is_active', NEW.is_active));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_app_user_audit
  AFTER INSERT OR UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.fn_app_user_audit();

-- No DELETE policy anywhere: users are deactivated, never deleted, so that
-- their historical visits keep a valid author.

-- =============================================================================
-- approved_email_domain — administrators only
-- =============================================================================
CREATE POLICY approved_email_domain_select ON public.approved_email_domain
  FOR SELECT TO authenticated USING (public.fn_is_admin());

CREATE POLICY approved_email_domain_insert ON public.approved_email_domain
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE POLICY approved_email_domain_update ON public.approved_email_domain
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- =============================================================================
-- app_setting
-- The device genuinely needs a few values (GPS accuracy threshold, default
-- radius). Those are flagged is_client_readable. Retention and other
-- administrative settings are not exposed.
-- =============================================================================
CREATE POLICY app_setting_select ON public.app_setting
  FOR SELECT TO authenticated
  USING (is_client_readable OR public.fn_is_admin());

CREATE POLICY app_setting_update ON public.app_setting
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

CREATE POLICY app_setting_insert ON public.app_setting
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE OR REPLACE FUNCTION public.fn_app_setting_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.fn_audit('setting_changed', 'app_setting', NULL,
                          to_jsonb(OLD), to_jsonb(NEW), NEW.key);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_app_setting_audit
  AFTER UPDATE ON public.app_setting
  FOR EACH ROW EXECUTE FUNCTION public.fn_app_setting_audit();

-- =============================================================================
-- audit_log — readable by managers and administrators, writable by nobody
-- directly (only through the SECURITY DEFINER fn_audit).
-- =============================================================================
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.fn_is_manager());

-- Deliberately NO insert/update/delete policy. fn_audit is SECURITY DEFINER and
-- therefore bypasses RLS; a user calling INSERT directly is denied.

-- =============================================================================
-- Master data
--
-- Read: every active authenticated user. Representatives need clinics, doctors,
--       brands and products to do their job.
-- Write: administrators only.
-- Delete: nobody — master data is soft-deleted via deleted_at.
-- =============================================================================

-- clinic
CREATE POLICY clinic_select ON public.clinic
  FOR SELECT TO authenticated
  USING (public.fn_current_app_user_id() IS NOT NULL);

CREATE POLICY clinic_insert ON public.clinic
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE POLICY clinic_update ON public.clinic
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- doctor
CREATE POLICY doctor_select ON public.doctor
  FOR SELECT TO authenticated
  USING (public.fn_current_app_user_id() IS NOT NULL);

CREATE POLICY doctor_insert ON public.doctor
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE POLICY doctor_update ON public.doctor
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- doctor_clinic
CREATE POLICY doctor_clinic_select ON public.doctor_clinic
  FOR SELECT TO authenticated
  USING (public.fn_current_app_user_id() IS NOT NULL);

CREATE POLICY doctor_clinic_insert ON public.doctor_clinic
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE POLICY doctor_clinic_update ON public.doctor_clinic
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- brand
CREATE POLICY brand_select ON public.brand
  FOR SELECT TO authenticated
  USING (public.fn_current_app_user_id() IS NOT NULL);

CREATE POLICY brand_insert ON public.brand
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE POLICY brand_update ON public.brand
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- product
CREATE POLICY product_select ON public.product
  FOR SELECT TO authenticated
  USING (public.fn_current_app_user_id() IS NOT NULL);

CREATE POLICY product_insert ON public.product
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE POLICY product_update ON public.product
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- =============================================================================
-- rep_brand_assignment
-- A representative sees their own assignments. Managers and administrators see
-- all — a manager must know who covers which brand. Only administrators change
-- assignments.
-- =============================================================================
CREATE POLICY rep_brand_assignment_select ON public.rep_brand_assignment
  FOR SELECT TO authenticated
  USING (
    rep_id = public.fn_current_app_user_id()
    OR public.fn_is_manager()
  );

CREATE POLICY rep_brand_assignment_insert ON public.rep_brand_assignment
  FOR INSERT TO authenticated WITH CHECK (public.fn_is_admin());

CREATE POLICY rep_brand_assignment_update ON public.rep_brand_assignment
  FOR UPDATE TO authenticated
  USING (public.fn_is_admin()) WITH CHECK (public.fn_is_admin());

-- =============================================================================
-- Guard: fail loudly if a future migration adds a table without RLS.
-- Also asserted by an automated test (tests/db/rls.test.ts).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_tables_without_rls()
RETURNS TABLE (table_name text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.relname::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_tables_with_rls_but_no_policy()
RETURNS TABLE (table_name text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.relname::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
  ORDER BY 1;
$$;
