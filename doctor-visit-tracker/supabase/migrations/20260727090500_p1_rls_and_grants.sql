-- ===========================================================================
-- Phase 1 / 06 — Row Level Security policies and table grants
-- ---------------------------------------------------------------------------
-- Strategy:
--   1. Revoke everything that Supabase grants by default.
--   2. Grant back only the verbs each role genuinely needs.
--   3. Enable RLS on every table and write explicit policies.
--
-- A table with RLS enabled and no matching policy returns zero rows and
-- refuses every write. That is the safe default we rely on.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Step 1 — take away the blanket default grants
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- New tables created by later migrations must not silently get grants either.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Step 2 — enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.approved_email_domains            enable row level security;
alter table public.app_users                         enable row level security;
alter table public.clinics                           enable row level security;
alter table public.doctors                           enable row level security;
alter table public.doctor_clinics                    enable row level security;
alter table public.brands                            enable row level security;
alter table public.products                          enable row level security;
alter table public.representative_brand_assignments  enable row level security;
alter table public.app_settings                      enable row level security;
alter table public.audit_logs                        enable row level security;


-- ===========================================================================
-- approved_email_domains — administrators only. Everyone else uses the
-- is_login_email_allowed() function, which reveals nothing.
-- ===========================================================================
grant select, insert, update, delete on public.approved_email_domains to authenticated;

create policy aed_admin_all on public.approved_email_domains
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===========================================================================
-- app_users
--   read : own row always; managers and administrators read everyone
--   write: administrators only, and never their own role (trigger enforces)
-- ===========================================================================
grant select, insert, update on public.app_users to authenticated;

create policy app_users_select_self on public.app_users
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy app_users_select_by_manager on public.app_users
  for select to authenticated
  using (public.is_active_user() and public.is_manager());

-- NOTE: representatives deliberately get NO policy to read other people's
-- app_users rows. They need colleagues' *names* for shared doctor history
-- (Phase 4), and they get exactly that — and nothing else — from the
-- staff_directory view below, which exposes no e-mail and no phone number.

create policy app_users_insert_admin on public.app_users
  for insert to authenticated
  with check (public.is_admin());

create policy app_users_update_admin on public.app_users
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Deliberately NO delete policy: staff are deactivated, never deleted, so the
-- audit trail and visit history stay intact.

-- Colleague names, and nothing else.
-- security_invoker = false (the default) means the view runs with its owner's
-- rights and therefore sees past the app_users policies. That is intentional
-- and safe here precisely BECAUSE the column list is narrow: no e-mail, no
-- phone, no manager chain, no timestamps. The is_active_user() guard keeps
-- deactivated staff from reading even this.
create view public.staff_directory
with (security_invoker = false) as
  select u.id, u.full_name, u.role, u.employee_code, u.is_active
  from public.app_users u
  where u.deleted_at is null
    and public.is_active_user();

comment on view public.staff_directory is
  'Display-only projection of app_users so colleagues can be named in shared history. Exposes no contact details.';

grant select on public.staff_directory to authenticated;


-- ===========================================================================
-- clinics — everyone reads active clinics; administrators manage them
-- ===========================================================================
grant select, insert, update on public.clinics to authenticated;

create policy clinics_select_all on public.clinics
  for select to authenticated
  using (public.is_active_user() and (deleted_at is null or public.is_admin()));

create policy clinics_insert_admin on public.clinics
  for insert to authenticated
  with check (public.is_admin());

create policy clinics_update_admin on public.clinics
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===========================================================================
-- doctors
-- ===========================================================================
grant select, insert, update on public.doctors to authenticated;

create policy doctors_select_all on public.doctors
  for select to authenticated
  using (public.is_active_user() and (deleted_at is null or public.is_admin()));

create policy doctors_insert_admin on public.doctors
  for insert to authenticated
  with check (public.is_admin());

create policy doctors_update_admin on public.doctors
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===========================================================================
-- doctor_clinics
-- ===========================================================================
grant select, insert, update, delete on public.doctor_clinics to authenticated;

create policy doctor_clinics_select_all on public.doctor_clinics
  for select to authenticated
  using (public.is_active_user());

create policy doctor_clinics_write_admin on public.doctor_clinics
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===========================================================================
-- brands and products
-- ===========================================================================
grant select, insert, update on public.brands   to authenticated;
grant select, insert, update on public.products to authenticated;

create policy brands_select_all on public.brands
  for select to authenticated
  using (public.is_active_user() and (deleted_at is null or public.is_admin()));

create policy brands_write_admin on public.brands
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy products_select_all on public.products
  for select to authenticated
  using (public.is_active_user() and (deleted_at is null or public.is_admin()));

create policy products_write_admin on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===========================================================================
-- representative_brand_assignments
--   read : own assignments; managers and administrators read all
--   write: administrators only
-- ===========================================================================
grant select, insert, update, delete on public.representative_brand_assignments to authenticated;

create policy rba_select_own on public.representative_brand_assignments
  for select to authenticated
  using (public.is_active_user() and representative_id = public.auth_user_id());

create policy rba_select_manager on public.representative_brand_assignments
  for select to authenticated
  using (public.is_active_user() and public.is_manager());

create policy rba_write_admin on public.representative_brand_assignments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===========================================================================
-- app_settings — public rows readable by everyone signed in (the app needs
-- them offline); the rest, and all writes, are administrator only.
-- ===========================================================================
grant select, insert, update on public.app_settings to authenticated;

create policy app_settings_select_public on public.app_settings
  for select to authenticated
  using (public.is_active_user() and is_public);

create policy app_settings_select_admin on public.app_settings
  for select to authenticated
  using (public.is_admin());

create policy app_settings_write_admin on public.app_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ===========================================================================
-- audit_logs — managers and administrators may READ. Nobody may write, update
-- or delete directly; entries appear only through SECURITY DEFINER functions.
-- ===========================================================================
grant select on public.audit_logs to authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;

create policy audit_select_manager on public.audit_logs
  for select to authenticated
  using (public.is_active_user() and public.is_manager());


-- ===========================================================================
-- Anonymous visitors get nothing at all except the login-check function.
-- ===========================================================================
revoke all on all tables in schema public from anon;
