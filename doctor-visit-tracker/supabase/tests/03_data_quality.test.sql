-- ===========================================================================
-- TEST — Data quality rules on master data
-- Covers: required fields, duplicate detection, coordinate validation,
-- orphan prevention, soft deletion, audit-log creation, patient-data blocking.
-- ===========================================================================
\set ON_ERROR_STOP on
\echo '--- 03 data quality'

begin;

create or replace function pg_temp.expect(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_condition then raise exception 'FAILED: %', p_label; end if;
  raise notice '  ok  %', p_label;
end;
$$;

create or replace function pg_temp.expect_error(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  ok  % (rejected: %)', p_label, left(sqlerrm, 55);
    return;
  end;
  raise exception 'FAILED: % — the value was accepted but should have been rejected', p_label;
end;
$$;


-- ---------------------------------------------------------------------------
-- Required fields
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $sql$ insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
        values ('   ', 'clinic', 'Баянгол', 'Хаяг', 47.9, 106.9) $sql$,
  'a blank clinic name is rejected');

select pg_temp.expect_error(
  $sql$ insert into public.doctors (full_name, speciality) values ('', 'Арьс') $sql$,
  'a blank doctor name is rejected');

select pg_temp.expect_error(
  $sql$ insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
        values ('Эмнэлэг', 'clinic', 'Баянгол', 'Хаяг', null, 106.9) $sql$,
  'a clinic without latitude is rejected');


-- ---------------------------------------------------------------------------
-- Coordinate validation
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $sql$ insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
        values ('Буруу өргөрөг', 'clinic', 'Баянгол', 'Хаяг', 95.0, 106.9) $sql$,
  'latitude above 90 is rejected');

select pg_temp.expect_error(
  $sql$ insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
        values ('Буруу уртраг', 'clinic', 'Баянгол', 'Хаяг', 47.9, 200.0) $sql$,
  'longitude above 180 is rejected');

select pg_temp.expect_error(
  $sql$ update public.clinics set geofence_radius_m = 5 where code = 'CL-001' $sql$,
  'a geofence radius below the 30 m minimum is rejected');

select pg_temp.expect_error(
  $sql$ update public.clinics set geofence_radius_m = 9000 where code = 'CL-001' $sql$,
  'a geofence radius above the 2000 m maximum is rejected');


-- ---------------------------------------------------------------------------
-- Duplicate detection
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $sql$ insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
        values ('Түмэн Арьс Судлалын Төв', 'clinic', 'Сүхбаатар', 'Өөр хаяг', 47.91, 106.92) $sql$,
  'the same clinic name in the same district is rejected');

-- Whitespace and letter case must not defeat the check.
select pg_temp.expect_error(
  $sql$ insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
        values ('  түмэн   арьс судлалын   төв ', 'clinic', ' Сүхбаатар ', 'Өөр хаяг', 47.91, 106.92) $sql$,
  'a duplicate clinic name with different spacing and case is still rejected');

-- The same name in a DIFFERENT district is a different clinic, and is fine.
insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
values ('Түмэн Арьс Судлалын Төв', 'clinic', 'Налайх', 'Салбар', 47.77, 107.25);
select pg_temp.expect(
  (select count(*) from public.clinics where name = 'Түмэн Арьс Судлалын Төв') = 2,
  'the same clinic name in a different district is allowed (a branch)');

select pg_temp.expect_error(
  $sql$ insert into public.doctors (full_name, speciality) values ('Д.Оюунчимэг', 'Арьс өвчин судлал') $sql$,
  'a duplicate doctor (same name, speciality and phone) is rejected');

-- Same name, different speciality — a genuinely different person.
insert into public.doctors (full_name, speciality) values ('Д.Оюунчимэг', 'Мэс засал');
select pg_temp.expect(
  (select count(*) from public.doctors where full_name = 'Д.Оюунчимэг') = 2,
  'the same name with a different speciality is allowed');

select pg_temp.expect_error(
  $sql$ insert into public.brands (name) values ('dermaline') $sql$,
  'a duplicate brand name differing only in case is rejected');

select pg_temp.expect_error(
  $sql$ insert into public.products (name, sku, brand_id)
        select 'Copy', p.sku, p.brand_id from public.products p limit 1 $sql$,
  'a duplicate product SKU is rejected');


-- ---------------------------------------------------------------------------
-- Orphan prevention
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $sql$ insert into public.products (name, sku, brand_id)
        values ('Өнчин', 'ORPHAN-01', '00000000-0000-4000-a000-0000000000ff') $sql$,
  'a product cannot point at a brand that does not exist');

select pg_temp.expect_error(
  $sql$ delete from public.brands where name = 'Dermaline' $sql$,
  'a brand that still has products cannot be deleted');

select pg_temp.expect_error(
  $sql$ delete from public.doctors where code = 'DR-001' $sql$,
  'a doctor linked to a clinic cannot be deleted');


