-- =============================================================================
-- 0018_exceptions.sql
-- Doctor Visit Tracker — Phase 5
--
-- The exception workflow: a representative explains why a planned visit could
-- not happen as planned, and a MANAGER decides whether it counts against them.
--
-- This is the pressure valve for every honest failure the geofence cannot tell
-- apart from a dishonest one: wrong coordinates in master data, no GPS inside
-- a concrete hospital, a clinic that closed early, illness. Without it the
-- system punishes people for things outside their control, and they stop
-- trusting it.
--
-- THE ONE RULE THAT MATTERS: a representative can never approve their own
-- exception. Enforced three times over — a CHECK constraint, a guard inside
-- the review function, and row-level security.
-- =============================================================================

CREATE TABLE public.visit_exception (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid           uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  planned_visit_id      uuid NOT NULL REFERENCES public.planned_visit (id) ON DELETE RESTRICT,
  visit_id              uuid REFERENCES public.visit (id) ON DELETE RESTRICT,
  rep_id                uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,

  reason_category       public.exception_reason NOT NULL,
  explanation           text NOT NULL,
  attachment_path       text,

  requested_at_server   timestamptz NOT NULL DEFAULT now(),
  device_ts             timestamptz,

  -- Location is OPTIONAL here, unlike check-in. Someone reporting sick leave
  -- from home has no business sending their coordinates, and demanding them
  -- would be exactly the surveillance this project promises not to do.
  request_latitude      numeric(9,6),
  request_longitude     numeric(9,6),
  request_accuracy_m    numeric(7,2),
  -- When the rep is at the clinic but blocked, this is the evidence that
  -- matters: how far the phone thought they were.
  distance_from_clinic_m numeric(10,2),

  status                public.exception_status NOT NULL DEFAULT 'pending',
  manager_comment       text,
  approved_by           uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  approval_ts           timestamptz,

  source                public.sync_source NOT NULL DEFAULT 'online',
  app_version           text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT visit_exception_explanation_not_blank CHECK (btrim(explanation) <> ''),
  -- Nobody approves their own exception. Ever.
  CONSTRAINT visit_exception_no_self_approval CHECK (approved_by IS DISTINCT FROM rep_id),
  -- A decision must have a decider and a time.
  CONSTRAINT visit_exception_decision_complete
    CHECK (status = 'pending' OR (approved_by IS NOT NULL AND approval_ts IS NOT NULL)),
  -- A rejection must say why; otherwise the rep cannot act on it.
  CONSTRAINT visit_exception_rejection_has_comment
    CHECK (status <> 'rejected' OR btrim(COALESCE(manager_comment, '')) <> ''),
  CONSTRAINT visit_exception_coords_paired
    CHECK ((request_latitude IS NULL) = (request_longitude IS NULL))
);

CREATE INDEX visit_exception_pending_idx ON public.visit_exception (requested_at_server)
  WHERE status = 'pending';
CREATE INDEX visit_exception_rep_idx     ON public.visit_exception (rep_id, requested_at_server DESC);
CREATE INDEX visit_exception_visit_idx   ON public.visit_exception (planned_visit_id);

-- One open request per planned visit: a queue of duplicates helps nobody.
CREATE UNIQUE INDEX visit_exception_one_pending_per_visit
  ON public.visit_exception (planned_visit_id)
  WHERE status = 'pending';

COMMENT ON TABLE public.visit_exception IS
  'A representative explains why a planned visit could not happen. Only a manager decides whether it affects the KPI.';

