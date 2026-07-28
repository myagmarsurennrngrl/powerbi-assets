-- =============================================================================
-- 0001_phase1_master_data.sql  —  SEED / TEST DATA
--
-- ⚠️  EVERY PERSON, CLINIC AND BRAND BELOW IS FICTIONAL.
--     No real doctor's personal information is used anywhere in this file.
--     Doctor names are synthetic combinations of common Mongolian given names.
--     Clinic and brand names are invented. Email addresses are structural
--     (rep01@, manager01@) so they cannot collide with a real employee.
--
-- Contents (Phase 1):
--   1 administrator, 3 managers, 7 representatives
--   1 approved email domain
--   15 clinics with real Ulaanbaatar district coordinates
--   50 doctors, ~90 doctor-clinic links
--   10 brands, 50 products
--   rep-brand assignments (3-4 brands each, with intentional overlap so that
--   two representatives legitimately visit the same doctor)
--
-- Plans and visits are seeded in Phase 2/3.
-- Run AFTER all migrations. Safe to re-run at ANY point: it performs a full
-- reset of every seeded table, not just the Phase 1 ones.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Clear ALL previous seed data.
--
-- This is a FULL reset, not a Phase 1 reset. Master data sits at the bottom of
-- the dependency graph: a product is referenced by planned_visit_brand, a
-- clinic by visit, a doctor by follow_up. Every foreign key is ON DELETE
-- RESTRICT, so everything above must go first or nothing goes at all.
--
-- The original version of this file deleted only the Phase 1 tables, because
-- Phase 1 was all that existed. Re-running it after seeds 0002 and 0003 then
-- failed with:
--     ERROR: 23503: update or delete on table "product" violates foreign key
--     constraint "planned_visit_brand_product_id_fkey"
--
-- Order below is children first, then parents. Adding a table? It goes above
-- whatever it points at.
--
-- ON DISABLING THE APPEND-ONLY TRIGGERS
-- Visits, events, addenda, status history, KPI snapshots and the audit log are
-- append-only, enforced by triggers as well as revoked grants. Disabling a
-- trigger requires table OWNERSHIP, which the application roles (`anon`,
-- `authenticated`) do not have and never will — so the immutability guarantee
-- is untouched for every real user. A developer resetting a scratch database
-- is not a threat model. The triggers are restored immediately below.
-- -----------------------------------------------------------------------------
ALTER TABLE public.visit                DISABLE TRIGGER trg_visit_no_delete;
ALTER TABLE public.visit_event          DISABLE TRIGGER trg_visit_event_no_delete;
ALTER TABLE public.visit_addendum       DISABLE TRIGGER trg_visit_addendum_no_delete;
ALTER TABLE public.visit_status_history DISABLE TRIGGER trg_visit_status_history_no_delete;
ALTER TABLE public.kpi_period_snapshot  DISABLE TRIGGER trg_kpi_snapshot_no_delete;
ALTER TABLE public.audit_log            DISABLE TRIGGER trg_audit_log_no_delete;

-- Visits and everything hanging off them (Phases 3-5)
DELETE FROM public.visit_product;
DELETE FROM public.visit_brand;
DELETE FROM public.visit_doctor;
DELETE FROM public.visit_event;
DELETE FROM public.visit_addendum;
DELETE FROM public.visit_exception;
DELETE FROM public.follow_up;
DELETE FROM public.visit_status_history;
DELETE FROM public.kpi_period_snapshot;
DELETE FROM public.visit;

-- Planning (Phase 2)
DELETE FROM public.planned_visit_brand;
DELETE FROM public.planned_visit_doctor;
DELETE FROM public.planned_visit;
DELETE FROM public.weekly_plan;

-- Master data (Phase 1)
DELETE FROM public.rep_brand_assignment;
DELETE FROM public.doctor_clinic;
DELETE FROM public.product;
DELETE FROM public.brand;
DELETE FROM public.doctor;
DELETE FROM public.clinic;

-- Identity last. audit_log goes after the master-data deletes above, because
-- those fire audit triggers that write into it.
DELETE FROM public.approved_email_domain;
DELETE FROM public.audit_log;
DELETE FROM public.app_user;

