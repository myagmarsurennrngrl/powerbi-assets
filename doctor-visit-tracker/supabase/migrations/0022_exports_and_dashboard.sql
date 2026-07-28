-- =============================================================================
-- 0022_exports_and_dashboard.sql
-- Doctor Visit Tracker — Phase 6
--
-- The manager dashboard's queries, and CSV export.
--
-- EVERY EXPORT IS AUDITED. Data leaving the system is exactly the event a
-- security review asks about, so `fn_export_visits` writes a `data_export`
-- audit entry recording who exported what, and how many rows — before it
-- returns a single one.
-- =============================================================================

-- =============================================================================
-- Manager dashboard
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The headline tiles.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_manager_dashboard(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (
  period_start          date,
  period_end            date,
  team_completion_pct   numeric,
  team_completed        integer,
  team_eligible         integer,
  total_missed          integer,
  pending_exceptions    integer,
  visits_needing_review integer,
  clinics_not_visited   integer,
  doctors_not_visited   integer,
  active_reps           integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from date := COALESCE(p_from, public.fn_local_date() - 27);
  v_to   date := COALESCE(p_to,   public.fn_local_date());
BEGIN
  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'Танд энэ мэдээллийг харах эрх алга.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH team AS (
    SELECT * FROM public.fn_kpi_for_team(v_from, v_to)
  ),
  totals AS (
    SELECT
      -- Weighted, not an average of percentages. See docs/05 §6.
      sum(completed_visits)::integer AS completed,
      sum(eligible_visits)::integer  AS eligible,
      sum(missed_visits)::integer    AS missed,
      count(*)::integer              AS reps
    FROM team
  ),
  reviews AS (
    SELECT count(*)::integer AS n
    FROM reporting.fact_visit fv
    WHERE fv.date_key BETWEEN v_from AND v_to AND fv.needs_review
  ),
  pending AS (
    SELECT count(*)::integer AS n FROM public.visit_exception WHERE status = 'pending'
  ),
  coverage AS (
    SELECT
      (SELECT count(*) FROM public.clinic c
        WHERE c.is_active AND c.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.visit v
             WHERE v.clinic_id = c.id AND v.is_draft = false
               AND v.visit_date BETWEEN v_from AND v_to))::integer AS clinics,
      (SELECT count(*) FROM public.doctor d
        WHERE d.is_active AND d.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.visit_doctor vd
              JOIN public.visit v ON v.id = vd.visit_id
             WHERE vd.doctor_id = d.id AND v.is_draft = false
               AND v.visit_date BETWEEN v_from AND v_to))::integer AS doctors
  )
  SELECT
    v_from, v_to,
    CASE WHEN t.eligible = 0 THEN NULL
         ELSE round((t.completed::numeric / t.eligible) * 100, 1) END,
    t.completed, t.eligible, t.missed,
    p.n, r.n, c.clinics, c.doctors, t.reps
  FROM totals t, pending p, reviews r, coverage c;
END;
$$;

