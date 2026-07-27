-- ===========================================================================
-- SEED / TEST DATA — Phase 1
-- ---------------------------------------------------------------------------
-- ALL PEOPLE AND CLINICS BELOW ARE INVENTED.
-- No real doctor, no real patient and no real personal information appears
-- anywhere in this file. Clinic names are fictional; coordinates are plausible
-- points in Ulaanbaatar chosen only so the geofence can be demonstrated.
--
-- Contents:
--   1 approved e-mail domain      1 administrator
--   3 managers                    7 medical representatives
--   15 clinics                    50 doctors (+ clinic links)
--   10 brands                     50 products
--   representative-brand assignments (3-4 brands each)
--
-- Later phases append weekly plans and visits to this same file.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Approved company e-mail domain
-- ---------------------------------------------------------------------------
insert into public.approved_email_domains (domain, note) values
  ('company.mn', 'Main company domain. Replace with the real one before go-live.')
on conflict (domain) do nothing;


-- ---------------------------------------------------------------------------
-- 1. Staff — 1 administrator, 3 managers, 7 representatives
-- ---------------------------------------------------------------------------
insert into public.app_users (id, email, full_name, employee_code, role, phone) values
  ('00000000-0000-4000-a000-000000000001', 'admin@company.mn',    'А.Батбаяр',      'EMP-001', 'administrator', '+976 9911 0001'),

  ('00000000-0000-4000-a000-000000000011', 'manager1@company.mn', 'Б.Оюунчимэг',    'EMP-011', 'manager',       '+976 9911 0011'),
  ('00000000-0000-4000-a000-000000000012', 'manager2@company.mn', 'Г.Мөнхбат',      'EMP-012', 'manager',       '+976 9911 0012'),
  ('00000000-0000-4000-a000-000000000013', 'manager3@company.mn', 'Д.Сэлэнгэ',      'EMP-013', 'manager',       '+976 9911 0013'),

  ('00000000-0000-4000-a000-000000000021', 'rep1@company.mn',     'Е.Ариунзаяа',    'EMP-021', 'representative','+976 9911 0021'),
  ('00000000-0000-4000-a000-000000000022', 'rep2@company.mn',     'Ж.Тэмүүлэн',     'EMP-022', 'representative','+976 9911 0022'),
  ('00000000-0000-4000-a000-000000000023', 'rep3@company.mn',     'З.Намуун'      , 'EMP-023', 'representative','+976 9911 0023'),
  ('00000000-0000-4000-a000-000000000024', 'rep4@company.mn',     'И.Батжаргал',    'EMP-024', 'representative','+976 9911 0024'),
  ('00000000-0000-4000-a000-000000000025', 'rep5@company.mn',     'К.Хулан',        'EMP-025', 'representative','+976 9911 0025'),
  ('00000000-0000-4000-a000-000000000026', 'rep6@company.mn',     'Л.Энхтуяа',      'EMP-026', 'representative','+976 9911 0026'),
  ('00000000-0000-4000-a000-000000000027', 'rep7@company.mn',     'М.Ганзориг',     'EMP-027', 'representative','+976 9911 0027')
on conflict (id) do nothing;

-- Reporting lines (informational only; managers see everyone regardless)
update public.app_users set manager_id = '00000000-0000-4000-a000-000000000011'
  where employee_code in ('EMP-021', 'EMP-022', 'EMP-023');
update public.app_users set manager_id = '00000000-0000-4000-a000-000000000012'
  where employee_code in ('EMP-024', 'EMP-025');
update public.app_users set manager_id = '00000000-0000-4000-a000-000000000013'
  where employee_code in ('EMP-026', 'EMP-027');


-- ---------------------------------------------------------------------------
-- 2. Clinics — 15 fictional sites across Ulaanbaatar
-- ---------------------------------------------------------------------------
insert into public.clinics
  (id, code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m, contact_phone, notes)
