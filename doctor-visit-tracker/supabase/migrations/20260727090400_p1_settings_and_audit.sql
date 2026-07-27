-- ===========================================================================
-- Phase 1 / 05 — Application settings and the immutable audit log
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app_settings — every tunable number in one place, changeable without a code
-- release. is_public rows are readable by all signed-in users because the app
-- needs them offline (radius, accuracy threshold, feature flags).
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text not null,
  is_public   boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.app_users (id) on delete set null
);

create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value, description, is_public) values
  ('default_geofence_radius_m', '150'::jsonb,
   'Metres. Used when a clinic has no specific radius.', true),
  ('gps_accuracy_threshold_m', '50'::jsonb,
   'A check-in is refused when the phone reports accuracy worse than this.', true),
  ('max_clock_skew_seconds', '300'::jsonb,
   'Difference between phone clock and server clock above which a visit is flagged for review.', true),
  ('location_fix_timeout_seconds', '20'::jsonb,
   'How long the app keeps trying for a good GPS reading before giving up.', true),
  ('planning_deadline_weekday', '5'::jsonb,
   'ISO weekday (1=Monday) by which next week''s plan must be submitted. 5 = Friday.', true),
  ('planning_deadline_hour', '18'::jsonb,
   'Hour of the deadline day, Asia/Ulaanbaatar, 24-hour clock.', true),
  ('on_time_tolerance_minutes', '15'::jsonb,
   'Minutes after the planned time that still counts as an on-time start.', true),
  ('min_visit_duration_minutes', '3'::jsonb,
   'Visits shorter than this are flagged to managers (not blocked).', true),
  ('feature_audio_recording', 'false'::jsonb,
   'Audio recording. MUST stay false until the consent workflow and legal review are complete.', true),
  ('feature_offline_unplanned_visits', 'false'::jsonb,
   'Creating brand-new unplanned visits while offline. Planned for Phase 7.', true),
  ('retention_visit_years', '5'::jsonb,
   'How long visit records are kept.', false),
  ('retention_location_years', '2'::jsonb,
   'How long check-in / check-out coordinates are kept. The visit record survives; the coordinates are erased.', false),
  ('retention_audit_years', '7'::jsonb,
   'How long audit records are kept.', false);


-- ---------------------------------------------------------------------------
-- audit_logs — append only. No UPDATE or DELETE grant exists for any
-- application role, and a trigger blocks it as a second line of defence.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  actor_email  extensions.citext,
  actor_role   public.user_role,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  before_data  jsonb,
  after_data   jsonb,
  ip_address   inet,
  user_agent   text,
  app_version  text,
  note         text
);

comment on table public.audit_logs is
  'Append-only record of security-relevant actions. actor_email is denormalised so the trail survives user deletion.';

create index idx_audit_occurred on public.audit_logs (occurred_at desc);
create index idx_audit_actor    on public.audit_logs (actor_id, occurred_at desc);
create index idx_audit_entity   on public.audit_logs (entity_type, entity_id, occurred_at desc);
create index idx_audit_action   on public.audit_logs (action, occurred_at desc);

create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.raise_immutable();


-- ---------------------------------------------------------------------------
-- Write an audit entry. SECURITY DEFINER so callers never need INSERT rights
-- on the table itself — they cannot forge an actor either, because the actor
-- is taken from the session, not from the arguments.
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid    default null,
  p_before      jsonb   default null,
  p_after       jsonb   default null,
  p_note        text    default null,
  p_app_version text    default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    bigint;
  v_email extensions.citext;
  v_role  public.user_role;
begin
  -- The actor is always read from the session, never from the arguments, so a
  -- caller cannot write an entry that blames somebody else.
  select u.email, u.role into v_email, v_role
  from public.app_users u
  where u.auth_user_id = auth.uid()
  limit 1;

  insert into public.audit_logs (
    actor_id, actor_email, actor_role, action, entity_type, entity_id,
    before_data, after_data, note, app_version
  )
  values (
    public.auth_user_id(), v_email, v_role, p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_note, p_app_version
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.write_audit(text, text, uuid, jsonb, jsonb, text, text) from public;
grant execute on function public.write_audit(text, text, uuid, jsonb, jsonb, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Generic trigger that audits master-data changes automatically, so nobody has
-- to remember to call write_audit() from application code.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action    text;
  v_entity_id uuid;
  v_before    jsonb;
  v_after     jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := tg_argv[0] || '_created';
    v_after  := to_jsonb(new);
    v_entity_id := (to_jsonb(new) ->> 'id')::uuid;
  elsif tg_op = 'UPDATE' then
    v_action := tg_argv[0] || '_updated';
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_entity_id := (to_jsonb(new) ->> 'id')::uuid;
  else
    v_action := tg_argv[0] || '_deleted';
    v_before := to_jsonb(old);
    v_entity_id := (to_jsonb(old) ->> 'id')::uuid;
  end if;

  insert into public.audit_logs (
    actor_id, actor_email, actor_role, action, entity_type, entity_id,
    before_data, after_data
  )
  values (
    public.auth_user_id(),
    (select u.email from public.app_users u where u.auth_user_id = auth.uid()),
    public.auth_role(),
    v_action, tg_table_name, v_entity_id, v_before, v_after
  );

  return coalesce(new, old);
end;
$$;

create trigger trg_audit_app_users
  after insert or update or delete on public.app_users
  for each row execute function public.audit_row_change('user');

create trigger trg_audit_clinics
  after insert or update or delete on public.clinics
  for each row execute function public.audit_row_change('master_data');

create trigger trg_audit_doctors
  after insert or update or delete on public.doctors
  for each row execute function public.audit_row_change('master_data');

create trigger trg_audit_doctor_clinics
  after insert or update or delete on public.doctor_clinics
  for each row execute function public.audit_row_change('master_data');

create trigger trg_audit_brands
  after insert or update or delete on public.brands
  for each row execute function public.audit_row_change('master_data');

create trigger trg_audit_products
  after insert or update or delete on public.products
  for each row execute function public.audit_row_change('master_data');

create trigger trg_audit_rba
  after insert or update or delete on public.representative_brand_assignments
  for each row execute function public.audit_row_change('master_data');

create trigger trg_audit_email_domains
  after insert or update or delete on public.approved_email_domains
  for each row execute function public.audit_row_change('email_domain');

create trigger trg_audit_app_settings
  after insert or update on public.app_settings
  for each row execute function public.audit_row_change('setting');


-- ---------------------------------------------------------------------------
-- Called by the app right after a successful sign-in.
-- ---------------------------------------------------------------------------
create or replace function public.record_login(p_app_version text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
begin
  select * into v_user
  from public.app_users u
  where u.auth_user_id = auth.uid() and u.deleted_at is null;

  if v_user.id is null then
    return;  -- not provisioned; nothing to record
  end if;

  update public.app_users
     set last_login_at = now(),
         app_version   = coalesce(p_app_version, app_version)
   where id = v_user.id;

  insert into public.audit_logs (actor_id, actor_email, actor_role, action,
                                 entity_type, entity_id, app_version)
  values (v_user.id, v_user.email, v_user.role, 'login',
          'app_users', v_user.id, p_app_version);
end;
$$;

revoke all on function public.record_login(text) from public;
grant execute on function public.record_login(text) to authenticated;
