-- ===========================================================================
-- Phase 1 / 01 — Extensions, enumerated types and shared utility functions
-- ---------------------------------------------------------------------------
-- Enumerated types for the WHOLE application are declared here, including the
-- ones used by later phases. Declaring them up front costs nothing and keeps
-- the vocabulary of the system in a single, reviewable place.
-- ===========================================================================

create extension if not exists "pgcrypto"  with schema extensions;  -- gen_random_uuid()
create extension if not exists "citext"    with schema extensions;  -- case-insensitive text
create extension if not exists "btree_gist" with schema extensions; -- exclusion constraints

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('representative', 'manager', 'administrator');

create type public.auth_provider as enum ('supabase', 'entra_id');

create type public.clinic_type as enum (
  'public_hospital', 'private_hospital', 'clinic',
  'dermatology_center', 'pharmacy_chain', 'other'
);

create type public.plan_status as enum (
  'draft', 'submitted', 'approved', 'rejected', 'active', 'completed', 'locked'
);

create type public.visit_status as enum (
  'planned', 'in_progress', 'completed', 'missed', 'rescheduled',
  'cancellation_requested', 'cancelled_approved', 'cancelled_unapproved'
);

create type public.visit_event_type as enum ('check_in', 'check_out');

create type public.meeting_status as enum (
  'doctor_met', 'doctor_unavailable', 'clinic_closed',
  'meeting_postponed', 'clinic_staff_only', 'other'
);

create type public.visit_outcome as enum (
  'product_introduced', 'doctor_interested', 'follow_up_requested',
  'sample_requested', 'training_requested', 'not_interested',
  'already_recommending', 'other'
);

create type public.interest_level as enum ('none', 'low', 'medium', 'high', 'unknown');

create type public.report_status as enum ('draft', 'submitted');

create type public.exception_reason as enum (
  'doctor_unavailable', 'clinic_closed', 'emergency', 'sick_leave',
  'company_assignment', 'gps_problem', 'wrong_clinic_coordinates',
  'appointment_rescheduled', 'other'
);

create type public.approval_status as enum ('pending', 'approved', 'rejected');

create type public.absence_type as enum (
  'official_holiday', 'sick_leave', 'company_assignment', 'clinic_closure', 'other'
);

create type public.follow_up_status as enum ('open', 'completed', 'cancelled', 'expired');

create type public.kpi_period_type as enum ('week', 'month');


-- ---------------------------------------------------------------------------
-- Utility: keep updated_at correct without trusting the client
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger. Stamps updated_at with the server clock so a client cannot backdate a change.';


-- ---------------------------------------------------------------------------
-- Utility: block UPDATE/DELETE on append-only tables.
-- Grants are revoked as the first line of defence; this trigger is the second,
-- so that a future migration re-granting by mistake still cannot corrupt data.
-- ---------------------------------------------------------------------------
create or replace function public.raise_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'DVT_IMMUTABLE_RECORD: table % is append-only; % is not permitted',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

comment on function public.raise_immutable() is
  'BEFORE UPDATE OR DELETE trigger for append-only tables (visit events, submitted reports, addenda, audit log).';


-- ---------------------------------------------------------------------------
-- Utility: name normalisation used by duplicate-detection indexes.
-- IMMUTABLE so it can be used inside a unique index.
--   "  Улаанбаатар   Арьс  " -> "улаанбаатар арьс"
-- ---------------------------------------------------------------------------
create or replace function public.normalize_name(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g')), '');
$$;

comment on function public.normalize_name(text) is
  'Lower-cases and collapses whitespace. Used by duplicate-detection unique indexes on clinic and doctor names.';


-- ---------------------------------------------------------------------------
-- Utility: reject text that looks like patient / national identification data.
-- Mongolian national ID: two Cyrillic letters followed by eight digits.
-- Also blocks any bare run of 8+ digits, which covers registration numbers.
-- Free text fields are validated with this before being stored.
-- ---------------------------------------------------------------------------
create or replace function public.contains_personal_identifier(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_text ~ '[А-ЯӨҮЁа-яөүё]{2}\s?[0-9]{8}'   -- national ID pattern
    or p_text ~ '(^|[^0-9])[0-9]{8,}([^0-9]|$)', -- long bare digit runs
    false
  );
$$;

comment on function public.contains_personal_identifier(text) is
  'True when the text looks like it contains a national ID or registration number. Used to keep patient data out of free-text fields.';