-- Restore immediately. Everything after this line runs under the real rules.
ALTER TABLE public.visit                ENABLE TRIGGER trg_visit_no_delete;
ALTER TABLE public.visit_event          ENABLE TRIGGER trg_visit_event_no_delete;
ALTER TABLE public.visit_addendum       ENABLE TRIGGER trg_visit_addendum_no_delete;
ALTER TABLE public.visit_status_history ENABLE TRIGGER trg_visit_status_history_no_delete;
ALTER TABLE public.kpi_period_snapshot  ENABLE TRIGGER trg_kpi_snapshot_no_delete;
ALTER TABLE public.audit_log            ENABLE TRIGGER trg_audit_log_no_delete;

-- -----------------------------------------------------------------------------
-- Approved login domain
-- -----------------------------------------------------------------------------
INSERT INTO public.approved_email_domain (domain, notes) VALUES
  ('monos.mn', 'Primary company domain. Only addresses under this domain may sign in.');

-- -----------------------------------------------------------------------------
-- Users: 1 administrator, 3 managers, 7 representatives
--
-- Fixed UUIDs so tests and later seed files can reference them reliably.
-- auth_user_id is NULL: it is filled automatically the first time the person
-- signs in (see migration 0006). This is exactly how a real rollout works —
-- the administrator provisions people, then they log in.
-- -----------------------------------------------------------------------------
INSERT INTO public.app_user (id, email, full_name, phone, role, manager_id, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@monos.mn',     'Системийн администратор', '+976 9900 0001', 'administrator', NULL, true);

INSERT INTO public.app_user (id, email, full_name, phone, role, manager_id, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'manager01@monos.mn', 'Б. Мөнхзул',  '+976 9900 0011', 'manager', NULL, true),
  ('00000000-0000-0000-0000-0000000000b2', 'manager02@monos.mn', 'Д. Оюунчимэг','+976 9900 0012', 'manager', NULL, true),
  ('00000000-0000-0000-0000-0000000000b3', 'manager03@monos.mn', 'Г. Батжаргал','+976 9900 0013', 'manager', NULL, true);

INSERT INTO public.app_user (id, email, full_name, phone, role, manager_id, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'rep01@monos.mn', 'А. Ариунзаяа',  '+976 9900 0101', 'representative', '00000000-0000-0000-0000-0000000000b1', true),
  ('00000000-0000-0000-0000-0000000000c2', 'rep02@monos.mn', 'Б. Болормаа',   '+976 9900 0102', 'representative', '00000000-0000-0000-0000-0000000000b1', true),
  ('00000000-0000-0000-0000-0000000000c3', 'rep03@monos.mn', 'С. Сарангэрэл', '+976 9900 0103', 'representative', '00000000-0000-0000-0000-0000000000b1', true),
  ('00000000-0000-0000-0000-0000000000c4', 'rep04@monos.mn', 'Т. Тэмүүлэн',   '+976 9900 0104', 'representative', '00000000-0000-0000-0000-0000000000b2', true),
  ('00000000-0000-0000-0000-0000000000c5', 'rep05@monos.mn', 'Э. Энхжаргал',  '+976 9900 0105', 'representative', '00000000-0000-0000-0000-0000000000b2', true),
  ('00000000-0000-0000-0000-0000000000c6', 'rep06@monos.mn', 'Н. Нарантуяа',  '+976 9900 0106', 'representative', '00000000-0000-0000-0000-0000000000b3', true),
  ('00000000-0000-0000-0000-0000000000c7', 'rep07@monos.mn', 'Ж. Жавхлан',    '+976 9900 0107', 'representative', '00000000-0000-0000-0000-0000000000b3', true);

-- -----------------------------------------------------------------------------
-- Clinics — 15, spread over the Ulaanbaatar districts.
-- Coordinates are real points inside the named district so that distance and
-- geofence behaviour can be tested realistically. The clinics themselves are
-- fictional.
--
-- Note the deliberately varied geofence radii: a large hospital campus needs
-- more than 150 m, a single-floor clinic needs less.
-- -----------------------------------------------------------------------------
INSERT INTO public.clinic
  (code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m, contact_phone, notes) VALUES
  ('CL-001','Дермалайф арьс судлалын төв','Тусгай мэргэжлийн эмнэлэг','Сүхбаатар','Сүхбаатар дүүрэг, 1-р хороо, Энх тайвны өргөн чөлөө 12',      47.918700,106.917200,150,'+976 7011 0001','Арьс судлалын 4 эмчтэй. Хүлээн авалт 2 давхарт.'),
  ('CL-002','Гоо Сайхан клиник','Гоо сайхны клиник','Сүхбаатар','Сүхбаатар дүүрэг, 8-р хороо, Их сургуулийн гудамж 5',                          47.923400,106.930100,120,'+976 7011 0002','Жижиг клиник. Радиус багатай.'),
  ('CL-003','Баянзүрх Нэгдсэн Эмнэлэг','Дүүргийн нэгдсэн эмнэлэг','Баянзүрх','Баянзүрх дүүрэг, 13-р хороо, Мандал гудамж 44',                   47.917800,106.965400,300,'+976 7011 0003','Том цогцолбор. Радиус 300 м.'),
  ('CL-004','Хан-Уул Арьс Судлал','Тусгай мэргэжлийн эмнэлэг','Хан-Уул','Хан-Уул дүүрэг, 4-р хороо, Чингисийн өргөн чөлөө 27',                  47.888900,106.906700,150,'+976 7011 0004',NULL),
  ('CL-005','Сонгино Гэр Бүлийн Эрүүл Мэндийн Төв','Гэр бүлийн эмнэлэг','Сонгинохайрхан','СХД, 20-р хороо, Барилгачдын гудамж 8',              47.905600,106.783300,180,'+976 7011 0005',NULL),
  ('CL-006','Чингэлтэй Дермато Клиник','Гоо сайхны клиник','Чингэлтэй','Чингэлтэй дүүрэг, 4-р хороо, Бага тойруу 15',                          47.928900,106.911100,130,'+976 7011 0006',NULL),
  ('CL-007','Баянгол Дүүргийн Эмнэлэг','Дүүргийн нэгдсэн эмнэлэг','Баянгол','Баянгол дүүрэг, 10-р хороо, Ард Аюушийн өргөн чөлөө 51',          47.913300,106.851100,250,'+976 7011 0007','Арьсны кабинет 3 давхарт.'),
  ('CL-008','Улаанбаатар Арьс Гоо Заслын Төв','Тусгай мэргэжлийн эмнэлэг','Сүхбаатар','Сүхбаатар дүүрэг, 6-р хороо, Сөүлийн гудамж 21',        47.921100,106.898900,150,'+976 7011 0008',NULL),
  ('CL-009','Од Клиник','Хувийн клиник','Хан-Уул','Хан-Уул дүүрэг, 15-р хороо, Зайсангийн гудамж 3',                                           47.875600,106.912200,140,'+976 7011 0009',NULL),
  ('CL-010','Ирээдүй Эмнэлэг','Хувийн эмнэлэг','Баянзүрх','Баянзүрх дүүрэг, 26-р хороо, Их тойруу 76',                                          47.930000,106.978900,200,'+976 7011 0010',NULL),
  ('CL-011','Налайх Нэгдсэн Эмнэлэг','Дүүргийн нэгдсэн эмнэлэг','Налайх','Налайх дүүрэг, 2-р хороо, Төв гудамж 1',                              47.772200,107.253300,250,'+976 7011 0011','Хотоос алслагдсан. Зам 40 минут.'),
  ('CL-012','Эрүүл Арьс Төв','Тусгай мэргэжлийн эмнэлэг','Баянгол','Баянгол дүүрэг, 20-р хороо, Тээвэрчдийн гудамж 9',                          47.908900,106.836700,150,'+976 7011 0012',NULL),
  ('CL-013','Мишээл Гоо Сайхны Клиник','Гоо сайхны клиник','Хан-Уул','Хан-Уул дүүрэг, 11-р хороо, Мишээл экспо орчим',                          47.895600,106.878900,120,'+976 7011 0013',NULL),
  ('CL-014','Төв Эмнэлгийн Арьсны Тасаг','Улсын эмнэлэг','Чингэлтэй','Чингэлтэй дүүрэг, 6-р хороо, С. Зоригийн гудамж 2',                       47.935600,106.920000,350,'+976 7011 0014','Улсын том эмнэлэг. Радиус 350 м.'),
  ('CL-015','Сонгинохайрхан Арьсны Кабинет','Гэр бүлийн эмнэлэг','Сонгинохайрхан','СХД, 32-р хороо, Тахилтын гудамж 14',                        47.891100,106.756700,160,'+976 7011 0015',NULL);

-- -----------------------------------------------------------------------------
-- Brands — 10 fictional dermocosmetics brands
-- -----------------------------------------------------------------------------
INSERT INTO public.brand (code, name, category) VALUES
  ('BR-01','Dermalys',      'Дермокосметик'),
  ('BR-02','Aquaderm',      'Чийгшүүлэгч'),
  ('BR-03','Solaris Care',  'Нарнаас хамгаалах'),
  ('BR-04','Acnetrol',      'Батга эмчилгээ'),
  ('BR-05','Atopicalm',     'Атопик арьс'),
  ('BR-06','Keratine Pro',  'Үс арчилгаа'),
  ('BR-07','Lumiskin',      'Толбо цайруулах'),
  ('BR-08','Sensiderm',     'Мэдрэг арьс'),
  ('BR-09','Nutrivital',    'Хүнсний нэмэлт'),
  ('BR-10','Repairix',      'Сэргээх эмчилгээ');

-- -----------------------------------------------------------------------------
-- Products — 5 per brand = 50
-- Generated so the list stays maintainable, but each has a real SKU and name.
-- -----------------------------------------------------------------------------
INSERT INTO public.product (sku, name, brand_id, category)
SELECT
  b.code || '-P' || lpad(g.i::text, 2, '0')                       AS sku,
  b.name || ' ' || v.variant                                       AS name,
  b.id                                                             AS brand_id,
  b.category
FROM public.brand b
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    (1, 'Цэвэрлэгч гель 200мл'),
    (2, 'Чийгшүүлэгч крем 50мл'),
    (3, 'Сийвэн 30мл'),
    (4, 'Тослог тос 100мл'),
    (5, 'Маск 5 ширхэг')
  ) AS t(i, variant)
) AS v
JOIN LATERAL (SELECT v.i) AS g(i) ON true;

