-- =============================================================================
-- test-setup-single-user.sql
--
-- "Prepare the database so ONE person can test the whole application."
--
-- WHY THIS EXISTS
-- ---------------
-- Supabase's built-in email sender allows only a couple of messages per hour,
-- for the whole project. Testing therefore has to work from a single sign-in:
-- one code, one session, no signing out. Everything else — the data to look
-- at, the role to act as, the clinic to check in at — has to be arranged in
-- the database beforehand, not by logging in as somebody else.
--
-- This file does that arrangement. It:
--
--   1. gives the tester's address to seeded representative rep01, so they
--      inherit four weeks of plans, visits and KPI history rather than
--      staring at an empty app;
--   2. moves any account already holding that address out of the way, because
--      app_user.auth_user_id is UNIQUE and two rows claiming one login makes
--      the profile query fail;
--   3. makes sure there is a visit planned for TODAY, so check-in is testable;
--   4. moves that visit's clinic to wherever the tester is sitting, with a
--      2 km radius, because the geofence is enforced server-side and cannot be
--      talked out of it from the phone.
--
-- SAFE TO RE-RUN. It reads the current state each time and only changes what
-- is not already correct.
--
-- NOT FOR PRODUCTION. It rewrites seeded test data and relocates a clinic.
-- Run it only against a database whose contents are the seed data.
--
-- HOW TO RUN
--   1. Edit the three values marked ▼ below.
--   2. Paste the whole file into the Supabase SQL editor and press Run.
--   3. Read the report it prints.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The report table is emptied HERE, in its own statement, before the work.
--
-- It was originally created and emptied inside the DO block below, which hid a
-- failure completely: the DO block is a single statement, so an error rolls the
-- whole thing back — including the DELETE — and the final SELECT then printed
-- the PREVIOUS run's six green ticks. The run had failed and the report said it
-- had succeeded. Emptied out here, a failed run leaves an empty grid, which
-- cannot be mistaken for anything else.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.test_setup_report (
  seq    integer,
  step   text,
  ok     boolean,
  detail text
);

DELETE FROM public.test_setup_report;

DO $$
DECLARE
  -- ▼▼▼ EDIT THESE THREE ▼▼▼

  -- The address you will sign in with.
  v_email text := 'myagmarsuren.na@monos.mn';

  -- Where you are sitting. Google Maps → long-press your location → the two
  -- numbers shown at the top. Latitude first.
  v_lat double precision := 47.918700;   -- Ulaanbaatar, roughly the centre
  v_lon double precision := 106.917700;

  -- ▲▲▲ EDIT THESE THREE ▲▲▲

  -- rep01 — the seeded representative whose data the tester adopts.
  v_rep_id constant uuid := '00000000-0000-0000-0000-0000000000c1';

  v_today       date;
  v_parked      integer := 0;
  v_plan_id     uuid;
  v_visit_id    uuid;
  v_clinic_id   uuid;
  v_clinic_name text;
  v_auth_linked boolean;
  v_moved       boolean := false;
  v_seq         integer := 0;