values
  ('10000000-0000-4000-a000-000000000001','CL-001','Түмэн Арьс Судлалын Төв',        'dermatology_center','Сүхбаатар',      'Сүхбаатар дүүрэг, 1-р хороо, Энхтайваны өргөн чөлөө 12',      47.918700, 106.917400, 150,'+976 7011 0001','Гол түншлэгч төв'),
  ('10000000-0000-4000-a000-000000000002','CL-002','Хангай Эмнэлэг',                  'private_hospital',  'Баянгол',        'Баянгол дүүрэг, 4-р хороо, Их тойруу 45',                      47.913200, 106.876500, 200,'+976 7011 0002',null),
  ('10000000-0000-4000-a000-000000000003','CL-003','Ундрам Гоо Сайхны Клиник',        'clinic',            'Хан-Уул',        'Хан-Уул дүүрэг, 3-р хороо, Чингисийн өргөн чөлөө 8',           47.900100, 106.914800, 150,'+976 7011 0003',null),
  ('10000000-0000-4000-a000-000000000004','CL-004','Дэлгэрэх Улсын Нэгдсэн Эмнэлэг',  'public_hospital',   'Баянзүрх',       'Баянзүрх дүүрэг, 8-р хороо, Нарны зам 22',                     47.921500, 106.965300, 350,'+976 7011 0004','Том кампус — радиус томсгосон'),
  ('10000000-0000-4000-a000-000000000005','CL-005','Сарнай Арьсны Эмнэлэг',           'dermatology_center','Чингэлтэй',      'Чингэлтэй дүүрэг, 2-р хороо, Бага тойруу 5',                   47.926400, 106.907700, 150,'+976 7011 0005',null),
  ('10000000-0000-4000-a000-000000000006','CL-006','Оргил Эмнэлэг',                    'private_hospital',  'Сонгинохайрхан','Сонгинохайрхан дүүрэг, 20-р хороо, Барилгачдын гудамж 3',      47.907800, 106.803200, 200,'+976 7011 0006',null),
  ('10000000-0000-4000-a000-000000000007','CL-007','Ирээдүй Гэр Бүлийн Эмнэлэг',      'clinic',            'Баянгол',        'Баянгол дүүрэг, 11-р хороо, Ард Аюушийн өргөн чөлөө 30',       47.905600, 106.859400, 150,'+976 7011 0007',null),
  ('10000000-0000-4000-a000-000000000008','CL-008','Мөнх Ногоон Клиник',              'clinic',            'Сүхбаатар',      'Сүхбаатар дүүрэг, 6-р хороо, Их сургуулийн гудамж 17',         47.923900, 106.928600, 120,'+976 7011 0008',null),
  ('10000000-0000-4000-a000-000000000009','CL-009','Цэцэг Дерматологи',               'dermatology_center','Хан-Уул',        'Хан-Уул дүүрэг, 15-р хороо, Зайсангийн гудамж 2',              47.887300, 106.921100, 150,'+976 7011 0009',null),
  ('10000000-0000-4000-a000-000000000010','CL-010','Ач Эрдэнэ Эмнэлэг',               'private_hospital',  'Баянзүрх',       'Баянзүрх дүүрэг, 26-р хороо, Дамбадаржаагийн зам 41',          47.945200, 106.988700, 250,'+976 7011 0010',null),
  ('10000000-0000-4000-a000-000000000011','CL-011','Найрамдал Поликлиник',            'public_hospital',   'Чингэлтэй',      'Чингэлтэй дүүрэг, 12-р хороо, Тэмүүжингийн гудамж 9',          47.938100, 106.902400, 250,'+976 7011 0011',null),
  ('10000000-0000-4000-a000-000000000012','CL-012','Гэгээн Гоо Сайхны Төв',           'clinic',            'Сүхбаатар',      'Сүхбаатар дүүрэг, 8-р хороо, Сөүлийн гудамж 14',               47.915900, 106.936200, 120,'+976 7011 0012',null),
  ('10000000-0000-4000-a000-000000000013','CL-013','Хүслэн Эмийн Сүлжээ — Төв Салбар','pharmacy_chain',    'Баянгол',        'Баянгол дүүрэг, 20-р хороо, Хувьсгалчдын гудамж 7',            47.910300, 106.845800, 100,'+976 7011 0013','Зөвхөн зөвлөгөө өгөх уулзалт'),
  ('10000000-0000-4000-a000-000000000014','CL-014','Тэнгэр Арьс Гоо Заслын Клиник',   'dermatology_center','Сонгинохайрхан','Сонгинохайрхан дүүрэг, 7-р хороо, Гандангийн зам 11',          47.919600, 106.879900, 150,'+976 7011 0014',null),
  ('10000000-0000-4000-a000-000000000015','CL-015','Налайх Нэгдсэн Эмнэлэг',          'public_hospital',   'Налайх',         'Налайх дүүрэг, 3-р хороо, Төвийн зам 1',                       47.772400, 107.250800, 300,'+976 7011 0015','Хотоос алслагдсан — өдөрт нэг уулзалт')
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- 3. Doctors — 50 invented names
-- ---------------------------------------------------------------------------
with names as (
  select * from (values
    ( 1,'Д.Оюунчимэг','Арьс өвчин судлал'),      ( 2,'Б.Ганбат','Арьс өвчин судлал'),
    ( 3,'С.Нарантуяа','Гоо засал'),               ( 4,'Ц.Батсайхан','Арьс өвчин судлал'),
    ( 5,'Н.Уранчимэг','Хүүхдийн арьс өвчин'),     ( 6,'О.Ганцэцэг','Гоо засал'),
    ( 7,'П.Эрдэнэбат','Арьс өвчин судлал'),       ( 8,'Р.Мөнхзул','Харшил судлал'),
    ( 9,'С.Түвшинбаяр','Арьс өвчин судлал'),      (10,'Т.Алтанцэцэг','Гоо засал'),
    (11,'У.Батболд'     ,'Арьс өвчин судлал'),   (12,'Ф.Сүхбаатар','Гоо засал'),
    (13,'Х.Наранцэцэг','Хүүхдийн арьс өвчин'),    (14,'Ц.Дэлгэрмаа','Арьс өвчин судлал'),
    (15,'Ч.Энхжаргал','Гоо засал'),               (16,'Ш.Отгонбаяр','Арьс өвчин судлал'),
    (17,'Э.Мөнхтуяа','Харшил судлал'),            (18,'Ю.Ганбаатар','Арьс өвчин судлал'),
    (19,'Я.Сарантуяа','Гоо засал'),               (20,'А.Батзориг','Арьс өвчин судлал'),
    (21,'Б.Цэцэгмаа','Хүүхдийн арьс өвчин'),      (22,'В.Дорждэрэм','Арьс өвчин судлал'),
    (23,'Г.Энхбаяр','Гоо засал'),                 (24,'Д.Мөнхцэцэг','Арьс өвчин судлал'),
    (25,'Е.Батмөнх','Харшил судлал'),             (26,'Ж.Оюунбилэг','Гоо засал'),
    (27,'З.Түмэнбаяр','Арьс өвчин судлал'),       (28,'И.Наранбаатар','Арьс өвчин судлал'),
    (29,'К.Соёлмаа','Гоо засал'),                 (30,'Л.Ганхуяг','Арьс өвчин судлал'),
    (31,'М.Уранбилэг','Хүүхдийн арьс өвчин'),     (32,'Н.Батбаяр','Арьс өвчин судлал'),
    (33,'О.Мөнхжаргал','Гоо засал'),              (34,'П.Цэрэндолгор','Арьс өвчин судлал'),
    (35,'Р.Эрдэнэчимэг','Харшил судлал'),         (36,'С.Ганболд','Арьс өвчин судлал'),
    (37,'Т.Ариунтуяа','Гоо засал'),               (38,'У.Дэлгэрсайхан','Арьс өвчин судлал'),
    (39,'Ф.Нямсүрэн','Арьс өвчин судлал'),        (40,'Х.Отгонжаргал'    ,'Гоо засал'),
    (41,'Ц.Баярмаа','Хүүхдийн арьс өвчин'),       (42,'Ч.Энхтөр','Арьс өвчин судлал'),
    (43,'Ш.Мөнхбаяр','Гоо засал'),                (44,'Э.Цолмон','Арьс өвчин судлал'),
    (45,'Ю.Батчимэг','Харшил судлал'),            (46,'Я.Ганцэцэг','Арьс өвчин судлал'),
    (47,'А.Тэмүүжин','Гоо засал'),                (48,'Б.Нарангэрэл','Арьс өвчин судлал'),
    (49,'Г.Сувдаа','Хүүхдийн арьс өвчин'),        (50,'Д.Эрдэнэсувд','Арьс өвчин судлал')
  ) as t(n, full_name, speciality)
)
insert into public.doctors (id, code, full_name, speciality, phone, email, professional_notes)
select
  ('20000000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid,
  'DR-' || lpad(n::text, 3, '0'),
  full_name,
  speciality,
  case when n % 3 = 0 then '+976 9900 ' || lpad(n::text, 4, '0') else null end,
  case when n % 4 = 0 then 'doctor' || n || '@example.test' else null end,
  case
    when n % 5 = 0 then 'Мэргэжлийн тэмдэглэл: эмчилгээний шинэ аргад сонирхолтой.'
    when n % 7 = 0 then 'Мэргэжлийн тэмдэглэл: сарын эхээр уулзах нь тохиромжтой.'
    else null
  end
from names
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- 4. Doctor-clinic links — each doctor works at 1-2 clinics
-- ---------------------------------------------------------------------------
insert into public.doctor_clinics
  (doctor_id, clinic_id, department, room_or_floor, available_days, available_hours)
select
  d.id,
  c.id,
  case when (dn % 3) = 0 then 'Арьс өвчний тасаг'
       when (dn % 3) = 1 then 'Гоо заслын тасаг'
       else 'Амбулатори' end,
  ((dn % 4) + 1)::text || '-р давхар, ' || (100 + dn)::text || ' тоот',
  case when dn % 2 = 0 then array['mon','wed','fri'] else array['tue','thu','sat'] end,
  case when dn % 2 = 0 then '09:00-13:00' else '14:00-18:00' end
from public.doctors d
cross join lateral (
  select right(d.code, 3)::int as dn
) x
join public.clinics c
  on c.code = 'CL-' || lpad((((x.dn - 1) % 15) + 1)::text, 3, '0')
on conflict (doctor_id, clinic_id) do nothing;

-- Every third doctor also consults at a second clinic
insert into public.doctor_clinics
  (doctor_id, clinic_id, department, room_or_floor, available_days, available_hours)
select
  d.id, c.id, 'Зөвлөх эмч', '1-р давхар', array['sat'], '10:00-14:00'
from public.doctors d
cross join lateral (select right(d.code, 3)::int as dn) x
join public.clinics c
  on c.code = 'CL-' || lpad(((x.dn % 15) + 1)::text, 3, '0')
where x.dn % 3 = 0
on conflict (doctor_id, clinic_id) do nothing;


-- ---------------------------------------------------------------------------
-- 5. Brands — 10 fictional dermocosmetics brands
-- ---------------------------------------------------------------------------
insert into public.brands (id, name, category) values
  ('30000000-0000-4000-a000-000000000001','Dermaline',   'Дермокосметик'),
  ('30000000-0000-4000-a000-000000000002','Hydravera',   'Чийгшүүлэлт'),
  ('30000000-0000-4000-a000-000000000003','Solaris Care','Нарнаас хамгаалах'),
  ('30000000-0000-4000-a000-000000000004','Puracne',     'Батга эмчилгээ'),
  ('30000000-0000-4000-a000-000000000005','Calmiderm',   'Мэдрэг арьс'),
  ('30000000-0000-4000-a000-000000000006','Nutrisilk',   'Үс, хумс'),
  ('30000000-0000-4000-a000-000000000007','Reglow',      'Хөгшрөлтийн эсрэг'),
  ('30000000-0000-4000-a000-000000000008','Baby Dermis', 'Хүүхдийн арьс'),
  ('30000000-0000-4000-a000-000000000009','Pigmenta',    'Толбоны эмчилгээ'),
  ('30000000-0000-4000-a000-000000000010','Barrier Plus','Арьсны хамгаалалт')
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- 6. Products — 5 per brand = 50
-- ---------------------------------------------------------------------------
insert into public.products (name, sku, brand_id, category)
select
  b.name || ' ' || f.form,
  upper(regexp_replace(b.name, '[^A-Za-z0-9]', '', 'g')) || '-' || lpad(f.i::text, 2, '0'),
  b.id,
  b.category
from public.brands b
cross join (values
  (1,'Cleansing Gel 200ml'),
  (2,'Repair Cream 50ml'),
  (3,'Serum 30ml'),
  (4,'SPF50+ Fluid 40ml'),
  (5,'Body Lotion 400ml')
) as f(i, form)
on conflict (sku) do nothing;


-- ---------------------------------------------------------------------------
-- 7. Representative-brand assignments — 3 or 4 brands each, with overlaps
--    so that two representatives can legitimately visit the same doctor.
-- ---------------------------------------------------------------------------
insert into public.representative_brand_assignments
  (representative_id, brand_id, start_date)
select u.id, b.id, date '2026-01-01'
from public.app_users u
join lateral (
  select unnest(
    case u.employee_code
      when 'EMP-021' then array[1, 2, 3]
      when 'EMP-022' then array[4, 5, 6]
      when 'EMP-023' then array[7, 8, 9, 10]
      when 'EMP-024' then array[1, 4, 7]
      when 'EMP-025' then array[2, 5, 8]
      when 'EMP-026' then array[3, 6, 9]
      when 'EMP-027' then array[10, 1, 5, 7]
      else array[]::int[]
    end
  ) as brand_no
) a on true
join public.brands b
  on b.id = ('30000000-0000-4000-a000-' || lpad(a.brand_no::text, 12, '0'))::uuid
where u.role = 'representative'
on conflict do nothing;

commit;


-- ===========================================================================
-- LOCAL DEVELOPMENT ONLY — fake authentication accounts.
--
-- On a real Supabase project you do NOT run this part. Real accounts are
-- created by Supabase when each person logs in with a one-time code, and the
-- login-gate trigger links them to the app_users rows above automatically.
--
-- Guard: only runs when the auth.test_sign_in helper exists, which is created
-- exclusively by supabase/tests/00_supabase_stub.sql.
-- ===========================================================================
do $$
begin
  if to_regprocedure('auth.test_sign_in(uuid)') is null then
    raise notice 'Real Supabase detected - skipping fake auth accounts.';
    return;
  end if;

  insert into auth.users (id, email, email_confirmed_at)
  select ('90000000-0000-4000-a000-' || lpad(row_number() over (order by u.employee_code)::text, 12, '0'))::uuid,
         u.email::text,
         now()
  from public.app_users u
  where u.deleted_at is null
  on conflict (email) do nothing;
end
$$;
