-- =============================================================================
-- 0003_phase3_visits.sql  —  SEED / TEST DATA (Phase 3)
--
-- Turns most of the PAST planned visits from seed 0002 into real visit records
-- with genuine check-in and check-out evidence, so that:
--
--   * the doctor visit history (Phase 4) has something to show;
--   * the KPI (Phase 5) has completed / missed / cancelled visits to count;
--   * managers can see realistic durations and distances.
--
-- The check-in coordinates are scattered a few dozen metres around each clinic
-- — the sort of spread a real GPS produces — so distances are plausible rather
-- than a suspicious row of exact zeroes.
--
-- A deliberate handful of visits are left ANOMALOUS so the "started outside
-- expected conditions" review list is not empty on day one:
--   * a couple checked in from outside the geofence
--   * one with a badly skewed device clock
--   * one flagged as a mocked location
--   * two suspiciously short visits
--
-- Statuses set here are only those Phase 3 can legitimately produce plus the
-- documentation Phase 4 will collect. Nothing is invented that the app cannot
-- itself create.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Clearing previous seed data requires deleting from append-only tables.
--
-- THIS IS ONLY POSSIBLE HERE, AND THAT IS THE POINT. Disabling a trigger needs
-- table ownership, which the application roles (`anon`, `authenticated`) do not
-- have and never will. The immutability guarantee is therefore untouched for
-- every real user; a developer re-running a seed script against a scratch
-- database is not a threat model.
--
-- The normal path does not even reach this: scripts/db-provision.mjs drops and
-- recreates the database, so these deletes only matter when someone re-runs the
-- seed by hand.
-- -----------------------------------------------------------------------------
ALTER TABLE public.visit_event          DISABLE TRIGGER trg_visit_event_no_delete;
ALTER TABLE public.visit                DISABLE TRIGGER trg_visit_no_delete;
ALTER TABLE public.visit_status_history DISABLE TRIGGER trg_visit_status_history_no_delete;
ALTER TABLE public.visit_addendum       DISABLE TRIGGER trg_visit_addendum_no_delete;
ALTER TABLE public.kpi_period_snapshot  DISABLE TRIGGER trg_kpi_snapshot_no_delete;

DELETE FROM public.visit_product;
DELETE FROM public.visit_brand;
DELETE FROM public.visit_doctor;
DELETE FROM public.visit_event;
-- Phase 4 and 5 attach to a visit too, so they go before it.
DELETE FROM public.visit_addendum;
DELETE FROM public.visit_exception;
DELETE FROM public.follow_up;
DELETE FROM public.kpi_period_snapshot;
DELETE FROM public.visit_status_history WHERE visit_id IS NOT NULL;
DELETE FROM public.visit;

-- Restore immediately. Everything after this line runs with the real rules.
ALTER TABLE public.visit_event          ENABLE TRIGGER trg_visit_event_no_delete;
ALTER TABLE public.visit                ENABLE TRIGGER trg_visit_no_delete;
ALTER TABLE public.visit_status_history ENABLE TRIGGER trg_visit_status_history_no_delete;
ALTER TABLE public.visit_addendum       ENABLE TRIGGER trg_visit_addendum_no_delete;
ALTER TABLE public.kpi_period_snapshot  ENABLE TRIGGER trg_kpi_snapshot_no_delete;

-- -----------------------------------------------------------------------------
-- Pick the past planned visits that "happened".
--
-- Seed 0002 already marked ~10% missed and ~10% cancelled; those stay as they
-- are. Everything else in the past becomes a completed visit.
--
-- The status filter accepts BOTH 'planned' and 'completed' so this file is
-- re-runnable: the first run flips those rows to 'completed', and a second run
-- must still find them rather than silently producing nothing.
-- -----------------------------------------------------------------------------
-- A REAL table, not a TEMP one, and deliberately so.
--
-- A temp table lives in one session and `ON COMMIT DROP` removes it the moment
-- its transaction ends. That is fine under `psql -f`, which runs the whole file
-- in one session and one transaction — and it BREAKS in the Supabase SQL
-- editor, which sends statements separately over a pooled connection. The
-- table was created and dropped before the next statement could read it:
--   ERROR: relation "tmp_completed" does not exist
--
-- A plain table survives either way. It is dropped again at the foot of this
-- file, and dropped defensively above in case a previous run died partway.
DROP TABLE IF EXISTS public.seed_tmp_completed;

CREATE TABLE public.seed_tmp_completed AS
SELECT
  pv.id                          AS planned_visit_id,
  pv.rep_id,
  pv.clinic_id,
  pv.planned_date,
  pv.planned_order,
  pv.planned_time,
  c.latitude                     AS clinic_lat,
  c.longitude                    AS clinic_lon,
  c.geofence_radius_m,
  row_number() OVER (ORDER BY pv.planned_date, pv.rep_id, pv.planned_order) AS rn
FROM public.planned_visit pv
JOIN public.clinic c ON c.id = pv.clinic_id
WHERE pv.planned_date < public.fn_local_date()
  AND pv.status IN ('planned', 'completed');

