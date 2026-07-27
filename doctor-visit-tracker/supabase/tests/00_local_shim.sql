-- =============================================================================
-- 00_local_shim.sql
--
-- NOT A MIGRATION. Never applied to the real Supabase project.
--
-- Supabase provides an `auth` schema and the roles anon / authenticated /
-- service_role. A plain PostgreSQL instance does not. This file recreates just
-- enough of that surface so the real migrations can be executed and tested in
-- CI, and so the row-level-security policies can be exercised as a real user.
--
-- Applied by scripts/run-db-tests.mjs before the migrations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- auth schema
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase's auth.uid() reads the `sub` claim of the request JWT. PostgREST
-- sets that as a GUC. The tests set the same GUC directly, so the RLS policies
-- under test are byte-for-byte the ones that run in production.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
