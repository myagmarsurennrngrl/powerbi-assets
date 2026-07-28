-- =============================================================================
-- 0012_manager_plan_authority.sql
-- Doctor Visit Tracker — Phase 2 (follow-up)
--
-- Confirmed decision: a manager may BOTH
--   (a) add a visit directly to a representative's plan, and
--   (b) approve, reject and reschedule.
--
-- This widens the permissions matrix (docs/03 rows 9 and 9a), so it comes with
-- three guardrails, because "a manager can change my plan" must never become
-- "my plan changed and nobody knows who did it":
--
--   1. A locked plan is closed to everyone, managers included.
--   2. Every manager change to someone else's plan writes an audit entry
--      naming the actor — enforced by trigger, not by convention.
--   3. Rescheduling never edits the original. It creates the replacement,
--      links the two, and leaves the original visible as 'rescheduled', so
--      the KPI can tell "moved" apart from "missed".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helper: find or create a representative's plan for a week.
--
-- fn_get_or_create_weekly_plan() is scoped to the CALLER, which is right for a
-- representative but useless when a manager reschedules someone else's visit
-- into a week that has no plan yet. This variant takes the rep explicitly and
-- is deliberately NOT granted to authenticated — only other functions call it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ensure_weekly_plan_for(
  p_rep_id          uuid,
  p_week_start_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  IF EXTRACT(ISODOW FROM p_week_start_date) <> 1 THEN
    RAISE EXCEPTION 'week_start_date must be a Monday' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_plan_id
  FROM public.weekly_plan
  WHERE rep_id = p_rep_id AND week_start_date = p_week_start_date;

  IF v_plan_id IS NOT NULL THEN
    RETURN v_plan_id;
  END IF;

  INSERT INTO public.weekly_plan
    (rep_id, iso_year, iso_week, week_start_date, week_end_date, status)
  VALUES (
    p_rep_id,
    EXTRACT(ISOYEAR FROM p_week_start_date)::integer,
    EXTRACT(WEEK    FROM p_week_start_date)::integer,
    p_week_start_date,
    p_week_start_date + 6,
    'draft'
  )
  RETURNING id INTO v_plan_id;

  PERFORM public.fn_audit('plan_created', 'weekly_plan', v_plan_id, NULL,
                          jsonb_build_object('week_start_date', p_week_start_date,
                                             'created_for_rep', p_rep_id,
                                             'reason', 'manager reschedule'));
  RETURN v_plan_id;
END;
$$;

-- =============================================================================
-- (a) A manager may add a visit to a representative's plan
-- =============================================================================

-- RLS policies are OR-ed, so this ADDS manager authority without touching the
-- representative's own rules.
--
-- Note what is deliberately absent: fn_plan_editable(). The planning deadline
-- exists to stop a representative rewriting history after the fact. A manager
-- adding a visit mid-week is the normal way work gets reassigned, so the
-- deadline must not block it. A LOCKED plan is still closed to everyone.
CREATE POLICY planned_visit_insert_manager ON public.planned_visit
  FOR INSERT TO authenticated
  WITH CHECK (
    public.fn_is_manager()
    AND EXISTS (
      SELECT 1 FROM public.weekly_plan p
      WHERE p.id = weekly_plan_id
        AND p.status <> 'locked'
    )
  );

CREATE POLICY planned_visit_doctor_write_manager ON public.planned_visit_doctor
  FOR INSERT TO authenticated
  WITH CHECK (
    public.fn_is_manager()
    AND EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id AND p.status <> 'locked'
    )
  );

CREATE POLICY planned_visit_doctor_delete_manager ON public.planned_visit_doctor
  FOR DELETE TO authenticated
  USING (
    public.fn_is_manager()
    AND EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id AND p.status <> 'locked'
    )
  );

CREATE POLICY planned_visit_brand_write_manager ON public.planned_visit_brand
  FOR INSERT TO authenticated
  WITH CHECK (
    public.fn_is_manager()
    AND EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id AND p.status <> 'locked'
    )
  );

CREATE POLICY planned_visit_brand_delete_manager ON public.planned_visit_brand
  FOR DELETE TO authenticated
  USING (
    public.fn_is_manager()
    AND EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id AND p.status <> 'locked'
    )
  );

-- -----------------------------------------------------------------------------
-- Guardrail 2: audit every change a manager makes to someone else's plan.
--
-- A representative editing their own draft is ordinary work and is not logged
-- here (it would drown the log). Somebody ELSE changing your plan is exactly
-- the event that needs a name attached to it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_foreign_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.fn_current_app_user_id();
  v_row   public.planned_visit := COALESCE(NEW, OLD);
