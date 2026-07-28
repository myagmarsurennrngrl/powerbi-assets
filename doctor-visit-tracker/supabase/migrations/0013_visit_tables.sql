-- =============================================================================
-- 0013_visit_tables.sql
-- Doctor Visit Tracker — Phase 3
--
-- visit        — the record of a meeting that actually happened.
-- visit_event  — the immutable check-in / check-out evidence.
--
-- THIS IS THE EVIDENCE LAYER. Everything the company will later rely on to say
-- "this representative was at this clinic at this time" lives here, so the
-- rules are deliberately strict:
--
--   * server_ts comes from the SERVER clock. A phone's clock is stored too,
--     but only so that a discrepancy becomes visible.
--   * distance_from_clinic_m is computed BY THE SERVER from the submitted
--     coordinates. A distance sent by a phone is ignored entirely.
--   * visit_event has no UPDATE and no DELETE — for anyone.
--   * once a visit is completed it cannot be edited; corrections are separate
--     addendum rows (Phase 4).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- visit
-- -----------------------------------------------------------------------------
CREATE TABLE public.visit (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Generated on the device before the request is sent. Replaying a queued
  -- check-in is then a no-op rather than a duplicate visit. This is what makes
  -- the Phase 7 offline queue safe on a flaky connection.
  client_uuid          uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  -- NULL means an UNPLANNED visit. The KPI counts those separately and never
  -- mixes them into planned completion (docs/05 §2).
  planned_visit_id     uuid UNIQUE REFERENCES public.planned_visit (id) ON DELETE RESTRICT,

  rep_id               uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,
  clinic_id            uuid NOT NULL REFERENCES public.clinic (id)   ON DELETE RESTRICT,

  -- Derived from the server check-in time in Asia/Ulaanbaatar, never from the
  -- device, or an 01:00 visit would be filed under the wrong day.
  visit_date           date NOT NULL,

  status               public.visit_status NOT NULL DEFAULT 'in_progress',

  started_at_server    timestamptz NOT NULL,
  completed_at_server  timestamptz,

  -- Stored generated column: cheap to query, impossible to disagree with its
  -- inputs.
  duration_seconds     integer GENERATED ALWAYS AS (
                         CASE
                           WHEN completed_at_server IS NULL THEN NULL
                           ELSE floor(EXTRACT(EPOCH FROM (completed_at_server - started_at_server)))::integer
                         END
                       ) STORED,

  -- ---------------------------------------------------------------------------
  -- Documentation fields. Nullable here; Phase 4 adds the completion form and
  -- the validation that makes them required before a visit may be completed.
  -- ---------------------------------------------------------------------------
  meeting_status       public.meeting_status,
  outcome              public.visit_outcome,
  interest_level       public.interest_level,
  doctor_feedback      text,
  rep_summary          text,
  next_action          text,
  samples_provided     text,
  materials_provided   text,
  follow_up_required   boolean,
  follow_up_date       date,

  -- True while the representative is still filling things in. A draft is
  -- private to its owner; only non-draft visits appear in doctor history.
  is_draft             boolean NOT NULL DEFAULT true,

  created_source       public.sync_source NOT NULL DEFAULT 'online',
  app_version          text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by           uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT visit_completed_after_started
    CHECK (completed_at_server IS NULL OR completed_at_server >= started_at_server),
  CONSTRAINT visit_follow_up_needs_date
    CHECK (follow_up_required IS NOT TRUE OR follow_up_date IS NOT NULL),
  -- A completed visit must have been checked out of.
  CONSTRAINT visit_completed_needs_checkout
    CHECK (status <> 'completed' OR completed_at_server IS NOT NULL)
);

-- Only ONE visit may be in progress per representative at a time. This is
-- acceptance criterion "duplicate active visit prevention", and a partial
-- unique index enforces it without a race window — two concurrent check-ins
-- cannot both win.
CREATE UNIQUE INDEX visit_one_in_progress_per_rep
  ON public.visit (rep_id)
  WHERE status = 'in_progress';

