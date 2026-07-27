-- =============================================================================
-- 0009_planning_tables.sql
-- Doctor Visit Tracker — Phase 2
--
-- weekly_plan, planned_visit, planned_visit_doctor, planned_visit_brand.
--
-- A weekly plan is a container; the planned visits inside it are what the
-- representative actually does and what the KPI counts. One plan per
-- representative per ISO week.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- weekly_plan
-- -----------------------------------------------------------------------------
CREATE TABLE public.weekly_plan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id          uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,

  -- ISO week numbering. Stored explicitly rather than derived, so a plan is
  -- still findable if week arithmetic ever changes.
  iso_year        integer NOT NULL,
  iso_week        integer NOT NULL,
  week_start_date date    NOT NULL,   -- Monday, Asia/Ulaanbaatar
  week_end_date   date    NOT NULL,   -- Sunday

  status          public.plan_status NOT NULL DEFAULT 'draft',

  submitted_at    timestamptz,
  reviewed_by     uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  reviewed_at     timestamptz,
  review_comment  text,
  locked_at       timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT weekly_plan_one_per_rep_week UNIQUE (rep_id, iso_year, iso_week),
  CONSTRAINT weekly_plan_week_range CHECK (iso_week BETWEEN 1 AND 53),
  CONSTRAINT weekly_plan_dates_ordered CHECK (week_end_date = week_start_date + 6),
  -- Monday is ISO day 1.
  CONSTRAINT weekly_plan_starts_monday CHECK (EXTRACT(ISODOW FROM week_start_date) = 1),
  -- A rejection must say why; otherwise the representative cannot act on it.
  CONSTRAINT weekly_plan_rejection_has_comment
    CHECK (status <> 'rejected' OR btrim(COALESCE(review_comment, '')) <> '')
);

CREATE INDEX weekly_plan_rep_idx    ON public.weekly_plan (rep_id, week_start_date DESC);
CREATE INDEX weekly_plan_status_idx ON public.weekly_plan (status) WHERE status IN ('submitted', 'active');
CREATE INDEX weekly_plan_week_idx   ON public.weekly_plan (week_start_date);

COMMENT ON TABLE public.weekly_plan IS
  'One plan per representative per ISO week. Weeks run Monday-Sunday in Asia/Ulaanbaatar.';

-- -----------------------------------------------------------------------------
-- planned_visit
-- -----------------------------------------------------------------------------
CREATE TABLE public.planned_visit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Generated on the device. Replaying a queued create is then a no-op instead
  -- of a duplicate — the foundation of the Phase 7 offline queue.
  client_uuid     uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  weekly_plan_id  uuid NOT NULL REFERENCES public.weekly_plan (id) ON DELETE RESTRICT,

  -- Denormalised from weekly_plan so RLS can authorise a row without a join.
  -- Kept honest by a trigger; it can never disagree with its parent plan.
  rep_id          uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,

  clinic_id       uuid NOT NULL REFERENCES public.clinic (id) ON DELETE RESTRICT,

  planned_date    date    NOT NULL,
  planned_order   integer NOT NULL DEFAULT 1,   -- order within that day
  planned_time    time,                          -- estimated start, optional

  objective       text NOT NULL,

  status          public.visit_status NOT NULL DEFAULT 'planned',

  -- When a manager officially moves a visit to a later date, the original row
  -- is kept and points at the replacement. Both remain visible, and the KPI
  -- rules can tell "moved" apart from "missed".
  rescheduled_to_planned_visit_id uuid REFERENCES public.planned_visit (id) ON DELETE RESTRICT,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT planned_visit_objective_not_blank CHECK (btrim(objective) <> ''),
  CONSTRAINT planned_visit_order_positive CHECK (planned_order BETWEEN 1 AND 50),
  CONSTRAINT planned_visit_not_self_reschedule
    CHECK (rescheduled_to_planned_visit_id IS DISTINCT FROM id)
);

CREATE INDEX planned_visit_rep_date_idx  ON public.planned_visit (rep_id, planned_date, planned_order);
CREATE INDEX planned_visit_plan_idx      ON public.planned_visit (weekly_plan_id);
CREATE INDEX planned_visit_clinic_idx    ON public.planned_visit (clinic_id, planned_date);
CREATE INDEX planned_visit_status_idx    ON public.planned_visit (status, planned_date);

COMMENT ON COLUMN public.planned_visit.rep_id IS
  'Copied from weekly_plan.rep_id by trigger. Present so row-level security can authorise without a join.';
COMMENT ON COLUMN public.planned_visit.rescheduled_to_planned_visit_id IS
  'Set when a manager officially moves this visit. The KPI excludes the original only when the replacement is on a LATER date.';

-- -----------------------------------------------------------------------------
-- planned_visit_doctor — who the representative expects to meet
-- -----------------------------------------------------------------------------
CREATE TABLE public.planned_visit_doctor (
  planned_visit_id uuid NOT NULL REFERENCES public.planned_visit (id) ON DELETE CASCADE,
  doctor_id        uuid NOT NULL REFERENCES public.doctor (id)        ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (planned_visit_id, doctor_id)
);

CREATE INDEX planned_visit_doctor_doctor_idx ON public.planned_visit_doctor (doctor_id);

-- ON DELETE CASCADE is safe here and only here: this is a child list belonging
-- to a plan the representative is still editing. Removing a doctor from a draft
-- plan is normal editing, not deletion of a business record.

-- -----------------------------------------------------------------------------
-- planned_visit_brand — what they intend to discuss
-- -----------------------------------------------------------------------------
CREATE TABLE public.planned_visit_brand (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_visit_id uuid NOT NULL REFERENCES public.planned_visit (id) ON DELETE CASCADE,
  brand_id         uuid NOT NULL REFERENCES public.brand (id)         ON DELETE RESTRICT,
  product_id       uuid REFERENCES public.product (id)                ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- A brand may appear once on its own, and once per specific product.
CREATE UNIQUE INDEX planned_visit_brand_unique
  ON public.planned_visit_brand (planned_visit_id, brand_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX planned_visit_brand_brand_idx ON public.planned_visit_brand (brand_id);

-- -----------------------------------------------------------------------------
-- visit_status_history — every status change, for audit and Power BI
-- -----------------------------------------------------------------------------
CREATE TABLE public.visit_status_history (
  id                bigserial PRIMARY KEY,
  planned_visit_id  uuid REFERENCES public.planned_visit (id) ON DELETE RESTRICT,
  from_status       public.visit_status,
  to_status         public.visit_status NOT NULL,
  changed_by        uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  note              text
);

CREATE INDEX visit_status_history_visit_idx ON public.visit_status_history (planned_visit_id, changed_at);

COMMENT ON TABLE public.visit_status_history IS
  'Append-only status trail. Phase 3 adds a visit_id column when the visit table exists.';

-- -----------------------------------------------------------------------------
-- Shared timestamp triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_weekly_plan_touch
  BEFORE INSERT OR UPDATE ON public.weekly_plan
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_audit_columns();

CREATE TRIGGER trg_planned_visit_touch
  BEFORE INSERT OR UPDATE ON public.planned_visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_audit_columns();
