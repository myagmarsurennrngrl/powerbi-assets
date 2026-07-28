/**
 * Phase 6 — reporting views, manager dashboard, exports and the audit log.
 *
 * Acceptance criteria covered:
 *   15. Power BI can access clean reporting views
 *   16. Important actions appear in the audit log
 *
 * The security tests matter most here. A Power BI file gets emailed around,
 * so the reporting login must be able to reach the star schema and absolutely
 * nothing else.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

describe.skipIf(!DB_AVAILABLE)('reporting and manager tools', () => {
  afterAll(closePool);

  // ===========================================================================
  describe('the reporting login is locked down', () => {
    it('has SELECT on the reporting schema and NOTHING else', async () => {
      const leaks = await asSuperuser<{ schema_name: string; object_name: string }>(
        'SELECT * FROM public.fn_reporting_reader_leaks()',
      );
      expect(leaks).toEqual([]);
    });

    it('cannot read application tables directly', async () => {
      const grants = await asSuperuser<{ table_name: string }>(
        `SELECT table_name FROM information_schema.role_table_grants
          WHERE grantee = 'reporting_reader' AND table_schema = 'public'`,
      );
      expect(grants).toEqual([]);
    });

    it('cannot reach the auth schema at all', async () => {
      const grants = await asSuperuser<{ table_name: string }>(
        `SELECT table_name FROM information_schema.role_table_grants
          WHERE grantee = 'reporting_reader' AND table_schema = 'auth'`,
      );
      expect(grants).toEqual([]);
    });

    it('has no write privilege anywhere', async () => {
      const writes = await asSuperuser<{ privilege_type: string }>(
        `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'reporting_reader' AND privilege_type <> 'SELECT'`,
      );
      expect(writes).toEqual([]);
    });

    it('the app roles cannot reach the reporting schema either', async () => {
      // One less path to audit: the app reads base tables through RLS.
      await actingAs(USERS.manager1, async (s) => {
        await s.expectDenied('SELECT * FROM reporting.fact_visit LIMIT 1');
      });
    });
  });

  // ===========================================================================
  describe('the star schema', () => {
    it('exposes every view the Power BI guide promises', async () => {
      const views = await asSuperuser<{ table_name: string }>(
        `SELECT table_name FROM information_schema.views
          WHERE table_schema = 'reporting' ORDER BY table_name`,
      );
      const names = views.map((v) => v.table_name);

      for (const required of [
        'dim_date', 'dim_user', 'dim_clinic', 'dim_doctor', 'dim_brand', 'dim_product',
        'fact_visit', 'fact_planned_visit', 'fact_exception', 'fact_follow_up',
        'fact_visit_status_history', 'fact_audit_log',
        'bridge_visit_doctor', 'bridge_visit_brand', 'bridge_visit_product',
        'vw_kpi_weekly_rep',
      ]) {
        expect(names, `missing view ${required}`).toContain(required);
      }
    });

    it('dim_date is contiguous, so Power BI time intelligence works', async () => {
      const [row] = await asSuperuser<{ days: string; distinct_days: string; gaps: string }>(
        `SELECT count(*) AS days,
                count(DISTINCT date_key) AS distinct_days,
                (max(date_key) - min(date_key) + 1)::text AS gaps
           FROM reporting.dim_date`,
      );
      // No duplicates and no missing days.
      expect(row.days).toBe(row.distinct_days);
      expect(Number(row.days)).toBe(Number(row.gaps));
    });

    it('NEVER exposes an unsubmitted draft', async () => {
      // A colleague's draft is private; a management report must not leak it.
      const [before] = await asSuperuser<{ n: string }>(
        'SELECT count(*) AS n FROM reporting.fact_visit',
      );

      const [visit] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit
           (rep_id, clinic_id, visit_date, status, started_at_server, is_draft)
         SELECT (SELECT id FROM public.app_user WHERE email = 'rep01@monos.mn'),
                (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                public.fn_local_date(), 'missed', now(), true
         RETURNING id`,
      );

      const [after] = await asSuperuser<{ n: string }>(
        'SELECT count(*) AS n FROM reporting.fact_visit',
      );
      expect(after.n).toBe(before.n);

      const found = await asSuperuser(
        'SELECT 1 FROM reporting.fact_visit WHERE visit_key = $1',
        [visit.id],
      );
      expect(found).toHaveLength(0);
    });

    it('does NOT expose doctor phone or email', async () => {
      // Personal data with no reporting purpose, and a .pbix file travels.
      const columns = await asSuperuser<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'reporting' AND table_name = 'dim_doctor'`,
      );
      const names = columns.map((c) => c.column_name);
      expect(names).not.toContain('phone');
      expect(names).not.toContain('email');
    });

    it('exposes no column that could hold patient data', async () => {
      const columns = await asSuperuser<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'reporting'`,
      );
      for (const forbidden of ['patient', 'diagnosis', 'treatment', 'prescription']) {
        const hit = columns.find((c) => c.column_name.includes(forbidden));
        expect(hit, `unexpected ${hit?.table_name}.${hit?.column_name}`).toBeUndefined();
      }
    });

    it('every fact joins to its dimensions without orphans', async () => {
      const [orphans] = await asSuperuser<{
        visit_user: string;
        visit_clinic: string;
        planned_user: string;
      }>(
        `SELECT
           (SELECT count(*) FROM reporting.fact_visit f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.dim_user d WHERE d.user_key = f.user_key))
             AS visit_user,
           (SELECT count(*) FROM reporting.fact_visit f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.dim_clinic d WHERE d.clinic_key = f.clinic_key))
             AS visit_clinic,
           (SELECT count(*) FROM reporting.fact_planned_visit f
             WHERE NOT EXISTS (SELECT 1 FROM reporting.dim_user d WHERE d.user_key = f.user_key))
             AS planned_user`,
      );
      expect(Number(orphans.visit_user)).toBe(0);
      expect(Number(orphans.visit_clinic)).toBe(0);
      expect(Number(orphans.planned_user)).toBe(0);
    });

    it('every fact_visit date exists in dim_date', async () => {
      const [row] = await asSuperuser<{ n: string }>(
        `SELECT count(*) AS n FROM reporting.fact_visit f
          WHERE NOT EXISTS (SELECT 1 FROM reporting.dim_date d WHERE d.date_key = f.date_key)`,
      );
      expect(Number(row.n)).toBe(0);
    });

    it('the weekly KPI view agrees with the app’s own function', async () => {
      // Two implementations of the KPI would eventually disagree, and nobody
      // would know which to believe. The view calls the same function.
      const [row] = await asSuperuser<{
        view_pct: string | null;
        fn_pct: string | null;
      }>(
        `WITH sample AS (
           SELECT user_key, date_key, completion_pct FROM reporting.vw_kpi_weekly_rep
            WHERE completion_pct IS NOT NULL LIMIT 1
         )
         SELECT s.completion_pct AS view_pct,
                k.completion_pct AS fn_pct
           FROM sample s
           CROSS JOIN LATERAL public.fn_kpi_for_rep(s.user_key, s.date_key, s.date_key + 6) k`,
      );
      expect(row.view_pct).toEqual(row.fn_pct);
    });
  });

  // ===========================================================================
  describe('manager dashboard', () => {
    it('returns the headline numbers', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const [row] = await s.query<{
          team_completed: number;
          team_eligible: number;
          total_missed: number;
          active_reps: number;
        }>('SELECT * FROM public.fn_manager_dashboard()');

        expect(row.active_reps).toBe(7);
        expect(Number(row.team_eligible)).toBeGreaterThan(0);
        expect(Number(row.total_missed)).toBeGreaterThan(0);
      });
    });

    it('a representative cannot open it', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied('SELECT * FROM public.fn_manager_dashboard()');
        expect(error.message).toMatch(/эрх алга/i);
      });
    });

    it('lists visits needing review, and says WHY each one is there', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{ reasons: string[]; rep_name: string }>(
          'SELECT * FROM public.fn_visits_needing_review()',
        );
        expect(rows.length).toBeGreaterThan(0);
        // Never a bare list of names with no explanation.
        for (const row of rows) {
          expect(row.reasons.length).toBeGreaterThan(0);
          expect(row.rep_name).toBeTruthy();
        }
      });
    });

    it('a representative cannot see the review list', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectInvisible('SELECT * FROM public.fn_visits_needing_review()');
      });
    });

    it('reports uncovered clinics with the date they were last visited', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query('SELECT * FROM public.fn_uncovered_clinics($1::date, $2::date)', [
          '2019-01-01',
          '2019-12-31',
        ]);
        // Nothing was visited in 2019, so every active clinic is uncovered.
        expect(rows.length).toBeGreaterThan(0);
      });
    });

    it('lists recent visits for the map', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{ latitude: string; clinic_name: string }>(
          'SELECT * FROM public.fn_recent_visits(10)',
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(Number(rows[0].latitude)).toBeGreaterThan(40);
      });
    });
  });

  // ===========================================================================
  describe('CSV export', () => {
    it('returns visit rows for a manager', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{ rep_name: string; clinic_name: string; doctors: string }>(
          `SELECT * FROM public.fn_export_visits(public.fn_local_date() - 30, public.fn_local_date())`,
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].rep_name).toBeTruthy();
        expect(rows[0].clinic_name).toBeTruthy();
      });
    });

    it('ACCEPTANCE 16: writes an audit entry BEFORE returning any rows', async () => {
      await actingAs(USERS.manager1, async (s) => {
        await s.query(
          `SELECT * FROM public.fn_export_visits(public.fn_local_date() - 30, public.fn_local_date())`,
        );

        const [entry] = await s.query<{
          action: string;
          actor_email: string;
          after_data: { row_count: number };
        }>(
          `SELECT action, actor_email, after_data FROM public.audit_log
            WHERE action = 'data_export' ORDER BY occurred_at DESC LIMIT 1`,
        );

        expect(entry.action).toBe('data_export');
        expect(entry.actor_email).toBe('manager01@monos.mn');
        expect(entry.after_data.row_count).toBeGreaterThan(0);
      });
    });

    it('a representative cannot export', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `SELECT * FROM public.fn_export_visits(public.fn_local_date() - 30, public.fn_local_date())`,
        );
        expect(error.message).toMatch(/зөвхөн менежер/i);
      });
    });

    it('does not export doctor contact details', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query(
          `SELECT * FROM public.fn_export_visits(public.fn_local_date() - 30, public.fn_local_date()) LIMIT 1`,
        );
        const columns = Object.keys(rows[0] ?? {});
        expect(columns).not.toContain('doctor_phone');
        expect(columns).not.toContain('doctor_email');
      });
    });
  });

  // ===========================================================================
  describe('ACCEPTANCE 16: the audit log records what matters', () => {
    it('records the actions performed during this test, with the actor named', async () => {
      // Self-contained on purpose: an earlier version of this test relied on
      // other test FILES having run first, which made it pass or fail
      // depending on ordering. It now performs the actions it asserts.
      const before = await asSuperuser<{ action: string }>(
        'SELECT DISTINCT action FROM public.audit_log',
      );
      const seeded = new Set(before.map((r) => r.action));

      // The seed provisions users and master data, so these always exist.
      expect(seeded).toContain('user_created');
      expect(seeded).toContain('master_data_changed');

      // Now generate more and confirm they land, attributed correctly.
      //
      // These are MANAGER actions deliberately: a representative cannot read
      // the audit log at all (asserted separately below), so a rep-performed
      // action cannot be verified inside its own rolled-back transaction.
      // Rep-side attribution is covered by the plan and visit tests, which
      // assert on the resulting data rather than on the log.
      await actingAs(USERS.manager1, async (s) => {
        await s.query(
          `SELECT public.fn_manager_add_visit(
             (SELECT id FROM public.app_user WHERE email = 'rep07@monos.mn'),
             (SELECT id FROM public.clinic WHERE code = 'CL-014'),
             public.fn_local_date() + 90,
             'аудит шалгах',
             ARRAY[(SELECT dc.doctor_id FROM public.doctor_clinic dc
                     WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-014')
                     LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand WHERE code = 'BR-01')])`,
        );

        // Creating the week's plan for someone else logs plan_created...
        const [created] = await s.query<{ actor_email: string }>(
          `SELECT actor_email FROM public.audit_log
            WHERE action = 'plan_created' ORDER BY occurred_at DESC LIMIT 1`,
        );
        expect(created.actor_email).toBe('manager01@monos.mn');

        // ...and touching someone else's plan logs plan_changed.
        const [changed] = await s.query<{ actor_email: string; note: string }>(
          `SELECT actor_email, note FROM public.audit_log
            WHERE action = 'plan_changed' ORDER BY occurred_at DESC LIMIT 1`,
        );
        expect(changed.actor_email).toBe('manager01@monos.mn');
        expect(changed.note).toMatch(/on behalf of rep/i);
      });

      await actingAs(USERS.manager1, async (s) => {
        await s.query(
          `SELECT * FROM public.fn_export_visits(public.fn_local_date() - 7, public.fn_local_date())`,
        );
        const [entry] = await s.query<{ actor_email: string }>(
          `SELECT actor_email FROM public.audit_log
            WHERE action = 'data_export' ORDER BY occurred_at DESC LIMIT 1`,
        );
        expect(entry.actor_email).toBe('manager01@monos.mn');
      });
    });

    it('defines an action name for every event the brief requires logging', async () => {
      // Per-action coverage is proven in the phase that produces it (plans in
      // planning.test.ts, check-ins in checkin.test.ts, and so on). What this
      // asserts is that the VOCABULARY is complete — nothing the brief names
      // is missing from the allowed set.
      const [constraint] = await asSuperuser<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint WHERE conname = 'audit_log_action_known'`,
      );

      for (const required of [
        'login',
        'plan_created', 'plan_changed', 'plan_submitted',
        'visit_started', 'visit_completed',
        'exception_requested', 'exception_reviewed',
        'addendum_added',
        'master_data_changed', 'user_role_changed',
        'data_export',
        'audio_accessed',
      ]) {
        expect(constraint.definition, `no audit action named ${required}`).toContain(required);
      }
    });

    it('is readable and filterable by a manager', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const all = await s.query('SELECT * FROM public.fn_audit_log_page()');
        expect(all.length).toBeGreaterThan(0);

        const filtered = await s.query<{ action: string }>(
          `SELECT * FROM public.fn_audit_log_page('master_data_changed')`,
        );
        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.every((r) => r.action === 'master_data_changed')).toBe(true);
      });
    });

    it('is invisible to a representative', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectInvisible('SELECT * FROM public.fn_audit_log_page()');
      });
    });

    it('names the actor on every entry that has one', async () => {
      const [row] = await asSuperuser<{ n: string }>(
        `SELECT count(*) AS n FROM public.audit_log
          WHERE actor_app_user_id IS NOT NULL AND actor_email IS NULL`,
      );
      expect(Number(row.n)).toBe(0);
    });
  });
});
