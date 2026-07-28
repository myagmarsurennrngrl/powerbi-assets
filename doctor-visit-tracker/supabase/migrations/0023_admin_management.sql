-- =============================================================================
-- 0023_admin_management.sql
-- Doctor Visit Tracker — Phase 6
--
-- Administration: user accounts, brand assignments, and archiving master data.
--
-- WHY FUNCTIONS AND NOT PLAIN TABLE WRITES
-- ----------------------------------------
-- RLS in 0007 already restricts these tables to administrators, and the client
-- COULD write to them directly. It must not, because these operations have
-- cross-row invariants that a single-row policy cannot express:
--
--   * an account whose email domain is not approved can never sign in — it
--     would look created but be permanently broken;
--   * deactivating the last administrator locks everyone out of administration
--     for good, with no way back through the app;
--   * deactivating a representative mid-visit strands an open visit that can
--     never be checked out;
--   * archiving a clinic that still has planned visits leaves representatives
--     with stops they cannot complete.
--
-- Each function below is SECURITY INVOKER (the default). RLS therefore still
-- applies underneath: the explicit fn_is_admin() checks exist to give a clear
-- Mongolian message, NOT to be the security boundary. Both layers must pass.
--
-- The archive guards are triggers rather than function-only checks, because a
-- trigger holds no matter which path the write arrives by.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fn_admin_users — the user list, enriched for the management screen
--
-- One round trip instead of four. Read-only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_users()
RETURNS TABLE (
  id              uuid,
  email           text,
  full_name       text,
  phone           text,
  role            public.user_role,
  manager_id      uuid,
  manager_name    text,
  is_active       boolean,
  deactivated_at  timestamptz,
  has_signed_in   boolean,
  brand_count     integer,
  brand_names     text,
  created_at      timestamptz
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    u.id,
    u.email::text,
    u.full_name,
    u.phone,
    u.role,
    u.manager_id,
    m.full_name AS manager_name,
    u.is_active,
    u.deactivated_at,
    u.auth_user_id IS NOT NULL AS has_signed_in,
    COALESCE(b.brand_count, 0)::integer AS brand_count,
    b.brand_names,
    u.created_at
  FROM public.app_user u
  LEFT JOIN public.app_user m ON m.id = u.manager_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS brand_count,
           string_agg(br.name, ', ' ORDER BY br.name) AS brand_names
    FROM public.rep_brand_assignment a
    JOIN public.brand br ON br.id = a.brand_id
    WHERE a.rep_id = u.id AND a.is_active
  ) b ON true
  WHERE public.fn_is_admin()
  ORDER BY u.is_active DESC, u.role, u.full_name;
$$;

COMMENT ON FUNCTION public.fn_admin_users IS
  'User list for the administration screen. Returns nothing to a non-administrator.';