BEGIN
  v_email := lower(btrim(v_email));
  v_today := public.fn_local_date();

  -- This file reads auth.users directly, so it only makes sense against a
  -- Supabase database. Said plainly rather than left as "relation auth.users
  -- does not exist" forty lines further down.
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION
      'auth.users байхгүй байна. Энэ файлыг Supabase-ийн SQL editor дээр ажиллуулна уу.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 1. Is the address allowed to sign in at all?
  --
  -- Checked first because it is enforced by a trigger on auth.users: a
  -- disallowed domain is refused before a code is ever sent, and no amount of
  -- setting up below would help.
  -- ---------------------------------------------------------------------------
  v_seq := v_seq + 1;
  INSERT INTO public.test_setup_report VALUES (
    v_seq,
    '1. И-мэйлийн домэйн',
    public.fn_can_email_sign_in(v_email),
    CASE WHEN public.fn_can_email_sign_in(v_email)
      THEN v_email || ' — зөвшөөрөгдсөн.'
      ELSE v_email || ' — ЗӨВШӨӨРӨӨГҮЙ. approved_email_domain хүснэгтэд домэйныг нэмнэ үү.'
    END);

  IF NOT public.fn_can_email_sign_in(v_email) THEN
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Move any other account holding this address out of the way.
  --
  -- auth_user_id is UNIQUE, and the profile query in the app is .maybeSingle()
  -- on auth_user_id — two rows pointing at one login is not a duplicate-data
  -- annoyance, it is a hard failure at sign-in. The old row is parked rather
  -- than deleted: app_user is referenced by audit rows that must not move.
  -- ---------------------------------------------------------------------------
  -- deactivated_at moves with is_active: app_user_deactivation_consistent
  -- requires the flag and the timestamp to agree, in both directions.
  UPDATE public.app_user
     SET email          = ('parked+' || id::text || '@monos.mn')::citext,
         auth_user_id   = NULL,
         is_active      = false,
         deactivated_at = now()
   WHERE lower(email::text) = v_email
     AND id <> v_rep_id;
  GET DIAGNOSTICS v_parked = ROW_COUNT;

  v_seq := v_seq + 1;
  INSERT INTO public.test_setup_report VALUES (
    v_seq,
    '2. Хуучин давхардсан бүртгэл',
    true,
    CASE WHEN v_parked = 0
      THEN 'Байхгүй — цэвэр.'
      ELSE v_parked || ' бүртгэлийг түр хойш тавилаа (parked+…@monos.mn, идэвхгүй).'
    END);

  -- ---------------------------------------------------------------------------
  -- 3. Hand rep01's identity to the tester.
  --
  -- The BEFORE UPDATE OF email trigger from migration 0026 adopts a matching
  -- auth.users row here, if the tester has already tried to sign in once. If
  -- they have not, 0006's trigger links it when they do. Both directions are
  -- covered; that is the whole point of 0026.
  -- ---------------------------------------------------------------------------
  -- auth_user_id is cleared as part of the rename, then set from the NEW
  -- address. Both halves matter.
  --
  -- Leaving it alone was a bug. On a database where rep01 had already signed
  -- in, auth_user_id still pointed at the login for rep01@monos.mn. 0026's
  -- adopt trigger deliberately does not touch a row that is already linked, so
  -- nothing corrected it. The tester then signed in, got their own login id,
  -- and the app looked for an app_user carrying that id — of which there was
  -- none. Result: «Таны бүртгэл идэвхжээгүй байна», from an account that looks
  -- perfectly correct in every column an administrator would think to read.
  --
  -- Any other row holding the target login is cleared first: auth_user_id is
  -- UNIQUE, so a leftover claim makes the statement below fail outright.
  UPDATE public.app_user u
     SET auth_user_id = NULL
    FROM auth.users a
   WHERE u.auth_user_id = a.id
     AND lower(a.email) = v_email
     AND u.id <> v_rep_id;

  UPDATE public.app_user
     SET email          = v_email::citext,
         is_active      = true,
         deactivated_at = NULL,
         auth_user_id   = NULL
   WHERE id = v_rep_id;

  -- Done explicitly rather than left to 0026's trigger, so this file also
  -- repairs a database where 0026 has not been applied.
  UPDATE public.app_user u
     SET auth_user_id = a.id
    FROM auth.users a
   WHERE u.id = v_rep_id
     AND lower(a.email) = v_email;

  SELECT auth_user_id IS NOT NULL INTO v_auth_linked
    FROM public.app_user WHERE id = v_rep_id;

  v_seq := v_seq + 1;
  INSERT INTO public.test_setup_report VALUES (
    v_seq,
    '3. Туршилтын бүртгэл',
    true,
    'rep01 (А. Ариунзаяа) → ' || v_email || '. Эрх: representative. '
    || CASE WHEN v_auth_linked
         THEN 'Нэвтрэх бүртгэлтэй холбогдсон.'
         ELSE 'Та эхний удаа код оруулахад автоматаар холбогдоно.' END);

  -- ---------------------------------------------------------------------------
  -- 4. Make sure something is planned for today.
  --
  -- The seed positions its four weeks relative to the day it was RUN. Seeded
  -- last week, "this week" is now last week and today's route is empty — which
  -- looks like a broken app rather than stale data.
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_plan_id
    FROM public.weekly_plan
   WHERE rep_id = v_rep_id
     AND v_today BETWEEN week_start_date AND week_end_date;

  IF v_plan_id IS NULL THEN
    v_seq := v_seq + 1;
    INSERT INTO public.test_setup_report VALUES (
      v_seq,
      '4. Өнөөдрийн маршрут',
      false,
      'Энэ долоо хоногт төлөвлөгөө алга. Үрийн өгөгдөл хуучирсан байна — '
      || 'seed/0002_phase2_weekly_plans.sql болон seed/0003_phase3_visits.sql -ыг '
      || 'дахин ажиллуулаад энэ файлыг дахин ажиллуулна уу.');
    RETURN;
  END IF;

  -- Prefer a visit already planned for today and not yet started.
  SELECT pv.id, pv.clinic_id INTO v_visit_id, v_clinic_id
    FROM public.planned_visit pv
   WHERE pv.rep_id = v_rep_id
     AND pv.planned_date = v_today
     AND pv.status = 'planned'
   ORDER BY pv.planned_order, pv.id
   LIMIT 1;

  -- Otherwise pull one forward from elsewhere in the same week. Staying inside
  -- the plan's own week matters: planned_date is constrained to it.
  IF v_visit_id IS NULL THEN
    SELECT pv.id, pv.clinic_id INTO v_visit_id, v_clinic_id
      FROM public.planned_visit pv
     WHERE pv.weekly_plan_id = v_plan_id
       AND pv.status = 'planned'
     ORDER BY pv.planned_date, pv.planned_order, pv.id
     LIMIT 1;

    IF v_visit_id IS NOT NULL THEN
      UPDATE public.planned_visit
         SET planned_date = v_today
       WHERE id = v_visit_id;
      v_moved := true;
    END IF;
  END IF;

  IF v_visit_id IS NULL THEN
    v_seq := v_seq + 1;
    INSERT INTO public.test_setup_report VALUES (
      v_seq,
      '4. Өнөөдрийн маршрут',
      false,
      'Энэ долоо хоногийн бүх уулзалт аль хэдийн хийгдсэн байна. '
      || 'seed/0003_phase3_visits.sql -ыг дахин ажиллуулна уу.');
    RETURN;
  END IF;

  v_seq := v_seq + 1;
  INSERT INTO public.test_setup_report VALUES (
    v_seq,
    '4. Өнөөдрийн маршрут',
    true,
    CASE WHEN v_moved
      THEN 'Нэг уулзалтыг өнөөдөр (' || v_today || ') рүү зөөлөө.'
      ELSE 'Өнөөдөр (' || v_today || ') хийх уулзалт байна.' END);

  -- ---------------------------------------------------------------------------
  -- 5. Bring the clinic to the tester.
  --
  -- The geofence is computed server-side from these coordinates, so it cannot
  -- be bypassed from the phone — correctly. Testing check-in at a desk
  -- therefore means moving the clinic, not faking the position.
  --
  -- The clinic already on the visit is used, rather than swapping the visit to
  -- some other clinic: the planned doctors belong to this clinic, and pointing
  -- the visit elsewhere would leave that inconsistent.
  --
  -- 2000 m is the maximum the schema allows, and covers ordinary GPS drift
  -- indoors with room to spare.
  -- ---------------------------------------------------------------------------
  UPDATE public.clinic
     SET latitude          = v_lat,
         longitude         = v_lon,
         geofence_radius_m = 2000
   WHERE id = v_clinic_id
  RETURNING name INTO v_clinic_name;

  v_seq := v_seq + 1;
  INSERT INTO public.test_setup_report VALUES (
    v_seq,
    '5. Эмнэлгийн байршил',
    true,
    '"' || v_clinic_name || '" -ийг ' || v_lat || ', ' || v_lon
    || ' цэг рүү зөөж, хүрээг 2000 м болголоо. Та суудаг газраасаа check-in хийж чадна.');

  -- ---------------------------------------------------------------------------
  -- 6. The verdict.
  -- ---------------------------------------------------------------------------
  v_seq := v_seq + 1;
  INSERT INTO public.test_setup_report VALUES (
    v_seq,
    '6. ДҮГНЭЛТ',
    true,
    'Бэлэн. Аппаас ' || v_email || ' хаягаар нэвтэрнэ үү. '
    || 'Код нэг л удаа авах тул ГАРАХ товчийг бүү дарна уу.');
END;
$$;

-- The report. A separate statement because the Supabase SQL editor runs each
-- statement independently and shows only the last result grid.
SELECT
  CASE WHEN ok THEN '✅' ELSE '❌' END AS status,
  step,
  detail
FROM public.test_setup_report
ORDER BY seq;

-- No rows above means the setup FAILED. Read the red error message that the
-- SQL editor shows and send it on; nothing in the database was changed.