-- -----------------------------------------------------------------------------
-- Visits started outside expected conditions.
--
-- Deliberately called a REVIEW list, not a violation list. Every entry has an
-- innocent explanation available — a hospital basement, a queued offline
-- check-in — and the point is to look, not to accuse.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_visits_needing_review(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  visit_key            uuid,
  visit_date           date,
  rep_name             text,
  clinic_name          text,
  distance_m           numeric,
  radius_m             integer,
  accuracy_m           numeric,
  outside_geofence     boolean,
  mocked_location      boolean,
  clock_drift_seconds  integer,
  created_source       text,
  duration_seconds     integer,
  reasons              text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    fv.visit_key,
    fv.date_key,
    u.full_name,
    c.clinic_name,
    fv.checkin_distance_m,
    fv.clinic_radius_m,
    fv.checkin_accuracy_m,
    fv.checkin_outside_geofence,
    fv.checkin_mocked_location,
    fv.checkin_clock_drift_seconds,
    fv.created_source,
    fv.duration_seconds,
    -- Say WHY each row is here, so nobody has to guess.
    ARRAY_REMOVE(ARRAY[
      CASE WHEN fv.checkin_outside_geofence THEN 'Радиусаас гадуур' END,
      CASE WHEN fv.checkin_mocked_location  THEN 'Хуурамч байршил' END,
      CASE WHEN COALESCE(abs(fv.checkin_clock_drift_seconds), 0) > 300
           THEN 'Утасны цаг зөрүүтэй' END,
      CASE WHEN fv.created_source = 'offline' THEN 'Офлайн бүртгэсэн' END,
      CASE WHEN COALESCE(fv.duration_seconds, 0) < 120 THEN 'Хэт богино' END
    ], NULL) AS reasons
  FROM reporting.fact_visit fv
  JOIN reporting.dim_user   u ON u.user_key   = fv.user_key
  JOIN reporting.dim_clinic c ON c.clinic_key = fv.clinic_key
  WHERE fv.needs_review
    AND fv.date_key BETWEEN COALESCE(p_from, public.fn_local_date() - 27)
                        AND COALESCE(p_to,   public.fn_local_date())
    AND public.fn_is_manager()
  ORDER BY fv.date_key DESC
  LIMIT p_limit;
$$;

-- -----------------------------------------------------------------------------
-- Clinics and doctors nobody has visited in the period.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_uncovered_clinics(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (clinic_key uuid, clinic_name text, district text, last_visit_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    c.id, c.name, c.district,
    (SELECT max(v.visit_date) FROM public.visit v
      WHERE v.clinic_id = c.id AND v.is_draft = false)
  FROM public.clinic c
  WHERE c.is_active AND c.deleted_at IS NULL
    AND public.fn_is_manager()
    AND NOT EXISTS (
      SELECT 1 FROM public.visit v
       WHERE v.clinic_id = c.id AND v.is_draft = false
         AND v.visit_date BETWEEN COALESCE(p_from, public.fn_local_date() - 27)
                              AND COALESCE(p_to,   public.fn_local_date()))
  ORDER BY 4 NULLS FIRST, c.name;
$$;

-- -----------------------------------------------------------------------------
-- Recent visits, for the dashboard map and list.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recent_visits(p_limit integer DEFAULT 50)
RETURNS TABLE (
  visit_key   uuid,
  visit_date  date,
  rep_name    text,
  clinic_name text,
  latitude    numeric,
  longitude   numeric,
  outcome     text,
  duration_seconds integer,
  needs_review boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    fv.visit_key, fv.date_key, u.full_name, c.clinic_name,
    c.latitude, c.longitude, fv.outcome, fv.duration_seconds, fv.needs_review
  FROM reporting.fact_visit fv
  JOIN reporting.dim_user   u ON u.user_key   = fv.user_key
  JOIN reporting.dim_clinic c ON c.clinic_key = fv.clinic_key
  WHERE public.fn_is_manager()
  ORDER BY fv.started_at_server DESC
  LIMIT p_limit;
$$;

-- =============================================================================
-- CSV export — audited before the data moves
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_export_visits(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  visit_date       date,
  rep_name         text,
  clinic_name      text,
  district         text,
  doctors          text,
  brands           text,
  products         text,
  meeting_status   text,
  outcome          text,
  interest_level   text,
  duration_minutes numeric,
  follow_up_required boolean,
  follow_up_date   date,
  doctor_feedback  text,
  rep_summary      text,
  next_action      text,
  is_unplanned     boolean,
  needs_review     boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'Зөвхөн менежер экспорт хийнэ.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_count
  FROM reporting.fact_visit fv
  WHERE fv.date_key BETWEEN p_from AND p_to;

  -- Audited BEFORE the rows are returned. Data leaving the system is the
  -- event a security review will ask about.
  PERFORM public.fn_audit('data_export', 'visit', NULL, NULL,
                          jsonb_build_object('from', p_from, 'to', p_to,
                                             'row_count', v_count),
                          'CSV export of visit data');

  RETURN QUERY
  SELECT
    fv.date_key,
    u.full_name,
    c.clinic_name,
    c.district,
    COALESCE((SELECT string_agg(d.doctor_name, '; ' ORDER BY d.doctor_name)
                FROM reporting.bridge_visit_doctor b
                JOIN reporting.dim_doctor d ON d.doctor_key = b.doctor_key
               WHERE b.visit_key = fv.visit_key), ''),
    COALESCE((SELECT string_agg(br.brand_name, '; ' ORDER BY br.brand_name)
                FROM reporting.bridge_visit_brand b
                JOIN reporting.dim_brand br ON br.brand_key = b.brand_key
               WHERE b.visit_key = fv.visit_key), ''),
    COALESCE((SELECT string_agg(p.product_name, '; ' ORDER BY p.product_name)
                FROM reporting.bridge_visit_product b
                JOIN reporting.dim_product p ON p.product_key = b.product_key
               WHERE b.visit_key = fv.visit_key), ''),
    fv.meeting_status,
    fv.outcome,
    fv.interest_level,
    fv.duration_minutes,
    fv.follow_up_required,
    fv.follow_up_date,
    -- Free text is included because a manager exporting visit reports needs
    -- it. Doctor CONTACT details are not, and never are: see docs/07 P3.
    v.doctor_feedback,
    v.rep_summary,
    v.next_action,
    fv.is_unplanned,
    fv.needs_review
  FROM reporting.fact_visit fv
  JOIN reporting.dim_user   u ON u.user_key   = fv.user_key
  JOIN reporting.dim_clinic c ON c.clinic_key = fv.clinic_key
  JOIN public.visit         v ON v.id         = fv.visit_key
  WHERE fv.date_key BETWEEN p_from AND p_to
  ORDER BY fv.date_key DESC, u.full_name;
END;
$$;

COMMENT ON FUNCTION public.fn_export_visits IS
  'Manager CSV export. Writes a data_export audit entry before returning any rows.';

-- -----------------------------------------------------------------------------
-- The audit log, for the audit screen. Read-only, filterable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_log_page(
  p_action     text    DEFAULT NULL,
  p_actor_id   uuid    DEFAULT NULL,
  p_from       date    DEFAULT NULL,
  p_to         date    DEFAULT NULL,
  p_limit      integer DEFAULT 100,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE (
  id          bigint,
  occurred_at timestamptz,
  actor_email text,
  actor_role  text,
  action      text,
  entity_type text,
  entity_id   uuid,
  note        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    a.id, a.occurred_at, a.actor_email::text, a.actor_role::text,
    a.action, a.entity_type, a.entity_id, a.note
  FROM public.audit_log a
  WHERE public.fn_is_manager()
    AND (p_action   IS NULL OR a.action = p_action)
    AND (p_actor_id IS NULL OR a.actor_app_user_id = p_actor_id)
    AND (p_from     IS NULL OR (a.occurred_at AT TIME ZONE 'Asia/Ulaanbaatar')::date >= p_from)
    AND (p_to       IS NULL OR (a.occurred_at AT TIME ZONE 'Asia/Ulaanbaatar')::date <= p_to)
  ORDER BY a.occurred_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION
  public.fn_manager_dashboard(date, date),
  public.fn_visits_needing_review(date, date, integer),
  public.fn_uncovered_clinics(date, date),
  public.fn_recent_visits(integer),
  public.fn_export_visits(date, date),
  public.fn_audit_log_page(text, uuid, date, date, integer, integer)
TO authenticated;

-- The dashboard functions read the reporting views, which the app roles cannot
-- reach directly. SECURITY DEFINER bridges that safely because each function
-- checks fn_is_manager() itself.
