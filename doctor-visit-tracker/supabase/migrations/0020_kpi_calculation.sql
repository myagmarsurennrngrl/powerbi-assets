-- =============================================================================
-- 0020_kpi_calculation.sql
-- Doctor Visit Tracker — Phase 5
--
-- The KPI arithmetic from docs/05, implemented once, on the server.
--
-- The worked example in docs/05 §4 is encoded as a test. If this file and that
-- document ever disagree, the test fails and one of them is wrong.
--
-- TWO RULES THAT ARE EASY TO GET WRONG AND MATTER A LOT
-- -----------------------------------------------------
-- 1. Zero eligible visits gives NULL, never 0%. A representative on approved
--    sick leave for a whole week has not failed; showing them 0% is a false
--    accusation by arithmetic.
-- 2. Unplanned visits are reported SEPARATELY and never enter the planned
--    completion ratio — neither on top nor underneath.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Classify every planned visit in a period for one representative.
--
-- Everything downstream reads from this, so the definitions exist in exactly
-- one place.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_kpi_visit_classification(
  p_rep_id uuid,
  p_from   date,
  p_to     date,
  p_config jsonb DEFAULT NULL
)
RETURNS TABLE (
  planned_visit_id uuid,
  planned_date     date,
  status           public.visit_status,
  visit_id         uuid,
  is_completed     boolean,
  is_missed        boolean,
  is_unapproved_cancellation boolean,
  is_approved_cancellation   boolean,
  is_future_rescheduled      boolean,
  is_eligible      boolean,
  started_on_time  boolean,
  duration_seconds integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH cfg AS (
    SELECT COALESCE(p_config, public.fn_kpi_rule_config(p_to)) AS c
  ),
  base AS (
    SELECT
      pv.id,
      pv.planned_date,
      pv.status,
      pv.planned_time,
      pv.rescheduled_to_planned_visit_id,
      v.id AS visit_id,
      v.status  AS visit_status,
      v.is_draft,
      v.started_at_server,
      v.duration_seconds,
      -- The most recent decided exception for this visit.
      (SELECT e.status FROM public.visit_exception e
        WHERE e.planned_visit_id = pv.id AND e.status <> 'pending'
        ORDER BY e.approval_ts DESC NULLS LAST LIMIT 1) AS exception_status,
      (SELECT e.reason_category FROM public.visit_exception e
        WHERE e.planned_visit_id = pv.id AND e.status <> 'pending'
        ORDER BY e.approval_ts DESC NULLS LAST LIMIT 1) AS exception_reason,
      -- Was it moved to a LATER date? Moving it earlier is not an excuse.
      (SELECT later.planned_date > pv.planned_date
         FROM public.planned_visit later
        WHERE later.id = pv.rescheduled_to_planned_visit_id) AS moved_later
    FROM public.planned_visit pv
    LEFT JOIN public.visit v ON v.planned_visit_id = pv.id
    WHERE pv.rep_id = p_rep_id
      AND pv.planned_date BETWEEN p_from AND p_to
  ),
  flagged AS (
    -- EVERY flag is COALESCEd to false.
    --
    -- A planned visit that never became a visit has visit_status = NULL, and a
    -- visit with no exception has exception_status = NULL. Without COALESCE
    -- those NULLs propagate through `NOT excused AND ...`, making is_eligible
    -- NULL so the row silently vanishes from the denominator — leaving only
    -- completed visits and handing everyone 100%. Caught by the docs/05 §4
    -- worked-example test, which expected 6 eligible and got 2.
    SELECT
      b.*,
      COALESCE(b.visit_status = 'completed' AND b.is_draft = false, false) AS completed,
      COALESCE(
        b.status = 'missed'
          OR (b.status IN ('planned', 'in_progress', 'cancellation_requested')
              AND b.planned_date < public.fn_local_date()),
        false) AS missed,
      COALESCE(b.status = 'cancelled_unapproved', false) AS unapproved,
      COALESCE(public.fn_exception_excludes_from_kpi(
        b.exception_status, b.exception_reason, (SELECT c FROM cfg)), false) AS excused,
      COALESCE(
        b.status = 'rescheduled' AND COALESCE(b.moved_later, false)
          AND COALESCE(((SELECT c FROM cfg) ->> 'exclude_future_rescheduled')::boolean, true),
        false) AS rescheduled_forward
    FROM base b
  )
  SELECT
    f.id,
    f.planned_date,
    f.status,
    f.visit_id,
    f.completed,
    (f.missed AND NOT f.completed),
    (f.unapproved AND NOT f.completed),
    -- "Approved cancellation" for reporting means an approved exception whose
    -- reason actually excuses it. An approved doctor_unavailable is a real
    -- cancellation but is NOT excused, and is counted as such.
    (f.excused AND NOT f.completed),
    f.rescheduled_forward,
    -- ELIGIBLE = counts in the denominator.
    (
      f.completed
      OR (
        NOT f.excused
        AND NOT f.rescheduled_forward
        AND (
          f.missed
          OR f.unapproved
          OR COALESCE(f.status = 'cancelled_approved', false)  -- approved, reason not excusing
        )
      )
    ),
    -- On time: started within the tolerance of the planned time. Visits with
    -- no planned time are excluded from this metric only (NULL, not false).
    CASE
      WHEN f.completed AND f.planned_time IS NOT NULL AND f.started_at_server IS NOT NULL THEN
        f.started_at_server <=
          ((f.planned_date + f.planned_time) AT TIME ZONE 'Asia/Ulaanbaatar')
          + (COALESCE(((SELECT c FROM cfg) ->> 'on_time_tolerance_minutes')::int, 15)
             * INTERVAL '1 minute')
      ELSE NULL
    END,
    f.duration_seconds
  FROM flagged f;
$$;

COMMENT ON FUNCTION public.fn_kpi_visit_classification IS
  'Per-visit KPI classification for one rep and period. The single definition every metric reads from.';

-- =============================================================================
-- The headline KPI for one representative over one period
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_kpi_for_rep(
  p_rep_id uuid,
  p_from   date,
  p_to     date
)
RETURNS TABLE (
  rep_id                   uuid,
  period_start             date,
  period_end               date,
  planned_visits           integer,
  completed_visits         integer,
  missed_visits            integer,
  approved_cancellations   integer,
  unapproved_cancellations integer,
  unplanned_visits         integer,
  eligible_visits          integer,
  completion_pct           numeric,
  avg_duration_seconds     integer,
  on_time_pct              numeric,
  doctor_coverage_pct      numeric,
  clinic_coverage_pct      numeric,
  follow_up_completion_pct numeric,
  kpi_rule_version_id      uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cfg jsonb := public.fn_kpi_rule_config(p_to);
BEGIN
  -- A representative sees their own; managers see everyone's. Enforced here
  -- because this function is SECURITY DEFINER and bypasses RLS.
  IF NOT (public.fn_is_manager() OR p_rep_id = public.fn_current_app_user_id()) THEN
    RAISE EXCEPTION 'Танд энэ мэдээллийг харах эрх алга.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH k AS (
    SELECT * FROM public.fn_kpi_visit_classification(p_rep_id, p_from, p_to, v_cfg)
  ),
  totals AS (
    SELECT
      count(*)::integer                                     AS planned,
      count(*) FILTER (WHERE is_completed)::integer         AS completed,
      count(*) FILTER (WHERE is_missed)::integer            AS missed,
      count(*) FILTER (WHERE is_approved_cancellation)::integer   AS approved_cancel,
      count(*) FILTER (WHERE is_unapproved_cancellation)::integer AS unapproved_cancel,
      count(*) FILTER (WHERE is_eligible)::integer          AS eligible,
      avg(duration_seconds) FILTER (WHERE is_completed)     AS avg_duration,
      count(*) FILTER (WHERE started_on_time IS TRUE)       AS on_time_yes,
      count(*) FILTER (WHERE started_on_time IS NOT NULL)   AS on_time_measurable
    FROM k
  ),
  unplanned AS (
    -- Reported separately, never mixed in.
    SELECT count(*)::integer AS n
    FROM public.visit v
    WHERE v.rep_id = p_rep_id
      AND v.planned_visit_id IS NULL
      AND v.status = 'completed'
      AND v.is_draft = false
      AND v.visit_date BETWEEN p_from AND p_to
  ),
  -- Coverage is measured against the doctors and clinics this rep is
  -- responsible for — those reachable through the brands they carry.
  scope AS (
    SELECT
      (SELECT count(DISTINCT dc.doctor_id)
         FROM public.doctor_clinic dc
         JOIN public.doctor d ON d.id = dc.doctor_id
        WHERE dc.is_active AND d.is_active AND d.deleted_at IS NULL) AS all_doctors,
      (SELECT count(*) FROM public.clinic c
        WHERE c.is_active AND c.deleted_at IS NULL)                  AS all_clinics
  ),
  reached AS (
    SELECT
      (SELECT count(DISTINCT vd.doctor_id)
         FROM public.visit v
         JOIN public.visit_doctor vd ON vd.visit_id = v.id
        WHERE v.rep_id = p_rep_id AND v.is_draft = false
          AND v.visit_date BETWEEN p_from AND p_to)                  AS doctors,
      (SELECT count(DISTINCT v.clinic_id)
         FROM public.visit v
        WHERE v.rep_id = p_rep_id AND v.is_draft = false
          AND v.visit_date BETWEEN p_from AND p_to)                  AS clinics
  ),
  follow_ups AS (
    SELECT
      count(*)                                    AS due,
      count(*) FILTER (WHERE f.status = 'done')   AS done
    FROM public.follow_up f
    WHERE f.rep_id = p_rep_id AND f.due_date BETWEEN p_from AND p_to
  )
  SELECT
    p_rep_id,
    p_from,
    p_to,
    t.planned,
    t.completed,
    t.missed,
    t.approved_cancel,
    t.unapproved_cancel,
    u.n,
    t.eligible,
    -- NULL, never 0%, when nothing was eligible.
    CASE
      WHEN t.eligible = 0 THEN NULL
      ELSE round((t.completed::numeric / t.eligible) * 100, 1)
    END,
    round(t.avg_duration)::integer,
    CASE
      WHEN t.on_time_measurable = 0 THEN NULL
      ELSE round((t.on_time_yes::numeric / t.on_time_measurable) * 100, 1)
    END,
    CASE
      WHEN s.all_doctors = 0 THEN NULL
      ELSE round((r.doctors::numeric / s.all_doctors) * 100, 1)
    END,
    CASE
      WHEN s.all_clinics = 0 THEN NULL
      ELSE round((r.clinics::numeric / s.all_clinics) * 100, 1)
    END,
    CASE
      WHEN f.due = 0 THEN NULL
      ELSE round((f.done::numeric / f.due) * 100, 1)
    END,
    public.fn_kpi_rule_version_id(p_to)
  FROM totals t, unplanned u, scope s, reached r, follow_ups f;
END;
$$;

-- -----------------------------------------------------------------------------
-- Brand activity: completed visits per brand. A list, not a single number.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_kpi_brand_activity(
  p_rep_id uuid,
  p_from   date,
  p_to     date
)
RETURNS TABLE (brand_id uuid, brand_name text, visit_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.id, b.name, count(DISTINCT v.id)::integer
  FROM public.brand b
  JOIN public.visit_brand vb ON vb.brand_id = b.id
  JOIN public.visit v        ON v.id = vb.visit_id
  WHERE v.rep_id = p_rep_id
    AND v.is_draft = false
    AND v.status = 'completed'
    AND v.visit_date BETWEEN p_from AND p_to
    AND (public.fn_is_manager() OR p_rep_id = public.fn_current_app_user_id())
  GROUP BY b.id, b.name
  ORDER BY count(DISTINCT v.id) DESC, b.name;
$$;

-- -----------------------------------------------------------------------------
-- Team KPI.
--
-- Team completion is SUM(numerators) / SUM(denominators), NOT the average of
-- percentages. A rep with 2 planned visits must not weigh as much as one with
-- 20, or the number can be moved by whoever had the quietest week.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_kpi_for_team(p_from date, p_to date)
RETURNS TABLE (
  rep_id                   uuid,
  rep_name                 text,
  planned_visits           integer,
  completed_visits         integer,
  missed_visits            integer,
  approved_cancellations   integer,
  unapproved_cancellations integer,
  unplanned_visits         integer,
  eligible_visits          integer,
  completion_pct           numeric,
  avg_duration_seconds     integer,
  on_time_pct              numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id, u.full_name,
    k.planned_visits, k.completed_visits, k.missed_visits,
    k.approved_cancellations, k.unapproved_cancellations, k.unplanned_visits,
    k.eligible_visits, k.completion_pct, k.avg_duration_seconds, k.on_time_pct
  FROM public.app_user u
  CROSS JOIN LATERAL public.fn_kpi_for_rep(u.id, p_from, p_to) k
  WHERE u.role = 'representative'
    AND u.is_active
    AND public.fn_is_manager()
  ORDER BY k.completion_pct DESC NULLS LAST, u.full_name;
$$;

-- -----------------------------------------------------------------------------
-- Publish a snapshot for a closed period. Written once, then immutable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_publish_kpi_snapshot(
  p_rep_id      uuid,
  p_period_type text,
  p_period_start date,
  p_period_end   date
)
RETURNS public.kpi_period_snapshot
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  k   record;
  row public.kpi_period_snapshot;
BEGIN
  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'Зөвхөн менежер KPI-г баталгаажуулна.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_period_end >= public.fn_local_date() THEN
    -- Publishing a period that has not finished would freeze a half-week.
    RAISE EXCEPTION 'Дуусаагүй хугацааг баталгаажуулах боломжгүй.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO k FROM public.fn_kpi_for_rep(p_rep_id, p_period_start, p_period_end);

  INSERT INTO public.kpi_period_snapshot (
    scope, rep_id, period_type, period_start, period_end, kpi_rule_version_id,
    planned_visits, completed_visits, missed_visits,
    approved_cancellations, unapproved_cancellations, unplanned_visits,
    eligible_visits, completion_pct, avg_duration_seconds, on_time_pct,
    doctor_coverage_pct, clinic_coverage_pct, follow_up_completion_pct
  ) VALUES (
    'rep', p_rep_id, p_period_type, p_period_start, p_period_end, k.kpi_rule_version_id,
    k.planned_visits, k.completed_visits, k.missed_visits,
    k.approved_cancellations, k.unapproved_cancellations, k.unplanned_visits,
    k.eligible_visits, k.completion_pct, k.avg_duration_seconds, k.on_time_pct,
    k.doctor_coverage_pct, k.clinic_coverage_pct, k.follow_up_completion_pct
  )
  RETURNING * INTO row;

  RETURN row;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.fn_kpi_visit_classification(uuid, date, date, jsonb),
  public.fn_kpi_for_rep(uuid, date, date),
  public.fn_kpi_brand_activity(uuid, date, date),
  public.fn_kpi_for_team(date, date),
  public.fn_publish_kpi_snapshot(uuid, text, date, date)
TO authenticated;
