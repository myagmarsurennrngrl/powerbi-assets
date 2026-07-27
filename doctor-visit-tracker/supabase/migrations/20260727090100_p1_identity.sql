-- ===========================================================================
-- Phase 1 / 02 — Identity: approved e-mail domains and application users
-- ---------------------------------------------------------------------------
-- DESIGN NOTE (important):
--   app_users.id is NOT the same as auth.users.id.
--   The administrator creates the person record FIRST (name, e-mail, role);
--   the row is linked to a Supabase auth account on that person's first login.
--   Two consequences, both wanted:
--     1. Staff can be provisioned before they ever open the app.
--     2. Switching to Microsoft Entra ID later only relinks auth_user_id /
--        external_id — no history, plan or visit ever moves.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- approved_email_domains
-- ---------------------------------------------------------------------------
create table public.approved_email_domains (
  id          uuid primary key default extensions.gen_random_uuid(),
  domain      extensions.citext not null unique,
  is_active   boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint chk_domain_shape check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

comment on table public.approved_email_domains is
  'Only e-mail addresses ending in an active domain here may create an account. Enforced by a trigger on auth.users.';
comment on column public.approved_email_domains.domain is
  'Bare domain, lower case, without the @ sign. Example: company.mn';

create trigger trg_approved_email_domains_updated_at
  before update on public.approved_email_domains
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- app_users
-- ---------------------------------------------------------------------------
create table public.app_users (
  id             uuid primary key default extensions.gen_random_uuid(),
  auth_user_id   uuid unique references auth.users (id) on delete set null,
  email          extensions.citext not null unique,
  full_name      text not null,
  employee_code  text unique,
  role           public.user_role not null default 'representative',
  phone          text,
  manager_id     uuid references public.app_users (id) on delete set null,
  auth_provider  public.auth_provider not null default 'supabase',
  external_id    text unique,
  is_active      boolean not null default true,
  last_login_at  timestamptz,
  app_version    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.app_users (id) on delete set null,
  updated_by     uuid references public.app_users (id) on delete set null,
  deleted_at     timestamptz,
  constraint chk_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint chk_full_name_not_blank check (btrim(full_name) <> ''),
  constraint chk_not_own_manager check (manager_id is null or manager_id <> id)
);

comment on table public.app_users is
  'One row per member of staff. Created by an administrator before first login; linked to a Supabase auth account on first login.';
comment on column public.app_users.auth_user_id is
  'Link to auth.users. Null until the person logs in for the first time.';
comment on column public.app_users.external_id is
  'Reserved for the Microsoft Entra ID object id when authentication is migrated.';
comment on column public.app_users.is_active is
  'False deactivates the account immediately for every Row Level Security policy.';

create index idx_app_users_role       on public.app_users (role) where deleted_at is null;
create index idx_app_users_active     on public.app_users (is_active) where deleted_at is null;
create index idx_app_users_manager    on public.app_users (manager_id);
create index idx_app_users_auth_uid   on public.app_users (auth_user_id);

create trigger trg_app_users_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- The e-mail of an app user must always sit on an approved, active domain.
-- Checked on insert and whenever the e-mail is changed.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_app_user_email_domain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_domain text;
begin
  v_domain := lower(split_part(new.email::text, '@', 2));

  if not exists (
    select 1 from public.approved_email_domains d
    where d.domain::text = v_domain and d.is_active
  ) then
    raise exception 'DVT_EMAIL_DOMAIN_NOT_ALLOWED: % is not an approved company domain', v_domain
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_app_users_email_domain
  before insert or update of email on public.app_users
  for each row execute function public.enforce_app_user_email_domain();


-- ---------------------------------------------------------------------------
-- Nobody may change their own role — not even an administrator.
-- Role changes are always performed on somebody else, and always audited.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and old.auth_user_id is not null
     and old.auth_user_id = auth.uid() then
    raise exception 'DVT_CANNOT_CHANGE_OWN_ROLE: a user may not change their own role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_app_users_no_self_role_change
  before update on public.app_users
  for each row execute function public.prevent_self_role_change();
