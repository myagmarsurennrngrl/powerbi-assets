-- ===========================================================================
-- TEST — Role-based access control and Row Level Security
-- Acceptance criteria 11, 18, 19 (Phase 1 scope).
--
-- These assertions run as the `authenticated` database role, exactly as
-- PostgREST does, so the policies are really in force. Running them as the
-- table owner would prove nothing.
--
-- IMPORTANT DISTINCTION, because it trips people up:
--   * A blocked INSERT raises an error ("violates row-level security policy").
--   * A blocked UPDATE or DELETE does NOT raise — the rows simply become
--     invisible, so ZERO rows change. Both are a refusal; they just look
--     different. The helpers below check each case correctly.
-- ===========================================================================
\set ON_ERROR_STOP on
\echo '--- 02 role permissions and RLS'

begin;

create or replace function pg_temp.expect(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception 'FAILED: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

-- The statement must be refused outright with an error.
create or replace function pg_temp.expect_error(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  ok  % (blocked: %)', p_label, left(sqlerrm, 55);
    return;
  end;
  raise exception 'FAILED: % — the statement was allowed but should not have been', p_label;
end;
$$;

-- The statement runs, but Row Level Security must hide every candidate row so
-- that nothing at all is changed.
create or replace function pg_temp.expect_no_rows_changed(p_sql text, p_label text)
returns void language plpgsql as $$
declare v_count integer;
begin
  begin
    execute p_sql;
    get diagnostics v_count = row_count;
  exception when others then
    raise notice '  ok  % (blocked with an error: %)', p_label, left(sqlerrm, 45);
    return;
  end;
  if v_count <> 0 then
    raise exception 'FAILED: % — % row(s) were changed', p_label, v_count;
  end if;
  raise notice '  ok  % (0 rows changed)', p_label;
end;
$$;

-- The statement must succeed and change exactly the expected number of rows.
create or replace function pg_temp.expect_rows_changed(p_sql text, p_expected integer, p_label text)
returns void language plpgsql as $$
declare v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  if v_count <> p_expected then
    raise exception 'FAILED: % — expected % row(s), got %', p_label, p_expected, v_count;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

-- Impersonation helper. SECURITY DEFINER so that the lookup itself is not
-- subject to the policies we are about to test.
create or replace function pg_temp.become(p_email text)
returns void language plpgsql security definer as $$
declare v_uid uuid;
begin
  select auth_user_id into v_uid
  from public.app_users
  where email = p_email::extensions.citext;

  if v_uid is null then
    raise exception 'test setup error: % has no linked auth account', p_email;
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

-- Everyone in the seed already has a fake auth account (created at the end of
-- seed.sql). Confirm that, so a setup mistake fails loudly here rather than
-- producing confusing assertion failures later.
do $$
begin
  if exists (select 1 from public.app_users where auth_user_id is null and deleted_at is null) then
    raise exception 'test setup error: some seeded users have no auth account';
  end if;
end
$$;

-- From here on we are an ordinary API caller, not the database owner.
set local role authenticated;


-- ===========================================================================
-- REPRESENTATIVE
-- ===========================================================================
select pg_temp.become('rep1@company.mn');

select pg_temp.expect(public.auth_role() = 'representative', 'rep is seen as a representative');
select pg_temp.expect(not public.is_manager(),               'rep is not a manager');
select pg_temp.expect(not public.is_admin(),                 'rep is not an administrator');

-- Master data is readable ...
select pg_temp.expect((select count(*) from public.clinics)  = 15, 'rep reads all 15 clinics');
select pg_temp.expect((select count(*) from public.doctors)  = 50, 'rep reads all 50 doctors');
select pg_temp.expect((select count(*) from public.brands)   = 10, 'rep reads all 10 brands');
select pg_temp.expect((select count(*) from public.products) = 50, 'rep reads all 50 products');
select pg_temp.expect((select count(*) from public.doctor_clinics) > 50, 'rep reads doctor-clinic links');

-- ... but not writable.
select pg_temp.expect_no_rows_changed(
  $sql$ update public.clinics set geofence_radius_m = 2000 where code = 'CL-001' $sql$,
  'rep cannot change a clinic radius');
select pg_temp.expect_error(
  $sql$ insert into public.doctors (full_name, speciality) values ('Хуурамч', 'Хуурамч') $sql$,
  'rep cannot create a doctor');
select pg_temp.expect_error(
  $sql$ insert into public.brands (name) values ('Fake Brand') $sql$,
  'rep cannot create a brand');
select pg_temp.expect_error(
  $sql$ insert into public.clinics (name, clinic_type, district, address, latitude, longitude)
        values ('Хуурамч эмнэлэг','clinic','Баянгол','Хаяг', 47.9, 106.9) $sql$,
  'rep cannot create a clinic');

-- A rep sees only their OWN brand assignments.
select pg_temp.expect(
  (select count(*) from public.representative_brand_assignments) = 3,
  'rep sees only their own 3 brand assignments');
select pg_temp.expect(
  (select count(*) from public.representative_brand_assignments
    where representative_id <> public.auth_user_id()) = 0,
  'rep sees no other representative''s assignments');

-- A rep reads only their own app_users row ...
select pg_temp.expect(
  (select count(*) from public.app_users) = 1,
  'rep reads exactly one app_users row — their own');
select pg_temp.expect(
  (select email from public.app_users) = 'rep1@company.mn',
  'the one visible row is the rep''s own');

-- ... and colleague NAMES (no contact details) through the directory view.
select pg_temp.expect(
  (select count(*) from public.staff_directory) = 11,
  'rep sees all 11 colleagues in the name-only directory');

-- Administrative configuration is invisible.
select pg_temp.expect(
  (select count(*) from public.approved_email_domains) = 0,
  'rep cannot read the approved e-mail domain list');
select pg_temp.expect(
  (select count(*) from public.app_settings where not is_public) = 0,
  'rep cannot read private settings (retention policy)');
select pg_temp.expect(
  (select count(*) from public.app_settings where is_public) > 0,
  'rep CAN read public settings (geofence radius, thresholds)');
select pg_temp.expect(
  (select count(*) from public.audit_logs) = 0,
  'rep cannot read the audit log');

-- A rep cannot promote themselves.
select pg_temp.expect_no_rows_changed(
  $sql$ update public.app_users set role = 'administrator' where email = 'rep1@company.mn' $sql$,
  'rep cannot promote themselves to administrator');
select pg_temp.expect(
  (select role from public.staff_directory where full_name = 'Е.Ариунзаяа') = 'representative',
  'the rep is still a representative afterwards');


-- ===========================================================================
-- MANAGER
-- ===========================================================================
select pg_temp.become('manager1@company.mn');

select pg_temp.expect(public.auth_role() = 'manager', 'manager is seen as a manager');
select pg_temp.expect(public.is_manager(),            'is_manager() is true for a manager');
select pg_temp.expect(not public.is_admin(),          'a manager is not an administrator');

select pg_temp.expect((select count(*) from public.app_users) = 11,
  'manager reads all 11 staff records');
select pg_temp.expect((select count(*) from public.representative_brand_assignments) = 23,
  'manager reads every brand assignment');
select pg_temp.expect((select count(*) from public.audit_logs) > 0,
  'manager can read the audit log');

select pg_temp.expect_no_rows_changed(
  $sql$ update public.clinics set name = 'Renamed' where code = 'CL-001' $sql$,
  'manager cannot edit master data');
select pg_temp.expect_error(
  $sql$ insert into public.app_users (email, full_name) values ('new@company.mn', 'Шинэ хүн') $sql$,
  'manager cannot create users');
select pg_temp.expect(
  (select count(*) from public.approved_email_domains) = 0,
  'manager cannot read the approved e-mail domain list');
select pg_temp.expect_no_rows_changed(
  $sql$ update public.app_settings set value = '999'::jsonb where key = 'gps_accuracy_threshold_m' $sql$,
  'manager cannot change application settings');


-- ===========================================================================
-- ADMINISTRATOR
-- ===========================================================================
select pg_temp.become('admin@company.mn');

select pg_temp.expect(public.is_admin(), 'administrator is recognised');
select pg_temp.expect((select count(*) from public.approved_email_domains) = 1,
  'administrator reads the approved domain list');
select pg_temp.expect((select count(*) from public.app_settings where not is_public) = 3,
  'administrator reads private settings');

select pg_temp.expect_rows_changed(
  $sql$ update public.clinics set geofence_radius_m = 400 where code = 'CL-001' $sql$,
  1, 'administrator can change a clinic geofence radius');
select pg_temp.expect(
  (select geofence_radius_m from public.clinics where code = 'CL-001') = 400,
  'the new radius is stored');

insert into public.doctors (full_name, speciality) values ('Тест Эмч', 'Арьс өвчин судлал');
select pg_temp.expect(
  (select count(*) from public.doctors where full_name = 'Тест Эмч') = 1,
  'administrator can create a doctor');

-- Not even an administrator may change their own role.
select pg_temp.expect_error(
  $sql$ update public.app_users set role = 'representative' where email = 'admin@company.mn' $sql$,
  'administrator cannot change their own role');

-- But they may change somebody else's.
select pg_temp.expect_rows_changed(
  $sql$ update public.app_users set role = 'manager' where email = 'rep7@company.mn' $sql$,
  1, 'administrator can change another user''s role');

-- Nobody may delete a user record — staff are deactivated, never deleted.
select pg_temp.expect_error(
  $sql$ delete from public.app_users where email = 'rep7@company.mn' $sql$,
  'even an administrator cannot delete a user record');

-- Nobody may tamper with the audit log.
select pg_temp.expect_error(
  $sql$ delete from public.audit_logs $sql$,
  'administrator cannot delete audit records');
select pg_temp.expect_error(
  $sql$ update public.audit_logs set action = 'tampered' $sql$,
  'administrator cannot edit audit records');
select pg_temp.expect_error(
  $sql$ insert into public.audit_logs (action, entity_type) values ('forged', 'nothing') $sql$,
  'administrator cannot write audit records by hand');


-- ===========================================================================
-- DEACTIVATED USER — loses everything at once
-- ===========================================================================
update public.app_users set is_active = false where email = 'rep2@company.mn';
select pg_temp.become('rep2@company.mn');

select pg_temp.expect(public.auth_role() is null,  'a deactivated user has no role');
select pg_temp.expect(not public.is_active_user(), 'is_active_user() is false');
select pg_temp.expect((select count(*) from public.clinics) = 0, 'deactivated user reads no clinics');
select pg_temp.expect((select count(*) from public.doctors) = 0, 'deactivated user reads no doctors');
select pg_temp.expect((select count(*) from public.app_settings) = 0, 'deactivated user reads no settings');
select pg_temp.expect((select count(*) from public.staff_directory) = 0,
  'deactivated user reads no colleague names');


-- ===========================================================================
-- NOT SIGNED IN
-- ===========================================================================
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect((select count(*) from public.clinics) = 0,   'anonymous reads no clinics');
select pg_temp.expect((select count(*) from public.doctors) = 0,   'anonymous reads no doctors');
select pg_temp.expect((select count(*) from public.app_users) = 0, 'anonymous reads no users');
select pg_temp.expect((select count(*) from public.staff_directory) = 0, 'anonymous reads no names');

reset role;
rollback;
\echo '--- 02 passed'
