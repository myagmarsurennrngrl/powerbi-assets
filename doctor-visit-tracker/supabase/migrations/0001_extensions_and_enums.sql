-- =============================================================================
-- 0001_extensions_and_enums.sql
-- Doctor Visit Tracker — Phase 1
--
-- Extensions and all enumerated types used by the application.
-- Enum VALUES are English codes. Mongolian labels live in the app
-- (src/lib/i18n/enums.ts) so that changing wording never breaks reports.
-- =============================================================================

-- citext  : case-insensitive email/domain comparison
-- pg_trgm : fuzzy similarity for duplicate clinic/doctor detection
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Identity
-- -----------------------------------------------------------------------------
CREATE TYPE public.user_role AS ENUM (
  'representative',
  'manager',
  'administrator'
);

-- -----------------------------------------------------------------------------
-- Planning (used from Phase 2 onward; defined here so the type set is complete
-- and later migrations never have to ALTER TYPE inside a transaction)
-- -----------------------------------------------------------------------------
CREATE TYPE public.plan_status AS ENUM (
  'draft',
  'submitted',
  'approved',
  'rejected',
  'active',
  'completed',
  'locked'
);

CREATE TYPE public.visit_status AS ENUM (
  'planned',
  'in_progress',
  'completed',
  'missed',
  'rescheduled',
  'cancellation_requested',
  'cancelled_approved',
  'cancelled_unapproved'
);

-- -----------------------------------------------------------------------------
-- Execution
-- -----------------------------------------------------------------------------
CREATE TYPE public.visit_event_type AS ENUM (
  'check_in',
  'check_out'
);

CREATE TYPE public.meeting_status AS ENUM (
  'doctor_met',
  'doctor_unavailable',
  'clinic_closed',
  'meeting_postponed',
  'met_clinic_staff_only',
  'other'
);

CREATE TYPE public.visit_outcome AS ENUM (
  'product_introduced',
  'doctor_interested',
  'follow_up_requested',
  'sample_requested',
  'training_requested',
  'not_interested',
  'already_recommending',
  'other'
);

CREATE TYPE public.interest_level AS ENUM (
  'none',
  'low',
  'medium',
  'high'
);

-- -----------------------------------------------------------------------------
-- Exceptions
-- -----------------------------------------------------------------------------
CREATE TYPE public.exception_reason AS ENUM (
  'doctor_unavailable',
  'clinic_closed',
  'emergency',
  'sick_leave',
  'official_assignment',
  'gps_problem',
  'wrong_clinic_coordinates',
  'appointment_rescheduled',
  'other'
);

CREATE TYPE public.exception_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

-- -----------------------------------------------------------------------------
-- Cross-cutting
-- -----------------------------------------------------------------------------

-- Whether a record was produced while the device had connectivity. Offline
-- records get their server timestamp only at sync time, so managers must be
-- able to see the difference.
CREATE TYPE public.sync_source AS ENUM (
  'online',
  'offline'
);

CREATE TYPE public.follow_up_status AS ENUM (
  'open',
  'done',
  'cancelled'
);

COMMENT ON TYPE public.sync_source IS
  'online = created with connectivity, server timestamp is authoritative. '
  'offline = created without connectivity, server timestamp applied at sync.';
