-- ===========================================================================
-- Phase 1 / 04 — Master data: clinics, doctors, brands, products, assignments
-- ---------------------------------------------------------------------------
-- Master data is editable and SOFT deletable (deleted_at). Transactional data
-- added in later phases is append-only and never deleted.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- clinics
-- ---------------------------------------------------------------------------
create table public.clinics (
  id                uuid primary key default extensions.gen_random_uuid(),
  code              text unique,
  name              text not null,
  clinic_type       public.clinic_type not null default 'clinic',
  district          text not null,
  address           text not null,
  latitude          double precision not null,
  longitude         double precision not null,
  geofence_radius_m integer not null default 150,
  contact_phone     text,
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.app_users (id) on delete set null,
  updated_by        uuid references public.app_users (id) on delete set null,
  deleted_at        timestamptz,

  constraint chk_clinic_name_not_blank check (btrim(name) <> ''),
  constraint chk_latitude  check (latitude  between -90  and 90),
  constraint chk_longitude check (longitude between -180 and 180),
  -- A radius below 30 m is smaller than typical urban GPS error and would make
  -- the app unusable; above 2 km it would no longer prove attendance.
  constraint chk_geofence_radius check (geofence_radius_m between 30 and 2000)
);

comment on table public.clinics is
  'Clinics and hospitals visited by representatives. Coordinates and radius drive the check-in geofence.';
comment on column public.clinics.geofence_radius_m is
  'Metres. Default 150. Raise it for large hospital campuses or places with poor GPS reception.';

-- Duplicate detection: the same clinic name in the same district, twice.
create unique index uq_clinics_name_district
  on public.clinics (public.normalize_name(name), public.normalize_name(district))
  where deleted_at is null;

create index idx_clinics_active   on public.clinics (is_active) where deleted_at is null;
create index idx_clinics_district on public.clinics (district)  where deleted_at is null;

create trigger trg_clinics_updated_at
  before update on public.clinics
  for each row execute function public.set_updated_at();


-- Warn (in a queryable way) about clinics that are suspiciously close together.
-- Not a hard block: two genuine clinics can share a building.
create or replace function public.clinics_possible_duplicates(p_max_metres integer default 50)
returns table (clinic_a uuid, clinic_b uuid, metres double precision)
language sql
stable
set search_path = ''
as $$
  select a.id, b.id,
         6371000 * 2 * asin(sqrt(
           power(sin(radians(b.latitude - a.latitude) / 2), 2)
           + cos(radians(a.latitude)) * cos(radians(b.latitude))
           * power(sin(radians(b.longitude - a.longitude) / 2), 2)
         )) as metres
  from public.clinics a
  join public.clinics b on b.id > a.id
  where a.deleted_at is null and b.deleted_at is null
    and a.is_active and b.is_active
    and 6371000 * 2 * asin(sqrt(
          power(sin(radians(b.latitude - a.latitude) / 2), 2)
          + cos(radians(a.latitude)) * cos(radians(b.latitude))
          * power(sin(radians(b.longitude - a.longitude) / 2), 2)
        )) <= p_max_metres;
$$;