CREATE INDEX visit_rep_date_idx    ON public.visit (rep_id, visit_date DESC);
CREATE INDEX visit_clinic_idx      ON public.visit (clinic_id, visit_date DESC);
CREATE INDEX visit_status_idx      ON public.visit (status);
CREATE INDEX visit_planned_idx     ON public.visit (planned_visit_id);
CREATE INDEX visit_submitted_idx   ON public.visit (visit_date DESC) WHERE is_draft = false;

COMMENT ON TABLE public.visit IS
  'A meeting that actually happened. Immutable once completed — corrections go in visit_addendum.';
COMMENT ON COLUMN public.visit.planned_visit_id IS
  'NULL = unplanned visit. Reported separately and never mixed into the planned-completion KPI.';
COMMENT ON COLUMN public.visit.started_at_server IS
  'Server clock at check-in. Authoritative. The device clock is kept in visit_event.device_ts for comparison only.';

-- -----------------------------------------------------------------------------
-- visit_doctor / visit_brand / visit_product
-- Who was ACTUALLY met and what was ACTUALLY discussed, as opposed to what was
-- planned. Populated by the Phase 4 completion form.
-- -----------------------------------------------------------------------------
CREATE TABLE public.visit_doctor (
  visit_id   uuid NOT NULL REFERENCES public.visit (id)  ON DELETE RESTRICT,
  doctor_id  uuid NOT NULL REFERENCES public.doctor (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visit_id, doctor_id)
);
CREATE INDEX visit_doctor_doctor_idx ON public.visit_doctor (doctor_id);

CREATE TABLE public.visit_brand (
  visit_id   uuid NOT NULL REFERENCES public.visit (id) ON DELETE RESTRICT,
  brand_id   uuid NOT NULL REFERENCES public.brand (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visit_id, brand_id)
);
CREATE INDEX visit_brand_brand_idx ON public.visit_brand (brand_id);

CREATE TABLE public.visit_product (
  visit_id   uuid NOT NULL REFERENCES public.visit (id)   ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.product (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visit_id, product_id)
);
CREATE INDEX visit_product_product_idx ON public.visit_product (product_id);

-- -----------------------------------------------------------------------------
-- visit_event — the check-in / check-out evidence record
--
-- Append-only. No UPDATE, no DELETE, for anyone, ever.
-- -----------------------------------------------------------------------------
CREATE TABLE public.visit_event (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid              uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  visit_id                 uuid NOT NULL REFERENCES public.visit (id) ON DELETE RESTRICT,
  event_type               public.visit_event_type NOT NULL,

  -- Set by the server. Never accepted from a client.
  server_ts                timestamptz NOT NULL DEFAULT now(),
  -- What the phone believed the time was. Stored for comparison, not trusted.
  device_ts                timestamptz,

  latitude                 numeric(9,6) NOT NULL,
  longitude                numeric(9,6) NOT NULL,
  gps_accuracy_m           numeric(7,2),

  -- Recomputed by the server with fn_haversine_metres. A client-supplied
  -- distance is discarded (docs/07-risks.md G4).
  distance_from_clinic_m   numeric(10,2) NOT NULL,
  -- Snapshot of the rule in force at the time, so a later admin change to the
  -- clinic radius cannot retroactively make a past check-in look invalid.
  clinic_radius_m_at_event integer NOT NULL,

  clinic_id                uuid NOT NULL REFERENCES public.clinic (id) ON DELETE RESTRICT,
  app_user_id              uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,
  planned_visit_id         uuid REFERENCES public.planned_visit (id) ON DELETE RESTRICT,

  app_version              text,
  source                   public.sync_source NOT NULL DEFAULT 'online',

  -- Android reports when a reading came from a mock-location app. We cannot
  -- reliably prevent spoofing, so we make it visible and auditable instead.
  is_mocked_location       boolean NOT NULL DEFAULT false,

  -- Positive when the device clock runs ahead of the server.
  clock_drift_seconds      integer GENERATED ALWAYS AS (
                             CASE
                               WHEN device_ts IS NULL THEN NULL
                               ELSE floor(EXTRACT(EPOCH FROM (device_ts - server_ts)))::integer
                             END
                           ) STORED,

  -- True when the check-in happened outside the clinic radius. Only reachable
  -- through an approved exception path; surfaced to managers for review.
  outside_geofence         boolean NOT NULL DEFAULT false,

  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT visit_event_one_per_type UNIQUE (visit_id, event_type),
  CONSTRAINT visit_event_latitude_range  CHECK (latitude  BETWEEN -90  AND 90),
  CONSTRAINT visit_event_longitude_range CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT visit_event_not_null_island CHECK (NOT (latitude = 0 AND longitude = 0)),
  CONSTRAINT visit_event_distance_non_negative CHECK (distance_from_clinic_m >= 0)
);

