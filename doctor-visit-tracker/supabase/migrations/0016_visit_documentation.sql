-- =============================================================================
-- 0016_visit_documentation.sql
-- Doctor Visit Tracker — Phase 4
--
-- visit.objective   — carried over from the plan, editable while drafting
-- visit_addendum    — the ONLY way to correct a submitted visit
-- follow_up         — the "next action" turned into something trackable
--
-- The governing rule of this phase: a submitted visit is a statement of record.
-- It is never rewritten. A correction is a NEW, attributable row displayed
-- alongside the original, so the history shows both what was said and what was
-- later corrected — never a silent edit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The visit's own objective.
--
-- Prefilled from the plan at check-in, but kept on the visit because an
-- unplanned visit has no plan to inherit from, and because what a meeting
-- turned out to be about is a fact of the meeting, not of the plan.
-- -----------------------------------------------------------------------------
ALTER TABLE public.visit ADD COLUMN objective text;

COMMENT ON COLUMN public.visit.objective IS
  'Prefilled from planned_visit.objective at check-in. Editable while the visit is a draft.';

-- Backfill from the plan so existing seeded visits are complete.
UPDATE public.visit v
   SET objective = pv.objective
  FROM public.planned_visit pv
 WHERE pv.id = v.planned_visit_id
   AND v.objective IS NULL;

-- -----------------------------------------------------------------------------
-- Relax the follow-up constraint so a DRAFT can be half-filled.
--
-- Phase 3 declared `follow_up_required IS NOT TRUE OR follow_up_date IS NOT NULL`
-- unconditionally. That is right for a finished report but wrong for the form:
-- a representative taps «Тийм» for "follow-up needed" and only then picks the
-- date, and the original constraint rejected that intermediate state — making
-- the field impossible to fill in without setting both in a single write.
--
-- Found by tests/db/visitCompletion.test.ts. The rule still holds absolutely at
-- completion: fn_visit_completion_issues() reports `follow_up_date:required`,
-- and fn_complete_visit() refuses to submit without it.
-- -----------------------------------------------------------------------------
ALTER TABLE public.visit DROP CONSTRAINT visit_follow_up_needs_date;

ALTER TABLE public.visit ADD CONSTRAINT visit_follow_up_needs_date
  CHECK (
    status <> 'completed'
    OR follow_up_required IS NOT TRUE
    OR follow_up_date IS NOT NULL
  );

-- =============================================================================
-- visit_addendum — corrections, never overwrites
-- =============================================================================
CREATE TABLE public.visit_addendum (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        uuid NOT NULL REFERENCES public.visit (id) ON DELETE RESTRICT,

  correction_text text NOT NULL,
  reason          text NOT NULL,

  author_id       uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,
  -- Denormalised so the record still reads correctly if the author is later
  -- renamed or deactivated.
  author_email    citext,
  author_role     public.user_role,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT visit_addendum_text_not_blank   CHECK (btrim(correction_text) <> ''),
  CONSTRAINT visit_addendum_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE INDEX visit_addendum_visit_idx ON public.visit_addendum (visit_id, created_at);

COMMENT ON TABLE public.visit_addendum IS
  'Append-only corrections to a submitted visit. The original visit row is never modified.';

-- Append-only, like every other evidence table in this project.
CREATE OR REPLACE FUNCTION public.fn_visit_addendum_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'visit_addendum is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_visit_addendum_no_update
  BEFORE UPDATE ON public.visit_addendum
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_addendum_append_only();

CREATE TRIGGER trg_visit_addendum_no_delete
  BEFORE DELETE ON public.visit_addendum
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_addendum_append_only();

-- =============================================================================
-- follow_up — "next action" made trackable
--
-- Without this, "дараагийн үйлдэл" is a sentence nobody ever reads again. As a
-- row with a due date it becomes a number on the KPI screen (docs/05 metric 13).
-- =============================================================================
CREATE TABLE public.follow_up (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id           uuid NOT NULL REFERENCES public.visit (id)   ON DELETE RESTRICT,
  rep_id             uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,
  doctor_id          uuid REFERENCES public.doctor (id)            ON DELETE RESTRICT,

  due_date           date NOT NULL,
  description        text NOT NULL,
  status             public.follow_up_status NOT NULL DEFAULT 'open',

  -- Set when a later visit satisfies this follow-up.
  completed_visit_id uuid REFERENCES public.visit (id) ON DELETE RESTRICT,
  completed_at       timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by         uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT follow_up_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT follow_up_done_consistent
    CHECK (status <> 'done' OR completed_at IS NOT NULL)
);

CREATE INDEX follow_up_rep_due_idx    ON public.follow_up (rep_id, due_date) WHERE status = 'open';
CREATE INDEX follow_up_visit_idx      ON public.follow_up (visit_id);
CREATE INDEX follow_up_doctor_idx     ON public.follow_up (doctor_id);

CREATE TRIGGER trg_follow_up_touch
  BEFORE INSERT OR UPDATE ON public.follow_up
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_audit_columns();

-- =============================================================================
-- Row level security
-- =============================================================================
ALTER TABLE public.visit_addendum ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up      ENABLE ROW LEVEL SECURITY;

-- An addendum is part of the doctor's history, so it is readable wherever its
-- parent visit is readable.
CREATE POLICY visit_addendum_select ON public.visit_addendum
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visit v
    WHERE v.id = visit_id
      AND (public.fn_is_manager()
           OR v.rep_id = public.fn_current_app_user_id()
           OR v.is_draft = false)
  ));

-- Written only through fn_add_addendum (SECURITY DEFINER), which enforces that
-- the author is a manager or administrator. No direct INSERT policy.

CREATE POLICY follow_up_select ON public.follow_up
  FOR SELECT TO authenticated
  USING (
    public.fn_is_manager()
    OR rep_id = public.fn_current_app_user_id()
    -- A colleague can see an outstanding follow-up on a doctor they also
    -- visit, which is the point of a shared history.
    OR EXISTS (SELECT 1 FROM public.visit v WHERE v.id = visit_id AND v.is_draft = false)
  );

-- The owning representative closes their own follow-ups.
CREATE POLICY follow_up_update ON public.follow_up
  FOR UPDATE TO authenticated
  USING (rep_id = public.fn_current_app_user_id() OR public.fn_is_manager())
  WITH CHECK (rep_id = public.fn_current_app_user_id() OR public.fn_is_manager());

GRANT SELECT ON public.visit_addendum TO authenticated;
GRANT SELECT, UPDATE ON public.follow_up TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.visit_addendum FROM anon, authenticated;
REVOKE INSERT, DELETE ON public.follow_up FROM anon, authenticated;
