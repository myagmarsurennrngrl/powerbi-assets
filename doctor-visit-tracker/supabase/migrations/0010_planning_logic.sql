-- =============================================================================
-- 0010_planning_logic.sql
-- Doctor Visit Tracker — Phase 2
--
-- The rules of planning: deadlines, the plan status machine, duplicate
-- prevention, and the functions the app calls to submit and review a plan.
--
-- All of it lives on the server. The app disables buttons to match, but the
-- app is never what enforces any of this.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The planning deadline
--
-- Configured as a weekday + hour in app_setting. Default: Friday 18:00
-- (Asia/Ulaanbaatar) of the week BEFORE the planned week.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plan_deadline(p_week_start_date date)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (
    (
      -- Monday of the previous week, plus (weekday - 1) days.
      (p_week_start_date - 7 + (public.fn_setting_int('plan_deadline_weekday') - 1))::text
      || ' ' || lpad(public.fn_setting_int('plan_deadline_hour')::text, 2, '0') || ':00:00'
    )::timestamp AT TIME ZONE 'Asia/Ulaanbaatar'
  );
$$;

COMMENT ON FUNCTION public.fn_plan_deadline IS
  'When the plan for the week starting on the given Monday must be submitted. Default Friday 18:00 Ulaanbaatar of the preceding week.';

