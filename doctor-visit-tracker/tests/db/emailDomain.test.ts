/**
 * ACCEPTANCE CRITERIA 1 & 2
 *   1. A representative can log in with an approved work email.
 *   2. An unauthorised email cannot log in.
 *
 * These are tested against auth.users itself, not against the mobile app, so
 * they hold for anyone calling the API directly.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { asSuperuser, closePool, DB_AVAILABLE } from './helpers';

describe.skipIf(!DB_AVAILABLE)('email domain restriction', () => {
  afterAll(closePool);

  it('accepts an address in an approved company domain', async () => {
    const [row] = await asSuperuser<{ ok: boolean }>(
      "SELECT public.fn_is_email_domain_approved('rep01@monos.mn') AS ok",
    );
    expect(row.ok).toBe(true);
  });

  it('rejects an address outside the approved domains', async () => {
    for (const email of [
      'someone@gmail.com',
      'attacker@monos.mn.evil.com',
      'person@notmonos.mn',
    ]) {
      const [row] = await asSuperuser<{ ok: boolean }>(
        'SELECT public.fn_is_email_domain_approved($1) AS ok',
        [email],
      );
      expect(row.ok, `${email} must be rejected`).toBe(false);
    }
  });

  it('is case-insensitive, because email domains are', async () => {
    const [row] = await asSuperuser<{ ok: boolean }>(
      "SELECT public.fn_is_email_domain_approved('Rep01@MONOS.MN') AS ok",
    );
    expect(row.ok).toBe(true);
  });

  it('rejects a malformed address even under an approved domain', async () => {
    for (const email of ['@monos.mn', 'no-at-sign', 'a b@monos.mn', 'two@@monos.mn']) {
      const [row] = await asSuperuser<{ ok: boolean }>(
        'SELECT public.fn_is_email_domain_approved($1) AS ok',
        [email],
      );
      expect(row.ok, `${email} must be rejected`).toBe(false);
    }
  });

  it('cannot be fooled by a second @ that fakes an approved domain', async () => {
    // 'evil@attacker.com@monos.mn' has an approved-looking tail. It must still
    // be rejected because it is not a well-formed single address.
    const [row] = await asSuperuser<{ ok: boolean }>(
      'SELECT public.fn_is_email_domain_approved($1) AS ok',
      ['evil@attacker.com@monos.mn'],
    );
    expect(row.ok).toBe(false);
  });

  it('BLOCKS the creation of an auth user outside an approved domain', async () => {
    await expect(
      asSuperuser("INSERT INTO auth.users (email) VALUES ('outsider@gmail.com')"),
    ).rejects.toThrow(/approved company email domains/i);
  });

  it('ALLOWS the creation of an auth user in an approved domain', async () => {
    await asSuperuser("INSERT INTO auth.users (email) VALUES ('newjoiner@monos.mn')");
    const rows = await asSuperuser("SELECT 1 FROM auth.users WHERE email = 'newjoiner@monos.mn'");
    expect(rows).toHaveLength(1);

    // cleanup so re-runs stay deterministic
    await asSuperuser("DELETE FROM auth.users WHERE email = 'newjoiner@monos.mn'");
  });

  it('links a new auth identity to the pre-provisioned app_user', async () => {
    await asSuperuser("DELETE FROM auth.users WHERE email = 'rep02@monos.mn'");
    await asSuperuser(
      "UPDATE public.app_user SET auth_user_id = NULL WHERE email = 'rep02@monos.mn'",
    );

    const [authUser] = await asSuperuser<{ id: string }>(
      "INSERT INTO auth.users (email) VALUES ('rep02@monos.mn') RETURNING id",
    );

    const [appUser] = await asSuperuser<{ auth_user_id: string }>(
      "SELECT auth_user_id FROM public.app_user WHERE email = 'rep02@monos.mn'",
    );
    expect(appUser.auth_user_id).toBe(authUser.id);
  });

  it('links the identity even when the address is typed in a different case', async () => {
    // Regression test. Both this trigger and fn_is_email_domain_approved run
    // with `SET search_path = ''`, which makes citext's case-insensitive '='
    // unresolvable and silently case-sensitive. A person typing
    // "Rep03@Monos.mn" must still reach their own account.
    await asSuperuser("DELETE FROM auth.users WHERE lower(email) = 'rep03@monos.mn'");
    await asSuperuser(
      "UPDATE public.app_user SET auth_user_id = NULL WHERE email = 'rep03@monos.mn'",
    );

    const [authUser] = await asSuperuser<{ id: string }>(
      "INSERT INTO auth.users (email) VALUES ('Rep03@Monos.MN') RETURNING id",
    );

    const [appUser] = await asSuperuser<{ auth_user_id: string | null }>(
      "SELECT auth_user_id FROM public.app_user WHERE email = 'rep03@monos.mn'",
    );
    expect(appUser.auth_user_id).toBe(authUser.id);
  });

  it('refuses to provision an app_user outside an approved domain', async () => {
    await expect(
      asSuperuser(
        `INSERT INTO public.app_user (email, full_name, role)
         VALUES ('contractor@gmail.com', 'Гэрээт ажилтан', 'representative')`,
      ),
    ).rejects.toThrow(/approved company domain list/i);
  });

  it('deactivating a domain immediately blocks new logins under it', async () => {
    await asSuperuser("UPDATE public.approved_email_domain SET is_active = false WHERE domain = 'monos.mn'");
    try {
      const [row] = await asSuperuser<{ ok: boolean }>(
        "SELECT public.fn_is_email_domain_approved('rep01@monos.mn') AS ok",
      );
      expect(row.ok).toBe(false);
    } finally {
      await asSuperuser("UPDATE public.approved_email_domain SET is_active = true WHERE domain = 'monos.mn'");
    }
  });
});
