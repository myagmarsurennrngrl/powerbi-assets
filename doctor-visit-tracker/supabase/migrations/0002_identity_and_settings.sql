-- =============================================================================
-- 0002_identity_and_settings.sql
-- Doctor Visit Tracker — Phase 1
--
-- app_user             : the application's own identity table.
-- approved_email_domain: the login allow-list.
-- app_setting          : runtime configuration (geofence defaults, thresholds,
--                        feature flags, retention).
--
-- WHY app_user EXISTS SEPARATELY FROM auth.users
-- ----------------------------------------------
-- Nothing in this application references the identity provider directly.
-- Every policy and every function resolves the caller through app_user.
-- Migrating from Supabase Auth to Microsoft Entra ID later is therefore a
-- one-column backfill of app_user.auth_user_id, with zero schema or policy
-- changes. This indirection is deliberate.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_user
-- -----------------------------------------------------------------------------
CREATE TABLE public.app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The ONLY column that knows an identity provider exists.
  -- Nullable so an administrator can pre-create a user before their first login.
  auth_user_id    uuid UNIQUE,

  email           citext      NOT NULL UNIQUE,
  full_name       text        NOT NULL,
  phone           text,
  role            public.user_role NOT NULL,

  -- Which manager reviews this user's plans and exceptions.
  manager_id      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  is_active       boolean     NOT NULL DEFAULT true,
  deactivated_at  timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT app_user_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT app_user_email_shape CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- A user cannot be their own manager.
  CONSTRAINT app_user_not_own_manager CHECK (manager_id IS DISTINCT FROM id),
  -- Keep the deactivation flag and its timestamp consistent.
  CONSTRAINT app_user_deactivation_consistent
    CHECK ((is_active AND deactivated_at IS NULL) OR (NOT is_active AND deactivated_at IS NOT NULL))
);

CREATE INDEX app_user_role_idx       ON public.app_user (role) WHERE is_active;
CREATE INDEX app_user_manager_id_idx ON public.app_user (manager_id);

COMMENT ON TABLE  public.app_user IS
  'Application identity. Decoupled from the auth provider so Supabase Auth can be replaced by Microsoft Entra ID without schema changes.';
COMMENT ON COLUMN public.app_user.auth_user_id IS
  'FK to auth.users.id under Supabase. Under Entra ID this becomes the Entra object id. Backfill by email when migrating.';

-- -----------------------------------------------------------------------------
-- approved_email_domain — the login allow-list
-- -----------------------------------------------------------------------------
CREATE TABLE public.approved_email_domain (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      citext      NOT NULL UNIQUE,
  is_active   boolean     NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  -- Store the bare domain: 'monos.mn', never '@monos.mn' and never a full address.
  CONSTRAINT approved_email_domain_shape
    CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

COMMENT ON TABLE public.approved_email_domain IS
  'Only email addresses under an active domain here may sign in. Enforced by a trigger on auth.users (see 0006).';

-- -----------------------------------------------------------------------------
-- app_setting — runtime configuration, not code constants
-- -----------------------------------------------------------------------------
CREATE TABLE public.app_setting (
  key           text PRIMARY KEY,
  value         jsonb       NOT NULL,
  description   text        NOT NULL,
  -- Settings a representative's device legitimately needs (e.g. the GPS
  -- accuracy threshold) are readable by everyone. Everything else is admin-only.
  is_client_readable boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.app_user (id) ON DELETE RESTRICT
);

INSERT INTO public.app_setting (key, value, description, is_client_readable) VALUES
  ('default_geofence_radius_m', '150'::jsonb,
   'Default allowed distance in metres between the representative and the clinic when starting a visit. Administrators may override per clinic.', true),

  ('gps_accuracy_threshold_m', '50'::jsonb,
   'Maximum acceptable GPS accuracy radius in metres. A reading less precise than this cannot start a visit.', true),

  ('min_valid_duration_seconds', '120'::jsonb,
   'Visits shorter than this are still recorded but flagged as suspicious for manager review.', true),

  ('on_time_tolerance_minutes', '15'::jsonb,
   'A visit counts as started on time if it begins within this many minutes of the planned time.', true),

  ('clock_drift_flag_minutes', '5'::jsonb,
   'If the device clock differs from the server clock by more than this, the visit is flagged for review.', true),

  ('plan_deadline_weekday', '5'::jsonb,
   'ISO weekday (1=Monday) of the week BEFORE the planned week by which a plan must be submitted. 5 = Friday.', true),

  ('plan_deadline_hour', '18'::jsonb,
   'Hour (Asia/Ulaanbaatar, 24h) on the deadline weekday by which a plan must be submitted.', true),

  ('feature_audio_recording_enabled', 'false'::jsonb,
   'MASTER SWITCH FOR AUDIO RECORDING. Deliberately false. No recording code exists in the MVP. Turning this on does nothing until the full consent workflow described in docs/07-risks.md is built.', true),

  ('retention_days_visit', '1825'::jsonb,
   'How long visit records are retained (5 years). Awaiting management confirmation.', false),

  ('retention_days_audit_log', '1095'::jsonb,
   'How long audit entries are retained (3 years). Awaiting management confirmation.', false),

  ('retention_days_exception_attachment', '365'::jsonb,
   'How long exception attachments are retained (1 year). Awaiting management confirmation.', false);

COMMENT ON TABLE public.app_setting IS
  'Runtime configuration. Changing behaviour must not require an app release.';

-- -----------------------------------------------------------------------------
-- Typed accessors so application code never parses jsonb by hand
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_setting_int(p_key text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (s.value #>> '{}')::integer FROM public.app_setting s WHERE s.key = p_key;
$$;

CREATE OR REPLACE FUNCTION public.fn_setting_bool(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (s.value #>> '{}')::boolean FROM public.app_setting s WHERE s.key = p_key;
$$;
