-- =============================================================================
-- 0005_master_data.sql
-- Doctor Visit Tracker — Phase 1
--
-- clinic, doctor, doctor_clinic, brand, product, rep_brand_assignment.
--
-- Master data is SOFT-deleted (deleted_at) so that historical visits never
-- become orphans. Transactional data (visits) is never deleted at all.
-- Every foreign key is ON DELETE RESTRICT: nothing can silently disappear.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- clinic
-- -----------------------------------------------------------------------------
CREATE TABLE public.clinic (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text        NOT NULL UNIQUE,
  name               text        NOT NULL,
  clinic_type        text        NOT NULL,
  district           text        NOT NULL,
  address            text        NOT NULL,

  latitude           numeric(9,6)  NOT NULL,
  longitude          numeric(9,6)  NOT NULL,
  geofence_radius_m  integer       NOT NULL DEFAULT 150,

  contact_phone      text,
  notes              text,

  is_active          boolean     NOT NULL DEFAULT true,
  deleted_at         timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by         uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT clinic_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT clinic_latitude_range  CHECK (latitude  BETWEEN -90  AND 90),
  CONSTRAINT clinic_longitude_range CHECK (longitude BETWEEN -180 AND 180),
  -- 0,0 is in the Gulf of Guinea and is the classic "coordinates were never
  -- filled in" value. Reject it outright.
  CONSTRAINT clinic_coordinates_not_null_island CHECK (NOT (latitude = 0 AND longitude = 0)),
  -- Below 30 m the geofence is smaller than typical urban GPS error and nobody
  -- could ever check in. Above 2 km it stops meaning "at the clinic".
  CONSTRAINT clinic_geofence_radius_sane CHECK (geofence_radius_m BETWEEN 30 AND 2000)
);

-- Duplicate clinic detection: the same name in the same district cannot exist
-- twice among live rows. Soft-deleted rows are excluded so a clinic can be
-- removed and re-added.
CREATE UNIQUE INDEX clinic_unique_name_district
  ON public.clinic (lower(name), lower(district))
  WHERE deleted_at IS NULL;

CREATE INDEX clinic_district_idx ON public.clinic (district) WHERE deleted_at IS NULL;
CREATE INDEX clinic_name_trgm_idx ON public.clinic USING gin (name gin_trgm_ops);

COMMENT ON COLUMN public.clinic.geofence_radius_m IS
  'Allowed distance in metres for starting a visit here. Default 150. Administrators tune this per clinic — large hospital campuses need more.';