-- -----------------------------------------------------------------------------
-- Shared validation: is this a usable manager for that user?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_manager_choice(
  p_user_id    uuid,
  p_manager_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_manager public.app_user;
BEGIN
  IF p_manager_id IS NULL THEN
    RETURN;
  END IF;

  IF p_manager_id = p_user_id THEN
    RAISE EXCEPTION 'Хэрэглэгч өөрийгөө удирдах боломжгүй.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_manager FROM public.app_user WHERE id = p_manager_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Сонгосон менежер олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT v_manager.is_active THEN
    RAISE EXCEPTION 'Идэвхгүй хэрэглэгчийг менежерээр сонгох боломжгүй.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_manager.role NOT IN ('manager', 'administrator') THEN
    RAISE EXCEPTION 'Зөвхөн менежер эсвэл администраторыг менежерээр сонгоно.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A two-step loop (A manages B, B manages A) is the only cycle possible with
  -- a single manager column, and app_user_not_own_manager covers the one-step
  -- case. Block it explicitly so "who reviews this plan" always terminates.
  IF EXISTS (
    SELECT 1 FROM public.app_user
    WHERE id = p_manager_id AND manager_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Энэ хоёр хэрэглэгч бие биенээ удирдах боломжгүй.'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_admin_create_user
--
-- Creates the application account. It does NOT create a login: the person signs
-- in with an email code and 0006 links auth.users to this row by email on first
-- sign-in. That is why the domain is validated here — an account under an
-- unapproved domain would be refused at the door forever.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_create_user(
  p_email      text,
  p_full_name  text,
  p_role       public.user_role,
  p_manager_id uuid DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_name  text := btrim(p_full_name);
  v_id    uuid;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор хэрэглэгч үүсгэнэ.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Нэрээ оруулна уу.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'И-мэйл хаяг буруу байна.' USING ERRCODE = 'check_violation';
  END IF;

  -- The same check the login path performs, so the administrator gets a clear
  -- message instead of the trigger's English one. trg_app_user_email_domain
  -- (0006) is still the enforcement — this is only the friendly version of it.
  -- fn_can_email_sign_in is used rather than fn_is_email_domain_approved
  -- because the latter is deliberately not executable by application roles.
  IF NOT public.fn_can_email_sign_in(v_email) THEN
    RAISE EXCEPTION 'Энэ и-мэйлийн домэйн зөвшөөрөгдөөгүй тул нэвтрэх боломжгүй.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.app_user WHERE email = v_email::public.citext) THEN
    RAISE EXCEPTION 'Энэ и-мэйлтэй хэрэглэгч аль хэдийн бүртгэгдсэн байна.'
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM public.fn_validate_manager_choice(NULL, p_manager_id);

  INSERT INTO public.app_user (email, full_name, phone, role, manager_id)
  VALUES (v_email::public.citext, v_name, nullif(btrim(coalesce(p_phone, '')), ''),
          p_role, p_manager_id)
  RETURNING id INTO v_id;

  -- The user_created audit entry is written by trg_app_user_audit.
  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_admin_update_user — name, phone, reporting line
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_update_user(
  p_user_id    uuid,
  p_full_name  text,
  p_phone      text DEFAULT NULL,
  p_manager_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_name text := btrim(p_full_name);
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор хэрэглэгчийн мэдээллийг өөрчилнө.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Нэрээ оруулна уу.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.app_user WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Хэрэглэгч олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.fn_validate_manager_choice(p_user_id, p_manager_id);

  UPDATE public.app_user
  SET full_name  = v_name,
      phone      = nullif(btrim(coalesce(p_phone, '')), ''),
      manager_id = p_manager_id
  WHERE id = p_user_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_admin_set_user_role
--
-- Role changes are audited automatically (user_role_changed, 0007). What this
-- adds is the set of consequences a single-row policy cannot see.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_set_user_role(
  p_user_id uuid,
  p_role    public.user_role
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user public.app_user;
  v_n    integer;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор эрх өөрчилнө.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_user FROM public.app_user WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Хэрэглэгч олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_user.role = p_role THEN
    RETURN;                                     -- nothing to do, not an error
  END IF;

  -- Lock-out protection. Without this, an administrator can remove their own
  -- administrator rights and nobody inside the app can ever restore them.
  IF v_user.role = 'administrator' AND p_role <> 'administrator' THEN
    SELECT count(*) INTO v_n
    FROM public.app_user
    WHERE role = 'administrator' AND is_active AND id <> p_user_id;

    IF v_n = 0 THEN
      RAISE EXCEPTION 'Сүүлийн администраторын эрхийг хасах боломжгүй.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Brands belong to representatives (trg_rep_brand_assignment_role). Moving
  -- someone out of that role while holding brands would leave rows the trigger
  -- would reject on their next edit.
  IF v_user.role = 'representative' AND p_role <> 'representative' THEN
    SELECT count(*) INTO v_n
    FROM public.rep_brand_assignment
    WHERE rep_id = p_user_id AND is_active;

    IF v_n > 0 THEN
      RAISE EXCEPTION 'Эхлээд % брэндийн хуваарилалтыг дуусгана уу.', v_n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Someone who no longer manages must not still be somebody's manager, or
  -- plans and exception requests would have no reviewer.
  IF v_user.role IN ('manager', 'administrator') AND p_role NOT IN ('manager', 'administrator') THEN
    SELECT count(*) INTO v_n
    FROM public.app_user
    WHERE manager_id = p_user_id AND is_active;

    IF v_n > 0 THEN
      RAISE EXCEPTION 'Энэ хүн % хэрэглэгчийн менежер байна. Эхлээд өөр менежер сонгоно уу.', v_n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.app_user SET role = p_role WHERE id = p_user_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_admin_set_user_active
--
-- Deactivation, not deletion. A deleted user would orphan every visit they
-- ever recorded; every foreign key here is ON DELETE RESTRICT for that reason.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_set_user_active(
  p_user_id uuid,
  p_active  boolean,
  p_reason  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user public.app_user;
  v_n    integer;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор хэрэглэгчийг идэвхгүй болгоно.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_user FROM public.app_user WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Хэрэглэгч олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_user.is_active = p_active THEN
    RETURN;
  END IF;

  IF NOT p_active THEN
    IF p_user_id = public.fn_current_app_user_id() THEN
      RAISE EXCEPTION 'Өөрийгөө идэвхгүй болгох боломжгүй.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_user.role = 'administrator' THEN
      SELECT count(*) INTO v_n
      FROM public.app_user
      WHERE role = 'administrator' AND is_active AND id <> p_user_id;

      IF v_n = 0 THEN
        RAISE EXCEPTION 'Сүүлийн администраторыг идэвхгүй болгох боломжгүй.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- An open visit can only be checked out by its own representative. Closing
    -- their account first would leave it open forever.
    IF EXISTS (
      SELECT 1 FROM public.visit
      WHERE rep_id = p_user_id AND status = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'Энэ хэрэглэгчид дуусаагүй уулзалт байна. Эхлээд түүнийг хаана уу.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*) INTO v_n
    FROM public.app_user
    WHERE manager_id = p_user_id AND is_active;

    IF v_n > 0 THEN
      RAISE EXCEPTION 'Энэ хүн % хэрэглэгчийн менежер байна. Эхлээд өөр менежер сонгоно уу.', v_n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.app_user
  SET is_active      = p_active,
      deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END
  WHERE id = p_user_id;

  -- trg_app_user_audit records user_deactivated. The reason is worth keeping
  -- separately, because "why" is the part a later review actually asks about.
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NOT NULL THEN
    PERFORM public.fn_audit(
      'user_deactivated', 'app_user', p_user_id,
      jsonb_build_object('is_active', v_user.is_active),
      jsonb_build_object('is_active', p_active),
      btrim(p_reason));
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Brand assignments
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_assign_brand(
  p_rep_id     uuid,
  p_brand_id   uuid,
  p_start_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_start date := COALESCE(p_start_date, public.fn_local_date(now()));
  v_id    uuid;
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор брэнд хуваарилна.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_user
    WHERE id = p_rep_id AND is_active AND role = 'representative'
  ) THEN
    RAISE EXCEPTION 'Брэндийг зөвхөн идэвхтэй төлөөлөгчид хуваарилна.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.brand
    WHERE id = p_brand_id AND deleted_at IS NULL AND is_active
  ) THEN
    RAISE EXCEPTION 'Брэнд олдсонгүй эсвэл идэвхгүй байна.' USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rep_brand_assignment
    WHERE rep_id = p_rep_id AND brand_id = p_brand_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Энэ брэнд аль хэдийн хуваарилагдсан байна.'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.rep_brand_assignment (rep_id, brand_id, start_date)
  VALUES (p_rep_id, p_brand_id, v_start)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_end_brand_assignment(
  p_assignment_id uuid,
  p_end_date      date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_row public.rep_brand_assignment;
  v_end date := COALESCE(p_end_date, public.fn_local_date(now()));
BEGIN
  IF NOT public.fn_is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн администратор брэндийн хуваарилалтыг дуусгана.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row FROM public.rep_brand_assignment WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Хуваарилалт олдсонгүй.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT v_row.is_active THEN
    RETURN;
  END IF;

  IF v_end < v_row.start_date THEN
    RAISE EXCEPTION 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The row is kept, not removed: past visits are attributed to the brands the
  -- representative held at the time, and the KPI reads history.
  UPDATE public.rep_brand_assignment
  SET is_active = false, end_date = v_end
  WHERE id = p_assignment_id;
END;
$$;

-- =============================================================================
-- Archive guards for master data
--
-- Soft delete is the only delete. These triggers refuse an archive that would
-- break work already scheduled. They fire regardless of how the write arrives —
-- the admin screen, a SQL console, or a future import job.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_clinic_archive()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER so the guard counts EVERY dependent row. As invoker it
-- would count only the rows RLS shows the caller, and an archive could slip
-- through simply because the caller could not see what it would break.
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL THEN
    RETURN NEW;                                  -- not an archive
  END IF;

  IF NEW.is_active THEN
    RAISE EXCEPTION 'Архивлахын өмнө эмнэлгийг идэвхгүй болгоно уу.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.visit WHERE clinic_id = NEW.id AND status = 'in_progress') THEN
    RAISE EXCEPTION 'Энэ эмнэлэгт дуусаагүй уулзалт байна.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.planned_visit
  WHERE clinic_id = NEW.id
    AND status = 'planned'
    AND planned_date >= public.fn_local_date(now());

  IF v_n > 0 THEN
    RAISE EXCEPTION 'Энэ эмнэлэгт төлөвлөгдсөн % уулзалт байна.', v_n
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_doctor_archive()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER so the guard counts EVERY dependent row. As invoker it
-- would count only the rows RLS shows the caller, and an archive could slip
-- through simply because the caller could not see what it would break.
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_active THEN
    RAISE EXCEPTION 'Архивлахын өмнө эмчийг идэвхгүй болгоно уу.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.planned_visit_doctor pvd
  JOIN public.planned_visit pv ON pv.id = pvd.planned_visit_id
  WHERE pvd.doctor_id = NEW.id
    AND pv.status = 'planned'
    AND pv.planned_date >= public.fn_local_date(now());

  IF v_n > 0 THEN
    RAISE EXCEPTION 'Энэ эмчтэй төлөвлөгдсөн % уулзалт байна.', v_n
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.follow_up
  WHERE doctor_id = NEW.id AND status = 'open';

  IF v_n > 0 THEN
    RAISE EXCEPTION 'Энэ эмчид хаагдаагүй % дараагийн ажил байна.', v_n
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_brand_archive()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER so the guard counts EVERY dependent row. As invoker it
-- would count only the rows RLS shows the caller, and an archive could slip
-- through simply because the caller could not see what it would break.
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_active THEN
    RAISE EXCEPTION 'Архивлахын өмнө брэндийг идэвхгүй болгоно уу.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.rep_brand_assignment
  WHERE brand_id = NEW.id AND is_active;

  IF v_n > 0 THEN
    RAISE EXCEPTION 'Энэ брэнд % төлөөлөгчид хуваарилагдсан байна.', v_n
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.product
  WHERE brand_id = NEW.id AND deleted_at IS NULL;

  IF v_n > 0 THEN
    RAISE EXCEPTION 'Энэ брэндэд % бүтээгдэхүүн бүртгэлтэй байна.', v_n
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clinic_guard_archive
  BEFORE UPDATE ON public.clinic
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_clinic_archive();

CREATE TRIGGER trg_doctor_guard_archive
  BEFORE UPDATE ON public.doctor
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_doctor_archive();

CREATE TRIGGER trg_brand_guard_archive
  BEFORE UPDATE ON public.brand
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_brand_archive();

-- -----------------------------------------------------------------------------
-- fn_admin_master_data_counts — what the management screen shows at the top
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_master_data_counts()
RETURNS TABLE (
  clinics_active   integer,
  clinics_archived integer,
  doctors_active   integer,
  doctors_archived integer,
  brands_active    integer,
  products_active  integer,
  users_active     integer,
  -- Clinics whose geofence is still exactly the default. Not wrong, but worth
  -- surfacing: an untuned radius is the usual cause of "I cannot check in".
  clinics_default_radius integer
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    (SELECT count(*) FROM public.clinic WHERE deleted_at IS NULL AND is_active)::integer,
    (SELECT count(*) FROM public.clinic WHERE deleted_at IS NOT NULL)::integer,
    (SELECT count(*) FROM public.doctor WHERE deleted_at IS NULL AND is_active)::integer,
    (SELECT count(*) FROM public.doctor WHERE deleted_at IS NOT NULL)::integer,
    (SELECT count(*) FROM public.brand  WHERE deleted_at IS NULL AND is_active)::integer,
    (SELECT count(*) FROM public.product WHERE deleted_at IS NULL AND is_active)::integer,
    (SELECT count(*) FROM public.app_user WHERE is_active)::integer,
    (SELECT count(*) FROM public.clinic
      WHERE deleted_at IS NULL
        AND geofence_radius_m = public.fn_setting_int('default_geofence_radius_m'))::integer
  WHERE public.fn_is_admin();
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  public.fn_admin_users(),
  public.fn_admin_create_user(text, text, public.user_role, uuid, text),
  public.fn_admin_update_user(uuid, text, text, uuid),
  public.fn_admin_set_user_role(uuid, public.user_role),
  public.fn_admin_set_user_active(uuid, boolean, text),
  public.fn_admin_assign_brand(uuid, uuid, date),
  public.fn_admin_end_brand_assignment(uuid, date),
  public.fn_admin_master_data_counts(),
  -- Granted because the functions above are SECURITY INVOKER: they call this
  -- helper as the signed-in user, so that user needs EXECUTE on it. It is a
  -- read-only validator that either returns nothing or raises, and it exposes
  -- no data, so granting it costs nothing.
  public.fn_validate_manager_choice(uuid, uuid)
TO authenticated;
