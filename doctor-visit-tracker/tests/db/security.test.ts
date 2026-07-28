/**
 * Standing security assertions.
 *
 * The centrepiece is `fn_security_findings()`, which must return zero rows.
 * Around it are direct tests for the specific attacks that motivated it — a
 * self-check nobody has tried to break is a self-check nobody should trust.
 *
 * The bug that produced this file: PostgreSQL grants EXECUTE on every new
 * function to PUBLIC. Migration 0008 revoked fn_audit "from anon,
 * authenticated" and believed that was enough. It was not, and an
 * unauthenticated caller could forge audit log entries. Migration 0025 closes
 * it; these tests make sure it stays closed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  actingAs,
  actingAsAnon,
  asSuperuser,
  closePool,
  DB_AVAILABLE,
  USERS,
} from './helpers';

interface Finding {
  severity: string;
  area: string;
  object: string;
  detail: string;
}

describe.skipIf(!DB_AVAILABLE)('security posture', () => {
  afterAll(closePool);

  // ===========================================================================
  describe('the standing self-check', () => {
    it('reports NOTHING', async () => {
      const findings = await asSuperuser<Finding>(
        'SELECT * FROM public.fn_security_findings()',
      );

      // Printed rather than just counted: a bare "expected 3 to be 0" tells
      // whoever broke it nothing about what they broke.
      if (findings.length > 0) {
        const summary = findings
          .map((f) => `  [${f.severity}] ${f.area}: ${f.object} — ${f.detail}`)
          .join('\n');
        throw new Error(`Security self-check found ${findings.length} problem(s):\n${summary}`);
      }
      expect(findings).toHaveLength(0);
    });

    it('is not executable by a signed-in user', async () => {
      // It is a map of the security model. Administrators run it through
      // psql or the Supabase SQL editor, not through the app.
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied('SELECT * FROM public.fn_security_findings()');
        expect(error.code).toBe('42501');
      });
    });

    it('actually detects a problem when there is one', async () => {
      // A check that can only ever return zero rows proves nothing. Introduce a
      // real violation inside a transaction and confirm it is caught.
      await actingAs(USERS.admin, async (s) => {
        await s.query('RESET ROLE');
        await s.query('CREATE TABLE public.tmp_unprotected (id int)');

        const findings = await s.query<Finding>('SELECT * FROM public.fn_security_findings()');
        const hit = findings.find((f) => f.object === 'tmp_unprotected');

        expect(hit).toBeDefined();
        expect(hit!.severity).toBe('critical');
        expect(hit!.area).toBe('rls');
      });
      // The transaction rolls back, so the table never exists outside this test.
    });
  });

  // ===========================================================================
  describe('the audit log cannot be forged', () => {
    it('an unauthenticated caller cannot call fn_audit', async () => {
      // This is the exact call that succeeded before migration 0025.
      await actingAsAnon(async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_audit('login', 'app_user', NULL, NULL, NULL, 'forged')`,
        );
        expect(error.code).toBe('42501');
      });
    });

    it('a representative cannot call fn_audit', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_audit('visit_completed', 'visit', NULL, NULL, NULL, 'forged')`,
        );
        expect(error.code).toBe('42501');
      });
    });

    it('an administrator cannot call fn_audit either', async () => {
      // Being an administrator is not a reason to be able to write history
      // by hand. Entries come from triggers and from the functions that
      // perform the action being recorded.
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_audit('setting_changed', 'app_setting', NULL, NULL, NULL, 'forged')`,
        );
        expect(error.code).toBe('42501');
      });
    });

    it('audit entries are still written by the real code paths', async () => {
      // The revoke must not have broken the trigger path it protects.
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          `UPDATE public.clinic SET geofence_radius_m = 321 WHERE code = 'CL-001'`,
        );
        const rows = await s.query(
          `SELECT 1 FROM public.audit_log
           WHERE action = 'master_data_changed' AND entity_type = 'clinic'
           ORDER BY id DESC LIMIT 1`,
        );
        expect(rows).toHaveLength(1);
      });
    });
  });

  // ===========================================================================
  describe('anon reaches exactly one function and no table', () => {
    it('can check whether an address may sign in', async () => {
      await actingAsAnon(async (s) => {
        const [row] = await s.query(
          `SELECT public.fn_can_email_sign_in('rep01@monos.mn') AS ok`,
        );
        expect(row.ok).toBe(true);
      });
    });

    it('learns nothing else from it', async () => {
      // Deliberately a boolean on an address the caller already typed, so it
      // cannot be used to enumerate company domains or staff.
      await actingAsAnon(async (s) => {
        const [row] = await s.query(
          `SELECT public.fn_can_email_sign_in('someone@example.com') AS ok`,
        );
        expect(row.ok).toBe(false);
      });
    });

    it.each([
      'SELECT * FROM public.app_user',
      'SELECT * FROM public.clinic',
      'SELECT * FROM public.doctor',
      'SELECT * FROM public.visit',
      'SELECT * FROM public.audit_log',
      'SELECT * FROM public.app_setting',
    ])('cannot read: %s', async (sql) => {
      await actingAsAnon(async (s) => {
        const error = await s.expectDenied(sql);
        expect(error.code).toBe('42501');
      });
    });

    it.each([
      "SELECT * FROM public.fn_manager_dashboard(NULL::date, NULL::date)",
      "SELECT * FROM public.fn_admin_users()",
      "SELECT * FROM public.fn_audit_log_page(NULL, NULL, NULL, NULL, 10, 0)",
      "SELECT * FROM public.fn_recent_visits(10)",
    ])('cannot call: %s', async (sql) => {
      await actingAsAnon(async (s) => {
        const error = await s.expectDenied(sql);
        expect(error.code).toBe('42501');
      });
    });
  });

  // ===========================================================================
  describe('privileges', () => {
    it('no application role can bypass row-level security', async () => {
      const rows = await asSuperuser<{ rolname: string; rolbypassrls: boolean }>(
        `SELECT rolname, rolbypassrls FROM pg_roles
         WHERE rolname IN ('anon', 'authenticated', 'reporting_reader')`,
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => !r.rolbypassrls)).toBe(true);
    });

    it('the reporting login cannot log in until somebody sets a password', async () => {
      // Migration 0021 creates it NOLOGIN on purpose; an administrator enables
      // it with a password from the company password manager (docs/70 §2).
      const [row] = await asSuperuser<{ rolcanlogin: boolean }>(
        `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'reporting_reader'`,
      );
      expect(row.rolcanlogin).toBe(false);
    });

    it('DELETE exists only on child lists', async () => {
      const rows = await asSuperuser<{ table_name: string }>(
        `SELECT DISTINCT table_name FROM information_schema.role_table_grants
         WHERE grantee = 'authenticated' AND table_schema = 'public'
           AND privilege_type = 'DELETE'
         ORDER BY 1`,
      );
      expect(rows.map((r) => r.table_name)).toEqual([
        'planned_visit_brand',
        'planned_visit_doctor',
        'visit_brand',
        'visit_doctor',
        'visit_product',
      ]);
    });

    it('every SECURITY DEFINER function locks its search_path', async () => {
      // The Phase 1 citext bug in one assertion.
      const rows = await asSuperuser<{ proname: string }>(
        `SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'reporting') AND p.prosecdef
           AND NOT EXISTS (
             SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) c
             WHERE c LIKE 'search_path=%')`,
      );
      expect(rows.map((r) => r.proname)).toEqual([]);
    });

    it('no function this project defines is executable by PUBLIC', async () => {
      const rows = await asSuperuser<{ signature: string }>(
        `SELECT p.oid::regprocedure::text AS signature
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
           AND has_function_privilege('public', p.oid, 'EXECUTE')
         ORDER BY 1`,
      );
      expect(rows.map((r) => r.signature)).toEqual([]);
    });
  });

  // ===========================================================================
  describe('privacy promises, asserted structurally', () => {
    it('no column anywhere suggests patient information', async () => {
      const rows = await asSuperuser<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema IN ('public', 'reporting')
           AND (column_name ILIKE '%patient%' OR column_name ILIKE '%diagnos%'
                OR column_name ILIKE '%prescription%')`,
      );
      expect(rows).toEqual([]);
    });

    it('no column anywhere stores a credential', async () => {
      const rows = await asSuperuser<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema IN ('public', 'reporting')
           AND (column_name ILIKE '%password%' OR column_name ILIKE '%secret%'
                OR column_name ILIKE '%api_key%')`,
      );
      expect(rows).toEqual([]);
    });

    it('audio recording is off and no audio column exists', async () => {
      const [flag] = await asSuperuser<{ value: unknown }>(
        `SELECT value FROM public.app_setting WHERE key = 'feature_audio_recording_enabled'`,
      );
      expect(String(flag.value)).toBe('false');

      const columns = await asSuperuser(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema IN ('public', 'reporting')
           AND (column_name ILIKE '%audio%' OR column_name ILIKE '%recording%')`,
      );
      expect(columns).toEqual([]);
    });

    it('location is stored on exactly three tables', async () => {
      // check-in/check-out evidence, and an exception the representative chose
      // to attach a position to. Nothing else may ever hold coordinates —
      // that is the "no movement history" promise, as a query.
      const rows = await asSuperuser<{ table_name: string }>(
        `SELECT DISTINCT table_name FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (column_name ILIKE '%latitude%' OR column_name ILIKE '%longitude%')
         ORDER BY 1`,
      );
      expect(rows.map((r) => r.table_name)).toEqual([
        'clinic',          // where the clinic is — not where a person is
        'visit_event',     // check-in and check-out evidence
        'visit_exception', // request_latitude / request_longitude: opt-in, nullable
      ]);
    });
  });
});