-- A soft warning, not a hard constraint: coordinates far outside Mongolia are
-- almost certainly a data-entry error (swapped lat/lng is the usual cause).
CREATE OR REPLACE FUNCTION public.fn_clinic_coordinates_plausible(p_lat numeric, p_lon numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_lat BETWEEN 41.0 AND 52.5 AND p_lon BETWEEN 87.0 AND 120.0;
$$;

COMMENT ON FUNCTION public.fn_clinic_coordinates_plausible IS
  'Mongolia bounding box. Used by the admin import to warn about swapped or mistyped coordinates. Intentionally not a CHECK constraint.';

-- -----------------------------------------------------------------------------
-- doctor
--
-- PRIVACY: there is no patient-related column here, and there never will be.
-- professional_notes is for professional context only (speciality interests,
-- preferred meeting times). See docs/07-risks.md P2 and P4.
-- -----------------------------------------------------------------------------
CREATE TABLE public.doctor (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text        NOT NULL UNIQUE,
  full_name          text        NOT NULL,
  speciality         text        NOT NULL,
  phone              text,
  email              citext,
  professional_notes text,

  is_active          boolean     NOT NULL DEFAULT true,
  deleted_at         timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by         uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT doctor_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT doctor_email_shape
    CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE UNIQUE INDEX doctor_unique_name_speciality
  ON public.doctor (lower(full_name), lower(speciality))
  WHERE deleted_at IS NULL;

CREATE INDEX doctor_speciality_idx ON public.doctor (speciality) WHERE deleted_at IS NULL;
CREATE INDEX doctor_name_trgm_idx  ON public.doctor USING gin (full_name gin_trgm_ops);

COMMENT ON COLUMN public.doctor.professional_notes IS
  'Professional context only. Patient information must never be entered. Separate from visit feedback by design.';

-- Fuzzy duplicate detection for the admin CSV import.
CREATE OR REPLACE FUNCTION public.fn_find_similar_doctors(
  p_full_name text,
  p_threshold real DEFAULT 0.8
)
RETURNS TABLE (id uuid, full_name text, speciality text, similarity real)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT d.id, d.full_name, d.speciality, public.similarity(d.full_name, p_full_name) AS similarity
  FROM public.doctor d
  WHERE d.deleted_at IS NULL
    AND public.similarity(d.full_name, p_full_name) >= p_threshold
  ORDER BY similarity DESC
  LIMIT 10;
$$;

-- -----------------------------------------------------------------------------
-- doctor_clinic — a doctor may work at several clinics
-- -----------------------------------------------------------------------------
CREATE TABLE public.doctor_clinic (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id       uuid NOT NULL REFERENCES public.doctor (id) ON DELETE RESTRICT,
  clinic_id       uuid NOT NULL REFERENCES public.clinic (id) ON DELETE RESTRICT,

  department      text,
  room_or_floor   text,
  available_days  text[]  NOT NULL DEFAULT '{}',   -- {'mon','tue',...}
  available_hours text,                            -- free text, e.g. '09:00-13:00'

  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by      uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT doctor_clinic_unique UNIQUE (doctor_id, clinic_id),
  CONSTRAINT doctor_clinic_days_valid
    CHECK (available_days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[])
);

CREATE INDEX doctor_clinic_clinic_idx ON public.doctor_clinic (clinic_id) WHERE is_active;
CREATE INDEX doctor_clinic_doctor_idx ON public.doctor_clinic (doctor_id) WHERE is_active;

-- -----------------------------------------------------------------------------
-- brand
-- -----------------------------------------------------------------------------
CREATE TABLE public.brand (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  category    text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT brand_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX brand_unique_name ON public.brand (lower(name)) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- product
-- -----------------------------------------------------------------------------
CREATE TABLE public.product (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  brand_id    uuid        NOT NULL REFERENCES public.brand (id) ON DELETE RESTRICT,
  category    text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT product_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX product_brand_idx ON public.product (brand_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX product_unique_name_per_brand
  ON public.product (brand_id, lower(name)) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- rep_brand_assignment
--
-- Each representative covers roughly three or four brands. Two representatives
-- may legitimately visit the same doctor for different brands, so this table —
-- not the doctor — is what scopes a representative's work.
-- -----------------------------------------------------------------------------
CREATE TABLE public.rep_brand_assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id      uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT,
  brand_id    uuid NOT NULL REFERENCES public.brand (id)    ON DELETE RESTRICT,
  start_date  date NOT NULL,
  end_date    date,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  updated_by  uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,

  CONSTRAINT rep_brand_dates_ordered CHECK (end_date IS NULL OR end_date >= start_date)
);

-- A representative cannot hold the same brand twice at the same time.
CREATE UNIQUE INDEX rep_brand_assignment_one_active
  ON public.rep_brand_assignment (rep_id, brand_id)
  WHERE is_active;

CREATE INDEX rep_brand_assignment_rep_idx   ON public.rep_brand_assignment (rep_id)   WHERE is_active;
CREATE INDEX rep_brand_assignment_brand_idx ON public.rep_brand_assignment (brand_id) WHERE is_active;

-- Only a representative can be assigned brands.
CREATE OR REPLACE FUNCTION public.fn_rep_brand_assignment_check_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  SELECT u.role INTO v_role FROM public.app_user u WHERE u.id = NEW.rep_id;
  IF v_role IS DISTINCT FROM 'representative' THEN
    RAISE EXCEPTION 'brands can only be assigned to a representative (user % has role %)',
      NEW.rep_id, v_role
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rep_brand_assignment_role
  BEFORE INSERT OR UPDATE OF rep_id ON public.rep_brand_assignment
  FOR EACH ROW EXECUTE FUNCTION public.fn_rep_brand_assignment_check_role();

-- -----------------------------------------------------------------------------
-- Attach shared timestamp + audit triggers to every master-data table
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user', 'approved_email_domain', 'clinic', 'doctor',
    'doctor_clinic', 'brand', 'product', 'rep_brand_assignment'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_touch BEFORE INSERT OR UPDATE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.fn_touch_audit_columns()', t);
  END LOOP;

  -- app_user changes are audited by dedicated actions (user_created,
  -- user_role_changed) in 0007, so it is not in this generic list.
  FOREACH t IN ARRAY ARRAY[
    'approved_email_domain', 'clinic', 'doctor',
    'doctor_clinic', 'brand', 'product', 'rep_brand_assignment'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.fn_audit_master_data()', t);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- Convenience: the brands a representative currently holds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_rep_brand_ids(p_rep_id uuid, p_on date DEFAULT CURRENT_DATE)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT a.brand_id
  FROM public.rep_brand_assignment a
  WHERE a.rep_id = p_rep_id
    AND a.is_active
    AND a.start_date <= p_on
    AND (a.end_date IS NULL OR a.end_date >= p_on);
$$;
