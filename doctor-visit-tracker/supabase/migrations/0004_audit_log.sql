-- =============================================================================
-- 0004_audit_log.sql
-- Doctor Visit Tracker — Phase 1
--
-- An append-only record of every action that matters.
--
-- "Immutable" here is not a naming convention, it is enforced:
--   * UPDATE and DELETE are revoked from every application role (0008).
--   * A trigger additionally raises on UPDATE/DELETE, so even a mis-granted
--     privilege cannot rewrite history.
--   * Rows are written by SECURITY DEFINER functions, so a user cannot suppress
--     an entry by lacking INSERT rights, and cannot forge one by having them.
-- =============================================================================

CREATE TABLE public.audit_log (
  id                bigserial PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),

  -- Denormalised on purpose: if a user is later renamed or deactivated, the
  -- audit trail must still say who acted at the time.
  actor_app_user_id uuid REFERENCES public.app_user (id) ON DELETE RESTRICT,
  actor_email       citext,
  actor_role        public.user_role,

  action            text NOT NULL,
  entity_type       text,
  entity_id         uuid,

  before_data       jsonb,
  after_data        jsonb,

  ip_address        inet,
  app_version       text,
  note              text,

  CONSTRAINT audit_log_action_known CHECK (action IN (
    'login',
    'logout',
    'login_denied_domain',
    'plan_created',
    'plan_changed',
    'plan_submitted',
    'plan_reviewed',
    'visit_started',
    'visit_completed',
    'visit_draft_saved',
    'exception_requested',
    'exception_reviewed',
    'addendum_added',
    'master_data_changed',
    'user_created',
    'user_role_changed',
    'user_deactivated',
    'setting_changed',
    'data_export',
    'audio_accessed'          -- reserved; audio is not implemented
  ))
);

CREATE INDEX audit_log_occurred_at_idx ON public.audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_idx       ON public.audit_log (actor_app_user_id, occurred_at DESC);
CREATE INDEX audit_log_action_idx      ON public.audit_log (action, occurred_at DESC);
CREATE INDEX audit_log_entity_idx      ON public.audit_log (entity_type, entity_id);

COMMENT ON TABLE public.audit_log IS
  'Append-only. UPDATE and DELETE are revoked and additionally blocked by trigger.';

-- -----------------------------------------------------------------------------
-- Block rewriting history even if privileges are ever mis-granted.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_log_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_is_append_only();

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_is_append_only();

-- -----------------------------------------------------------------------------
-- The single entry point for writing an audit record.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit(
  p_action      text,
  p_entity_type text     DEFAULT NULL,
  p_entity_id   uuid     DEFAULT NULL,
  p_before      jsonb    DEFAULT NULL,
  p_after       jsonb    DEFAULT NULL,
  p_note        text     DEFAULT NULL,
  p_app_version text     DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.app_user;
  v_id    bigint;
BEGIN
  v_actor := public.fn_current_app_user();

  INSERT INTO public.audit_log (
    actor_app_user_id, actor_email, actor_role,
    action, entity_type, entity_id,
    before_data, after_data, note, app_version
  )
  VALUES (
    v_actor.id, v_actor.email, v_actor.role,
    p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_note, p_app_version
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.fn_audit IS
  'The only supported way to write an audit entry. SECURITY DEFINER so callers cannot forge or suppress entries.';

-- -----------------------------------------------------------------------------
-- Generic trigger for master-data tables (clinic, doctor, brand, product, ...).
-- Attached in 0005. Records the full before/after row so an administrator can
-- see exactly what changed, not merely that something changed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_master_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_entity_id := (to_jsonb(NEW) ->> 'id')::uuid;
    PERFORM public.fn_audit('master_data_changed', TG_TABLE_NAME, v_entity_id,
                            NULL, to_jsonb(NEW), TG_OP);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_entity_id := (to_jsonb(NEW) ->> 'id')::uuid;
    -- Skip no-op updates so the log stays readable.
    IF to_jsonb(OLD) - 'updated_at' - 'updated_by' = to_jsonb(NEW) - 'updated_at' - 'updated_by' THEN
      RETURN NEW;
    END IF;
    PERFORM public.fn_audit('master_data_changed', TG_TABLE_NAME, v_entity_id,
                            to_jsonb(OLD), to_jsonb(NEW), TG_OP);
    RETURN NEW;
  ELSE
    v_entity_id := (to_jsonb(OLD) ->> 'id')::uuid;
    PERFORM public.fn_audit('master_data_changed', TG_TABLE_NAME, v_entity_id,
                            to_jsonb(OLD), NULL, TG_OP);
    RETURN OLD;
  END IF;
END;
$$;
