-- ===========================================================================
-- TEST — Approved e-mail domain restriction and the login gate
-- Acceptance criteria 1 and 2.
--
-- Run with:  ./scripts/run-sql-tests.sh
-- Each assertion raises an exception on failure, which aborts the file and
-- makes the runner report a failure.
-- ===========================================================================
\set ON_ERROR_STOP on
\echo '--- 01 e-mail domain restriction'

begin;

-- ---------------------------------------------------------------------------
create or replace function pg_temp.expect(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception 'FAILED: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

create or replace function pg_temp.expect_error(p_sql text, p_fragment text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_fragment in sqlerrm) = 0 then
      raise exception 'FAILED: % — expected error containing "%", got "%"', p_label, p_fragment, sqlerrm;
    end if;
    raise notice '  ok  %', p_label;
    return;
  end;
  raise exception 'FAILED: % — expected an error, but the statement succeeded', p_label;
end;
$$;
-- ---------------------------------------------------------------------------


-- 1. A seeded, approved address is allowed to log in.
select pg_temp.expect(
  public.is_login_email_allowed('rep1@company.mn'),
  'approved domain + provisioned user is allowed'
);

-- 2. An outside address is not, even though it is well formed.
select pg_temp.expect(
  not public.is_login_email_allowed('attacker@gmail.com'),
  'outside domain is rejected'
);

-- 3. Right domain but no administrator-created account is still refused.
select pg_temp.expect(
  not public.is_login_email_allowed('ghost@company.mn'),
  'approved domain without a provisioned user is rejected'
);

-- 4. Case must not matter.
select pg_temp.expect(
  public.is_login_email_allowed('REP1@COMPANY.MN'),
  'e-mail check is case-insensitive'
);

-- 5. Rubbish input does not error, it simply returns false.
select pg_temp.expect(
  not public.is_login_email_allowed('not-an-email')
  and not public.is_login_email_allowed('')
  and not public.is_login_email_allowed(null),
  'malformed input returns false rather than failing'
);

-- 6. THE REAL GATE: Supabase cannot create an account for an outside domain.
select pg_temp.expect_error(
  $sql$ insert into auth.users (email) values ('attacker@gmail.com') $sql$,
  'DVT_EMAIL_DOMAIN_NOT_ALLOWED',
  'auth.users insert is blocked for a non-approved domain'
);

-- 7. Nor for an approved domain with no provisioned staff record.
select pg_temp.expect_error(
  $sql$ insert into auth.users (email) values ('ghost@company.mn') $sql$,
  'DVT_USER_NOT_PROVISIONED',
  'auth.users insert is blocked when the person has no app_users row'
);

-- 8. A deactivated employee can no longer obtain a new account.
update public.app_users set is_active = false where email = 'rep7@company.mn';
delete from auth.users where email = 'rep7@company.mn';
select pg_temp.expect(
  not public.is_login_email_allowed('rep7@company.mn'),
  'deactivated staff cannot log in'
);
select pg_temp.expect_error(
  $sql$ insert into auth.users (email) values ('rep7@company.mn') $sql$,
  'DVT_USER_NOT_PROVISIONED',
  'auth.users insert is blocked for a deactivated employee'
);
update public.app_users set is_active = true where email = 'rep7@company.mn';

-- 9. Deactivating the DOMAIN blocks everyone on it.
update public.approved_email_domains set is_active = false where domain = 'company.mn';
select pg_temp.expect(
  not public.is_login_email_allowed('rep1@company.mn'),
  'deactivating the domain blocks previously allowed addresses'
);
update public.approved_email_domains set is_active = true where domain = 'company.mn';

-- 10. An app_users row cannot be created on an unapproved domain either.
select pg_temp.expect_error(
  $sql$ insert into public.app_users (email, full_name)
        values ('someone@outside.example', 'Outside Person') $sql$,
  'DVT_EMAIL_DOMAIN_NOT_ALLOWED',
  'administrators cannot provision a user on an unapproved domain'
);

-- 11. First login links the auth account to the pre-created staff record.
delete from auth.users where email = 'rep1@company.mn';
update public.app_users set auth_user_id = null where email = 'rep1@company.mn';
insert into auth.users (id, email) values ('99999999-0000-4000-a000-000000000001', 'rep1@company.mn');
select pg_temp.expect(
  (select auth_user_id from public.app_users where email = 'rep1@company.mn')
    = '99999999-0000-4000-a000-000000000001',
  'first login links auth.users to the existing app_users row'
);

rollback;
\echo '--- 01 passed'
