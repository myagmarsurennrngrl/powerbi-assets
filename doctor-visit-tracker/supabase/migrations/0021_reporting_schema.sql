-- =============================================================================
-- 0021_reporting_schema.sql
-- Doctor Visit Tracker — Phase 6
--
-- A star schema for Power BI, in its own `reporting` schema, read through a
-- dedicated login that can do nothing else.
--
-- HOW THE SECURITY WORKS — read this before changing any view
-- -----------------------------------------------------------
-- A PostgreSQL view executes with the privileges of its OWNER unless it is
-- declared `security_invoker = true`. These views are owned by the schema
-- owner, so they can read the underlying tables while `reporting_reader` — the
-- Power BI login — has no rights on `public` or `auth` at all.
--
-- That is deliberate and it is the whole design: the reporting user can see
-- exactly these views and nothing else. It cannot read auth.users, cannot see
-- an unsubmitted draft, cannot write anything, and cannot reach a table
-- directly even if someone hands it a query.
--
-- DEVIATION FROM docs/02, recorded: that document said "SECURITY INVOKER
-- views". Invoker semantics would apply row-level security as
-- `reporting_reader`, which has no app_user row — so every view would return
-- zero rows. Owner semantics with a locked-down role is the correct shape.
--
-- WHAT IS DELIBERATELY EXCLUDED
--   * unsubmitted drafts (is_draft = true) — private until submitted
--   * doctor phone and email — personal data with no reporting purpose
--   * anything from auth.*
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS reporting;

COMMENT ON SCHEMA reporting IS
  'Read-only star schema for Power BI. The only surface the reporting login can reach.';

-- =============================================================================
-- DIMENSIONS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- dim_date — a proper date dimension, generated for 2024-2030.
--
-- Power BI needs a contiguous date table to make time intelligence work; using
-- the dates that happen to appear in the facts leaves gaps and breaks
-- year-on-year comparisons.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.dim_date AS
SELECT
  d::date                                                   AS date_key,
  EXTRACT(YEAR    FROM d)::integer                          AS year,
  EXTRACT(QUARTER FROM d)::integer                          AS quarter,
  EXTRACT(MONTH   FROM d)::integer                          AS month_number,
  to_char(d, 'YYYY-MM')                                     AS year_month,
  EXTRACT(ISOYEAR FROM d)::integer                          AS iso_year,
  EXTRACT(WEEK    FROM d)::integer                          AS iso_week,
  EXTRACT(ISODOW  FROM d)::integer                          AS iso_weekday,
  (EXTRACT(ISODOW FROM d) >= 6)                             AS is_weekend,
  (date_trunc('week', d))::date                             AS week_start_date,
  (date_trunc('month', d))::date                            AS month_start_date,
  -- Mongolian month name, so report axes read naturally.
  (EXTRACT(MONTH FROM d))::text || '-р сар'                 AS month_name_mn,
  (ARRAY['Даваа','Мягмар','Лхагва','Пүрэв','Баасан','Бямба','Ням'])
    [EXTRACT(ISODOW FROM d)::integer]                       AS weekday_name_mn
FROM generate_series(DATE '2024-01-01', DATE '2030-12-31', INTERVAL '1 day') AS d;

COMMENT ON VIEW reporting.dim_date IS
  'Contiguous date dimension 2024-2030. Mark as the date table in Power BI.';

-- -----------------------------------------------------------------------------
-- dim_user — representatives, managers, administrators
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.dim_user AS
SELECT
  u.id                                   AS user_key,
  u.email::text                          AS email,
  u.full_name,
  u.role::text                           AS role,
  CASE u.role
    WHEN 'representative' THEN 'Эмнэлгийн төлөөлөгч'
    WHEN 'manager'        THEN 'Менежер'
    WHEN 'administrator'  THEN 'Администратор'
  END                                    AS role_mn,
  m.full_name                            AS manager_name,
  u.manager_id                           AS manager_key,
  u.is_active,
  u.created_at
FROM public.app_user u
LEFT JOIN public.app_user m ON m.id = u.manager_id;