-- visit_exception records WHO decided in approved_by, so a second
-- "last modified by" column would be redundant and could disagree with it.
-- This table therefore needs a trigger that touches only the timestamp.
CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_visit_exception_touch
  BEFORE UPDATE ON public.visit_exception
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Does an approved exception remove the visit from the KPI denominator?
--
-- DEVIATION FROM docs/02, recorded deliberately. That document specified a
-- GENERATED column `excludes_from_kpi`. A generated column cannot read another
-- table, and the excluding reason set is CONFIGURATION living in
-- kpi_rule_version.config — which is the whole point of versioning the rules.
-- A generated column would therefore freeze one answer while the KPI used
-- another, and the two would silently disagree.
--
-- So the decision is a function of (status, reason, rule config), evaluated
-- with the rule version in force for the period being reported.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_exception_excludes_from_kpi(
  p_status public.exception_status,
  p_reason public.exception_reason,
  p_config jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- COALESCE, not a bare comparison: a visit with NO exception passes NULLs in
  -- here, and NULL must mean "not excused" rather than poisoning every
  -- downstream boolean. See the note in fn_kpi_visit_classification.
  SELECT COALESCE(
    p_status = 'approved'
      AND p_reason::text IN (
            SELECT jsonb_array_elements_text(
              COALESCE(p_config -> 'excluding_exception_reasons', '[]'::jsonb))
          ),
    false);
$$;

COMMENT ON FUNCTION public.fn_exception_excludes_from_kpi IS
  'Whether an approved exception removes its visit from the KPI denominator, per the rule version in force.';

-- =============================================================================
-- Requesting an exception
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_request_exception(
  p_planned_visit_id uuid,
  p_reason           public.exception_reason,
  p_explanation      text,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_accuracy_m       double precision DEFAULT NULL,
  p_attachment_path  text        DEFAULT NULL,
  p_device_ts        timestamptz DEFAULT NULL,
  p_client_uuid      uuid        DEFAULT NULL,
  p_app_version      text        DEFAULT NULL,
  p_source           public.sync_source DEFAULT 'online'
)
RETURNS public.visit_exception
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me          uuid := public.fn_current_app_user_id();
  v_pv          public.planned_visit;
  v_clinic      public.clinic;
  v_existing    public.visit_exception;
  v_distance    numeric;
  v_client_uuid uuid := COALESCE(p_client_uuid, gen_random_uuid());
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Нэвтрээгүй байна.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent, for the offline queue.
  SELECT * INTO v_existing FROM public.visit_exception WHERE client_uuid = v_client_uuid;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_pv FROM public.planned_visit WHERE id = p_planned_visit_id;
  IF v_pv.id IS NULL THEN
    RAISE EXCEPTION 'Уулзалт олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_pv.rep_id <> v_me THEN
    RAISE EXCEPTION 'Энэ уулзалт танд хамааралгүй байна.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF btrim(COALESCE(p_explanation, '')) = '' THEN
    RAISE EXCEPTION 'Тайлбараа бичнэ үү.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.visit_exception
              WHERE planned_visit_id = p_planned_visit_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Энэ уулзалтад хүлээгдэж буй хүсэлт аль хэдийн байна.'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- A completed visit has already happened; there is nothing to excuse.
  IF v_pv.status = 'completed' THEN
    RAISE EXCEPTION 'Дууссан уулзалтад чөлөөлөх хүсэлт илгээх боломжгүй.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- If coordinates were offered, record how far away they actually were —
  -- the single most useful number for a manager judging a GPS complaint.
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    SELECT * INTO v_clinic FROM public.clinic WHERE id = v_pv.clinic_id;
    v_distance := round(
      public.fn_haversine_metres(
        p_latitude, p_longitude,
        v_clinic.latitude::double precision, v_clinic.longitude::double precision
      )::numeric, 2);
  END IF;

  INSERT INTO public.visit_exception (
    client_uuid, planned_visit_id, rep_id, reason_category, explanation,
    attachment_path, device_ts, request_latitude, request_longitude,
    request_accuracy_m, distance_from_clinic_m, source, app_version
  ) VALUES (
    v_client_uuid, p_planned_visit_id, v_me, p_reason, p_explanation,
    p_attachment_path, p_device_ts, p_latitude, p_longitude,
    p_accuracy_m, v_distance, p_source, p_app_version
  )
  RETURNING * INTO v_existing;

  -- The visit is now awaiting a decision, which is visibly different from
  -- both "still planned" and "cancelled".
  IF v_pv.status = 'planned' THEN
    UPDATE public.planned_visit
       SET status = 'cancellation_requested'
     WHERE id = p_planned_visit_id;
  END IF;

  PERFORM public.fn_audit('exception_requested', 'visit_exception', v_existing.id, NULL,
                          jsonb_build_object('planned_visit_id', p_planned_visit_id,
                                             'reason', p_reason,
                                             'distance_m', v_distance));

  RETURN v_existing;
END;
$$;

-- =============================================================================
-- Reviewing an exception — managers only, never your own
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_review_exception(
  p_exception_id uuid,
  p_approve      boolean,
  p_comment      text DEFAULT NULL
)
RETURNS public.visit_exception
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me        public.app_user;
  v_exception public.visit_exception;
BEGIN
  v_me := public.fn_current_app_user();

  IF NOT public.fn_is_manager() THEN
    RAISE EXCEPTION 'Зөвхөн менежер хүсэлтийг шийдвэрлэнэ.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_exception FROM public.visit_exception WHERE id = p_exception_id;
  IF v_exception.id IS NULL THEN
    RAISE EXCEPTION 'Хүсэлт олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  -- THE separation-of-duty rule. A manager may file their own exception like
  -- anyone else, but somebody else has to decide it.
  IF v_exception.rep_id = v_me.id THEN
    RAISE EXCEPTION 'Өөрийн хүсэлтийг өөрөө шийдвэрлэх боломжгүй.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_exception.status <> 'pending' THEN
    RAISE EXCEPTION 'Энэ хүсэлт аль хэдийн шийдвэрлэгдсэн байна (%).', v_exception.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT p_approve AND btrim(COALESCE(p_comment, '')) = '' THEN
    RAISE EXCEPTION 'Татгалзах шалтгаанаа бичнэ үү.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.visit_exception
     SET status          = (CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END)::public.exception_status,
         manager_comment = p_comment,
         approved_by     = v_me.id,
         approval_ts     = now()
   WHERE id = p_exception_id
  RETURNING * INTO v_exception;

  -- Approved   -> the visit is officially cancelled with approval.
  -- Rejected   -> it becomes an unapproved cancellation, which DOES count
  --               against the KPI. The rep is told why.
  UPDATE public.planned_visit
     SET status = (CASE WHEN p_approve THEN 'cancelled_approved'
                        ELSE 'cancelled_unapproved' END)::public.visit_status
   WHERE id = v_exception.planned_visit_id
     AND status IN ('cancellation_requested', 'planned', 'missed');

  PERFORM public.fn_audit('exception_reviewed', 'visit_exception', p_exception_id, NULL,
                          jsonb_build_object('approved', p_approve,
                                             'reason', v_exception.reason_category,
                                             'comment', p_comment));

  RETURN v_exception;
END;
$$;

-- -----------------------------------------------------------------------------
-- The manager's pending queue, with the context needed to decide.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pending_exceptions()
RETURNS TABLE (
  exception_id        uuid,
  planned_visit_id    uuid,
  rep_id              uuid,
  rep_name            text,
  clinic_name         text,
  doctor_names        text[],
  planned_date        date,
  reason_category     public.exception_reason,
  explanation         text,
  requested_at_server timestamptz,
  distance_from_clinic_m numeric,
  clinic_radius_m     integer,
  accuracy_m          numeric,
  has_attachment      boolean,
  excludes_from_kpi_if_approved boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    e.id, e.planned_visit_id, e.rep_id, u.full_name, c.name,
    COALESCE((SELECT array_agg(d.full_name ORDER BY d.full_name)
                FROM public.planned_visit_doctor pvd
                JOIN public.doctor d ON d.id = pvd.doctor_id
               WHERE pvd.planned_visit_id = e.planned_visit_id), ARRAY[]::text[]),
    pv.planned_date,
    e.reason_category,
    e.explanation,
    e.requested_at_server,
    e.distance_from_clinic_m,
    c.geofence_radius_m,
    e.request_accuracy_m,
    (e.attachment_path IS NOT NULL),
    -- Shown BEFORE the manager decides, so the KPI consequence of approving
    -- is never a surprise.
    public.fn_exception_excludes_from_kpi(
      'approved'::public.exception_status,
      e.reason_category,
      (SELECT config FROM public.kpi_rule_version
        WHERE effective_to IS NULL ORDER BY version_no DESC LIMIT 1))
  FROM public.visit_exception e
  JOIN public.planned_visit pv ON pv.id = e.planned_visit_id
  JOIN public.app_user u       ON u.id  = e.rep_id
  JOIN public.clinic   c       ON c.id  = pv.clinic_id
  WHERE e.status = 'pending'
    AND public.fn_is_manager()
  ORDER BY e.requested_at_server;
$$;

-- =============================================================================
-- Row level security
-- =============================================================================
ALTER TABLE public.visit_exception ENABLE ROW LEVEL SECURITY;

CREATE POLICY visit_exception_select ON public.visit_exception
  FOR SELECT TO authenticated
  USING (rep_id = public.fn_current_app_user_id() OR public.fn_is_manager());

-- Written only through the functions above, which enforce ownership and the
-- no-self-approval rule. No direct INSERT or UPDATE policy exists, so a client
-- cannot approve anything by writing the row itself.

GRANT SELECT ON public.visit_exception TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.visit_exception FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.fn_request_exception(uuid, public.exception_reason, text, double precision,
                              double precision, double precision, text, timestamptz,
                              uuid, text, public.sync_source),
  public.fn_review_exception(uuid, boolean, text),
  public.fn_pending_exceptions(),
  public.fn_exception_excludes_from_kpi(public.exception_status, public.exception_reason, jsonb)
TO authenticated;