-- -----------------------------------------------------------------------------
-- May this plan still be edited by its owner?
--
-- Deliberate rule: a REJECTED plan is editable even after the deadline. The
-- manager sent it back and expects a correction; blocking it would leave the
-- representative with no way to comply.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plan_editable(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.weekly_plan p
    WHERE p.id = p_plan_id
      AND (
        p.status = 'rejected'
        OR (p.status = 'draft' AND now() <= public.fn_plan_deadline(p.week_start_date))
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- Keep planned_visit.rep_id and planned_date honest.
--
-- rep_id is denormalised for RLS, so it must always equal the parent plan's
-- owner — otherwise a representative could attach a visit to their own plan
-- while labelling it as someone else's.
-- planned_date must fall inside the plan's own week.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planned_visit_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan public.weekly_plan;
BEGIN
  SELECT * INTO v_plan FROM public.weekly_plan WHERE id = NEW.weekly_plan_id;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'weekly plan % does not exist', NEW.weekly_plan_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Always derive rep_id from the plan; never trust a submitted value.
  NEW.rep_id := v_plan.rep_id;

  IF NEW.planned_date < v_plan.week_start_date OR NEW.planned_date > v_plan.week_end_date THEN
    RAISE EXCEPTION
      'planned date % is outside the plan week % .. %',
      NEW.planned_date, v_plan.week_start_date, v_plan.week_end_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_planned_visit_validate
  BEFORE INSERT OR UPDATE OF weekly_plan_id, planned_date, rep_id ON public.planned_visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_planned_visit_validate();

-- -----------------------------------------------------------------------------
-- Duplicate planned visit prevention
--
-- BLOCKED : the same representative planning the same doctor, at the same
--           clinic, on the same date, twice.
-- ALLOWED : two DIFFERENT representatives planning the same doctor, same
--           clinic, same date. This is a core business requirement — they
--           carry different brands.
-- ALLOWED : the same representative seeing the same doctor at a different
--           clinic, or on a different day.
--
-- Enforced by trigger rather than a unique index, because the doctor list
-- lives in a child table.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_planned_visit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_this   public.planned_visit;
  v_doctor text;
  v_clinic text;
BEGIN
  SELECT * INTO v_this FROM public.planned_visit WHERE id = NEW.planned_visit_id;
  IF v_this.id IS NULL THEN
    RETURN NEW;   -- parent row is being created in the same statement
  END IF;

  -- Cancelled and rescheduled visits do not block a fresh plan.
  IF v_this.status IN ('cancelled_approved', 'cancelled_unapproved', 'rescheduled') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.planned_visit_doctor other_doctor
    JOIN public.planned_visit other ON other.id = other_doctor.planned_visit_id
    WHERE other_doctor.doctor_id      = NEW.doctor_id
      AND other_doctor.planned_visit_id <> NEW.planned_visit_id
      AND other.rep_id       = v_this.rep_id        -- same representative only
      AND other.clinic_id    = v_this.clinic_id
      AND other.planned_date = v_this.planned_date
      AND other.status NOT IN ('cancelled_approved', 'cancelled_unapproved', 'rescheduled')
  ) THEN
    SELECT full_name INTO v_doctor FROM public.doctor WHERE id = NEW.doctor_id;
    SELECT name      INTO v_clinic FROM public.clinic WHERE id = v_this.clinic_id;

    RAISE EXCEPTION
      'Энэ өдөр (%) % эмнэлэгт % эмчтэй уулзах төлөвлөгөө аль хэдийн байна.',
      v_this.planned_date, v_clinic, v_doctor
      USING ERRCODE   = 'unique_violation',
            CONSTRAINT = 'planned_visit_no_duplicate_doctor',
            DETAIL    = 'A different representative may still plan this doctor on the same day.';
  END IF;

  RETURN NEW;
END;
$$;

-- DEFERRABLE so a plan builder can insert the visit and its doctors in one
-- transaction without tripping over its own partially-written rows.
CREATE CONSTRAINT TRIGGER trg_prevent_duplicate_planned_visit
  AFTER INSERT OR UPDATE ON public.planned_visit_doctor
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_duplicate_planned_visit();

-- -----------------------------------------------------------------------------
-- Plan status machine
--
--   draft ──submit──► submitted ──approve──► approved ──► active ──► completed ──► locked
--     ▲                    │
--     └──── reject ────────┘  (rejected → draft on the next edit)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_weekly_plan_validate_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.status
    WHEN 'draft'     THEN ARRAY['submitted']
    WHEN 'submitted' THEN ARRAY['approved', 'rejected', 'draft']
    WHEN 'rejected'  THEN ARRAY['draft', 'submitted']
    WHEN 'approved'  THEN ARRAY['active', 'locked']
    WHEN 'active'    THEN ARRAY['completed', 'locked']
    WHEN 'completed' THEN ARRAY['locked']
    WHEN 'locked'    THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.status::text = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'plan status cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_weekly_plan_transition
  BEFORE UPDATE OF status ON public.weekly_plan
  FOR EACH ROW EXECUTE FUNCTION public.fn_weekly_plan_validate_transition();

-- -----------------------------------------------------------------------------
-- Record every planned-visit status change
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planned_visit_track_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.visit_status_history (planned_visit_id, from_status, to_status, changed_by, note)
    VALUES (NEW.id, NULL, NEW.status, public.fn_current_app_user_id(), 'created');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.visit_status_history (planned_visit_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, public.fn_current_app_user_id());
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_planned_visit_track_status
  AFTER INSERT OR UPDATE OF status ON public.planned_visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_planned_visit_track_status();

-- =============================================================================
-- Functions the application calls
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Get or create this representative's plan for a week.
-- Returns the plan id. Idempotent, so tapping twice is harmless.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_or_create_weekly_plan(p_week_start_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      public.app_user;
  v_plan_id uuid;
  v_iso_year integer;
  v_iso_week integer;
BEGIN
  v_me := public.fn_current_app_user();
  IF v_me.id IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_me.role <> 'representative' THEN
    RAISE EXCEPTION 'only a representative can own a weekly plan'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXTRACT(ISODOW FROM p_week_start_date) <> 1 THEN
    RAISE EXCEPTION 'week_start_date must be a Monday' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_plan_id
  FROM public.weekly_plan
  WHERE rep_id = v_me.id AND week_start_date = p_week_start_date;

  IF v_plan_id IS NOT NULL THEN
    RETURN v_plan_id;
  END IF;

  v_iso_year := EXTRACT(ISOYEAR FROM p_week_start_date);
  v_iso_week := EXTRACT(WEEK    FROM p_week_start_date);

  INSERT INTO public.weekly_plan (rep_id, iso_year, iso_week, week_start_date, week_end_date, status)
  VALUES (v_me.id, v_iso_year, v_iso_week, p_week_start_date, p_week_start_date + 6, 'draft')
  RETURNING id INTO v_plan_id;

  PERFORM public.fn_audit('plan_created', 'weekly_plan', v_plan_id, NULL,
                          jsonb_build_object('week_start_date', p_week_start_date));

  RETURN v_plan_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- Submit a plan for review.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_submit_plan(p_plan_id uuid)
RETURNS public.weekly_plan
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me     public.app_user;
  v_plan   public.weekly_plan;
  v_visits integer;
BEGIN
  v_me := public.fn_current_app_user();
  SELECT * INTO v_plan FROM public.weekly_plan WHERE id = p_plan_id;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_plan.rep_id <> v_me.id THEN
    RAISE EXCEPTION 'you can only submit your own plan' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_plan.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'only a draft or rejected plan can be submitted (current status: %)', v_plan.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- The deadline applies to a first submission, not to fixing a rejection.
  IF v_plan.status = 'draft' AND now() > public.fn_plan_deadline(v_plan.week_start_date) THEN
    RAISE EXCEPTION 'the planning deadline for this week has passed (%)',
      public.fn_plan_deadline(v_plan.week_start_date)
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_visits FROM public.planned_visit WHERE weekly_plan_id = p_plan_id;
  IF v_visits = 0 THEN
    RAISE EXCEPTION 'a plan must contain at least one visit' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.weekly_plan
     SET status = 'submitted', submitted_at = now(), review_comment = NULL
   WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  PERFORM public.fn_audit('plan_submitted', 'weekly_plan', p_plan_id, NULL,
                          jsonb_build_object('visit_count', v_visits));

  RETURN v_plan;
END;
$$;

-- -----------------------------------------------------------------------------
-- Approve or reject a submitted plan. Managers and administrators only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_review_plan(
  p_plan_id  uuid,
  p_approve  boolean,
  p_comment  text DEFAULT NULL
)
RETURNS public.weekly_plan
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me   public.app_user;
  v_plan public.weekly_plan;
BEGIN
  v_me := public.fn_current_app_user();

  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'only a manager can review a plan' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_plan FROM public.weekly_plan WHERE id = p_plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_plan.rep_id = v_me.id THEN
    RAISE EXCEPTION 'you cannot review your own plan' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_plan.status <> 'submitted' THEN
    RAISE EXCEPTION 'only a submitted plan can be reviewed (current status: %)', v_plan.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT p_approve AND btrim(COALESCE(p_comment, '')) = '' THEN
    RAISE EXCEPTION 'a rejection must include a comment' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.weekly_plan
     -- The explicit cast is required: a CASE over two untyped literals resolves
     -- to text, and text will not assign to an enum column.
     SET status         = (CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END)::public.plan_status,
         reviewed_by    = v_me.id,
         reviewed_at    = now(),
         review_comment = p_comment
   WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  PERFORM public.fn_audit('plan_reviewed', 'weekly_plan', p_plan_id, NULL,
                          jsonb_build_object('approved', p_approve, 'comment', p_comment));

  RETURN v_plan;
END;
$$;

-- -----------------------------------------------------------------------------
-- Move approved plans into 'active' when their week begins, and 'completed'
-- when it ends. Intended to be run by a scheduled job; also callable by an
-- administrator. Written to be safe to run repeatedly.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_advance_plan_lifecycle()
RETURNS TABLE (became_active integer, became_completed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := public.fn_local_date();
  v_active integer;
  v_completed integer;
BEGIN
  WITH updated AS (
    UPDATE public.weekly_plan
       SET status = 'active'
     WHERE status = 'approved'
       AND week_start_date <= v_today
       AND week_end_date   >= v_today
    RETURNING 1
  )
  SELECT count(*) INTO v_active FROM updated;

  WITH updated AS (
    UPDATE public.weekly_plan
       SET status = 'completed'
     WHERE status = 'active'
       AND week_end_date < v_today
    RETURNING 1
  )
  SELECT count(*) INTO v_completed FROM updated;

  RETURN QUERY SELECT v_active, v_completed;
END;
$$;

-- -----------------------------------------------------------------------------
-- Today's route.
--
-- Returns the caller's planned visits for a date, in planned order, with the
-- clinic, its coordinates and radius, the expected doctors and the intended
-- brands. One round trip instead of four, which matters on a weak connection.
--
-- Distance from the representative is NOT computed here: the server has no
-- business knowing where someone is standing unless they are starting a visit.
-- The app computes the display distance locally from these coordinates.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_route_for_date(p_date date DEFAULT NULL)
RETURNS TABLE (
  planned_visit_id  uuid,
  planned_date      date,
  planned_order     integer,
  planned_time      time,
  status            public.visit_status,
  objective         text,
  clinic_id         uuid,
  clinic_name       text,
  clinic_address    text,
  clinic_district   text,
  latitude          numeric,
  longitude         numeric,
  geofence_radius_m integer,
  doctor_names      text[],
  brand_names       text[],
  plan_status       public.plan_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    pv.id,
    pv.planned_date,
    pv.planned_order,
    pv.planned_time,
    pv.status,
    pv.objective,
    c.id,
    c.name,
    c.address,
    c.district,
    c.latitude,
    c.longitude,
    c.geofence_radius_m,
    COALESCE(
      (SELECT array_agg(d.full_name ORDER BY d.full_name)
         FROM public.planned_visit_doctor pvd
         JOIN public.doctor d ON d.id = pvd.doctor_id
        WHERE pvd.planned_visit_id = pv.id),
      ARRAY[]::text[]
    ),
    COALESCE(
      (SELECT array_agg(DISTINCT b.name)
         FROM public.planned_visit_brand pvb
         JOIN public.brand b ON b.id = pvb.brand_id
        WHERE pvb.planned_visit_id = pv.id),
      ARRAY[]::text[]
    ),
    wp.status
  FROM public.planned_visit pv
  JOIN public.clinic      c  ON c.id  = pv.clinic_id
  JOIN public.weekly_plan wp ON wp.id = pv.weekly_plan_id
  WHERE pv.rep_id = public.fn_current_app_user_id()
    AND pv.planned_date = COALESCE(p_date, public.fn_local_date())
  ORDER BY pv.planned_order, pv.planned_time NULLS LAST;
$$;

COMMENT ON FUNCTION public.fn_route_for_date IS
  'The caller''s own route for a date. SECURITY DEFINER but scoped to fn_current_app_user_id() — it cannot return another representative''s route.';

-- -----------------------------------------------------------------------------
-- Per-day visit counts for the weekly calendar screen.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_week_summary(p_week_start_date date)
RETURNS TABLE (
  planned_date  date,
  visit_count   integer,
  clinic_count  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    pv.planned_date,
    count(*)::integer,
    count(DISTINCT pv.clinic_id)::integer
  FROM public.planned_visit pv
  WHERE pv.rep_id = public.fn_current_app_user_id()
    AND pv.planned_date BETWEEN p_week_start_date AND p_week_start_date + 6
  GROUP BY pv.planned_date
  ORDER BY pv.planned_date;
$$;
