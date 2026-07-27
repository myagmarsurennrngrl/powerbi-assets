-- ===========================================================================
-- TEST HARNESS ONLY — a minimal stand-in for the parts of Supabase that our
-- migrations depend on (the auth schema, the auth.uid() helper and the three
-- database roles).
--
-- This file is NEVER applied to a real Supabase project — Supabase creates all
-- of this itself. It exists so the migrations and the Row Level Security
-- policies can be executed and tested against a plain PostgreSQL server in CI
-- and on a developer machine.
-- ===========================================================================

create schema if not exists auth;
create schema if not exists extensions;

-- ---------------------------------------------------------------------------
-- Roles that Supabase provides out of the box
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth       to anon, authenticated, service_role;

-- Supabase grants blanket privileges on new public tables by default. We
-- reproduce that here so the REVOKE statements in our migration are exercised
-- exactly as they will be in production.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth.users — only the columns our triggers touch
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  phone               text,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  raw_app_meta_data   jsonb not null default '{}'::jsonb,
  raw_user_meta_data  jsonb not null default '{}'::jsonb
);

grant select on auth.users to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth.uid() / auth.role() / auth.jwt() — same definitions Supabase ships
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Test convenience: become a given app user (or nobody).
-- Mirrors what PostgREST does per request.
-- ---------------------------------------------------------------------------
create or replace function auth.test_sign_in(p_auth_user_id uuid)
returns void
language plpgsql
as $$
begin
  if p_auth_user_id is null then
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'anon', true);
  else
    perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
  end if;
end;
$$;