-- -----------------------------------------------------------------------------
-- The visits themselves.
--
-- Start time = planned time (or 09:00) plus a few minutes of jitter, so the
-- "on-time start" KPI has both punctual and late examples.
-- Duration = 18-52 minutes, with two deliberately-too-short outliers.
-- -----------------------------------------------------------------------------
INSERT INTO public.visit (
  planned_visit_id, rep_id, clinic_id, visit_date, status,
  started_at_server, completed_at_server, is_draft, created_source,
  meeting_status, outcome, interest_level,
  doctor_feedback, rep_summary, next_action,
  samples_provided, follow_up_required, follow_up_date, app_version
)
SELECT
  t.planned_visit_id,
  t.rep_id,
  t.clinic_id,
  t.planned_date,
  'completed',

  -- Check-in: planned time + 0..25 minutes late.
  ((t.planned_date + COALESCE(t.planned_time, TIME '09:00'))
     AT TIME ZONE 'Asia/Ulaanbaatar')
    + ((t.rn * 7) % 26) * INTERVAL '1 minute',

  -- Check-out: 18-52 minutes later, except two very short ones.
  ((t.planned_date + COALESCE(t.planned_time, TIME '09:00'))
     AT TIME ZONE 'Asia/Ulaanbaatar')
    + ((t.rn * 7) % 26) * INTERVAL '1 minute'
    + CASE
        WHEN t.rn % 97 = 0 THEN INTERVAL '45 seconds'   -- suspiciously short
        ELSE (18 + (t.rn * 13) % 35) * INTERVAL '1 minute'
      END,

  false,                                                -- submitted
  CASE WHEN t.rn % 23 = 0 THEN 'offline' ELSE 'online' END::public.sync_source,

  CASE (t.rn % 8)
    WHEN 6 THEN 'doctor_unavailable'
    WHEN 7 THEN 'met_clinic_staff_only'
    ELSE 'doctor_met'
  END::public.meeting_status,

  CASE (t.rn % 7)
    WHEN 0 THEN 'product_introduced'
    WHEN 1 THEN 'doctor_interested'
    WHEN 2 THEN 'follow_up_requested'
    WHEN 3 THEN 'sample_requested'
    WHEN 4 THEN 'already_recommending'
    WHEN 5 THEN 'not_interested'
    ELSE 'training_requested'
  END::public.visit_outcome,

  CASE (t.rn % 4)
    WHEN 0 THEN 'high' WHEN 1 THEN 'medium' WHEN 2 THEN 'low' ELSE 'none'
  END::public.interest_level,

  CASE (t.rn % 5)
    WHEN 0 THEN 'Бүтээгдэхүүний найрлагыг сонирхов. Үнийн мэдээлэл хүслээ.'
    WHEN 1 THEN 'Өвчтөнүүддээ санал болгож үзнэ гэв.'
    WHEN 2 THEN 'Одоогоор өөр брэнд ашиглаж байгаа тул сонирхоогүй.'
    WHEN 3 THEN 'Сорьц авч туршиж үзэхээр тохиров.'
    ELSE 'Сургалт зохион байгуулах хүсэлтэй байна.'
  END,

  CASE (t.rn % 3)
    WHEN 0 THEN 'Товч танилцуулга хийж, каталог үлдээв.'
    WHEN 1 THEN 'Өмнөх уулзалтын үргэлжлэл. Санал хүсэлт авав.'
    ELSE 'Шинэ бүтээгдэхүүний мэдээлэл өгөв.'
  END,

  CASE (t.rn % 4)
    WHEN 0 THEN 'Дараагийн сард дахин уулзах'
    WHEN 1 THEN 'Үнийн санал илгээх'
    WHEN 2 THEN 'Сорьц хүргэх'
    ELSE 'Сургалтын хуваарь тохирох'
  END,

  CASE WHEN t.rn % 3 = 0 THEN 'Сорьц 2 ширхэг, каталог 1' END,

  (t.rn % 4 = 0),
  CASE WHEN t.rn % 4 = 0 THEN t.planned_date + 21 END,
  '0.1.0'
FROM public.seed_tmp_completed t;

-- -----------------------------------------------------------------------------
-- Check-in events.
--
-- Coordinates jitter ±60 m around the clinic. Rows where rn % 41 = 0 are placed
-- WELL outside the radius on purpose, to populate the manager review list.
-- -----------------------------------------------------------------------------
INSERT INTO public.visit_event (
  visit_id, event_type, server_ts, device_ts,
  latitude, longitude, gps_accuracy_m,
  distance_from_clinic_m, clinic_radius_m_at_event,
  clinic_id, app_user_id, planned_visit_id, app_version, source,
  is_mocked_location, outside_geofence
)
SELECT
  v.id,
  'check_in',
  v.started_at_server,
  -- One visit in every 61 has a badly wrong device clock.
  v.started_at_server + CASE WHEN t.rn % 61 = 0 THEN INTERVAL '38 minutes' ELSE INTERVAL '0' END,
  ev.lat,
  ev.lon,
  8 + (t.rn * 3) % 22,
  ev.distance,
  t.geofence_radius_m,
  t.clinic_id,
  t.rep_id,
  t.planned_visit_id,
  '0.1.0',
  v.created_source,
  (t.rn % 137 = 0),                         -- a single mocked-location example
  ev.distance > t.geofence_radius_m
