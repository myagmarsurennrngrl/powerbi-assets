-- ===========================================================================
-- Phase 1 / 03 — Authorisation helper functions and the login gate
-- ---------------------------------------------------------------------------
-- These five helpers are the only place in the whole database that answers
-- "who is calling and what are they allowed to be?". Every Row Level Security
-- policy is written in terms of them.
--
-- They are SECURITY DEFINER on purpose: that lets them read public.app_users
-- without triggering the very policies that call them (which would recurse).
-- ===========================================================================

create or replace function public.auth_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.app_users u
  where u.auth_user_id = auth.uid()
    and u.deleted_at is null
  limit 1;
$$;

comment on function public.auth_user_id() is
  'app_users.id of the caller (NOT auth.uid()). Null when not signed in or not provisioned.';


create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.app_users u
  where u.auth_user_id = auth.uid()
    and u.deleted_at is null
    and u.is_active
  limit 1;
$$;

comment on function public.auth_role() is
  'Role of the caller. Null for deactivated or unprovisioned accounts, which therefore fail every policy.';


create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users u
    where u.auth_user_id = auth.uid()
      and u.deleted_at is null
      and u.is_active
  );
$$;

comment on function public.is_active_user() is
  'Gate used by every policy. Deactivating a user in the admin screen revokes all access at the next request.';


create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.auth_role() in ('manager', 'administrator');
$$;

comment on function public.is_manager() is
  'True for managers and administrators — used for read-everything policies.';


create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.auth_role() = 'administrator';
$$;


-- ===========================================================================
-- THE LOGIN GATE
-- ---------------------------------------------------------------------------
-- Two conditions must both hold before Supabase is allowed to create an
-- authentication account:
--   1. the e-mail domain is on the approved list, and
--   2. an administrator has already created an ACTIVE app_users row for it.
--
-- If either fails the insert is refused, so the person never obtains a usable
-- session no matter how many one-time codes they receive.
-- ===========================================================================

create or replace function public.enforce_login_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(new.email);
  v_domain text := lower(split_part(new.email, '@', 2));
begin
  if v_email is null or v_email = '' then
    raise exception 'DVT_EMAIL_REQUIRED' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.approved_email_domains d
    where d.domain::text = v_domain and d.is_active
  ) then
    raise exception 'DVT_EMAIL_DOMAIN_NOT_ALLOWED: % is not an approved company domain', v_domain
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.app_users u
    where u.email::text = v_email
      and u.is_active
      and u.deleted_at is null
  ) then
    raise exception 'DVT_USER_NOT_PROVISIONED: % has no active account. Ask an administrator to create one.', v_email
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_login_allowed() is
  'BEFORE INSERT on auth.users. Refuses accounts outside the approved domains or without an administrator-created app_users row.';

create trigger trg_auth_users_login_gate
  before insert on auth.users
  for each row execute function public.enforce_login_allowed();


-- ---------------------------------------------------------------------------
-- On successful account creation, link it to the pre-created app_users row.
-- ---------------------------------------------------------------------------
create or replace function public.link_auth_user_to_app_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_users u
     set auth_user_id  = new.id,
         last_login_at = now(),
         updated_at    = now()
   where u.email::text = lower(new.email)
     and u.auth_user_id is null;

  return new;
end;
$$;

create trigger trg_auth_users_link_app_user
  after insert on auth.users
  for each row execute function public.link_auth_user_to_app_user();


-- ---------------------------------------------------------------------------
-- Read-only check the login screen can call BEFORE asking for a one-time code.
-- It answers only "yes / no", never who exists, so it leaks nothing useful.
-- Deliberately callable by anonymous visitors — that is the whole point.
-- ---------------------------------------------------------------------------
create or replace function public.is_login_email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.approved_email_domains d
    where d.domain::text = lower(split_part(coalesce(p_email, ''), '@', 2))
      and d.is_active
  )
  and exists (
    select 1
    from public.app_users u
    where u.email::text = lower(coalesce(p_email, ''))
      and u.is_active
      and u.deleted_at is null
  );
$$;

comment on function public.is_login_email_allowed(text) is
  'Returns true only when the address may log in. Used by the login screen for a friendly message; the real gate is the auth.users trigger.';

revoke all on function public.is_login_email_allowed(text) from public;
grant execute on function public.is_login_email_allowed(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Profile of the signed-in user, including whether the account is usable.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_profile()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          public.user_role,
  employee_code text,
  phone         text,
  is_active     boolean,
  manager_id    uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.full_name, u.role, u.employee_code,
         u.phone, u.is_active, u.manager_id
  from public.app_users u
  where u.auth_user_id = auth.uid()
    and u.deleted_at is null
  limit 1;
$$;

revoke all on function public.current_user_profile() from public;
grant execute on function public.current_user_profile() to authenticated;