CREATE INDEX visit_event_visit_idx ON public.visit_event (visit_id, event_type);
CREATE INDEX visit_event_user_idx  ON public.visit_event (app_user_id, server_ts DESC);
-- The manager's "started outside expected conditions" review list.
CREATE INDEX visit_event_review_idx ON public.visit_event (server_ts DESC)
  WHERE outside_geofence OR is_mocked_location OR source = 'offline';

COMMENT ON TABLE public.visit_event IS
  'Immutable check-in/check-out evidence. Append-only: UPDATE and DELETE are revoked and blocked by trigger.';
COMMENT ON COLUMN public.visit_event.clinic_radius_m_at_event IS
  'The radius in force when the event happened. Snapshotted so a later admin change cannot retroactively invalidate a past check-in.';

-- =============================================================================
-- Immutability
-- =============================================================================

-- visit_event: append-only, no exceptions.
CREATE OR REPLACE FUNCTION public.fn_visit_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'visit_event is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_visit_event_no_update
  BEFORE UPDATE ON public.visit_event
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_event_append_only();

CREATE TRIGGER trg_visit_event_no_delete
  BEFORE DELETE ON public.visit_event
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_event_append_only();

-- -----------------------------------------------------------------------------
-- visit: certain columns are never rewritable, and a COMPLETED visit is frozen.
--
-- ACCEPTANCE CRITERION 9: completed visit records cannot be edited.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_visit_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Evidence columns are fixed at check-in, whatever the status.
  IF NEW.started_at_server IS DISTINCT FROM OLD.started_at_server
     OR NEW.rep_id           IS DISTINCT FROM OLD.rep_id
     OR NEW.clinic_id        IS DISTINCT FROM OLD.clinic_id
     OR NEW.planned_visit_id IS DISTINCT FROM OLD.planned_visit_id
     OR NEW.client_uuid      IS DISTINCT FROM OLD.client_uuid
     OR NEW.visit_date       IS DISTINCT FROM OLD.visit_date
  THEN
    RAISE EXCEPTION
      'check-in facts of a visit cannot be changed (started_at_server, rep, clinic, planned visit, date)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A submitted, completed visit is frozen entirely.
  IF OLD.status = 'completed' AND OLD.is_draft = false THEN
    RAISE EXCEPTION
      'completed visits are immutable; record a correction in visit_addendum instead'
      USING ERRCODE   = 'insufficient_privilege',
            HINT      = 'Use fn_add_addendum() (Phase 4).';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_visit_immutability
  BEFORE UPDATE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_enforce_immutability();

CREATE OR REPLACE FUNCTION public.fn_visit_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'visits are never deleted' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_visit_no_delete
  BEFORE DELETE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_no_delete();

-- -----------------------------------------------------------------------------
-- Timestamps and status history
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_visit_touch
  BEFORE INSERT OR UPDATE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_audit_columns();

-- visit_status_history was created in Phase 2 keyed on planned_visit_id.
-- A visit needs its own link; both are nullable because a visit may be
-- unplanned and a planned visit may never become a visit.
ALTER TABLE public.visit_status_history
  ADD COLUMN visit_id uuid REFERENCES public.visit (id) ON DELETE RESTRICT;

CREATE INDEX visit_status_history_visit_id_idx ON public.visit_status_history (visit_id, changed_at);

CREATE OR REPLACE FUNCTION public.fn_visit_track_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.visit_status_history
      (visit_id, planned_visit_id, from_status, to_status, changed_by, note)
    VALUES (NEW.id, NEW.planned_visit_id, NULL, NEW.status,
            public.fn_current_app_user_id(), 'checked in');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.visit_status_history
      (visit_id, planned_visit_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NEW.planned_visit_id, OLD.status, NEW.status,
            public.fn_current_app_user_id());
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_visit_track_status
  AFTER INSERT OR UPDATE OF status ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_track_status();
