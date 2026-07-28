/**
 * Linking a login to its application account.
 *
 * There are two orders in which an account can come into being, and the system
 * has to survive both:
 *
 *   A. administrator provisions, then the person signs in   (the happy order)
 *   B. the person tries to sign in, THEN gets provisioned    (the real world)
 *
 * Order B was permanently broken. Migration 0006's trigger fires on
 * auth.users INSERT; in order B that insert has already happened, so nothing
 * ever links the two rows. The account looked correct in every table and the
 * person could never sign in.
 *
 * It survived seven phases because every test and every seed uses order A.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { asSuperuser, closePool, DB_AVAILABLE } from './helpers';

interface Diagnosis {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * These tests need auth.users and app_user rows to persist across statements
 * within one check, so each runs in its own explicit transaction and rolls
 * back at the end.
 */
async function inRolledBackTransaction(body: () => Promise<void>) {
  await asSuperuser('BEGIN');
  try {
    await body();
  } finally {
    await asSuperuser('ROLLBACK');
  }
}

describe.skipIf(!DB_AVAILABLE)('account linking', () => {
  afterAll(closePool);

  it('order A — provisioned first, then signs in', async () => {
    await inRolledBackTransaction(async () => {
      await asSuperuser(
        `INSERT INTO public.app_user (email, full_name, role)
         VALUES ('order-a@monos.mn', 'Дараалал А', 'representative')`,
      );
      await asSuperuser(`INSERT INTO auth.users (email) VALUES ('order-a@monos.mn')`);

      const [row] = await asSuperuser<{ auth_user_id: string | null }>(
        `SELECT auth_user_id FROM public.app_user WHERE email = 'order-a@monos.mn'`,
      );
      expect(row.auth_user_id).not.toBeNull();
    });
  });

  it('order B — signs in first, then provisioned (this used to fail for ever)', async () => {
    await inRolledBackTransaction(async () => {
      await asSuperuser(`INSERT INTO auth.users (email) VALUES ('order-b@monos.mn')`);
      await asSuperuser(
        `INSERT INTO public.app_user (email, full_name, role)
         VALUES ('order-b@monos.mn', 'Дараалал Б', 'representative')`,
      );

      const [row] = await asSuperuser<{ auth_user_id: string | null }>(
        `SELECT auth_user_id FROM public.app_user WHERE email = 'order-b@monos.mn'`,
      );
      expect(row.auth_user_id).not.toBeNull();
    });
  });

  it('links regardless of how the address was capitalised', async () => {
    // The Phase 1 citext trap, in its third guise.
    await inRolledBackTransaction(async () => {
      await asSuperuser(`INSERT INTO auth.users (email) VALUES ('MixedCase@Monos.MN')`);
      await asSuperuser(
        `INSERT INTO public.app_user (email, full_name, role)
         VALUES ('mixedcase@monos.mn', 'Том Жижиг', 'representative')`,
      );

      const [row] = await asSuperuser<{ auth_user_id: string | null }>(
        `SELECT auth_user_id FROM public.app_user WHERE email = 'mixedcase@monos.mn'`,
      );
      expect(row.auth_user_id).not.toBeNull();
    });
  });

  it('does not invent a link when no login exists', async () => {
    await inRolledBackTransaction(async () => {
      await asSuperuser(
        `INSERT INTO public.app_user (email, full_name, role)
         VALUES ('nobody@monos.mn', 'Хэн ч Биш', 'representative')`,
      );
      const [row] = await asSuperuser<{ auth_user_id: string | null }>(
        `SELECT auth_user_id FROM public.app_user WHERE email = 'nobody@monos.mn'`,
      );
      expect(row.auth_user_id).toBeNull();
    });
  });

  it('never re-points an account that is already linked', async () => {
    await inRolledBackTransaction(async () => {
      const [seeded] = await asSuperuser<{ id: string; auth_user_id: string }>(
        `SELECT u.id, u.auth_user_id FROM public.app_user u
         WHERE u.auth_user_id IS NOT NULL LIMIT 1`,
      );
      if (!seeded) return; // nothing signed in yet in this database

      await asSuperuser('SELECT * FROM public.fn_relink_orphaned_users()');

      const [after] = await asSuperuser<{ auth_user_id: string }>(
        `SELECT auth_user_id FROM public.app_user WHERE id = $1`,
        [seeded.id],
      );
      expect(after.auth_user_id).toBe(seeded.auth_user_id);
    });
  });

  // ===========================================================================
  describe('the repair function', () => {
    it('links an account that is already stuck, and says so', async () => {
      await inRolledBackTransaction(async () => {
        await asSuperuser(`INSERT INTO auth.users (email) VALUES ('stuck@monos.mn')`);
        // Reproduce the pre-0026 state exactly.
        await asSuperuser(
          'ALTER TABLE public.app_user DISABLE TRIGGER trg_app_user_adopt_existing_login',
        );
        await asSuperuser(
          `INSERT INTO public.app_user (email, full_name, role)
           VALUES ('stuck@monos.mn', 'Гацсан', 'representative')`,
        );
        await asSuperuser(
          'ALTER TABLE public.app_user ENABLE TRIGGER trg_app_user_adopt_existing_login',
        );

        const before = await asSuperuser<{ auth_user_id: string | null }>(
          `SELECT auth_user_id FROM public.app_user WHERE email = 'stuck@monos.mn'`,
        );
        expect(before[0].auth_user_id).toBeNull();

        const repaired = await asSuperuser<{ email: string; outcome: string }>(
          `SELECT * FROM public.fn_relink_orphaned_users() WHERE outcome LIKE 'LINKED%'`,
        );
        expect(repaired.map((r) => r.email)).toContain('stuck@monos.mn');

        const after = await asSuperuser<{ auth_user_id: string | null }>(
          `SELECT auth_user_id FROM public.app_user WHERE email = 'stuck@monos.mn'`,
        );
        expect(after[0].auth_user_id).not.toBeNull();
      });
    });
  });

  // ===========================================================================
  describe('the diagnosis', () => {
    it('identifies an unlinked account as the problem', async () => {
      await inRolledBackTransaction(async () => {
        await asSuperuser(`INSERT INTO auth.users (email) VALUES ('diag@monos.mn')`);
        await asSuperuser(
          'ALTER TABLE public.app_user DISABLE TRIGGER trg_app_user_adopt_existing_login',
        );
        await asSuperuser(
          `INSERT INTO public.app_user (email, full_name, role)
           VALUES ('diag@monos.mn', 'Онош', 'representative')`,
        );
        await asSuperuser(
          'ALTER TABLE public.app_user ENABLE TRIGGER trg_app_user_adopt_existing_login',
        );

        const steps = await asSuperuser<Diagnosis>(
          `SELECT * FROM public.fn_diagnose_login('diag@monos.mn')`,
        );
        const failed = steps.filter((s) => !s.ok);

        expect(failed.map((s) => s.step)).toEqual([
          '5. Хоёр бүртгэл хоорондоо холбогдсон эсэх',
          '6. ДҮГНЭЛТ',
        ]);
        // The message must name the repair, not merely state the fact.
        expect(failed[0].detail).toContain('fn_relink_orphaned_users');
      });
    });

    it('identifies a missing account', async () => {
      const steps = await asSuperuser<Diagnosis>(
        `SELECT * FROM public.fn_diagnose_login('never-created@monos.mn')`,
      );
      expect(steps[1].ok).toBe(false);
      expect(steps[1].step).toContain('app_user');
      // It stops there rather than reporting five more confusing failures.
      expect(steps).toHaveLength(2);
    });

    it('identifies an unapproved domain', async () => {
      const steps = await asSuperuser<Diagnosis>(
        `SELECT * FROM public.fn_diagnose_login('someone@gmail.com')`,
      );
      expect(steps[0].ok).toBe(false);
      expect(steps[0].detail).toContain('ЗӨВШӨӨРӨӨГҮЙ');
    });

    it('passes a healthy seeded account', async () => {
      const steps = await asSuperuser<Diagnosis>(
        `SELECT * FROM public.fn_diagnose_login('rep01@monos.mn')`,
      );
      const verdict = steps[steps.length - 1];
      expect(verdict.step).toContain('ДҮГНЭЛТ');
      expect(verdict.ok).toBe(true);
    });

    it('reports "not signed in yet" as normal, not as a fault', async () => {
      await inRolledBackTransaction(async () => {
        await asSuperuser(
          `INSERT INTO public.app_user (email, full_name, role)
           VALUES ('fresh@monos.mn', 'Шинэ', 'representative')`,
        );
        const steps = await asSuperuser<Diagnosis>(
          `SELECT * FROM public.fn_diagnose_login('fresh@monos.mn')`,
        );
        // No login yet is expected; the verdict must still be OK so an
        // administrator does not go hunting for a problem that is not there.
        expect(steps[steps.length - 1].ok).toBe(true);
      });
    });
  });

  // ===========================================================================
  it('none of these tools are reachable from the app', async () => {
    const rows = await asSuperuser<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('fn_relink_orphaned_users', 'fn_diagnose_login')
         AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           OR has_function_privilege('anon', p.oid, 'EXECUTE'))`,
    );
    // fn_diagnose_login reveals whether an address is registered — exactly the
    // enumeration fn_can_email_sign_in was written to avoid leaking.
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});