-- -----------------------------------------------------------------------------
-- dim_clinic
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.dim_clinic AS
SELECT
  c.id            AS clinic_key,
  c.code          AS clinic_code,
  c.name          AS clinic_name,
  c.clinic_type,
  c.district,
  c.address,
  c.latitude,
  c.longitude,
  c.geofence_radius_m,
  c.is_active,
  (c.deleted_at IS NOT NULL) AS is_deleted,
  c.created_at
FROM public.clinic c;

-- -----------------------------------------------------------------------------
-- dim_doctor
--
-- Phone and email are deliberately ABSENT. They are personal data with no
-- reporting purpose, and a Power BI file gets emailed around.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.dim_doctor AS
SELECT
  d.id          AS doctor_key,
  d.code        AS doctor_code,
  d.full_name   AS doctor_name,
  d.speciality,
  d.is_active,
  (d.deleted_at IS NOT NULL) AS is_deleted,
  d.created_at
FROM public.doctor d;

COMMENT ON VIEW reporting.dim_doctor IS
  'Doctor dimension. Phone and email are intentionally excluded — personal data with no reporting purpose.';

-- -----------------------------------------------------------------------------
-- dim_brand / dim_product
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.dim_brand AS
SELECT
  b.id      AS brand_key,
  b.code    AS brand_code,
  b.name    AS brand_name,
  b.category,
  b.is_active,
  (b.deleted_at IS NOT NULL) AS is_deleted
FROM public.brand b;

CREATE OR REPLACE VIEW reporting.dim_product AS
SELECT
  p.id       AS product_key,
  p.sku,
  p.name     AS product_name,
  p.brand_id AS brand_key,
  b.name     AS brand_name,
  p.category,
  p.is_active,
  (p.deleted_at IS NOT NULL) AS is_deleted
FROM public.product p
JOIN public.brand b ON b.id = p.brand_id;

-- =============================================================================
-- FACTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fact_visit — grain: one completed or submitted visit
--
-- Drafts are excluded. An unsubmitted report is private to its author and must
-- never appear in a management report.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.fact_visit AS
SELECT
  v.id                     AS visit_key,
  v.visit_date             AS date_key,
  v.rep_id                 AS user_key,
  v.clinic_id              AS clinic_key,
  v.planned_visit_id       AS planned_visit_key,

  (v.planned_visit_id IS NULL)  AS is_unplanned,
  v.status::text                AS visit_status,
  v.meeting_status::text        AS meeting_status,
  v.outcome::text               AS outcome,
  v.interest_level::text        AS interest_level,

  v.started_at_server,
  v.completed_at_server,
  v.duration_seconds,
  round(v.duration_seconds / 60.0, 1) AS duration_minutes,

  v.follow_up_required,
  v.follow_up_date,
  v.created_source::text   AS created_source,
  v.app_version,

  -- Evidence, joined from the check-in event. This is what makes the
  -- "started outside expected conditions" report possible in Power BI.
  ci.distance_from_clinic_m   AS checkin_distance_m,
  ci.gps_accuracy_m           AS checkin_accuracy_m,
  ci.clinic_radius_m_at_event AS clinic_radius_m,
  ci.outside_geofence         AS checkin_outside_geofence,
  ci.is_mocked_location       AS checkin_mocked_location,
  ci.clock_drift_seconds      AS checkin_clock_drift_seconds,
  co.distance_from_clinic_m   AS checkout_distance_m,

  -- A single flag Power BI can filter on for the review list.
  (
    COALESCE(ci.outside_geofence, false)
    OR COALESCE(ci.is_mocked_location, false)
    OR COALESCE(abs(ci.clock_drift_seconds), 0) > 300
    OR v.created_source = 'offline'
    OR COALESCE(v.duration_seconds, 0) < 120
  ) AS needs_review,

  (SELECT count(*) FROM public.visit_addendum a WHERE a.visit_id = v.id)::integer
    AS addendum_count
FROM public.visit v
LEFT JOIN public.visit_event ci
       ON ci.visit_id = v.id AND ci.event_type = 'check_in'
LEFT JOIN public.visit_event co
       ON co.visit_id = v.id AND co.event_type = 'check_out'
WHERE v.is_draft = false;

COMMENT ON VIEW reporting.fact_visit IS
  'One row per SUBMITTED visit. Drafts are excluded — they are private until submitted.';

