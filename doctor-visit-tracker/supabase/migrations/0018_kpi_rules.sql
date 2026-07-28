-- =============================================================================
-- 0018_kpi_rules.sql
-- Doctor Visit Tracker — Phase 5
--
-- kpi_rule_version    — the KPI definition, as versioned DATA not code
-- kpi_period_snapshot — frozen results, so history never changes
--
-- WHY THE RULES ARE DATA
-- ----------------------
-- A KPI that people are measured on will be argued about, and the definition
-- WILL change. If the rules live in code, changing them silently rewrites
-- every past month: someone who scored 82% in September finds they now scored
-- 71%, and the number stops meaning anything to anyone.
--
-- So a rule change is an INSERT of a new version, never an edit. Each closed
-- period is snapshotted together with the version that produced it.
-- =============================================================================

CREATE TABLE public.kpi_rule_version (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no     integer NOT NULL UNIQUE,
  effective_from date    NOT NULL,
  effective_to   date,                  -- NULL = currently in force
  config         jsonb   NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT kpi_rule_version_dates_ordered
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Exactly one version can be in force at a time.
CREATE UNIQUE INDEX kpi_rule_version_one_current
  ON public.kpi_rule_version ((effective_to IS NULL))
  WHERE effective_to IS NULL;

COMMENT ON TABLE public.kpi_rule_version IS
  'Versioned KPI definition. Changing the rules means inserting a new row; published history is never recomputed.';

-- -----------------------------------------------------------------------------
-- Version 1 — the defaults confirmed with the business.
--
-- Note `doctor_unavailable` and `gps_problem` are NOT in the excluding set:
-- approving the explanation should not erase the target, because the rep still
-- travelled and still owns the outcome. Confirmed decision; configurable here
-- if it ever changes.
-- -----------------------------------------------------------------------------
INSERT INTO public.kpi_rule_version (version_no, effective_from, config, notes) VALUES (
  1,
  DATE '2026-01-01',
  jsonb_build_object(
    'numerator_statuses',                   jsonb_build_array('completed'),
    'denominator_statuses',                 jsonb_build_array('completed', 'missed', 'cancelled_unapproved'),
    'denominator_includes_past_incomplete', true,
    'excluding_exception_reasons',          jsonb_build_array(
                                              'sick_leave', 'clinic_closed', 'official_assignment',
                                              'emergency', 'wrong_clinic_coordinates',
                                              'appointment_rescheduled'),
    'exclude_future_rescheduled',           true,
    'on_time_tolerance_minutes',            15,
    'min_valid_duration_seconds',           120,
    'unplanned_visits_in_standard_kpi',     false,
    'null_when_denominator_zero',           true
  ),
  'Initial rules. doctor_unavailable and gps_problem deliberately excluded from the excluding set.'
);

-- -----------------------------------------------------------------------------
-- The rule version in force on a given date.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_kpi_rule_config(p_on date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT config
  FROM public.kpi_rule_version
  WHERE effective_from <= p_on
    AND (effective_to IS NULL OR effective_to >= p_on)
  ORDER BY version_no DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_kpi_rule_version_id(p_on date DEFAULT CURRENT_DATE)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT id
  FROM public.kpi_rule_version
  WHERE effective_from <= p_on
    AND (effective_to IS NULL OR effective_to >= p_on)
  ORDER BY version_no DESC
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- Publishing a new rule version. Administrators only.
-- Closes the current version rather than editing it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_create_kpi_rule_version(
  p_config         jsonb,
  p_effective_from date,
  p_notes          text DEFAULT NULL
)
RETURNS public.kpi_rule_version
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_next integer;
  v_row  public.kpi_rule_version;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор KPI дүрэм өөрчилнө.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_effective_from <= CURRENT_DATE THEN
    -- Backdating would change numbers people have already been shown.
    RAISE EXCEPTION 'Шинэ дүрэм зөвхөн ирээдүйн огнооноос эхэлнэ.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(max(version_no), 0) + 1 INTO v_next FROM public.kpi_rule_version;

  UPDATE public.kpi_rule_version
     SET effective_to = p_effective_from - 1
   WHERE effective_to IS NULL;

  INSERT INTO public.kpi_rule_version (version_no, effective_from, config, notes, created_by)
  VALUES (v_next, p_effective_from, p_config, p_notes, public.fn_current_app_user_id())
  RETURNING * INTO v_row;

  PERFORM public.fn_audit('setting_changed', 'kpi_rule_version', v_row.id, NULL,
                          jsonb_build_object('version_no', v_next, 'config', p_config));

  RETURN v_row;
END;
$$;

-- =============================================================================
-- kpi_period_snapshot — frozen published results
-- =============================================================================
CREATE TABLE public.kpi_period_snapshot (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope               text NOT NULL,          -- 'rep' | 'team'
  rep_id              uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  period_type         text NOT NULL,          -- 'week' | 'month'
  period_start        date NOT NULL,
  period_end          date NOT NULL,

  kpi_rule_version_id uuid NOT NULL REFERENCES public.kpi_rule_version (id) ON DELETE RESTRICT,

  planned_visits      integer NOT NULL,
  completed_visits    integer NOT NULL,
  missed_visits       integer NOT NULL,
  approved_cancellations   integer NOT NULL,
  unapproved_cancellations integer NOT NULL,
  unplanned_visits    integer NOT NULL,
  eligible_visits     integer NOT NULL,
  completion_pct      numeric(5,1),           -- NULL when nothing was eligible
  avg_duration_seconds integer,
  on_time_pct         numeric(5,1),
  doctor_coverage_pct numeric(5,1),
  clinic_coverage_pct numeric(5,1),
  follow_up_completion_pct numeric(5,1),

  computed_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kpi_snapshot_scope_valid  CHECK (scope IN ('rep', 'team')),
  CONSTRAINT kpi_snapshot_period_valid CHECK (period_type IN ('week', 'month')),
  CONSTRAINT kpi_snapshot_rep_present  CHECK (scope <> 'rep' OR rep_id IS NOT NULL),
  CONSTRAINT kpi_snapshot_dates_ordered CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX kpi_snapshot_unique
  ON public.kpi_period_snapshot (
    scope, COALESCE(rep_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_type, period_start);

CREATE INDEX kpi_snapshot_rep_idx ON public.kpi_period_snapshot (rep_id, period_start DESC);

COMMENT ON TABLE public.kpi_period_snapshot IS
  'Published KPI for a closed period, frozen with the rule version that produced it. Never recomputed.';

-- A published snapshot is a historical fact.
CREATE OR REPLACE FUNCTION public.fn_kpi_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'a published KPI snapshot cannot be % — publish a correction instead', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_kpi_snapshot_no_update
  BEFORE UPDATE ON public.kpi_period_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.fn_kpi_snapshot_immutable();

CREATE TRIGGER trg_kpi_snapshot_no_delete
  BEFORE DELETE ON public.kpi_period_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.fn_kpi_snapshot_immutable();

-- =============================================================================
-- Row level security
-- =============================================================================
ALTER TABLE public.kpi_rule_version    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_period_snapshot ENABLE ROW LEVEL SECURITY;

-- Everyone may read the rules they are measured by. That is not a courtesy —
-- a KPI nobody can inspect is a KPI nobody trusts.
CREATE POLICY kpi_rule_version_select ON public.kpi_rule_version
  FOR SELECT TO authenticated
  USING (public.fn_current_app_user_id() IS NOT NULL);

CREATE POLICY kpi_snapshot_select ON public.kpi_period_snapshot
  FOR SELECT TO authenticated
  USING (rep_id = public.fn_current_app_user_id() OR public.fn_is_manager());

GRANT SELECT ON public.kpi_rule_version, public.kpi_period_snapshot TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.kpi_rule_version, public.kpi_period_snapshot
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.fn_kpi_rule_config(date),
  public.fn_kpi_rule_version_id(date),
  public.fn_create_kpi_rule_version(jsonb, date, text)
TO authenticated;