-- -----------------------------------------------------------------------------
-- Doctors — 50, synthetic names, dermatology-related specialities
-- -----------------------------------------------------------------------------
INSERT INTO public.doctor (code, full_name, speciality, phone, email, professional_notes)
SELECT
  'DR-' || lpad(n::text, 3, '0'),
  initial || '. ' || given,
  speciality,
  '+976 8800 ' || lpad(n::text, 4, '0'),
  NULL,                      -- email left empty: optional, and not needed for seed
  note
FROM (
  VALUES
    ( 1,'А','Алтанцэцэг','Арьс судлаач','Хүүхдийн арьсны асуудлаар мэргэшсэн.'),
    ( 2,'Б','Батсайхан','Арьс судлаач',NULL),
    ( 3,'Г','Ганбаатар','Гоо заслын эмч',NULL),
    ( 4,'Д','Дэлгэрмаа','Арьс судлаач','Атопик дерматит сонирхдог.'),
    ( 5,'Ж','Жаргалсайхан','Харшил судлаач',NULL),
    ( 6,'З','Золжаргал','Арьс судлаач',NULL),
    ( 7,'И','Ичинхорлоо','Гоо заслын эмч',NULL),
    ( 8,'Л','Лхагвасүрэн','Арьс судлаач',NULL),
    ( 9,'М','Мөнхбат','Гэр бүлийн эмч',NULL),
    (10,'Н','Нарангэрэл','Арьс судлаач','Лазер эмчилгээний чиглэлээр.'),
    (11,'О','Отгонбаяр','Арьс судлаач',NULL),
    (12,'П','Пүрэвдорж','Харшил судлаач',NULL),
    (13,'Р','Рэнцэндорж','Гоо заслын эмч',NULL),
    (14,'С','Сайнбаяр','Арьс судлаач',NULL),
    (15,'Т','Түвшинжаргал','Гэр бүлийн эмч',NULL),
    (16,'У','Уранчимэг','Арьс судлаач',NULL),
    (17,'Ф','Фарида','Гоо заслын эмч',NULL),
    (18,'Х','Хулан','Арьс судлаач','Батга эмчилгээний чиглэлээр.'),
    (19,'Ц','Цэрэнханд','Арьс судлаач',NULL),
    (20,'Ч','Чинбат','Гэр бүлийн эмч',NULL),
    (21,'Ш','Шинэбаяр','Арьс судлаач',NULL),
    (22,'Э','Энхтуяа','Гоо заслын эмч',NULL),
    (23,'Ю','Юмжав','Арьс судлаач',NULL),
    (24,'Я','Янжмаа','Харшил судлаач',NULL),
    (25,'А','Амаржаргал','Арьс судлаач',NULL),
    (26,'Б','Баярмаа','Гоо заслын эмч',NULL),
    (27,'Г','Гэрэлмаа','Арьс судлаач',NULL),
    (28,'Д','Долгорсүрэн','Гэр бүлийн эмч',NULL),
    (29,'Е','Ерөөлт','Арьс судлаач',NULL),
    (30,'Ж','Жамбалдорж','Арьс судлаач',NULL),
    (31,'З','Зулаа','Гоо заслын эмч',NULL),
    (32,'И','Идэрбаяр','Арьс судлаач',NULL),
    (33,'К','Ким','Харшил судлаач',NULL),
    (34,'Л','Лхагважав','Арьс судлаач',NULL),
    (35,'М','Мандахбаяр','Гэр бүлийн эмч',NULL),
    (36,'Н','Нямдорж','Арьс судлаач',NULL),
    (37,'О','Оюунтуяа','Гоо заслын эмч','Толбо цайруулах эмчилгээ.'),
    (38,'Ө','Өнөрмаа','Арьс судлаач',NULL),
    (39,'П','Пагма','Арьс судлаач',NULL),
    (40,'С','Сүхбат','Гэр бүлийн эмч',NULL),
    (41,'Т','Тунгалаг','Арьс судлаач',NULL),
    (42,'У','Уламбаяр','Гоо заслын эмч',NULL),
    (43,'Х','Хишигбат','Арьс судлаач',NULL),
    (44,'Ц','Цолмон','Харшил судлаач',NULL),
    (45,'Ч','Чимэгмаа','Арьс судлаач',NULL),
    (46,'Ш','Шүрэнчимэг','Гоо заслын эмч',NULL),
    (47,'Э','Эрдэнэчимэг','Арьс судлаач',NULL),
    (48,'Ю','Юндэнбат','Гэр бүлийн эмч',NULL),
    (49,'Я','Ялалт','Арьс судлаач',NULL),
    (50,'Б','Бямбасүрэн','Арьс судлаач','Ахлах эмч. Сургалт сонирхдог.')
) AS d(n, initial, given, speciality, note);