-- -----------------------------------------------------------------------------
-- Bridge tables for the many-to-many relationships.
-- Power BI cannot model many-to-many cleanly without them.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.bridge_visit_doctor AS
SELECT vd.visit_id AS visit_key, vd.doctor_id AS doctor_key
FROM public.visit_doctor vd
JOIN public.visit v ON v.id = vd.visit_id AND v.is_draft = false;

CREATE OR REPLACE VIEW reporting.bridge_visit_brand AS
SELECT vb.visit_id AS visit_key, vb.brand_id AS brand_key
FROM public.visit_brand vb
JOIN public.visit v ON v.id = vb.visit_id AND v.is_draft = false;

CREATE OR REPLACE VIEW reporting.bridge_visit_product AS
SELECT vp.visit_id AS visit_key, vp.product_id AS product_key
FROM public.visit_product vp
JOIN public.visit v ON v.id = vp.visit_id AND v.is_draft = false;

-- -----------------------------------------------------------------------------
-- fact_planned_visit — grain: one planned visit
--
-- Carries the KPI classification flags so Power BI does not have to
-- re-implement the rules. If it did, the report and the app would eventually
-- disagree, and nobody would know which was right.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.fact_planned_visit AS
SELECT
  pv.id                AS planned_visit_key,
  pv.planned_date      AS date_key,
  pv.rep_id            AS user_key,
  pv.clinic_id         AS clinic_key,
  pv.weekly_plan_id    AS weekly_plan_key,
  wp.iso_year,
  wp.iso_week,
  wp.week_start_date,
  wp.status::text      AS plan_status,
  pv.status::text      AS visit_status,
  pv.planned_order,
  pv.planned_time,
  pv.objective,
  v.id                 AS visit_key,
  (v.id IS NOT NULL AND v.is_draft = false AND v.status = 'completed') AS is_completed,
  pv.rescheduled_to_planned_visit_id AS rescheduled_to_key,
  -- The decided exception, if any.
  e.reason_category::text AS exception_reason,
  e.status::text          AS exception_status,
  public.fn_exception_excludes_from_kpi(
    e.status, e.reason_category, public.fn_kpi_rule_config(pv.planned_date)
  ) AS exception_excuses_kpi
FROM public.planned_visit pv
JOIN public.weekly_plan wp ON wp.id = pv.weekly_plan_id
LEFT JOIN public.visit v ON v.planned_visit_id = pv.id
LEFT JOIN LATERAL (
  SELECT x.status, x.reason_category
  FROM public.visit_exception x
  WHERE x.planned_visit_id = pv.id AND x.status <> 'pending'
  ORDER BY x.approval_ts DESC NULLS LAST
  LIMIT 1
) e ON true;

-- -----------------------------------------------------------------------------
-- fact_exception
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.fact_exception AS
SELECT
  e.id                     AS exception_key,
  pv.planned_date          AS date_key,
  e.rep_id                 AS user_key,
  pv.clinic_id             AS clinic_key,
  e.planned_visit_id       AS planned_visit_key,
  e.reason_category::text  AS reason,
  e.status::text           AS status,
  e.explanation,
  e.manager_comment,
  e.approved_by            AS approved_by_key,
  e.requested_at_server,
  e.approval_ts,
  EXTRACT(EPOCH FROM (e.approval_ts - e.requested_at_server))::integer
                           AS decision_seconds,
  e.distance_from_clinic_m,
  (e.attachment_path IS NOT NULL) AS has_attachment,
  public.fn_exception_excludes_from_kpi(
    e.status, e.reason_category, public.fn_kpi_rule_config(pv.planned_date)
  ) AS excludes_from_kpi
FROM public.visit_exception e
JOIN public.planned_visit pv ON pv.id = e.planned_visit_id;

-- -----------------------------------------------------------------------------
-- fact_follow_up
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.fact_follow_up AS
SELECT
  f.id           AS follow_up_key,
  f.due_date     AS date_key,
  f.rep_id       AS user_key,
  f.doctor_id    AS doctor_key,
  f.visit_id     AS visit_key,
  f.status::text AS status,
  f.description,
  f.completed_at,
  f.completed_visit_id AS completed_visit_key,
  (f.status = 'open' AND f.due_date < CURRENT_DATE) AS is_overdue
FROM public.follow_up f;

