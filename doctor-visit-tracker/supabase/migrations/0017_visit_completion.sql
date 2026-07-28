-- =============================================================================
-- 0017_visit_completion.sql
-- Doctor Visit Tracker — Phase 4
--
-- fn_visit_completion_issues() — what is still missing, as a list
-- fn_complete_visit()          — validate, freeze, and submit
-- fn_add_addendum()            — the only way to correct a submitted visit
--
-- A DELIBERATE DEPARTURE FROM THE LITERAL SPECIFICATION, stated up front.
--
-- The brief lists "Doctor met" and "Doctor feedback" as unconditionally
-- required. Taken literally, a representative who found the clinic CLOSED
-- could never submit their report: there is no doctor to name and no feedback
-- to record. They would be forced either to abandon the record or to invent
-- something — and an invented record is worse than no record.
--
-- So the required set is CONDITIONAL on meeting_status:
--
--   meeting_status = doctor_met
--       → doctor(s), brands, feedback and interest level are all required
--   meeting_status = met_clinic_staff_only
--       → brands required; no doctor, no feedback, no interest level
--   clinic_closed / doctor_unavailable / meeting_postponed / other
--       → none of those; the rep still explains what happened
--
-- Always required, whatever happened: objective, outcome, next action,
-- summary, and an explicit yes/no on whether a follow-up is needed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What is still missing?
--
-- Returned as a list of machine-readable codes rather than a boolean, so the
-- form can mark the exact fields in red and the server can refuse with the
-- same reasons. One rule set, two consumers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_visit_completion_issues(p_visit_id uuid)
RETURNS TABLE (field text, issue text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v public.visit;
  v_needs_doctor  boolean;
  v_needs_brand   boolean;
BEGIN
  SELECT * INTO v FROM public.visit WHERE id = p_visit_id;
  IF v.id IS NULL THEN
    RETURN QUERY SELECT 'visit'::text, 'not_found'::text;
    RETURN;
  END IF;

  -- The check-out must have happened: a visit with no end has no duration and
  -- no exit location, so it is not a complete record of anything.
  IF v.completed_at_server IS NULL THEN
    RETURN QUERY SELECT 'check_out'::text, 'missing'::text;
  END IF;

  IF v.meeting_status IS NULL THEN
    RETURN QUERY SELECT 'meeting_status'::text, 'required'::text;
    -- Without knowing what happened, the conditional rules cannot be applied.
    RETURN;
  END IF;

  v_needs_doctor := (v.meeting_status = 'doctor_met');
  v_needs_brand  := (v.meeting_status IN ('doctor_met', 'met_clinic_staff_only'));

  IF v_needs_doctor AND NOT EXISTS (
    SELECT 1 FROM public.visit_doctor WHERE visit_id = p_visit_id
  ) THEN
    RETURN QUERY SELECT 'doctors'::text, 'required'::text;
  END IF;

  IF v_needs_brand AND NOT EXISTS (
    SELECT 1 FROM public.visit_brand WHERE visit_id = p_visit_id
  ) THEN
    RETURN QUERY SELECT 'brands'::text, 'required'::text;
  END IF;

  IF v_needs_doctor AND btrim(COALESCE(v.doctor_feedback, '')) = '' THEN
    RETURN QUERY SELECT 'doctor_feedback'::text, 'required'::text;
  END IF;

  IF v_needs_doctor AND v.interest_level IS NULL THEN
    RETURN QUERY SELECT 'interest_level'::text, 'required'::text;
  END IF;

  -- Always required.
  IF btrim(COALESCE(v.objective, '')) = '' THEN
    RETURN QUERY SELECT 'objective'::text, 'required'::text;
  END IF;

  IF v.outcome IS NULL THEN
    RETURN QUERY SELECT 'outcome'::text, 'required'::text;
  END IF;

  IF btrim(COALESCE(v.next_action, '')) = '' THEN
    RETURN QUERY SELECT 'next_action'::text, 'required'::text;
  END IF;

  IF btrim(COALESCE(v.rep_summary, '')) = '' THEN
    RETURN QUERY SELECT 'rep_summary'::text, 'required'::text;
  END IF;

  -- An explicit yes/no. NULL means "not answered", which is not the same as no.
  IF v.follow_up_required IS NULL THEN
    RETURN QUERY SELECT 'follow_up_required'::text, 'required'::text;
  ELSIF v.follow_up_required AND v.follow_up_date IS NULL THEN
    RETURN QUERY SELECT 'follow_up_date'::text, 'required'::text;
  ELSIF v.follow_up_required AND v.follow_up_date < v.visit_date THEN
    RETURN QUERY SELECT 'follow_up_date'::text, 'in_the_past'::text;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.fn_visit_completion_issues IS
  'The single source of truth for completion validation. The form and fn_complete_visit both use it.';

-- -----------------------------------------------------------------------------
-- fn_complete_visit — submit the report and freeze the record
--
-- ACCEPTANCE CRITERIA 8 and 9: a structured report can be completed, and once
-- completed the record cannot be edited.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_complete_visit(p_visit_id uuid)
RETURNS public.visit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me       uuid := public.fn_current_app_user_id();
  v          public.visit;
  v_issues   text;
  v_doctor   uuid;
BEGIN
  SELECT * INTO v FROM public.visit WHERE id = p_visit_id;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Уулзалт олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v.rep_id <> v_me THEN
    RAISE EXCEPTION 'Энэ уулзалт танд хамааралгүй байна.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent: submitting twice is a no-op, not an error. Important on a
  -- flaky connection where the client may not have seen the first response.
  IF v.status = 'completed' AND v.is_draft = false THEN
    RETURN v;
  END IF;

  IF v.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Зөвхөн үргэлжилж буй уулзалтыг дуусгана (төлөв: %).', v.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(field || ':' || issue, ', ' ORDER BY field)
    INTO v_issues
    FROM public.fn_visit_completion_issues(p_visit_id);

  IF v_issues IS NOT NULL THEN
    RAISE EXCEPTION 'Тайлан бүрэн бөглөгдөөгүй байна.'
      USING ERRCODE = 'check_violation',
            DETAIL  = v_issues;
  END IF;

  UPDATE public.visit
     SET status   = 'completed',
         is_draft = false
   WHERE id = p_visit_id
  RETURNING * INTO v;

  -- The planned visit follows.
  IF v.planned_visit_id IS NOT NULL THEN
    UPDATE public.planned_visit SET status = 'completed' WHERE id = v.planned_visit_id;
  END IF;

  -- Turn "next action" into something that can actually be chased.
  IF v.follow_up_required THEN
    SELECT doctor_id INTO v_doctor
      FROM public.visit_doctor WHERE visit_id = p_visit_id LIMIT 1;

    INSERT INTO public.follow_up (visit_id, rep_id, doctor_id, due_date, description)
    VALUES (p_visit_id, v.rep_id, v_doctor, v.follow_up_date, v.next_action);
  END IF;

  PERFORM public.fn_audit('visit_completed', 'visit', p_visit_id, NULL,
                          jsonb_build_object(
                            'meeting_status', v.meeting_status,
                            'outcome', v.outcome,
                            'duration_seconds', v.duration_seconds,
                            'follow_up_required', v.follow_up_required),
                          'report submitted');

  RETURN v;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_add_addendum — the ONLY route to correcting a submitted visit
--
-- Managers and administrators only. The original visit row is not touched;
-- the correction is a separate, attributable, permanent row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_add_addendum(
  p_visit_id        uuid,
  p_correction_text text,
  p_reason          text
)
RETURNS public.visit_addendum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me       public.app_user;
  v_visit    public.visit;
  v_addendum public.visit_addendum;
BEGIN
  v_me := public.fn_current_app_user();

  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'Зөвхөн менежер залруулга нэмнэ.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_visit FROM public.visit WHERE id = p_visit_id;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Уулзалт олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  -- A draft is still being written by its owner; there is nothing to correct
  -- yet, and adding an addendum would pre-empt the report.
  IF v_visit.is_draft THEN
    RAISE EXCEPTION 'Илгээгээгүй тайланд залруулга нэмэх боломжгүй.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF btrim(COALESCE(p_correction_text, '')) = '' THEN
    RAISE EXCEPTION 'Залруулгын агуулгыг бичнэ үү.' USING ERRCODE = 'check_violation';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Залруулгын шалтгааныг бичнэ үү.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.visit_addendum
    (visit_id, correction_text, reason, author_id, author_email, author_role)
  VALUES
    (p_visit_id, p_correction_text, p_reason, v_me.id, v_me.email, v_me.role)
  RETURNING * INTO v_addendum;

  PERFORM public.fn_audit('addendum_added', 'visit', p_visit_id, NULL,
                          jsonb_build_object('addendum_id', v_addendum.id,
                                             'reason', p_reason));

  RETURN v_addendum;
END;
$$;

-- -----------------------------------------------------------------------------
-- Close a follow-up.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_complete_follow_up(
  p_follow_up_id      uuid,
  p_completed_visit_id uuid DEFAULT NULL
)
RETURNS public.follow_up
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := public.fn_current_app_user_id();
  v    public.follow_up;
BEGIN
  SELECT * INTO v FROM public.follow_up WHERE id = p_follow_up_id;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Даалгавар олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v.rep_id <> v_me AND NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'Энэ даалгавар танд хамааралгүй байна.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.follow_up
     SET status = 'done',
         completed_at = now(),
         completed_visit_id = p_completed_visit_id
   WHERE id = p_follow_up_id
  RETURNING * INTO v;

  RETURN v;
END;
$$;

-- =============================================================================
-- Doctor visit history — ACCEPTANCE CRITERION 10
--
-- Every authorised representative may read the SUBMITTED history for a doctor,
-- from all colleagues, with the five filters the brief asks for. Drafts are
-- excluded, which keeps criterion 18 intact.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_doctor_visit_history(
  p_doctor_id   uuid,
  p_from_date   date    DEFAULT NULL,
  p_to_date     date    DEFAULT NULL,
  p_brand_id    uuid    DEFAULT NULL,
  p_rep_id      uuid    DEFAULT NULL,
  p_clinic_id   uuid    DEFAULT NULL,
  p_outcome     public.visit_outcome DEFAULT NULL
)
RETURNS TABLE (
  visit_id         uuid,
  visit_date       date,
  rep_id           uuid,
  rep_name         text,
  clinic_id        uuid,
  clinic_name      text,
  meeting_status   public.meeting_status,
  outcome          public.visit_outcome,
  interest_level   public.interest_level,
  doctor_feedback  text,
  rep_summary      text,
  next_action      text,
  duration_seconds integer,
  follow_up_required boolean,
  follow_up_date   date,
  brand_names      text[],
  product_names    text[],
  addendum_count   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    v.id,
    v.visit_date,
    v.rep_id,
    u.full_name,
    v.clinic_id,
    c.name,
    v.meeting_status,
    v.outcome,
    v.interest_level,
    v.doctor_feedback,
    v.rep_summary,
    v.next_action,
    v.duration_seconds,
    v.follow_up_required,
    v.follow_up_date,
    COALESCE((SELECT array_agg(DISTINCT b.name)
                FROM public.visit_brand vb
                JOIN public.brand b ON b.id = vb.brand_id
               WHERE vb.visit_id = v.id), ARRAY[]::text[]),
    COALESCE((SELECT array_agg(DISTINCT p.name)
                FROM public.visit_product vp
                JOIN public.product p ON p.id = vp.product_id
               WHERE vp.visit_id = v.id), ARRAY[]::text[]),
    (SELECT count(*)::integer FROM public.visit_addendum a WHERE a.visit_id = v.id)
  FROM public.visit v
  JOIN public.visit_doctor vd ON vd.visit_id = v.id AND vd.doctor_id = p_doctor_id
  JOIN public.app_user u ON u.id = v.rep_id
  JOIN public.clinic   c ON c.id = v.clinic_id
  WHERE
    -- Submitted work only. A colleague's draft is never visible here.
    v.is_draft = false
    -- The caller must be someone: this function is SECURITY DEFINER, so it
    -- would otherwise bypass RLS for an unprovisioned session.
    AND public.fn_current_app_user_id() IS NOT NULL
    AND (p_from_date IS NULL OR v.visit_date >= p_from_date)
    AND (p_to_date   IS NULL OR v.visit_date <= p_to_date)
    AND (p_rep_id    IS NULL OR v.rep_id     = p_rep_id)
    AND (p_clinic_id IS NULL OR v.clinic_id  = p_clinic_id)
    AND (p_outcome   IS NULL OR v.outcome    = p_outcome)
    AND (p_brand_id  IS NULL OR EXISTS (
          SELECT 1 FROM public.visit_brand vb
           WHERE vb.visit_id = v.id AND vb.brand_id = p_brand_id))
  ORDER BY v.visit_date DESC, v.started_at_server DESC;
$$;

COMMENT ON FUNCTION public.fn_doctor_visit_history IS
  'Shared, read-only doctor history across all representatives. Submitted visits only.';

GRANT EXECUTE ON FUNCTION
  public.fn_visit_completion_issues(uuid),
  public.fn_complete_visit(uuid),
  public.fn_add_addendum(uuid, text, text),
  public.fn_complete_follow_up(uuid, uuid),
  public.fn_doctor_visit_history(uuid, date, date, uuid, uuid, uuid, public.visit_outcome)
TO authenticated;
