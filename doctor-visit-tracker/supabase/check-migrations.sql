-- =============================================================================
-- check-migrations.sql
--
-- "Which migrations have actually landed?"
--
-- Paste this whole file into the Supabase SQL editor and run it. It reports one
-- row per migration with ✅ or ❌, and names the first one that is missing.
--
-- WHY THIS EXISTS
-- ---------------
-- Applying 25 files by hand through a web editor is easy to get wrong: a file
-- skipped, a paste truncated, or — the classic — text left selected in the
-- editor, which makes it run only the selection. The failure then shows up
-- several files later as "function ... does not exist", which points at the
-- wrong file.
--
-- This checks for one distinctive object from each migration. It reads nothing
-- and changes nothing, so it is always safe to run.
--
-- The better answer is not to apply them by hand at all — see §B in
-- docs/90-setup-for-non-technical.md for `supabase db push`.
-- =============================================================================

WITH expected (seq, migration, kind, object, purpose) AS (
  VALUES
    ( 1, '0001_extensions_and_enums',  'type',     'user_role',                  'Extensions and the enum types'),
    ( 2, '0002_identity_and_settings', 'table',    'app_user',                   'Users, approved domains, settings'),
    ( 3, '0003_helper_functions',      'function', 'fn_haversine_metres',        'Shared helper functions'),
    ( 4, '0004_audit_log',             'table',    'audit_log',                  'The append-only audit log'),
    ( 5, '0005_master_data',           'table',    'clinic',                     'Clinics, doctors, brands, products'),
    ( 6, '0006_email_domain',          'function', 'fn_can_email_sign_in',       'Company email domain enforcement'),
    ( 7, '0007_rls_policies',          'policy',   'app_user_select',            'Row-level security policies'),
    ( 8, '0008_grants',                'function', 'fn_rep_brand_ids',           'Table and function privileges'),
    ( 9, '0009_planning_tables',       'table',    'weekly_plan',                'Weekly plans and planned visits'),
    (10, '0010_planning_logic',        'function', 'fn_plan_editable',           'Plan deadline and status machine'),
    (11, '0011_planning_rls',          'policy',   'weekly_plan_select',         'Security for the planning tables'),
    (12, '0012_manager_plan_authority','function', 'fn_manager_add_visit',       'Manager can add and reschedule'),
    (13, '0013_visit_tables',          'table',    'visit',                      'Visits and check-in evidence'),
    (14, '0014_checkin_checkout',      'function', 'fn_start_visit',             'The geofenced check-in'),
    (15, '0015_visit_rls',             'policy',   'visit_select',               'Security for the visit tables'),
    (16, '0016_visit_documentation',   'table',    'visit_addendum',             'Report fields, addenda, follow-ups'),
    (17, '0017_visit_completion',      'function', 'fn_complete_visit',          'Report validation and submission'),
    (18, '0018_kpi_rules',             'table',    'kpi_rule_version',           'Versioned KPI rules'),
    (19, '0019_exceptions',            'table',    'visit_exception',            'Exception requests and approval'),
    (20, '0020_kpi_calculation',       'function', 'fn_kpi_for_rep',             'The KPI arithmetic'),
    (21, '0021_reporting_schema',      'schema',   'reporting',                  'The Power BI star schema'),
    (22, '0022_exports_and_dashboard', 'function', 'fn_manager_dashboard',       'Manager dashboard and exports'),
    (23, '0023_admin_management',      'function', 'fn_admin_users',             'User and master-data administration'),
    (24, '0024_unplanned_visits',      'function', 'fn_start_unplanned_visit',   'Unplanned visits'),
    (25, '0025_security_hardening',    'function', 'fn_security_findings',       'Security hardening and self-check')
),
checked AS (
  SELECT
    e.seq,
    e.migration,
    e.purpose,
    CASE e.kind
      WHEN 'type' THEN EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = e.object)
      WHEN 'table' THEN EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = e.object AND c.relkind = 'r')
      WHEN 'function' THEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = e.object)
      WHEN 'policy' THEN EXISTS (
        SELECT 1 FROM pg_policy WHERE polname = e.object)
      WHEN 'schema' THEN EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname = e.object)
      ELSE false
    END AS applied
  FROM expected e
)
SELECT
  CASE WHEN applied THEN '✅' ELSE '❌ MISSING' END AS status,
  seq                                              AS "#",
  migration,
  purpose
FROM checked
ORDER BY seq;

-- -----------------------------------------------------------------------------
-- The one-line answer: what to do next.
-- -----------------------------------------------------------------------------
WITH expected (seq, migration, kind, object) AS (
  VALUES
    ( 1, '0001_extensions_and_enums',  'type',     'user_role'),
    ( 2, '0002_identity_and_settings', 'table',    'app_user'),
    ( 3, '0003_helper_functions',      'function', 'fn_haversine_metres'),
    ( 4, '0004_audit_log',             'table',    'audit_log'),
    ( 5, '0005_master_data',           'table',    'clinic'),
    ( 6, '0006_email_domain',          'function', 'fn_can_email_sign_in'),
    ( 7, '0007_rls_policies',          'policy',   'app_user_select'),
    ( 8, '0008_grants',                'function', 'fn_rep_brand_ids'),
    ( 9, '0009_planning_tables',       'table',    'weekly_plan'),
    (10, '0010_planning_logic',        'function', 'fn_plan_editable'),
    (11, '0011_planning_rls',          'policy',   'weekly_plan_select'),
    (12, '0012_manager_plan_authority','function', 'fn_manager_add_visit'),
    (13, '0013_visit_tables',          'table',    'visit'),
    (14, '0014_checkin_checkout',      'function', 'fn_start_visit'),
    (15, '0015_visit_rls',             'policy',   'visit_select'),
    (16, '0016_visit_documentation',   'table',    'visit_addendum'),
    (17, '0017_visit_completion',      'function', 'fn_complete_visit'),
    (18, '0018_kpi_rules',             'table',    'kpi_rule_version'),
    (19, '0019_exceptions',            'table',    'visit_exception'),
    (20, '0020_kpi_calculation',       'function', 'fn_kpi_for_rep'),
    (21, '0021_reporting_schema',      'schema',   'reporting'),
    (22, '0022_exports_and_dashboard', 'function', 'fn_manager_dashboard'),
    (23, '0023_admin_management',      'function', 'fn_admin_users'),
    (24, '0024_unplanned_visits',      'function', 'fn_start_unplanned_visit'),
    (25, '0025_security_hardening',    'function', 'fn_security_findings')
),
checked AS (
  SELECT e.seq, e.migration,
    CASE e.kind
      WHEN 'type' THEN EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                               WHERE n.nspname='public' AND t.typname=e.object)
      WHEN 'table' THEN EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                                WHERE n.nspname='public' AND c.relname=e.object AND c.relkind='r')
      WHEN 'function' THEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                                   WHERE n.nspname='public' AND p.proname=e.object)
      WHEN 'policy' THEN EXISTS (SELECT 1 FROM pg_policy WHERE polname=e.object)
      WHEN 'schema' THEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=e.object)
      ELSE false
    END AS applied
  FROM expected e
)
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM checked WHERE NOT applied)
      THEN 'All 25 migrations are applied. Next: the seed data, or Part C of the setup guide.'
    ELSE 'Run this file next: supabase/migrations/'
         || (SELECT migration FROM checked WHERE NOT applied ORDER BY seq LIMIT 1)
         || '.sql  — then run this checker again.'
  END AS next_step;