-- -----------------------------------------------------------------------------
-- fact_visit_status_history
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.fact_visit_status_history AS
SELECT
  h.id                 AS history_key,
  h.visit_id           AS visit_key,
  h.planned_visit_id   AS planned_visit_key,
  h.from_status::text  AS from_status,
  h.to_status::text    AS to_status,
  h.changed_by         AS user_key,
  h.changed_at,
  (h.changed_at AT TIME ZONE 'Asia/Ulaanbaatar')::date AS date_key,
  h.note
FROM public.visit_status_history h;

-- -----------------------------------------------------------------------------
-- fact_audit_log — who did what, for compliance reporting
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW reporting.fact_audit_log AS
SELECT
  a.id                AS audit_key,
  (a.occurred_at AT TIME ZONE 'Asia/Ulaanbaatar')::date AS date_key,
  a.occurred_at,
  a.actor_app_user_id AS user_key,
  a.actor_email::text AS actor_email,
  a.actor_role::text  AS actor_role,
  a.action,
  a.entity_type,
  a.entity_id,
  a.note
FROM public.audit_log a;

-- =============================================================================
-- A ready-made weekly KPI view.
--
-- Power BI CAN compute this from the facts, but the rules are subtle enough
-- (see docs/05) that two implementations would eventually disagree. This view
-- is the same arithmetic the app shows, so a report and the phone can never
-- contradict each other.
-- =============================================================================
CREATE OR REPLACE VIEW reporting.vw_kpi_weekly_rep AS
WITH weeks AS (
  SELECT DISTINCT
    wp.rep_id,
    wp.week_start_date,
    wp.week_end_date,
    wp.iso_year,
    wp.iso_week
  FROM public.weekly_plan wp
)
SELECT
  w.rep_id            AS user_key,
  u.full_name         AS rep_name,
  w.week_start_date   AS date_key,
  w.iso_year,
  w.iso_week,
  k.planned_visits,
  k.completed_visits,
  k.missed_visits,
  k.approved_cancellations,
  k.unapproved_cancellations,
  k.unplanned_visits,
  k.eligible_visits,
  k.completion_pct,
  k.avg_duration_seconds,
  k.on_time_pct,
  k.doctor_coverage_pct,
  k.clinic_coverage_pct,
  k.follow_up_completion_pct,
  k.kpi_rule_version_id
FROM weeks w
JOIN public.app_user u ON u.id = w.rep_id
CROSS JOIN LATERAL public.fn_kpi_for_rep(w.rep_id, w.week_start_date, w.week_end_date) k;

COMMENT ON VIEW reporting.vw_kpi_weekly_rep IS
  'Weekly KPI per representative, using the same function the app uses — so a Power BI report can never disagree with the phone.';

-- =============================================================================
-- The reporting login
--
-- SELECT on the reporting schema and NOTHING else. No public, no auth, no
-- writes anywhere.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader') THEN
    -- NOLOGIN here; the administrator sets a password when connecting Power BI.
    -- See docs/70-powerbi-guide.md. A password is never written in a migration.
    CREATE ROLE reporting_reader NOLOGIN;
    RAISE NOTICE 'Created role reporting_reader. Set a password before use: ALTER ROLE reporting_reader LOGIN PASSWORD ''...'';';
  END IF;
END;
$$;

-- Explicitly deny everything else, then grant only the reporting schema.
REVOKE ALL ON SCHEMA public FROM reporting_reader;
GRANT USAGE ON SCHEMA reporting TO reporting_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader;

-- Any view added to the reporting schema later is readable automatically;
-- nothing outside it ever becomes readable.
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  GRANT SELECT ON TABLES TO reporting_reader;

-- The application roles do not need the reporting schema — the app reads the
-- base tables through RLS. Keeping them out means one less path to audit.
REVOKE ALL ON SCHEMA reporting FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- A guard, asserted by tests: the reporting login must never gain access to
-- application tables.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reporting_reader_leaks()
RETURNS TABLE (schema_name text, object_name text, privilege text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT table_schema::text, table_name::text, privilege_type::text
  FROM information_schema.role_table_grants
  WHERE grantee = 'reporting_reader'
    AND (table_schema <> 'reporting' OR privilege_type <> 'SELECT')
  ORDER BY 1, 2;
$$;
