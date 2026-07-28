-- =============================================================================
-- 0024_unplanned_visits.sql
-- Doctor Visit Tracker — Phase 6
--
-- Starting a visit that was never planned.
--
-- The schema has supported unplanned visits since Phase 3 (visit.planned_visit_id
-- is nullable) and the KPI has counted them separately since Phase 5, but there
-- was no way to create one from the app. That gap mattered: a representative who
-- is at a clinic anyway and gets ten minutes with a doctor either records nothing
-- or invents a planned visit after the fact. Both are worse than the truth.
--
-- WHAT IS THE SAME AS A PLANNED CHECK-IN
--   * the location rules are identical — real fix, accuracy within threshold,
--     inside the clinic's own radius, server-computed distance;
--   * one visit in progress at a time;
--   * the same immutable visit_event evidence row;
--   * idempotent by client_uuid, so the Phase 7 offline queue works unchanged.
--
-- WHAT IS DIFFERENT
--   * there is no planned_visit to own, so ownership is simply "the caller";
--   * there is no planned date to check against today;
--   * a REASON is required. An unplanned visit is a deviation from an approved
--     plan, and the manager reviewing it later needs to know why it happened.
--     It is stored as the visit's objective, so it appears everywhere the
--     planned objective does.
--
-- WHAT IT DOES NOT DO
--   * it never touches the KPI denominator. docs/05 §2 is explicit: unplanned
--     visits are reported separately and never mixed into planned completion.
--     Otherwise the way to a good score would be to plan two visits and walk
--     into twenty.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fn_unplanned_start_eligibility — the same conditions, minus the plan
--
-- Returned as individual flags, like the planned version, so the screen can say
-- exactly what is wrong instead of a single unhelpful "cannot start".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_unplanned_start_eligibility(
  p_clinic_id  uuid,
  p_latitude   double precision DEFAULT NULL,
  p_longitude  double precision DEFAULT NULL,
  p_accuracy_m double precision DEFAULT NULL
)
RETURNS TABLE (
  can_start            boolean,
  is_rep               boolean,
  clinic_is_active     boolean,
  no_other_in_progress boolean,
  has_location         boolean,
  accuracy_ok          boolean,
  within_radius        boolean,
  distance_m           numeric,
  radius_m             integer,
  accuracy_threshold_m integer,
  already_planned_here boolean,
  blocking_reason      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me        uuid := public.fn_current_app_user_id();
  v_clinic    public.clinic;
  v_threshold integer := public.fn_setting_int('gps_accuracy_threshold_m');
  v_distance  numeric;
BEGIN
  SELECT * INTO v_clinic
  FROM public.clinic
  WHERE id = p_clinic_id AND deleted_at IS NULL;

  IF v_clinic.id IS NULL THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false,
                        NULL::numeric, NULL::integer, v_threshold, false,
                        'not_found'::text;
    RETURN;
  END IF;

  -- Only representatives record visits. A manager's job here is to review them.
  is_rep := public.fn_is_rep();

  clinic_is_active := v_clinic.is_active;

  no_other_in_progress := NOT EXISTS (
    SELECT 1 FROM public.visit v
    WHERE v.rep_id = v_me AND v.status = 'in_progress'
  );

  has_location := (
    p_latitude IS NOT NULL AND p_longitude IS NOT NULL
    AND p_latitude BETWEEN -90 AND 90
    AND p_longitude BETWEEN -180 AND 180
    AND NOT (p_latitude = 0 AND p_longitude = 0)
  );

  accuracy_ok := (has_location AND p_accuracy_m IS NOT NULL AND p_accuracy_m <= v_threshold);

  IF has_location THEN
    v_distance := round(
      public.fn_haversine_metres(
        p_latitude, p_longitude,
        v_clinic.latitude::double precision, v_clinic.longitude::double precision
      )::numeric, 2);
    within_radius := (v_distance <= v_clinic.geofence_radius_m);
  ELSE
    v_distance := NULL;
    within_radius := false;
  END IF;

  -- Informational, never blocking: if today's plan already has this clinic, the
  -- representative almost certainly wants that stop rather than a new unplanned
  -- visit — which would leave the planned one looking missed.
  already_planned_here := EXISTS (
    SELECT 1 FROM public.planned_visit pv
    WHERE pv.rep_id = v_me
      AND pv.clinic_id = p_clinic_id
      AND pv.planned_date = public.fn_local_date()
      AND pv.status = 'planned'
  );

  distance_m           := v_distance;
  radius_m             := v_clinic.geofence_radius_m;
  accuracy_threshold_m := v_threshold;

  can_start := is_rep AND clinic_is_active AND no_other_in_progress
               AND has_location AND accuracy_ok AND within_radius;

  blocking_reason := CASE
    WHEN NOT is_rep               THEN 'not_representative'
    WHEN NOT clinic_is_active     THEN 'clinic_inactive'
    WHEN NOT no_other_in_progress THEN 'other_visit_in_progress'
    WHEN NOT has_location         THEN 'no_location'
    WHEN NOT accuracy_ok          THEN 'poor_accuracy'
    WHEN NOT within_radius        THEN 'outside_radius'
    ELSE NULL
  END;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.fn_unplanned_start_eligibility IS
  'Start conditions for an unplanned visit. already_planned_here is a warning for the app, never a block.';

-- -----------------------------------------------------------------------------
-- fn_start_unplanned_visit
--
-- Deliberately a separate function rather than a nullable argument on
-- fn_start_visit. The two have different preconditions, and a single function
-- where half the checks are skipped depending on one NULL argument is how a
-- geofence quietly stops being enforced.
--
-- There is NO exception path here. An unplanned visit outside the radius is
-- simply not started: unlike a planned visit, nothing is at stake in the KPI,
-- so there is nothing to be excused from.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_start_unplanned_visit(
  p_clinic_id   uuid,
  p_reason      text,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_device_ts   timestamptz DEFAULT NULL,
  p_client_uuid uuid        DEFAULT NULL,
  p_app_version text        DEFAULT NULL,
  p_is_mocked   boolean     DEFAULT false,
  p_source      public.sync_source DEFAULT 'online'
)
RETURNS public.visit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me          uuid := public.fn_current_app_user_id();
  v_eligibility record;
  v_clinic      public.clinic;
  v_visit       public.visit;
  v_reason      text := btrim(COALESCE(p_reason, ''));
  v_client_uuid uuid := COALESCE(p_client_uuid, gen_random_uuid());
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Нэвтрээгүй байна.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotency first, exactly as in fn_start_visit: a retried request must
  -- return the visit it already created, not create a second one.
  SELECT * INTO v_visit FROM public.visit WHERE client_uuid = v_client_uuid;
  IF v_visit.id IS NOT NULL THEN
    RETURN v_visit;
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Төлөвлөгөөнд байхгүй уулзалтын шалтгааныг бичнэ үү.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_eligibility
  FROM public.fn_unplanned_start_eligibility(p_clinic_id, p_latitude, p_longitude, p_accuracy_m);

  IF NOT v_eligibility.can_start THEN
    RAISE EXCEPTION '%',
      CASE v_eligibility.blocking_reason
        WHEN 'not_found' THEN 'Эмнэлэг олдсонгүй.'
        WHEN 'not_representative' THEN 'Зөвхөн эмнэлгийн төлөөлөгч уулзалт бүртгэнэ.'
        WHEN 'clinic_inactive' THEN 'Энэ эмнэлэг идэвхгүй байна.'
        WHEN 'other_visit_in_progress' THEN
          'Танд үргэлжилж буй өөр уулзалт байна. Түүнийг эхлээд дуусгана уу.'
        WHEN 'no_location' THEN
          'Байршил тодорхойлогдоогүй байна. Байршлын зөвшөөрлөө шалгана уу.'
        WHEN 'poor_accuracy' THEN
          format('GPS-ийн нарийвчлал хангалтгүй байна (%s м, шаардлага %s м-ээс бага).',
                 COALESCE(round(p_accuracy_m::numeric)::text, '?'),
                 v_eligibility.accuracy_threshold_m)
        WHEN 'outside_radius' THEN
          format('Та эмнэлгээс %s м зайд байна. Зөвшөөрөгдөх зай %s м.',
                 round(v_eligibility.distance_m), v_eligibility.radius_m)
        ELSE 'Уулзалт эхлүүлэх боломжгүй байна.'
      END
      USING ERRCODE = 'check_violation',
            DETAIL  = COALESCE(v_eligibility.blocking_reason, 'unknown');
  END IF;

  SELECT * INTO v_clinic FROM public.clinic WHERE id = p_clinic_id;

  INSERT INTO public.visit
    (client_uuid, planned_visit_id, rep_id, clinic_id, visit_date,
     status, started_at_server, objective, is_draft, created_source, app_version)
  VALUES
    (v_client_uuid, NULL, v_me, p_clinic_id, public.fn_local_date(),
     'in_progress', now(), v_reason, true, p_source, p_app_version)
  RETURNING * INTO v_visit;

  INSERT INTO public.visit_event
    (visit_id, event_type, device_ts, latitude, longitude, gps_accuracy_m,
     distance_from_clinic_m, clinic_radius_m_at_event, clinic_id, app_user_id,
     planned_visit_id, app_version, source, is_mocked_location, outside_geofence)
  VALUES
    (v_visit.id, 'check_in', p_device_ts, p_latitude, p_longitude, p_accuracy_m,
     v_eligibility.distance_m, v_clinic.geofence_radius_m, v_clinic.id, v_me,
     NULL, p_app_version, p_source, COALESCE(p_is_mocked, false), false);

  PERFORM public.fn_audit('visit_started', 'visit', v_visit.id, NULL,
                          jsonb_build_object(
                            'planned_visit_id', NULL,
                            'unplanned', true,
                            'clinic_id', p_clinic_id,
                            'reason', v_reason,
                            'distance_m', v_eligibility.distance_m,
                            'accuracy_m', p_accuracy_m,
                            'mocked', COALESCE(p_is_mocked, false),
                            'source', p_source),
                          'unplanned visit', p_app_version);

  RETURN v_visit;
END;
$$;

COMMENT ON FUNCTION public.fn_start_unplanned_visit IS
  'Check in at a clinic with no planned visit. Same location rules as a planned check-in; requires a reason; never affects the KPI denominator.';

-- -----------------------------------------------------------------------------
-- fn_nearby_clinics — which clinic am I standing in?
--
-- Sorted by distance so the representative does not scroll a list of fifteen
-- clinics while holding the door open. Returns every live clinic with its
-- distance rather than only the close ones, because a wrong coordinate in the
-- master data is exactly the case where the nearest clinic is not "near".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nearby_clinics(
  p_latitude  double precision,
  p_longitude double precision,
  p_limit     integer DEFAULT 10
)
RETURNS TABLE (
  clinic_id    uuid,
  clinic_name  text,
  district     text,
  distance_m   numeric,
  radius_m     integer,
  within_radius boolean
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    c.id,
    c.name,
    c.district,
    round(public.fn_haversine_metres(
      p_latitude, p_longitude,
      c.latitude::double precision, c.longitude::double precision)::numeric, 0) AS distance_m,
    c.geofence_radius_m,
    public.fn_haversine_metres(
      p_latitude, p_longitude,
      c.latitude::double precision, c.longitude::double precision) <= c.geofence_radius_m
  FROM public.clinic c
  WHERE c.deleted_at IS NULL
    AND c.is_active
    AND public.fn_current_app_user_id() IS NOT NULL
    AND p_latitude IS NOT NULL
    AND p_longitude IS NOT NULL
  ORDER BY distance_m
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
$$;

-- -----------------------------------------------------------------------------
-- fn_active_visit — one-line fix for unplanned visits
--
-- The original (0014) read the objective only from the planned visit, which is
-- correct when there is one. An unplanned visit keeps its reason on the visit
-- row itself, so the active-visit screen showed a blank objective. The visit's
-- own value wins where it exists; a planned visit without one still falls back
-- to the plan.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_active_visit()
RETURNS TABLE (
  visit_id            uuid,
  planned_visit_id    uuid,
  clinic_id           uuid,
  clinic_name         text,
  clinic_address      text,
  started_at_server   timestamptz,
  completed_at_server timestamptz,
  objective           text,
  doctor_names        text[],
  brand_names         text[],
  awaiting_report     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    v.id,
    v.planned_visit_id,
    c.id,
    c.name,
    c.address,
    v.started_at_server,
    v.completed_at_server,
    COALESCE(v.objective, pv.objective, ''),
    COALESCE(
      (SELECT array_agg(d.full_name ORDER BY d.full_name)
         FROM public.planned_visit_doctor pvd
         JOIN public.doctor d ON d.id = pvd.doctor_id
        WHERE pvd.planned_visit_id = v.planned_visit_id),
      ARRAY[]::text[]),
    COALESCE(
      (SELECT array_agg(DISTINCT b.name)
         FROM public.planned_visit_brand pvb
         JOIN public.brand b ON b.id = pvb.brand_id
        WHERE pvb.planned_visit_id = v.planned_visit_id),
      ARRAY[]::text[]),
    (v.completed_at_server IS NOT NULL)
  FROM public.visit v
  JOIN public.clinic c ON c.id = v.clinic_id
  LEFT JOIN public.planned_visit pv ON pv.id = v.planned_visit_id
  WHERE v.rep_id = public.fn_current_app_user_id()
    AND v.status = 'in_progress'
  ORDER BY v.started_at_server DESC
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  public.fn_unplanned_start_eligibility(uuid, double precision, double precision, double precision),
  public.fn_start_unplanned_visit(uuid, text, double precision, double precision, double precision,
                                  timestamptz, uuid, text, boolean, public.sync_source),
  public.fn_nearby_clinics(double precision, double precision, integer)
TO authenticated;
