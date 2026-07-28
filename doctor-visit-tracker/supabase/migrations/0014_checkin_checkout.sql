-- =============================================================================
-- 0014_checkin_checkout.sql
-- Doctor Visit Tracker — Phase 3
--
-- fn_visit_start_eligibility() — why the button is or is not enabled
-- fn_start_visit()             — the check-in
-- fn_check_out()               — the check-out
--
-- THE CENTRAL RULE OF THIS PROJECT LIVES HERE.
--
-- The mobile app runs the same eligibility logic locally so it can disable a
-- button and explain why. That copy is a courtesy. This one decides. Every
-- condition below is re-evaluated from scratch, server-side, using the server
-- clock and a server-computed distance, at the moment the check-in is
-- attempted. Anyone calling the API directly with curl meets exactly the same
-- eight gates.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Eligibility, as data rather than a boolean.
--
-- Returning the individual reasons lets the app tell a representative standing
-- in a hospital corridor precisely WHICH condition failed — "you are 240 m
-- away, the limit is 150 m" — instead of a dead grey button. That difference
-- decides whether the app gets used or resented.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_visit_start_eligibility(
  p_planned_visit_id uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_accuracy_m       double precision DEFAULT NULL
)
RETURNS TABLE (
  can_start            boolean,
  is_owner             boolean,
  is_today             boolean,
  is_status_planned    boolean,
  no_other_in_progress boolean,
  has_location         boolean,
  accuracy_ok          boolean,
  within_radius        boolean,
  distance_m           numeric,
  radius_m             integer,
  accuracy_threshold_m integer,
  planned_date         date,
  visit_status         public.visit_status,
  blocking_reason      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me        uuid := public.fn_current_app_user_id();
  v_pv        public.planned_visit;
  v_clinic    public.clinic;
  v_threshold integer := public.fn_setting_int('gps_accuracy_threshold_m');
  v_today     date    := public.fn_local_date();
  v_distance  numeric;
BEGIN
  SELECT * INTO v_pv FROM public.planned_visit WHERE id = p_planned_visit_id;
  IF v_pv.id IS NULL THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false,
                        NULL::numeric, NULL::integer, v_threshold, NULL::date,
                        NULL::public.visit_status, 'not_found'::text;
    RETURN;
  END IF;

  SELECT * INTO v_clinic FROM public.clinic WHERE id = v_pv.clinic_id;

  -- Condition 1: the caller owns this planned visit.
  is_owner := (v_me IS NOT NULL AND v_pv.rep_id = v_me);

  -- Condition 2: it is scheduled for today, in Ulaanbaatar.
  is_today := (v_pv.planned_date = v_today);

  -- Condition 3: it has not already been started, cancelled or completed.
  is_status_planned := (v_pv.status = 'planned');

  -- Condition 4: this representative has no other visit already running.
  no_other_in_progress := NOT EXISTS (
    SELECT 1 FROM public.visit v
    WHERE v.rep_id = v_me AND v.status = 'in_progress'
  );

  -- Conditions 5 and 6: a usable fix exists. The app cannot check "permission
  -- granted" server-side, but a denied permission always arrives here as
  -- missing coordinates, so the effect is the same.
  has_location := (
    p_latitude IS NOT NULL AND p_longitude IS NOT NULL
    AND p_latitude BETWEEN -90 AND 90
    AND p_longitude BETWEEN -180 AND 180
    AND NOT (p_latitude = 0 AND p_longitude = 0)
  );

  -- Condition 7: the fix is precise enough to mean anything.
  -- A missing accuracy value is treated as unacceptable rather than assumed
  -- good — an unknown error radius is not evidence of proximity.
  accuracy_ok := (has_location AND p_accuracy_m IS NOT NULL AND p_accuracy_m <= v_threshold);

  -- Condition 8: inside the clinic's own radius. SERVER-COMPUTED.
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

  distance_m           := v_distance;
  radius_m             := v_clinic.geofence_radius_m;
  accuracy_threshold_m := v_threshold;
  planned_date         := v_pv.planned_date;
  visit_status         := v_pv.status;

  can_start := is_owner AND is_today AND is_status_planned
               AND no_other_in_progress AND has_location
               AND accuracy_ok AND within_radius;

  -- The single most useful reason to show first.
  blocking_reason := CASE
    WHEN NOT is_owner             THEN 'not_owner'
    WHEN NOT is_status_planned    THEN 'wrong_status'
    WHEN NOT is_today             THEN 'not_today'
    WHEN NOT no_other_in_progress THEN 'other_visit_in_progress'
    WHEN NOT has_location         THEN 'no_location'
    WHEN NOT accuracy_ok          THEN 'poor_accuracy'
    WHEN NOT within_radius        THEN 'outside_radius'
    ELSE NULL
  END;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.fn_visit_start_eligibility IS
  'All eight start conditions, evaluated server-side, returned individually so the app can explain exactly what is wrong.';

-- -----------------------------------------------------------------------------
-- fn_start_visit — the check-in
--
-- Idempotent by p_client_uuid: replaying a queued offline check-in returns the
-- visit that already exists instead of creating a second one.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_start_visit(
  p_planned_visit_id uuid,
  p_latitude         double precision,
  p_longitude        double precision,
  p_accuracy_m       double precision,
  p_device_ts        timestamptz DEFAULT NULL,
  p_client_uuid      uuid        DEFAULT NULL,
  p_app_version      text        DEFAULT NULL,
  p_is_mocked        boolean     DEFAULT false,
  p_source           public.sync_source DEFAULT 'online'
)
RETURNS public.visit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me          uuid := public.fn_current_app_user_id();
  v_eligibility record;
  v_pv          public.planned_visit;
  v_clinic      public.clinic;
  v_visit       public.visit;
  v_client_uuid uuid := COALESCE(p_client_uuid, gen_random_uuid());
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotency first: a retried request must not be treated as a new one.
  SELECT * INTO v_visit FROM public.visit WHERE client_uuid = v_client_uuid;
  IF v_visit.id IS NOT NULL THEN
    RETURN v_visit;
  END IF;

  SELECT * INTO v_eligibility
  FROM public.fn_visit_start_eligibility(p_planned_visit_id, p_latitude, p_longitude, p_accuracy_m);

  IF NOT v_eligibility.can_start THEN
    -- Mongolian, because a representative reads this while standing in a
    -- corridor. The numbers matter more than the words.
    RAISE EXCEPTION '%',
      CASE v_eligibility.blocking_reason
        WHEN 'not_found'   THEN 'Уулзалт олдсонгүй.'
        WHEN 'not_owner'   THEN 'Энэ уулзалт танд хамааралгүй байна.'
        WHEN 'wrong_status' THEN
          format('Энэ уулзалтыг эхлүүлэх боломжгүй (төлөв: %s).', v_eligibility.visit_status)
        WHEN 'not_today'   THEN
          format('Энэ уулзалт %s-нд товлогдсон. Зөвхөн өнөөдрийн уулзалтыг эхлүүлнэ.',
                 v_eligibility.planned_date)
        WHEN 'other_visit_in_progress' THEN
          'Танд үргэлжилж буй өөр уулзалт байна. Түүнийг эхлээд дуусгана уу.'
        WHEN 'no_location' THEN
          'Байршил тодорхойлогдоогүй байна. Байршлын зөвшөөрлөө шалгана уу.'
        WHEN 'poor_accuracy' THEN
          format('GPS-ийн нарийвчлал хангалтгүй байна (%s м, шаардлага %s м-ээс бага).',
                 COALESCE(round(p_accuracy_m::numeric)::text, '?'), v_eligibility.accuracy_threshold_m)
        WHEN 'outside_radius' THEN
          format('Та эмнэлгээс %s м зайд байна. Зөвшөөрөгдөх зай %s м. Чөлөөлөх хүсэлт илгээнэ үү.',
                 round(v_eligibility.distance_m), v_eligibility.radius_m)
        ELSE 'Уулзалт эхлүүлэх боломжгүй байна.'
      END
      USING ERRCODE = 'check_violation',
            DETAIL  = COALESCE(v_eligibility.blocking_reason, 'unknown');
  END IF;

  SELECT * INTO v_pv     FROM public.planned_visit WHERE id = p_planned_visit_id;
  SELECT * INTO v_clinic FROM public.clinic        WHERE id = v_pv.clinic_id;

  INSERT INTO public.visit
    (client_uuid, planned_visit_id, rep_id, clinic_id, visit_date,
     status, started_at_server, is_draft, created_source, app_version)
  VALUES
    (v_client_uuid, p_planned_visit_id, v_me, v_pv.clinic_id, public.fn_local_date(),
     'in_progress', now(), true, p_source, p_app_version)
  RETURNING * INTO v_visit;

  -- The evidence record. distance is the SERVER's number, not the client's.
  INSERT INTO public.visit_event
    (visit_id, event_type, device_ts, latitude, longitude, gps_accuracy_m,
     distance_from_clinic_m, clinic_radius_m_at_event, clinic_id, app_user_id,
     planned_visit_id, app_version, source, is_mocked_location, outside_geofence)
  VALUES
    (v_visit.id, 'check_in', p_device_ts, p_latitude, p_longitude, p_accuracy_m,
     v_eligibility.distance_m, v_clinic.geofence_radius_m, v_clinic.id, v_me,
     p_planned_visit_id, p_app_version, p_source, COALESCE(p_is_mocked, false), false);

  UPDATE public.planned_visit SET status = 'in_progress' WHERE id = p_planned_visit_id;

  PERFORM public.fn_audit('visit_started', 'visit', v_visit.id, NULL,
                          jsonb_build_object(
                            'planned_visit_id', p_planned_visit_id,
                            'distance_m', v_eligibility.distance_m,
                            'accuracy_m', p_accuracy_m,
                            'mocked', COALESCE(p_is_mocked, false),
                            'source', p_source),
                          NULL, p_app_version);

  RETURN v_visit;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_check_out — leaving the clinic
--
-- PHASE BOUNDARY, STATED PLAINLY: this records the check-out event and stamps
-- completed_at_server, which fixes the duration. It does NOT set the status to
-- 'completed'. A visit becomes completed only once the structured
-- documentation is valid, which is fn_complete_visit() in Phase 4. Until then
-- the visit stays 'in_progress' with is_draft = true and shows in the app as
-- awaiting its report.
--
-- Doing it this way means the duration reflects when the representative
-- actually left, not when they got round to typing up the notes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_out(
  p_visit_id    uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision DEFAULT NULL,
  p_device_ts   timestamptz DEFAULT NULL,
  p_client_uuid uuid DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_is_mocked   boolean DEFAULT false,
  p_source      public.sync_source DEFAULT 'online'
)
RETURNS public.visit
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me          uuid := public.fn_current_app_user_id();
  v_visit       public.visit;
  v_clinic      public.clinic;
  v_distance    numeric;
  v_client_uuid uuid := COALESCE(p_client_uuid, gen_random_uuid());
BEGIN
  SELECT * INTO v_visit FROM public.visit WHERE id = p_visit_id;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Уулзалт олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_visit.rep_id <> v_me THEN
    RAISE EXCEPTION 'Энэ уулзалт танд хамааралгүй байна.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent: a replayed check-out is a no-op, not an error.
  IF EXISTS (SELECT 1 FROM public.visit_event
              WHERE visit_id = p_visit_id AND event_type = 'check_out') THEN
    RETURN v_visit;
  END IF;

  IF v_visit.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Зөвхөн үргэлжилж буй уулзалтыг дуусгана (одоогийн төлөв: %).', v_visit.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Дуусгахын тулд байршил шаардлагатай.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_clinic FROM public.clinic WHERE id = v_visit.clinic_id;

  v_distance := round(
    public.fn_haversine_metres(
      p_latitude, p_longitude,
      v_clinic.latitude::double precision, v_clinic.longitude::double precision
    )::numeric, 2);

  -- Check-out is NOT geofenced. A representative may well be walking to the
  -- car by the time they tap it, and refusing the check-out would leave the
  -- visit stuck open for ever. The distance is recorded either way, so an
  -- implausible check-out is visible to a manager.
  INSERT INTO public.visit_event
    (client_uuid, visit_id, event_type, device_ts, latitude, longitude, gps_accuracy_m,
     distance_from_clinic_m, clinic_radius_m_at_event, clinic_id, app_user_id,
     planned_visit_id, app_version, source, is_mocked_location, outside_geofence)
  VALUES
    (v_client_uuid, p_visit_id, 'check_out', p_device_ts, p_latitude, p_longitude, p_accuracy_m,
     v_distance, v_clinic.geofence_radius_m, v_clinic.id, v_me,
     v_visit.planned_visit_id, p_app_version, p_source, COALESCE(p_is_mocked, false),
     v_distance > v_clinic.geofence_radius_m);

  UPDATE public.visit
     SET completed_at_server = now()
   WHERE id = p_visit_id
  RETURNING * INTO v_visit;

  PERFORM public.fn_audit('visit_completed', 'visit', p_visit_id, NULL,
                          jsonb_build_object(
                            'checked_out_at', v_visit.completed_at_server,
                            'duration_seconds', v_visit.duration_seconds,
                            'distance_m', v_distance),
                          'check-out recorded; documentation still required',
                          p_app_version);

  RETURN v_visit;
END;
$$;

-- -----------------------------------------------------------------------------
-- The caller's currently running visit, if any. Drives the "you already have a
-- visit in progress" banner and the active-visit screen.
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
    COALESCE(pv.objective, ''),
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
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION
  public.fn_visit_start_eligibility(uuid, double precision, double precision, double precision),
  public.fn_start_visit(uuid, double precision, double precision, double precision, timestamptz, uuid, text, boolean, public.sync_source),
  public.fn_check_out(uuid, double precision, double precision, double precision, timestamptz, uuid, text, boolean, public.sync_source),
  public.fn_active_visit()
TO authenticated;
