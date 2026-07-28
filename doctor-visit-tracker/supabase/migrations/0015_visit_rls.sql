-- =============================================================================
-- 0015_visit_rls.sql
-- Doctor Visit Tracker — Phase 3
--
-- Row-level security for the visit tables.
--
-- Two acceptance criteria meet here and pull in opposite directions:
--   #10  another authorised representative CAN read a doctor's visit history
--   #18  a representative's DRAFT stays private until they submit it
--
-- The shared-read policy below satisfies both: submitted visits are visible to
-- every representative, drafts only to their owner.
-- =============================================================================

ALTER TABLE public.visit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_event   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_doctor  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_brand   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_product ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- visit
-- =============================================================================

-- The shared doctor-history policy (docs/03 §2).
CREATE POLICY visit_select ON public.visit
  FOR SELECT TO authenticated
  USING (
    public.fn_is_manager()
    OR rep_id = public.fn_current_app_user_id()
    -- Submitted work is readable by every colleague: that is the whole point
    -- of a shared doctor history. Drafts are not.
    OR is_draft = false
  );

-- Visits are created ONLY by fn_start_visit(), which is SECURITY DEFINER and
-- therefore bypasses this policy. There is deliberately no INSERT policy: a
-- client cannot fabricate a visit with a check-in time and location of its
-- choosing, because it cannot INSERT at all.

-- The owner may edit their own visit while it is still an unsubmitted draft.
-- The immutability trigger (0013) additionally freezes the check-in facts and
-- any completed visit, so this policy governs only the documentation fields.
CREATE POLICY visit_update_own_draft ON public.visit
  FOR UPDATE TO authenticated
  USING (rep_id = public.fn_current_app_user_id() AND is_draft = true)
  WITH CHECK (rep_id = public.fn_current_app_user_id());

-- No DELETE policy, and DELETE is not granted. A trigger blocks it as well.

-- =============================================================================
-- visit_event — readable with its parent visit, writable by nobody
-- =============================================================================
CREATE POLICY visit_event_select ON public.visit_event
  FOR SELECT TO authenticated
  USING (
    public.fn_is_manager()
    OR app_user_id = public.fn_current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM public.visit v
      WHERE v.id = visit_id AND v.is_draft = false
    )
  );

-- No INSERT/UPDATE/DELETE policy at all. Only fn_start_visit and fn_check_out
-- write here, and they are SECURITY DEFINER.

-- =============================================================================
-- visit_doctor / visit_brand / visit_product
-- Authority follows the parent visit.
-- =============================================================================
CREATE POLICY visit_doctor_select ON public.visit_doctor
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND (public.fn_is_manager() OR v.rep_id = public.fn_current_app_user_id() OR v.is_draft = false)
  ));

CREATE POLICY visit_doctor_write ON public.visit_doctor
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND v.rep_id = public.fn_current_app_user_id() AND v.is_draft = true
  ));

CREATE POLICY visit_doctor_delete ON public.visit_doctor
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND v.rep_id = public.fn_current_app_user_id() AND v.is_draft = true
  ));

CREATE POLICY visit_brand_select ON public.visit_brand
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND (public.fn_is_manager() OR v.rep_id = public.fn_current_app_user_id() OR v.is_draft = false)
  ));

CREATE POLICY visit_brand_write ON public.visit_brand
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND v.rep_id = public.fn_current_app_user_id() AND v.is_draft = true
  ));

CREATE POLICY visit_brand_delete ON public.visit_brand
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND v.rep_id = public.fn_current_app_user_id() AND v.is_draft = true
  ));

CREATE POLICY visit_product_select ON public.visit_product
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND (public.fn_is_manager() OR v.rep_id = public.fn_current_app_user_id() OR v.is_draft = false)
  ));

CREATE POLICY visit_product_write ON public.visit_product
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND v.rep_id = public.fn_current_app_user_id() AND v.is_draft = true
  ));

CREATE POLICY visit_product_delete ON public.visit_product
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visit v WHERE v.id = visit_id
      AND v.rep_id = public.fn_current_app_user_id() AND v.is_draft = true
  ));

-- =============================================================================
-- Grants
--
-- Note what is NOT granted: INSERT on visit and any write at all on
-- visit_event. Those go exclusively through the SECURITY DEFINER functions, so
-- a client cannot invent a check-in.
-- =============================================================================
GRANT SELECT, UPDATE ON public.visit TO authenticated;
GRANT SELECT ON public.visit_event TO authenticated;
GRANT SELECT, INSERT, DELETE ON
  public.visit_doctor,
  public.visit_brand,
  public.visit_product
TO authenticated;

REVOKE INSERT, DELETE ON public.visit FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.visit_event FROM anon, authenticated;