-- -----------------------------------------------------------------------------
-- doctor_clinic — every doctor works at 1-3 clinics.
-- Deterministic spread so tests can rely on it.
-- -----------------------------------------------------------------------------
INSERT INTO public.doctor_clinic (doctor_id, clinic_id, department, room_or_floor, available_days, available_hours)
SELECT
  d.id,
  c.id,
  CASE WHEN d.speciality = 'Арьс судлаач' THEN 'Арьс судлалын тасаг'
       WHEN d.speciality = 'Гоо заслын эмч' THEN 'Гоо заслын тасаг'
       WHEN d.speciality = 'Харшил судлаач' THEN 'Харшил судлалын тасаг'
       ELSE 'Гэр бүлийн эмчилгээний тасаг' END,
  ((dn.rn % 4) + 1)::text || '-р давхар, ' || (100 + dn.rn)::text || ' тоот',
  CASE WHEN dn.rn % 3 = 0 THEN ARRAY['mon','wed','fri']
       WHEN dn.rn % 3 = 1 THEN ARRAY['tue','thu']
       ELSE ARRAY['mon','tue','wed','thu','fri'] END,
  CASE WHEN dn.rn % 2 = 0 THEN '09:00-13:00' ELSE '14:00-18:00' END
FROM (
  SELECT id, speciality, row_number() OVER (ORDER BY code) AS rn FROM public.doctor
) AS dn
JOIN public.doctor d ON d.id = dn.id
JOIN LATERAL (
  -- clinic 1: spread all 50 doctors over the 15 clinics
  -- clinic 2: every 2nd doctor also works at a second clinic
  -- clinic 3: every 5th doctor also works at a third
  SELECT cl.id
  FROM public.clinic cl
  JOIN (
    SELECT code, row_number() OVER (ORDER BY code) - 1 AS ci FROM public.clinic
  ) ci ON ci.code = cl.code
  WHERE ci.ci = (dn.rn - 1) % 15
     OR (dn.rn % 2 = 0 AND ci.ci = (dn.rn + 4) % 15)
     OR (dn.rn % 5 = 0 AND ci.ci = (dn.rn + 8) % 15)
) AS c ON true;