-- ---------------------------------------------------------------------------
-- doctors
-- ---------------------------------------------------------------------------
create table public.doctors (
  id                 uuid primary key default extensions.gen_random_uuid(),
  code               text unique,
  full_name          text not null,
  speciality         text not null,
  phone              text,
  email              extensions.citext,
  professional_notes text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.app_users (id) on delete set null,
  updated_by         uuid references public.app_users (id) on delete set null,
  deleted_at         timestamptz,

  constraint chk_doctor_name_not_blank check (btrim(full_name) <> ''),
  constraint chk_doctor_email_shape check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.doctors is
  'Dermatologists and other doctors the representatives meet. Business contact data only.';
comment on column public.doctors.professional_notes is
  'PROFESSIONAL notes only (interests, preferred brands, congress attendance). Never patient data, never personal remarks.';

create unique index uq_doctors_identity
  on public.doctors (
    public.normalize_name(full_name),
    coalesce(btrim(phone), ''),
    public.normalize_name(speciality)
  )
  where deleted_at is null;

create index idx_doctors_active     on public.doctors (is_active) where deleted_at is null;
create index idx_doctors_speciality on public.doctors (speciality) where deleted_at is null;

create trigger trg_doctors_updated_at
  before update on public.doctors
  for each row execute function public.set_updated_at();


-- Keep patient identifiers out of the doctor notes field.
create or replace function public.validate_doctor_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.professional_notes is not null
     and public.contains_personal_identifier(new.professional_notes) then
    raise exception 'DVT_PERSONAL_IDENTIFIER_NOT_ALLOWED: notes must not contain identification or patient data'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger trg_doctors_validate_notes
  before insert or update of professional_notes on public.doctors
  for each row execute function public.validate_doctor_notes();


-- ---------------------------------------------------------------------------
-- doctor_clinics — a doctor may work at several clinics
-- ---------------------------------------------------------------------------
create table public.doctor_clinics (
  id              uuid primary key default extensions.gen_random_uuid(),
  doctor_id       uuid not null references public.doctors (id) on delete restrict,
  clinic_id       uuid not null references public.clinics (id) on delete restrict,
  department      text,
  room_or_floor   text,
  available_days  text[] not null default '{}',
  available_hours text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.app_users (id) on delete set null,
  updated_by      uuid references public.app_users (id) on delete set null,

  constraint uq_doctor_clinic unique (doctor_id, clinic_id),
  constraint chk_available_days check (
    available_days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
  )
);

comment on column public.doctor_clinics.available_days is
  'Lower-case three-letter English day codes, e.g. {mon,wed,fri}. Displayed in Mongolian by the app.';

create index idx_doctor_clinics_doctor on public.doctor_clinics (doctor_id) where is_active;
create index idx_doctor_clinics_clinic on public.doctor_clinics (clinic_id) where is_active;

create trigger trg_doctor_clinics_updated_at
  before update on public.doctor_clinics
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------
create table public.brands (
  id         uuid primary key default extensions.gen_random_uuid(),
  name       text not null,
  category   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_by uuid references public.app_users (id) on delete set null,
  deleted_at timestamptz,
  constraint chk_brand_name_not_blank check (btrim(name) <> '')
);

create unique index uq_brands_name
  on public.brands (public.normalize_name(name))
  where deleted_at is null;

create trigger trg_brands_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id         uuid primary key default extensions.gen_random_uuid(),
  name       text not null,
  sku        text not null unique,
  brand_id   uuid not null references public.brands (id) on delete restrict,
  category   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_by uuid references public.app_users (id) on delete set null,
  deleted_at timestamptz,
  constraint chk_product_name_not_blank check (btrim(name) <> ''),
  constraint chk_sku_shape check (sku ~ '^[A-Z0-9][A-Z0-9._-]{1,31}$')
);

comment on column public.products.brand_id is
  'ON DELETE RESTRICT — a brand with products cannot be removed, which prevents orphan products.';

create index idx_products_brand  on public.products (brand_id) where deleted_at is null;
create index idx_products_active on public.products (is_active) where deleted_at is null;

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- representative_brand_assignments
-- ---------------------------------------------------------------------------
create table public.representative_brand_assignments (
  id                uuid primary key default extensions.gen_random_uuid(),
  representative_id uuid not null references public.app_users (id) on delete restrict,
  brand_id          uuid not null references public.brands (id) on delete restrict,
  start_date        date not null,
  end_date          date,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.app_users (id) on delete set null,
  updated_by        uuid references public.app_users (id) on delete set null,

  constraint chk_assignment_dates check (end_date is null or end_date >= start_date),

  -- The same representative cannot hold the same brand twice over overlapping
  -- dates. btree_gist lets us mix equality columns with a range.
  constraint excl_assignment_overlap exclude using gist (
    representative_id with =,
    brand_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
  ) where (is_active)
);

comment on table public.representative_brand_assignments is
  'Which brands each representative carries, and for which period. Drives what they may plan and report.';

create index idx_rba_representative on public.representative_brand_assignments (representative_id) where is_active;
create index idx_rba_brand          on public.representative_brand_assignments (brand_id) where is_active;

create trigger trg_rba_updated_at
  before update on public.representative_brand_assignments
  for each row execute function public.set_updated_at();


-- Only a representative may hold a brand assignment.
create or replace function public.validate_brand_assignment_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.app_users u
    where u.id = new.representative_id
      and u.role = 'representative'
      and u.deleted_at is null
  ) then
    raise exception 'DVT_NOT_A_REPRESENTATIVE: brand assignments may only be given to representatives'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger trg_rba_validate_role
  before insert or update of representative_id on public.representative_brand_assignments
  for each row execute function public.validate_brand_assignment_role();
