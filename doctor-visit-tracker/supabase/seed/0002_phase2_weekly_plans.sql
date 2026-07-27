-- =============================================================================
-- 0002_phase2_weekly_plans.sql  —  SEED / TEST DATA (Phase 2)
--
-- Four weeks of weekly plans for all seven representatives, positioned
-- RELATIVE TO TODAY so the app always has something to show:
--
--   week -2 : completed  (past)
--   week -1 : completed  (past)
--   week  0 : active     (this week — includes today, so "Өнөөдрийн маршрут" works)
--   week +1 : a mix of submitted / draft / approved / rejected, so every plan
--             status is visible somewhere in the app
--
-- HONEST SCOPE NOTE
-- -----------------
-- Phase 2 has no `visit` table yet, so no planned visit here is marked
-- 'completed' — that status is only truthful once a real check-in and
-- check-out exist. Past weeks carry a realistic mix of 'planned' (not done),
-- 'missed' and 'cancelled_unapproved'. Phase 3's seed adds real visits and
-- updates these statuses.
--
-- Doctor/clinic/brand choices respect each representative's brand
-- assignments, and rep01/rep04 deliberately share Solaris Care so the
-- "two reps, same doctor, same day" case appears in the data.
-- =============================================================================

BEGIN;

-- Clear previous planning seed (children first).
DELETE FROM public.visit_status_history;
DELETE FROM public.planned_visit_brand;
DELETE FROM public.planned_visit_doctor;
DELETE FROM public.planned_visit;
DELETE FROM public.weekly_plan;

-- -----------------------------------------------------------------------------
-- Build the four plans per representative.
-- -----------------------------------------------------------------------------
WITH this_monday AS (
  -- date_trunc('week') is ISO: Monday.
  SELECT (date_trunc('week', public.fn_local_date()::timestamp))::date AS monday
),
weeks AS (
  SELECT
    offset_weeks,
    (SELECT monday FROM this_monday) + (offset_weeks * 7) AS week_start
  FROM (VALUES (-2), (-1), (0), (1)) AS w(offset_weeks)
),
reps AS (
  SELECT id, email, row_number() OVER (ORDER BY email) AS rn
  FROM public.app_user
  WHERE role = 'representative'
)
INSERT INTO public.weekly_plan
  (rep_id, iso_year, iso_week, week_start_date, week_end_date, status,
   submitted_at, reviewed_by, reviewed_at, review_comment)
SELECT
  reps.id,
  EXTRACT(ISOYEAR FROM weeks.week_start)::integer,
  EXTRACT(WEEK    FROM weeks.week_start)::integer,
  weeks.week_start,
  weeks.week_start + 6,
  CASE
    WHEN weeks.offset_weeks < 0 THEN 'completed'::public.plan_status
    WHEN weeks.offset_weeks = 0 THEN 'active'::public.plan_status
    -- Next week: spread the statuses so every one is represented in the UI.
    WHEN reps.rn = 1 THEN 'submitted'::public.plan_status
    WHEN reps.rn = 2 THEN 'approved'::public.plan_status
    WHEN reps.rn = 3 THEN 'rejected'::public.plan_status
    WHEN reps.rn = 4 THEN 'draft'::public.plan_status
    ELSE 'submitted'::public.plan_status
  END,
  CASE WHEN weeks.offset_weeks < 1 OR reps.rn <> 4
       THEN weeks.week_start - INTERVAL '3 days' + INTERVAL '15 hours' END,
  CASE WHEN weeks.offset_weeks < 1 OR reps.rn IN (2, 3)
       THEN (SELECT m.id FROM public.app_user m WHERE m.role = 'manager' ORDER BY m.email LIMIT 1) END,
  CASE WHEN weeks.offset_weeks < 1 OR reps.rn IN (2, 3)
       THEN weeks.week_start - INTERVAL '2 days' END,
  CASE WHEN weeks.offset_weeks = 1 AND reps.rn = 3
       THEN 'Даваа гарагийн маршрут хэт ачаалалтай байна. Зарим уулзалтыг Лхагва гараг руу шилжүүлнэ үү.' END
FROM weeks CROSS JOIN reps;

-- -----------------------------------------------------------------------------
-- Planned visits: 3-4 per working day (Mon-Fri) for each plan.
--
-- Clinic choice is spread deterministically so every representative has a
-- varied route and clinics repeat across weeks, which is what real coverage
-- reporting needs.
-- -----------------------------------------------------------------------------
WITH plans AS (
  SELECT
    wp.id            AS plan_id,
    wp.rep_id,
    wp.week_start_date,
    wp.status        AS plan_status,
    row_number() OVER (ORDER BY wp.rep_id, wp.week_start_date) AS plan_rn
  FROM public.weekly_plan wp
),
clinics AS (
  SELECT id, row_number() OVER (ORDER BY code) - 1 AS ci, (SELECT count(*) FROM public.clinic) AS total
  FROM public.clinic
),
slots AS (
  -- Monday..Friday, 3 visits on most days and 4 on two of them.
  SELECT
    plans.plan_id,
    plans.rep_id,
    plans.plan_rn,
    plans.plan_status,
    plans.week_start_date + day_offset AS planned_date,
    day_offset,
    visit_no
  FROM plans
  CROSS JOIN generate_series(0, 4) AS day_offset            -- Mon..Fri
  CROSS JOIN generate_series(1, 4) AS visit_no
  WHERE visit_no <= CASE WHEN (plans.plan_rn + day_offset) % 3 = 0 THEN 4 ELSE 3 END
)
INSERT INTO public.planned_visit
  (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, planned_time, objective, status)
