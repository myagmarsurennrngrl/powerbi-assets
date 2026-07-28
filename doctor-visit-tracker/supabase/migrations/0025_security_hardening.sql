-- =============================================================================
-- 0025_security_hardening.sql
-- Doctor Visit Tracker — Phase 7
--
-- THE BUG THIS MIGRATION FIXES
-- ---------------------------
-- Migration 0008 said, in a comment that was wrong:
--
--     "fn_audit is SECURITY DEFINER and is called from triggers only. It is
--      NOT granted to authenticated: a user must not be able to write
--      arbitrary audit entries by hand."
--
-- and enforced it with:
--
--     REVOKE EXECUTE ON FUNCTION public.fn_audit(...) FROM anon, authenticated;
--
-- That revoke did nothing. PostgreSQL grants EXECUTE on every new function to
-- the pseudo-role PUBLIC by default, and revoking from `anon` does not remove a
-- privilege held through PUBLIC. Every function in this schema was therefore
-- callable by an unauthenticated request, including fn_audit — so anyone with
-- the public anon key could FORGE AUDIT LOG ENTRIES.
--
-- Most functions survived this on their own merits: they are SECURITY DEFINER
-- but check fn_is_admin() / fn_current_app_user_id() internally, which is false
-- or NULL for an anonymous caller. That defence in depth is why this was not
-- worse. It is not why it was acceptable.
--
-- Fixed by the sweep in §7 at the foot of this file, which revokes EXECUTE
-- from PUBLIC on every function this project defines.
-- =============================================================================

-- HOW FUTURE FUNCTIONS ARE PROTECTED — and how they are NOT
-- ---------------------------------------------------------
-- The obvious guard would be:
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--
-- It was tried here and it DOES NOT WORK. PostgreSQL accepts the statement,
-- but a function created afterwards still comes out with the built-in
-- owner+PUBLIC access list. Writing a line that looks like protection and is
-- not is precisely the mistake this whole migration exists to correct, so it
-- is deliberately absent.
--
-- What protects future functions instead is fn_security_findings() below,
-- asserted by tests/db/security.test.ts. Add a function without revoking it
-- from PUBLIC and the test suite fails, by name, with the reason. A failing
-- build is a stronger guarantee than a default privilege that silently may or
-- may not apply.
--
-- The sweep that closes the hole runs at the END of this file, so that it also
-- covers the functions this file itself creates.

-- -----------------------------------------------------------------------------
-- 1. Re-grant, explicitly, what the application genuinely calls.
--
-- Everything below was already granted by an earlier migration; the sweep in
-- §7 removes only the PUBLIC path. These statements are here so that this
-- file alone shows the complete answer to "what can a signed-in user call?",
-- and are idempotent.
--
-- Helper functions appear here because several callers are SECURITY INVOKER —
-- they run as the signed-in user, so that user needs EXECUTE on the helpers.
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_can_email_sign_in(text) TO anon, authenticated;

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

-- -----------------------------------------------------------------------------
-- 2. Belt and braces on the ones that must never be callable by hand.
--
-- fn_audit writes the record of who did what. A caller able to invoke it
-- directly can bury a real action under forged noise, or attribute one to
-- nobody. It is reached only from triggers and from SECURITY DEFINER functions,
-- both of which run as the owner and do not consult these grants.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.fn_audit(text, text, uuid, jsonb, jsonb, text, text)
FROM PUBLIC, anon, authenticated;

-- Schema diagnostics. Harmless to read, but they describe the shape of the
-- security model to anyone who asks, so they stay with the administrator.
REVOKE EXECUTE ON FUNCTION
  public.fn_tables_without_rls(),
  public.fn_tables_with_rls_but_no_policy(),
  public.fn_reporting_reader_leaks()
FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. The one legitimate caller the sweep breaks, and its narrow fix.
--
-- fn_admin_set_user_active (0023) is SECURITY INVOKER by design, so that RLS
-- still applies underneath it. It called fn_audit directly to attach the
-- administrator's REASON to a deactivation — as the invoker, which after §7
-- correctly has no EXECUTE on fn_audit. Caught by tests/db/admin.test.ts.
--
-- Three ways to fix it, and why this one:
--   * grant fn_audit to authenticated — reopens exactly the hole just closed;
--   * make the admin function SECURITY DEFINER — loses the RLS layer beneath
--     it, for the sake of one audit line;
--   * a purpose-built definer function that can write ONE action and only for
--     an administrator. Nothing about it is forgeable, because there is
--     nothing to choose: the action is fixed and the actor is checked.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_record_deactivation_reason(
  p_user_id uuid,
  p_active  boolean,
  p_reason  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RETURN;
  END IF;

  -- The action is a literal, not an argument. A caller cannot use this to
  -- write a 'visit_completed' or a 'login' entry.
  PERFORM public.fn_audit(
    'user_deactivated', 'app_user', p_user_id,
    jsonb_build_object('is_active', NOT p_active),
    jsonb_build_object('is_active', p_active),
    btrim(p_reason));
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_record_deactivation_reason(uuid, boolean, text)
  TO authenticated;

-- Re-issued from 0023 with the direct fn_audit call replaced. Everything else
-- is unchanged; see 0023 for why each refusal exists.
CREATE OR REPLACE FUNCTION public.fn_admin_set_user_active(
  p_user_id uuid,
  p_active  boolean,
  p_reason  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user public.app_user;
  v_n    integer;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор хэрэглэгчийг идэвхгүй болгоно.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_user FROM public.app_user WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Хэрэглэгч олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_user.is_active = p_active THEN
    RETURN;
  END IF;

  IF NOT p_active THEN
    IF p_user_id = public.fn_current_app_user_id() THEN
      RAISE EXCEPTION 'Өөрийгөө идэвхгүй болгох боломжгүй.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_user.role = 'administrator' THEN
      SELECT count(*) INTO v_n
      FROM public.app_user
      WHERE role = 'administrator' AND is_active AND id <> p_user_id;

      IF v_n = 0 THEN
        RAISE EXCEPTION 'Сүүлийн администраторыг идэвхгүй болгох боломжгүй.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.visit
      WHERE rep_id = p_user_id AND status = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'Энэ хэрэглэгчид дуусаагүй уулзалт байна. Эхлээд түүнийг хаана уу.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_n
    FROM public.app_user
    WHERE manager_id = p_user_id AND is_active;

    IF v_n > 0 THEN
      RAISE EXCEPTION 'Энэ хүн % хэрэглэгчийн менежер байна. Эхлээд өөр менежер сонгоно уу.', v_n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.app_user
  SET is_active      = p_active,
      deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END
  WHERE id = p_user_id;

  -- trg_app_user_audit already recorded the change itself; this adds the
  -- reason, which is the part a later review actually asks about.
  PERFORM public.fn_record_deactivation_reason(p_user_id, p_active, p_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_admin_set_user_active(uuid, boolean, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. The standing self-check.
--
-- One query an administrator (or a test) can run to ask "is anything wrong?".
-- Zero rows is the only acceptable answer. It is written to fail loudly on the
-- categories of mistake this project has actually made, not on hypotheticals:
--   * the PUBLIC grant hole above;
--   * a table shipped without RLS or without a policy;
--   * a SECURITY DEFINER function without a locked search_path — the cause of
--     the citext case-sensitivity bug in Phase 1;
--   * DELETE granted where the design says data is immutable;
--   * the reporting login picking up access outside its schema.
-- -----------------------------------------------------------------------------

/**
 * Tables where DELETE is legitimately granted to the application.
 *
 * These are child lists — the doctors on a planned visit, the brands on a
 * visit. Editing such a list means replacing it, so DELETE is the verb.
 * Nothing here is a record of something that happened; those are all
 * append-only and appear nowhere in this list.
 */
CREATE OR REPLACE FUNCTION public.fn_delete_allowlist()
RETURNS TABLE (table_name text)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT unnest(ARRAY[
    'planned_visit_doctor',
    'planned_visit_brand',
    'visit_doctor',
    'visit_brand',
    'visit_product'
  ]::text[]);
$$;

CREATE OR REPLACE FUNCTION public.fn_security_findings()
RETURNS TABLE (
  severity text,
  area     text,
  object   text,
  detail   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- A table with no row-level security is readable in full by anyone with a
  -- table grant, whatever the policies elsewhere say.
  SELECT 'critical', 'rls', t.table_name,
         'Table has no row-level security enabled.'
  FROM public.fn_tables_without_rls() t

  UNION ALL
  -- RLS on with no policy denies everything, which is safe but almost always
  -- means somebody forgot to write the policy.
  SELECT 'high', 'rls', t.table_name,
         'Row-level security is on but no policy exists; every access is denied.'
  FROM public.fn_tables_with_rls_but_no_policy() t

  UNION ALL
  -- The Phase 1 citext bug: without a locked search_path, a SECURITY DEFINER
  -- function resolves operators against the caller's path.
  SELECT 'critical', 'search_path', p.proname::text,
         'SECURITY DEFINER function without SET search_path.'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) c
      WHERE c LIKE 'search_path=%'
    )

  UNION ALL
  -- The bug this migration fixes, asserted so it cannot come back.
  SELECT 'critical', 'grant', p.oid::regprocedure::text,
         'Function is executable by PUBLIC.'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('public', p.oid, 'EXECUTE')

  UNION ALL
  -- An unauthenticated caller may reach exactly one function.
  SELECT 'critical', 'grant', p.oid::regprocedure::text,
         'Function is executable by anon.'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname <> 'fn_can_email_sign_in'

  UNION ALL
  -- anon has no table access of any kind.
  SELECT 'critical', 'grant', g.table_name || ' (' || g.privilege_type || ')',
         'anon holds a table privilege.'
  FROM information_schema.role_table_grants g
  WHERE g.grantee = 'anon' AND g.table_schema = 'public'

  UNION ALL
  -- Nothing that records an event may be deleted by the application.
  SELECT 'high', 'grant', g.table_name,
         'DELETE is granted outside the child-list allowlist.'
  FROM information_schema.role_table_grants g
  WHERE g.grantee = 'authenticated'
    AND g.table_schema = 'public'
    AND g.privilege_type = 'DELETE'
    AND g.table_name NOT IN (SELECT table_name FROM public.fn_delete_allowlist())

  UNION ALL
  -- Truncate would empty a table without firing the row triggers that keep the
  -- append-only tables append-only.
  SELECT 'critical', 'grant', g.table_name,
         'TRUNCATE is granted to the application.'
  FROM information_schema.role_table_grants g
  WHERE g.grantee IN ('anon', 'authenticated')
    AND g.table_schema = 'public'
    AND g.privilege_type = 'TRUNCATE'

  UNION ALL
  -- The Power BI login must see the reporting schema and nothing else.
  SELECT 'critical', 'reporting', l.schema_name || '.' || l.object_name,
         'Reporting login holds ' || l.privilege || ' outside the reporting schema.'
  FROM public.fn_reporting_reader_leaks() l

  UNION ALL
  -- No application role may bypass row-level security.
  SELECT 'critical', 'role', r.rolname::text,
         'Role can bypass row-level security.'
  FROM pg_roles r
  WHERE r.rolname IN ('anon', 'authenticated', 'reporting_reader')
    AND r.rolbypassrls

  UNION ALL
  -- Credentials belong in a secret manager, never in a column.
  SELECT 'high', 'schema', c.table_name || '.' || c.column_name,
         'Column name suggests a stored credential.'
  FROM information_schema.columns c
  WHERE c.table_schema IN ('public', 'reporting')
    AND (c.column_name ILIKE '%password%'
      OR c.column_name ILIKE '%secret%'
      OR c.column_name ILIKE '%api_key%'
      OR c.column_name ILIKE '%private_key%')

  UNION ALL
  -- The privacy promise: no patient data anywhere, in any spelling.
  SELECT 'critical', 'privacy', c.table_name || '.' || c.column_name,
         'Column name suggests patient information.'
  FROM information_schema.columns c
  WHERE c.table_schema IN ('public', 'reporting')
    AND (c.column_name ILIKE '%patient%'
      OR c.column_name ILIKE '%diagnos%'
      OR c.column_name ILIKE '%prescription%'
      OR c.column_name ILIKE '%өвчтөн%')

  UNION ALL
  -- Audio recording is not implemented and its flag must stay off until a
  -- consent mechanism exists. See docs/07-risks.md A1-A5.
  SELECT 'high', 'feature_flag', s.key,
         'Audio recording flag is enabled but no consent mechanism exists.'
  FROM public.app_setting s
  WHERE s.key = 'feature_audio_recording_enabled'
    AND s.value::text NOT IN ('false', '"false"')

  ORDER BY 1, 2, 3;
$$;

COMMENT ON FUNCTION public.fn_security_findings IS
  'Standing security self-check. Zero rows is the only acceptable result. Asserted by tests/db/security.test.ts and listed in docs/93-security-checklist.md.';

-- Administrators only: the output is a map of the security model.
REVOKE EXECUTE ON FUNCTION public.fn_security_findings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_delete_allowlist() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Storage
--
-- This project uses no Supabase Storage bucket. visit_exception.attachment_path
-- is reserved for a future photo attachment and is always NULL.
--
-- If a bucket is ever added it MUST be created private, with policies written
-- in the same style as the table policies here, and this comment replaced by
-- them. A public bucket would put photographs taken inside clinics on the open
-- internet behind a guessable URL. Recorded in docs/93-security-checklist.md.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 6. Rate limiting
--
-- Login attempts, OTP sends and API request rates are enforced by Supabase in
-- front of PostgreSQL, not here, and are configured in the project dashboard.
-- The required settings are listed in docs/93-security-checklist.md §5. There
-- is deliberately no in-database imitation of them: a counter table would be
-- bypassed by anything that does not reach the database, which is precisely
-- what a flood does.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 7. The sweep — LAST STATEMENT IN THIS FILE, deliberately.
--
-- Revokes EXECUTE from PUBLIC on every function this project defines,
-- including the ones created above. Extension functions are excluded: the
-- citext and pg_trgm operators are used implicitly by ordinary queries, so
-- revoking them from PUBLIC would break case-insensitive comparison for
-- everyone, and they are not ours to re-privilege in any case.
--
-- Explicit grants to `anon` and `authenticated` are untouched by this — it
-- removes only the implicit path that nobody chose.
-- =============================================================================
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'reporting')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn.signature);
  END LOOP;
END;
$$;