FROM public.seed_tmp_completed t
JOIN public.visit v ON v.planned_visit_id = t.planned_visit_id
CROSS JOIN LATERAL (
  SELECT
    lat, lon,
    round(public.fn_haversine_metres(
      lat, lon, t.clinic_lat::double precision, t.clinic_lon::double precision
    )::numeric, 2) AS distance
  FROM (
    SELECT
      t.clinic_lat::double precision
        + (CASE WHEN t.rn % 41 = 0 THEN 420.0 ELSE ((t.rn * 17) % 100) - 50 END) / 111320.0 AS lat,
      t.clinic_lon::double precision
        + (((t.rn * 29) % 80) - 40) / 74800.0 AS lon
  ) AS raw
) AS ev;

-- -----------------------------------------------------------------------------
-- Check-out events — near the clinic, a little more scattered.
-- -----------------------------------------------------------------------------
INSERT INTO public.visit_event (
  visit_id, event_type, server_ts, device_ts,
  latitude, longitude, gps_accuracy_m,
  distance_from_clinic_m, clinic_radius_m_at_event,
  clinic_id, app_user_id, planned_visit_id, app_version, source,
  is_mocked_location, outside_geofence
)
SELECT
  v.id,
  'check_out',
  v.completed_at_server,
  v.completed_at_server,
  ev.lat,
  ev.lon,
  10 + (t.rn * 5) % 25,
  ev.distance,
  t.geofence_radius_m,
  t.clinic_id,
  t.rep_id,
  t.planned_visit_id,
  '0.1.0',
  v.created_source,
  false,
  ev.distance > t.geofence_radius_m
FROM public.seed_tmp_completed t
JOIN public.visit v ON v.planned_visit_id = t.planned_visit_id
CROSS JOIN LATERAL (
  SELECT
    lat, lon,
    round(public.fn_haversine_metres(
      lat, lon, t.clinic_lat::double precision, t.clinic_lon::double precision
    )::numeric, 2) AS distance
  FROM (
    SELECT
      t.clinic_lat::double precision + (((t.rn * 23) % 140) - 70) / 111320.0 AS lat,
      t.clinic_lon::double precision + (((t.rn * 31) % 120) - 60) / 74800.0  AS lon
  ) AS raw
) AS ev;

-- -----------------------------------------------------------------------------
-- Who was actually met, and what was actually discussed.
-- Taken from the plan, which is what happens in practice.
-- -----------------------------------------------------------------------------
INSERT INTO public.visit_doctor (visit_id, doctor_id)
SELECT v.id, pvd.doctor_id
FROM public.visit v
JOIN public.planned_visit_doctor pvd ON pvd.planned_visit_id = v.planned_visit_id
-- If the doctor was not available, no doctor was met.
WHERE v.meeting_status = 'doctor_met'
ON CONFLICT DO NOTHING;

INSERT INTO public.visit_brand (visit_id, brand_id)
SELECT DISTINCT v.id, pvb.brand_id
FROM public.visit v
JOIN public.planned_visit_brand pvb ON pvb.planned_visit_id = v.planned_visit_id
ON CONFLICT DO NOTHING;

INSERT INTO public.visit_product (visit_id, product_id)
SELECT DISTINCT v.id, pvb.product_id
FROM public.visit v
JOIN public.planned_visit_brand pvb ON pvb.planned_visit_id = v.planned_visit_id
WHERE pvb.product_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- The planned visits are now completed.
UPDATE public.planned_visit pv
   SET status = 'completed'
  FROM public.visit v
 WHERE v.planned_visit_id = pv.id
   AND pv.status <> 'completed';

-- Scratch table gone. It has no row-level security, so leaving it behind would
-- (correctly) be reported by fn_security_findings().
DROP TABLE IF EXISTS public.seed_tmp_completed;

COMMIT;

-- -----------------------------------------------------------------------------
-- Summary
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT
    (SELECT count(*) FROM public.visit)                                              AS visits,
    (SELECT count(*) FROM public.visit_event)                                        AS events,
    (SELECT count(*) FROM public.visit_event WHERE outside_geofence)                 AS outside,
    (SELECT count(*) FROM public.visit_event WHERE is_mocked_location)               AS mocked,
    (SELECT count(*) FROM public.visit_event WHERE abs(COALESCE(clock_drift_seconds,0)) > 300) AS drifted,
    (SELECT count(*) FROM public.visit WHERE duration_seconds < 120)                 AS too_short,
    (SELECT count(*) FROM public.planned_visit WHERE status = 'missed')              AS missed,
    (SELECT round(avg(duration_seconds) / 60.0, 1) FROM public.visit)                AS avg_minutes
  INTO r;

  RAISE NOTICE 'Phase 3 seed: % visits, % location events (% outside radius, % mocked, % clock-skewed, % too short), % missed, avg % minutes',
    r.visits, r.events, r.outside, r.mocked, r.drifted, r.too_short, r.missed, r.avg_minutes;
END;
$$;
