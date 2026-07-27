-- =============================================================================
-- 0008_grants.sql
-- Doctor Visit Tracker — Phase 1
--
-- Table-level privileges. RLS decides WHICH ROWS; grants decide WHICH VERBS.
-- Both are needed: RLS cannot stop a DELETE that was never granted, and a
-- grant cannot expose a row that RLS hides.
--
-- Roles (created by Supabase; created by the CI shim on plain PostgreSQL):
--   anon          — unauthenticated. Gets nothing at all.
--   authenticated — a signed-in user. Gets verbs; RLS narrows the rows.
--   service_role  — backend/admin key. Never shipped in the mobile app.
-- =============================================================================

-- Least privilege by default: revoke everything, then grant deliberately.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- anon: nothing. Not one table. The login screen's only need is the
-- domain check, granted as a single function below.
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_can_email_sign_in(text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- authenticated
-- -----------------------------------------------------------------------------

-- Read-only master data.
GRANT SELECT ON
  public.clinic,
  public.doctor,
  public.doctor_clinic,
  public.brand,
  public.product,
  public.rep_brand_assignment,
  public.app_setting,
  public.approved_email_domain
TO authenticated;

-- Master data is written by administrators — the verb is granted here and the
-- row is authorised by the RLS policy, which requires fn_is_admin().
GRANT INSERT, UPDATE ON
  public.clinic,
  public.doctor,
  public.doctor_clinic,
  public.brand,
  public.product,
  public.rep_brand_assignment,
  public.approved_email_domain
TO authenticated;

GRANT UPDATE ON public.app_setting TO authenticated;   -- admin-only via RLS

GRANT SELECT, INSERT, UPDATE ON public.app_user TO authenticated;

-- Audit log: readable by managers (RLS), never writable, never erasable.
GRANT SELECT ON public.audit_log TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM anon, authenticated;

-- DELETE is granted on NOTHING. Master data is soft-deleted; transactional
-- data is immutable. This is a deliberate, global decision.

-- -----------------------------------------------------------------------------
-- Functions
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  public.fn_current_app_user(),
  public.fn_current_app_user_id(),
  public.fn_current_role(),
  public.fn_is_admin(),
  public.fn_is_manager(),
  public.fn_is_rep(),
  public.fn_manages(uuid),
  public.fn_haversine_metres(double precision, double precision, double precision, double precision),
  public.fn_local_date(timestamptz),
  public.fn_setting_int(text),
  public.fn_setting_bool(text),
  public.fn_rep_brand_ids(uuid, date),
  public.fn_find_similar_doctors(text, real),
  public.fn_clinic_coordinates_plausible(numeric, numeric)
TO authenticated;

-- fn_audit is SECURITY DEFINER and is called from triggers only. It is NOT
-- granted to authenticated: a user must not be able to write arbitrary audit
-- entries by hand.
REVOKE EXECUTE ON FUNCTION
  public.fn_audit(text, text, uuid, jsonb, jsonb, text, text)
FROM anon, authenticated;

-- Diagnostics used by the automated security tests; administrators only.
REVOKE EXECUTE ON FUNCTION
  public.fn_tables_without_rls(),
  public.fn_tables_with_rls_but_no_policy()
FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Defaults for future objects, so a new table is never accidentally world-
-- readable before someone remembers to revoke it.
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