-- -----------------------------------------------------------------------------
-- Representative → brand assignments
--
-- 7 representatives, 10 brands, 3-4 brands each, WITH DELIBERATE OVERLAP.
-- The overlap is the point: rep01 and rep04 both carry Solaris Care, so both
-- may legitimately plan a visit to the same doctor on the same day. The
-- duplicate-prevention rule (Phase 2) must allow that while still blocking a
-- single representative from double-booking.
-- -----------------------------------------------------------------------------
INSERT INTO public.rep_brand_assignment (rep_id, brand_id, start_date)
SELECT u.id, b.id, DATE '2026-01-01'
FROM (VALUES
  ('rep01@monos.mn', ARRAY['BR-01','BR-02','BR-03']),
  ('rep02@monos.mn', ARRAY['BR-04','BR-05','BR-06']),
  ('rep03@monos.mn', ARRAY['BR-07','BR-08','BR-09','BR-10']),
  ('rep04@monos.mn', ARRAY['BR-01','BR-03','BR-07']),          -- overlaps rep01 & rep03
  ('rep05@monos.mn', ARRAY['BR-02','BR-05','BR-08']),          -- overlaps rep01, rep02, rep03
  ('rep06@monos.mn', ARRAY['BR-04','BR-06','BR-09','BR-10']),  -- overlaps rep02 & rep03
  ('rep07@monos.mn', ARRAY['BR-01','BR-05','BR-07','BR-10'])   -- overlaps several
) AS a(email, brand_codes)
JOIN public.app_user u ON u.email = a.email::citext
JOIN public.brand    b ON b.code = ANY (a.brand_codes);

COMMIT;

-- -----------------------------------------------------------------------------
-- Summary
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT
    (SELECT count(*) FROM public.app_user WHERE role = 'representative') AS reps,
    (SELECT count(*) FROM public.app_user WHERE role = 'manager')        AS managers,
    (SELECT count(*) FROM public.app_user WHERE role = 'administrator')  AS admins,
    (SELECT count(*) FROM public.clinic)                                 AS clinics,
    (SELECT count(*) FROM public.doctor)                                 AS doctors,
    (SELECT count(*) FROM public.doctor_clinic)                          AS doctor_clinics,
    (SELECT count(*) FROM public.brand)                                  AS brands,
    (SELECT count(*) FROM public.product)                                AS products,
    (SELECT count(*) FROM public.rep_brand_assignment)                   AS assignments
  INTO r;

  RAISE NOTICE 'Seed complete: % reps, % managers, % admin, % clinics, % doctors, % doctor-clinic links, % brands, % products, % brand assignments',
    r.reps, r.managers, r.admins, r.clinics, r.doctors, r.doctor_clinics, r.brands, r.products, r.assignments;
END;
$$;
