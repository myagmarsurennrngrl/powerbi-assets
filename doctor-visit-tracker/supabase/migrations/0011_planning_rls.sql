-- =============================================================================
-- 0011_planning_rls.sql
-- Doctor Visit Tracker — Phase 2
--
-- Row-level security and grants for the planning tables.
--
-- Core rule (acceptance criterion 11): a representative can read and write
-- their OWN plan and nobody else's. Managers can read everything and
-- reschedule; only the owner creates and edits.
-- =============================================================================

ALTER TABLE public.weekly_plan          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planned_visit        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planned_visit_doctor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planned_visit_brand  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_status_history ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- weekly_plan
-- =============================================================================
CREATE POLICY weekly_plan_select ON public.weekly_plan
  FOR SELECT TO authenticated
  USING (rep_id = public.fn_current_app_user_id() OR public.fn_is_manager());

-- A representative creates only their own plan, and only as a draft.
CREATE POLICY weekly_plan_insert ON public.weekly_plan
  FOR INSERT TO authenticated
  WITH CHECK (
    rep_id = public.fn_current_app_user_id()
    AND public.fn_is_rep()
    AND status = 'draft'
  );

-- The owner may edit while the plan is editable; a manager may review it.
-- The status machine trigger (0010) constrains WHICH transitions are legal;
-- this policy constrains WHO may attempt one.
CREATE POLICY weekly_plan_update ON public.weekly_plan
  FOR UPDATE TO authenticated
  USING (
    (rep_id = public.fn_current_app_user_id() AND public.fn_plan_editable(id))
    OR public.fn_is_manager()
  )
  WITH CHECK (
    (rep_id = public.fn_current_app_user_id())
    OR public.fn_is_manager()
  );

-- No DELETE policy: a plan is never deleted. An unwanted plan simply stays a
-- draft with no visits, and its visits can be cancelled.

-- =============================================================================
-- planned_visit
-- =============================================================================
CREATE POLICY planned_visit_select ON public.planned_visit
  FOR SELECT TO authenticated
  USING (rep_id = public.fn_current_app_user_id() OR public.fn_is_manager());

CREATE POLICY planned_visit_insert ON public.planned_visit
  FOR INSERT TO authenticated
  WITH CHECK (
    public.fn_is_rep()
    AND EXISTS (
      SELECT 1 FROM public.weekly_plan p
      WHERE p.id = weekly_plan_id
        AND p.rep_id = public.fn_current_app_user_id()
        AND public.fn_plan_editable(p.id)
    )
  );

CREATE POLICY planned_visit_update ON public.planned_visit
  FOR UPDATE TO authenticated
  USING (
    (rep_id = public.fn_current_app_user_id()
      AND EXISTS (SELECT 1 FROM public.weekly_plan p
                   WHERE p.id = weekly_plan_id AND public.fn_plan_editable(p.id)))
    OR public.fn_is_manager()
  )
  WITH CHECK (
    rep_id = public.fn_current_app_user_id() OR public.fn_is_manager()
  );

-- =============================================================================
-- planned_visit_doctor / planned_visit_brand
--
-- These are child lists. Authority follows the parent visit exactly: if you
-- may edit the visit, you may edit its doctors and brands.
-- =============================================================================
CREATE POLICY planned_visit_doctor_select ON public.planned_visit_doctor
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.planned_visit pv
      WHERE pv.id = planned_visit_id
        AND (pv.rep_id = public.fn_current_app_user_id() OR public.fn_is_manager())
    )
  );

CREATE POLICY planned_visit_doctor_write ON public.planned_visit_doctor
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id
        AND pv.rep_id = public.fn_current_app_user_id()
        AND public.fn_plan_editable(p.id)
    )
  );

CREATE POLICY planned_visit_doctor_delete ON public.planned_visit_doctor
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id
        AND pv.rep_id = public.fn_current_app_user_id()
        AND public.fn_plan_editable(p.id)
    )
  );

CREATE POLICY planned_visit_brand_select ON public.planned_visit_brand
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.planned_visit pv
      WHERE pv.id = planned_visit_id
        AND (pv.rep_id = public.fn_current_app_user_id() OR public.fn_is_manager())
    )
  );

CREATE POLICY planned_visit_brand_write ON public.planned_visit_brand
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id
        AND pv.rep_id = public.fn_current_app_user_id()
        AND public.fn_plan_editable(p.id)
    )
  );

CREATE POLICY planned_visit_brand_delete ON public.planned_visit_brand
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.planned_visit pv
      JOIN public.weekly_plan p ON p.id = pv.weekly_plan_id
      WHERE pv.id = planned_visit_id
        AND pv.rep_id = public.fn_current_app_user_id()
        AND public.fn_plan_editable(p.id)
    )
  );

-- =============================================================================
-- visit_status_history — readable, never writable by hand
-- =============================================================================
CREATE POLICY visit_status_history_select ON public.visit_status_history
  FOR SELECT TO authenticated
  USING (
    public.fn_is_manager()
    OR EXISTS (
      SELECT 1 FROM public.planned_visit pv
      WHERE pv.id = planned_visit_id
        AND pv.rep_id = public.fn_current_app_user_id()
    )
  );

CREATE OR REPLACE FUNCTION public.fn_visit_status_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'visit_status_history is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_visit_status_history_no_update
  BEFORE UPDATE ON public.visit_status_history
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_status_history_append_only();

CREATE TRIGGER trg_visit_status_history_no_delete
  BEFORE DELETE ON public.visit_status_history
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_status_history_append_only();

-- =============================================================================
-- Grants
--
-- DELETE is granted on the two child list tables ONLY. Removing a doctor from
-- a plan you are still drafting is editing, not destroying a record. Plans and
-- planned visits themselves can never be deleted by anyone.
-- =============================================================================
GRANT SELECT, INSERT, UPDATE ON
  public.weekly_plan,
  public.planned_visit
TO authenticated;

GRANT SELECT, INSERT, DELETE ON
  public.planned_visit_doctor,
  public.planned_visit_brand
TO authenticated;

GRANT SELECT ON public.visit_status_history TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.visit_status_history FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.fn_plan_deadline(date),
  public.fn_plan_editable(uuid),
  public.fn_get_or_create_weekly_plan(date),
  public.fn_submit_plan(uuid),
  public.fn_review_plan(uuid, boolean, text),
  public.fn_route_for_date(date),
  public.fn_week_summary(date)
TO authenticated;

-- Lifecycle advancement is a scheduled job, not a user action.
REVOKE EXECUTE ON FUNCTION public.fn_advance_plan_lifecycle() FROM anon, authenticated;