-- ---------------------------------------------------------------------------
-- Soft deletion keeps master data out of the app without destroying history
-- ---------------------------------------------------------------------------
update public.clinics set deleted_at = now() where code = 'CL-015';
select pg_temp.expect(
  (select deleted_at from public.clinics where code = 'CL-015') is not null,
  'a clinic can be soft deleted');
-- The unique index ignores soft-deleted rows, so the name becomes reusable.
insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
values ('Налайх Нэгдсэн Эмнэлэг', 'public_hospital', 'Налайх', 'Шинэ байр', 47.77, 107.25);
select pg_temp.expect(
  (select count(*) from public.clinics where code is null and name = 'Налайх Нэгдсэн Эмнэлэг') = 1,
  'the name of a soft-deleted clinic can be reused');


-- ---------------------------------------------------------------------------
-- Brand assignments
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(
  $sql$ insert into public.representative_brand_assignments (representative_id, brand_id, start_date)
        values ('00000000-0000-4000-a000-000000000011',
                '30000000-0000-4000-a000-000000000001', date '2026-01-01') $sql$,
  'a manager cannot be given a brand assignment');

select pg_temp.expect_error(
  $sql$ insert into public.representative_brand_assignments (representative_id, brand_id, start_date)
        values ('00000000-0000-4000-a000-000000000021',
                '30000000-0000-4000-a000-000000000001', date '2026-06-01') $sql$,
  'the same representative cannot hold the same brand over overlapping dates');

-- A non-overlapping later period is fine (the person picks the brand up again).
update public.representative_brand_assignments
   set end_date = date '2026-03-31'
 where representative_id = '00000000-0000-4000-a000-000000000021'
   and brand_id = '30000000-0000-4000-a000-000000000001';
insert into public.representative_brand_assignments (representative_id, brand_id, start_date)
values ('00000000-0000-4000-a000-000000000021', '30000000-0000-4000-a000-000000000001', date '2026-06-01');
select pg_temp.expect(
  (select count(*) from public.representative_brand_assignments
    where representative_id = '00000000-0000-4000-a000-000000000021'
      and brand_id = '30000000-0000-4000-a000-000000000001') = 2,
  'a later, non-overlapping assignment of the same brand is allowed');

select pg_temp.expect_error(
  $sql$ insert into public.representative_brand_assignments
          (representative_id, brand_id, start_date, end_date)
        values ('00000000-0000-4000-a000-000000000022',
                '30000000-0000-4000-a000-000000000010', date '2026-05-01', date '2026-04-01') $sql$,
  'an end date before the start date is rejected');


-- ---------------------------------------------------------------------------
-- Patient / personal identifiers must never enter free text
-- ---------------------------------------------------------------------------
select pg_temp.expect(
  public.contains_personal_identifier('Өвчтөн УБ12345678 ирсэн'),
  'a Mongolian national ID pattern is detected');
select pg_temp.expect(
  public.contains_personal_identifier('регистр 99123456 дугаартай'),
  'a long bare digit run is detected');
select pg_temp.expect(
  not public.contains_personal_identifier('Dermaline SPF50 бүтээгдэхүүнийг танилцууллаа'),
  'ordinary professional text is not flagged');
select pg_temp.expect(
  not public.contains_personal_identifier('2026 оны 7 сард 15 ширхэг сорьц өглөө'),
  'ordinary numbers in text are not flagged');

select pg_temp.expect_error(
  $sql$ update public.doctors set professional_notes = 'Өвчтөн УБ12345678 харшилтай'
        where code = 'DR-002' $sql$,
  'doctor notes containing a national ID are rejected');


-- ---------------------------------------------------------------------------
-- Timestamps and the audit trail
-- ---------------------------------------------------------------------------
select pg_temp.expect(
  (select count(*) from public.clinics where created_at is null or updated_at is null) = 0,
  'every clinic has creation and modification timestamps');

-- updated_at is stamped by the server, so a client value is overwritten.
update public.clinics set name = 'Хангай Эмнэлэг (шинэчилсэн)', updated_at = timestamptz '2000-01-01'
 where code = 'CL-002';
select pg_temp.expect(
  (select updated_at from public.clinics where code = 'CL-002') > now() - interval '1 minute',
  'updated_at cannot be backdated by the client');

select pg_temp.expect(
  (select count(*) from public.audit_logs
    where action = 'master_data_updated' and entity_type = 'clinics') > 0,
  'editing a clinic writes an audit entry');
select pg_temp.expect(
  (select count(*) from public.audit_logs
    where action = 'master_data_created' and entity_type = 'doctors') > 0,
  'creating a doctor writes an audit entry');
select pg_temp.expect(
  (select before_data is not null and after_data is not null
     from public.audit_logs
    where action = 'master_data_updated' and entity_type = 'clinics'
    order by id desc limit 1),
  'the audit entry records both the old and the new value');

rollback;
\echo '--- 03 passed'