SELECT
  slots.plan_id,
  slots.rep_id,
  c.id,
  slots.planned_date,
  slots.visit_no,
  (TIME '09:00' + ((slots.visit_no - 1) * INTERVAL '2 hours')
                + (CASE WHEN slots.day_offset % 2 = 0 THEN INTERVAL '0 min' ELSE INTERVAL '30 min' END)),
  CASE slots.visit_no
    WHEN 1 THEN 'Шинэ бүтээгдэхүүн танилцуулах'
    WHEN 2 THEN 'Өмнөх уулзалтын үргэлжлэл, санал хүсэлт авах'
    WHEN 3 THEN 'Брэндийн мэдээлэл өгөх, сорьц үлдээх'
    ELSE 'Сургалтын талаар ярилцах'
  END,
  CASE
    -- Past weeks: a realistic mix. See the scope note at the top of this file.
    WHEN slots.planned_date < public.fn_local_date() THEN
      CASE (slots.plan_rn * 7 + slots.day_offset * 3 + slots.visit_no) % 10
        WHEN 0 THEN 'missed'::public.visit_status
        WHEN 7 THEN 'cancelled_unapproved'::public.visit_status
        ELSE 'planned'::public.visit_status
      END
    ELSE 'planned'::public.visit_status
  END
FROM slots
JOIN clinics c
  ON c.ci = ((slots.plan_rn * 5) + (slots.day_offset * 3) + slots.visit_no) % c.total;

-- -----------------------------------------------------------------------------
-- Expected doctors: pick doctors who actually work at the chosen clinic.
-- 1-2 doctors per visit.
-- -----------------------------------------------------------------------------
INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id)
SELECT DISTINCT ON (pv.id, ranked.rn)
  pv.id,
  ranked.doctor_id
FROM public.planned_visit pv
JOIN LATERAL (
  SELECT dc.doctor_id, row_number() OVER (ORDER BY dc.doctor_id) AS rn
  FROM public.doctor_clinic dc
  JOIN public.doctor d ON d.id = dc.doctor_id
  WHERE dc.clinic_id = pv.clinic_id
    AND dc.is_active
    AND d.is_active
    AND d.deleted_at IS NULL
) AS ranked ON true
-- One doctor normally; a second on every third visit.
WHERE ranked.rn <= CASE WHEN pv.planned_order % 3 = 0 THEN 2 ELSE 1 END
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Intended brands: only brands the representative actually carries.
-- 1-2 brands per visit, plus one specific product on some.
-- -----------------------------------------------------------------------------
INSERT INTO public.planned_visit_brand (planned_visit_id, brand_id, product_id)
SELECT
  pv.id,
  mine.brand_id,
  CASE WHEN pv.planned_order = 1 THEN (
    SELECT p.id FROM public.product p
    WHERE p.brand_id = mine.brand_id AND p.deleted_at IS NULL
    ORDER BY p.sku LIMIT 1
  ) END
FROM public.planned_visit pv
JOIN LATERAL (
  SELECT a.brand_id, row_number() OVER (ORDER BY a.brand_id) AS rn
  FROM public.rep_brand_assignment a
  WHERE a.rep_id = pv.rep_id AND a.is_active
) AS mine ON true
WHERE mine.rn <= CASE WHEN pv.planned_order % 2 = 0 THEN 2 ELSE 1 END
ON CONFLICT DO NOTHING;

COMMIT;

-- -----------------------------------------------------------------------------
-- Summary
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT
    (SELECT count(*) FROM public.weekly_plan)                                        AS plans,
    (SELECT count(*) FROM public.planned_visit)                                      AS visits,
    (SELECT count(*) FROM public.planned_visit WHERE planned_date = public.fn_local_date()) AS today,
    (SELECT count(*) FROM public.planned_visit_doctor)                               AS visit_doctors,
    (SELECT count(*) FROM public.planned_visit_brand)                                AS visit_brands,
    (SELECT count(*) FROM public.planned_visit WHERE status = 'missed')              AS missed,
    (SELECT count(*) FROM public.planned_visit WHERE status = 'cancelled_unapproved') AS cancelled
  INTO r;

  RAISE NOTICE 'Phase 2 seed: % plans, % planned visits (% today), % doctor links, % brand links, % missed, % unapproved cancellations',
    r.plans, r.visits, r.today, r.visit_doctors, r.visit_brands, r.missed, r.cancelled;
END;
$$;