BEGIN
  -- No session (migrations, seed scripts) or the owner acting on their own
  -- plan: nothing noteworthy.
  IF v_actor IS NULL OR v_actor = v_row.rep_id THEN
    RETURN NULL;
  END IF;

  PERFORM public.fn_audit(
    'plan_changed',
    'planned_visit',
    v_row.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    format('%s by another user on behalf of rep %s', TG_OP, v_row.rep_id)
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_planned_visit_audit_foreign_change
  AFTER INSERT OR UPDATE ON public.planned_visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_foreign_plan_change();

-- =============================================================================
-- (b) Reschedule — move a visit to another date without erasing the original
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_reschedule_visit(
  p_planned_visit_id uuid,
  p_new_date         date,
  p_new_time         time DEFAULT NULL,
  p_note             text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me           public.app_user;
  v_original     public.planned_visit;
  v_target_plan  uuid;
  v_target_status public.plan_status;
  v_new_id       uuid;
  v_next_order   integer;
BEGIN
  v_me := public.fn_current_app_user();

  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'only a manager can reschedule a visit'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_original FROM public.planned_visit WHERE id = p_planned_visit_id;
  IF v_original.id IS NULL THEN
    RAISE EXCEPTION 'planned visit not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- A visit that already happened, or was already moved, cannot be moved again.
  IF v_original.status NOT IN ('planned', 'missed', 'cancellation_requested') THEN
    RAISE EXCEPTION 'a visit with status % cannot be rescheduled', v_original.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_new_date = v_original.planned_date THEN
    RAISE EXCEPTION 'the new date is the same as the current one'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The replacement belongs to whichever week now contains it, which may be a
  -- different plan entirely.
  v_target_plan := public.fn_ensure_weekly_plan_for(
    v_original.rep_id,
    (date_trunc('week', p_new_date::timestamp))::date
  );

  SELECT status INTO v_target_status FROM public.weekly_plan WHERE id = v_target_plan;
  IF v_target_status = 'locked' THEN
    RAISE EXCEPTION 'the target week is locked' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(max(planned_order), 0) + 1 INTO v_next_order
  FROM public.planned_visit
  WHERE rep_id = v_original.rep_id AND planned_date = p_new_date;

  INSERT INTO public.planned_visit
    (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, planned_time, objective, status)
  VALUES (
    v_target_plan,
    v_original.rep_id,
    v_original.clinic_id,
    p_new_date,
    v_next_order,
    COALESCE(p_new_time, v_original.planned_time),
    v_original.objective,
    'planned'
  )
  RETURNING id INTO v_new_id;

  -- Carry the intent across: same doctors, same brands.
  INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id)
  SELECT v_new_id, doctor_id
  FROM public.planned_visit_doctor
  WHERE planned_visit_id = p_planned_visit_id;

  INSERT INTO public.planned_visit_brand (planned_visit_id, brand_id, product_id)
  SELECT v_new_id, brand_id, product_id
  FROM public.planned_visit_brand
  WHERE planned_visit_id = p_planned_visit_id;

  -- Guardrail 3: the original is marked, never edited away.
  UPDATE public.planned_visit
     SET status = 'rescheduled',
         rescheduled_to_planned_visit_id = v_new_id
   WHERE id = p_planned_visit_id;

  INSERT INTO public.visit_status_history (planned_visit_id, from_status, to_status, changed_by, note)
  VALUES (p_planned_visit_id, v_original.status, 'rescheduled', v_me.id,
          COALESCE(p_note, format('rescheduled to %s', p_new_date)));

  PERFORM public.fn_audit('plan_changed', 'planned_visit', p_planned_visit_id,
                          jsonb_build_object('planned_date', v_original.planned_date,
                                             'status', v_original.status),
                          jsonb_build_object('rescheduled_to', v_new_id,
                                             'new_date', p_new_date),
                          COALESCE(p_note, 'manager reschedule'));

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.fn_reschedule_visit IS
  'Manager-only. Creates the replacement visit, copies doctors and brands, and marks the original as rescheduled. Never edits the original away — the KPI must be able to distinguish "moved" from "missed".';

-- -----------------------------------------------------------------------------
-- A convenience for the manager UI (Phase 6): add a visit to a rep's plan for
-- an arbitrary date, creating the week's plan if it does not exist.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_manager_add_visit(
  p_rep_id     uuid,
  p_clinic_id  uuid,
  p_date       date,
  p_objective  text,
  p_doctor_ids uuid[],
  p_brand_ids  uuid[],
  p_time       time DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan_id    uuid;
  v_visit_id   uuid;
  v_next_order integer;
  v_rep_role   public.user_role;
BEGIN
  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'only a manager can add a visit to another user''s plan'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO v_rep_role FROM public.app_user WHERE id = p_rep_id AND is_active;
  IF v_rep_role IS DISTINCT FROM 'representative' THEN
    RAISE EXCEPTION 'visits can only be planned for an active representative'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_doctor_ids IS NULL OR array_length(p_doctor_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one doctor is required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_brand_ids IS NULL OR array_length(p_brand_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one brand is required' USING ERRCODE = 'check_violation';
  END IF;

  v_plan_id := public.fn_ensure_weekly_plan_for(
    p_rep_id, (date_trunc('week', p_date::timestamp))::date
  );

  SELECT COALESCE(max(planned_order), 0) + 1 INTO v_next_order
  FROM public.planned_visit
  WHERE rep_id = p_rep_id AND planned_date = p_date;

  INSERT INTO public.planned_visit
    (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, planned_time, objective)
  VALUES (v_plan_id, p_rep_id, p_clinic_id, p_date, v_next_order, p_time, p_objective)
  RETURNING id INTO v_visit_id;

  INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id)
  SELECT v_visit_id, unnest(p_doctor_ids);

  INSERT INTO public.planned_visit_brand (planned_visit_id, brand_id)
  SELECT v_visit_id, unnest(p_brand_ids);

  RETURN v_visit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.fn_reschedule_visit(uuid, date, time, text),
  public.fn_manager_add_visit(uuid, uuid, date, text, uuid[], uuid[], time)
TO authenticated;

-- Internal only: called by the two functions above, never by a client.
REVOKE EXECUTE ON FUNCTION public.fn_ensure_weekly_plan_for(uuid, date)
  FROM anon, authenticated;
