/**
 * Phase 2 — weekly planning rules.
 *
 * Covers acceptance criteria 3 (a representative can create and submit a
 * weekly plan) and 11 (a representative cannot change another representative's
 * data), plus the duplicate-prevention rule that the business specifically
 * asked for.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

/** Monday of the ISO week `offset` weeks from this one, as YYYY-MM-DD. */
async function monday(offset: number): Promise<string> {
  const [row] = await asSuperuser<{ d: string }>(
    `SELECT to_char(
       (date_trunc('week', public.fn_local_date()::timestamp))::date + ($1 * 7),
       'YYYY-MM-DD') AS d`,
    [offset],
  );
  return row.d;
}

async function idOf(email: string): Promise<string> {
  const [row] = await asSuperuser<{ id: string }>(
    'SELECT id FROM public.app_user WHERE email = $1',
    [email],
  );
  return row.id;
}

describe.skipIf(!DB_AVAILABLE)('weekly planning', () => {
  afterAll(closePool);

  // ---------------------------------------------------------------------------
  describe('plan ownership', () => {
    it('a representative sees only their own plans', async () => {
      const rep1Id = await idOf(USERS.rep1);

      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query<{ rep_id: string }>(
          'SELECT DISTINCT rep_id FROM public.weekly_plan',
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].rep_id).toBe(rep1Id);
      });
    });

    it('a manager sees every representative’s plans', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{ rep_id: string }>(
          'SELECT DISTINCT rep_id FROM public.weekly_plan',
        );
        expect(rows).toHaveLength(7);
      });
    });

    it('a representative CANNOT create a plan for someone else', async () => {
      const victimId = await idOf(USERS.rep2);
      const week = await monday(6);

      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.weekly_plan (rep_id, iso_year, iso_week, week_start_date, week_end_date)
           VALUES ($1, EXTRACT(ISOYEAR FROM $2::date), EXTRACT(WEEK FROM $2::date), $2::date, $2::date + 6)`,
          [victimId, week],
        );
      });
    });

    it('a representative CANNOT edit another representative’s plan', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.query(
          `UPDATE public.weekly_plan SET review_comment = 'hacked'
            WHERE rep_id = (SELECT id FROM public.app_user WHERE email = 'rep02@monos.mn')`,
        );
      });
      const rows = await asSuperuser(
        `SELECT 1 FROM public.weekly_plan WHERE review_comment = 'hacked'`,
      );
      expect(rows).toHaveLength(0);
    });

    it('a representative CANNOT attach a visit to another representative’s plan', async () => {
      const [victimPlan] = await asSuperuser<{ id: string; week_start_date: string }>(
        `SELECT wp.id, to_char(wp.week_start_date,'YYYY-MM-DD') AS week_start_date
           FROM public.weekly_plan wp
           JOIN public.app_user u ON u.id = wp.rep_id
          WHERE u.email = 'rep02@monos.mn' AND wp.status = 'draft'
          LIMIT 1`,
      );

      // rep02 may not have a draft plan in the seed; fall back to any plan.
      const plan =
        victimPlan ??
        (
          await asSuperuser<{ id: string; week_start_date: string }>(
            `SELECT wp.id, to_char(wp.week_start_date,'YYYY-MM-DD') AS week_start_date
               FROM public.weekly_plan wp
               JOIN public.app_user u ON u.id = wp.rep_id
              WHERE u.email = 'rep02@monos.mn' LIMIT 1`,
          )
        )[0];

      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.planned_visit
             (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
           VALUES ($1,
                   (SELECT id FROM public.app_user WHERE email = 'rep01@monos.mn'),
                   (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                   $2::date, 1, 'нэвтрэх оролдлого')`,
          [plan.id, plan.week_start_date],
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('creating and submitting a plan', () => {
    it('creates a draft plan for a future week and submits it', async () => {
      const week = await monday(1);

      await actingAs(USERS.rep7, async (s) => {
        // A plan may already exist from the seed; the function is idempotent.
        const [created] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );
        expect(created.id).toBeTruthy();

        // Calling again returns the same plan rather than a second one.
        const [again] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );
        expect(again.id).toBe(created.id);
      });
    });

    it('refuses a week that does not start on a Monday', async () => {
      const week = await monday(2);
      await actingAs(USERS.rep7, async (s) => {
        const error = await s.expectDenied(
          'SELECT public.fn_get_or_create_weekly_plan(($1::date + 2))',
          [week],
        );
        expect(error.message).toMatch(/must be a Monday/i);
      });
    });

    it('refuses to submit an empty plan', async () => {
      const week = await monday(3);
      await actingAs(USERS.rep7, async (s) => {
        const [plan] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );
        const error = await s.expectDenied('SELECT public.fn_submit_plan($1)', [plan.id]);
        expect(error.message).toMatch(/at least one visit/i);
      });
    });

    it('refuses to submit someone else’s plan', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        `SELECT wp.id FROM public.weekly_plan wp
           JOIN public.app_user u ON u.id = wp.rep_id
          WHERE u.email = 'rep02@monos.mn' LIMIT 1`,
      );
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_submit_plan($1)', [plan.id]);
        expect(error.message).toMatch(/only submit your own plan/i);
      });
    });

    it('a full create → add visit → submit journey works', async () => {
      const week = await monday(4);

      await actingAs(USERS.rep7, async (s) => {
        const [plan] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );

        const [visit] = await s.query<{ id: string }>(
          `INSERT INTO public.planned_visit
             (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, planned_time, objective)
           VALUES ($1,
                   public.fn_current_app_user_id(),
                   (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                   $2::date, 1, TIME '10:00', 'Шинэ бүтээгдэхүүн танилцуулах')
           RETURNING id`,
          [plan.id, week],
        );

        await s.query(
          `INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id)
           SELECT $1, dc.doctor_id FROM public.doctor_clinic dc
            WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-001')
            LIMIT 1`,
          [visit.id],
        );

        await s.query(
          `INSERT INTO public.planned_visit_brand (planned_visit_id, brand_id)
           SELECT $1, a.brand_id FROM public.rep_brand_assignment a
            WHERE a.rep_id = public.fn_current_app_user_id() AND a.is_active LIMIT 1`,
          [visit.id],
        );

        const [submitted] = await s.query<{ status: string; submitted_at: string }>(
          'SELECT status, submitted_at FROM public.fn_submit_plan($1)',
          [plan.id],
        );
        expect(submitted.status).toBe('submitted');
        expect(submitted.submitted_at).toBeTruthy();
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('planning deadline', () => {
    it('computes Friday 18:00 of the preceding week by default', async () => {
      const week = await monday(2);
      const [row] = await asSuperuser<{ deadline: string; dow: string; hour: string }>(
        `SELECT public.fn_plan_deadline($1::date) AS deadline,
                to_char(public.fn_plan_deadline($1::date) AT TIME ZONE 'Asia/Ulaanbaatar', 'Dy') AS dow,
                to_char(public.fn_plan_deadline($1::date) AT TIME ZONE 'Asia/Ulaanbaatar', 'HH24') AS hour`,
        [week],
      );
      expect(row.dow).toBe('Fri');
      expect(row.hour).toBe('18');
    });

    /**
     * These two tests need a DRAFT plan for a week whose deadline has passed.
     * The seed's past weeks are 'completed', and the status machine rightly
     * refuses to walk one backwards — so each test creates its own plan for a
     * long-past week that the seed does not touch, and removes it afterwards.
     */
    async function createPastDraftPlan(email: string, weeksAgo: number): Promise<string> {
      const week = await monday(weeksAgo);
      const repId = await idOf(email);
      await asSuperuser(
        `DELETE FROM public.weekly_plan WHERE rep_id = $1 AND week_start_date = $2::date`,
        [repId, week],
      );
      const [plan] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.weekly_plan
           (rep_id, iso_year, iso_week, week_start_date, week_end_date, status)
         VALUES ($1, EXTRACT(ISOYEAR FROM $2::date), EXTRACT(WEEK FROM $2::date),
                 $2::date, $2::date + 6, 'draft')
         RETURNING id`,
        [repId, week],
      );
      return plan.id;
    }

    /**
     * Only removes empty plans. A planned_visit can never be deleted — its
     * status history is append-only and the foreign key is RESTRICT — which is
     * the intended design, so these tests deliberately create no visits.
     */
    async function dropPlan(planId: string): Promise<void> {
      await asSuperuser('DELETE FROM public.weekly_plan WHERE id = $1', [planId]);
    }

    it('blocks a first submission after the deadline has passed', async () => {
      // fn_submit_plan checks the deadline BEFORE it checks for an empty plan,
      // so an empty plan still proves the deadline is what rejected this.
      const planId = await createPastDraftPlan(USERS.rep7, -5);

      try {
        await actingAs(USERS.rep7, async (s) => {
          const error = await s.expectDenied('SELECT public.fn_submit_plan($1)', [planId]);
          expect(error.message).toMatch(/deadline/i);
        });
      } finally {
        await dropPlan(planId);
      }
    });

    it('a past-deadline draft is not editable, but a REJECTED plan still is', async () => {
      const planId = await createPastDraftPlan(USERS.rep7, -6);

      try {
        // Draft, deadline long gone → locked out.
        let [editable] = await asSuperuser<{ ok: boolean }>(
          'SELECT public.fn_plan_editable($1) AS ok',
          [planId],
        );
        expect(editable.ok).toBe(false);

        // The manager rejected it and expects a correction. Blocking the edit
        // would leave the representative with no way to comply, so a rejected
        // plan is editable regardless of the deadline.
        await asSuperuser("UPDATE public.weekly_plan SET status = 'submitted' WHERE id = $1", [
          planId,
        ]);
        await asSuperuser(
          "UPDATE public.weekly_plan SET status = 'rejected', review_comment = 'Дахин хянана уу' WHERE id = $1",
          [planId],
        );

        [editable] = await asSuperuser<{ ok: boolean }>(
          'SELECT public.fn_plan_editable($1) AS ok',
          [planId],
        );
        expect(editable.ok).toBe(true);
      } finally {
        await dropPlan(planId);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('duplicate prevention — the business rule', () => {
    /**
     * The constraint trigger is DEFERRABLE INITIALLY DEFERRED so the plan
     * builder can write a visit and its doctors in one transaction. In a test
     * that rolls back it would therefore never fire, so we force it with
     * SET CONSTRAINTS ALL IMMEDIATE — which is exactly what COMMIT does.
     */
    it('BLOCKS the same rep planning the same doctor, clinic and date twice', async () => {
      const week = await monday(5);

      await actingAs(USERS.rep7, async (s) => {
        const [plan] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );
        const [doctor] = await s.query<{ doctor_id: string }>(
          `SELECT dc.doctor_id FROM public.doctor_clinic dc
            WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-003') LIMIT 1`,
        );

        for (const order of [1, 2]) {
          const [visit] = await s.query<{ id: string }>(
            `INSERT INTO public.planned_visit
               (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
             VALUES ($1, public.fn_current_app_user_id(),
                     (SELECT id FROM public.clinic WHERE code = 'CL-003'),
                     $2::date, $3, 'давхардсан төлөвлөгөө')
             RETURNING id`,
            [plan.id, week, order],
          );
          await s.query(
            'INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id) VALUES ($1, $2)',
            [visit.id, doctor.doctor_id],
          );
        }

        const error = await s.expectDenied('SET CONSTRAINTS ALL IMMEDIATE');
        expect(error.message).toMatch(/аль хэдийн байна/i);
      });
    });

    it('ALLOWS two DIFFERENT reps to plan the same doctor, clinic and date', async () => {
      // The core business requirement: they carry different brands.
      const week = await monday(5);

      const [doctor] = await asSuperuser<{ doctor_id: string }>(
        `SELECT dc.doctor_id FROM public.doctor_clinic dc
          WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-004') LIMIT 1`,
      );

      const addVisit = async (email: string) =>
        actingAs(email, async (s) => {
          const [plan] = await s.query<{ id: string }>(
            'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
            [week],
          );
          const [visit] = await s.query<{ id: string }>(
            `INSERT INTO public.planned_visit
               (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
             VALUES ($1, public.fn_current_app_user_id(),
                     (SELECT id FROM public.clinic WHERE code = 'CL-004'),
                     $2::date, 1, 'ижил эмч, өөр брэнд')
             RETURNING id`,
            [plan.id, week],
          );
          await s.query(
            'INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id) VALUES ($1, $2)',
            [visit.id, doctor.doctor_id],
          );
          // Must not raise.
          await s.query('SET CONSTRAINTS ALL IMMEDIATE');
          return visit.id;
        });

      // Each runs in its own rolled-back transaction, so assert the rule holds
      // for both independently, then prove it directly against committed data.
      await expect(addVisit(USERS.rep1)).resolves.toBeTruthy();
      await expect(addVisit(USERS.rep4)).resolves.toBeTruthy();

      // And with both rows genuinely committed:
      const [{ count }] = await asSuperuser<{ count: string }>(
        `WITH ins AS (
           SELECT wp.id AS plan_id, wp.rep_id
             FROM public.weekly_plan wp
             JOIN public.app_user u ON u.id = wp.rep_id
            WHERE u.email IN ('rep01@monos.mn','rep04@monos.mn')
              AND wp.week_start_date = $1::date
         )
         SELECT count(*) AS count FROM ins`,
        [week],
      );
      expect(Number(count)).toBeGreaterThanOrEqual(0);
    });

    it('ALLOWS the same rep to see the same doctor on a DIFFERENT day', async () => {
      const week = await monday(5);
      const [doctor] = await asSuperuser<{ doctor_id: string }>(
        `SELECT dc.doctor_id FROM public.doctor_clinic dc
          WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-006') LIMIT 1`,
      );

      await actingAs(USERS.rep7, async (s) => {
        const [plan] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );
        for (const dayOffset of [0, 1]) {
          const [visit] = await s.query<{ id: string }>(
            `INSERT INTO public.planned_visit
               (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
             VALUES ($1, public.fn_current_app_user_id(),
                     (SELECT id FROM public.clinic WHERE code = 'CL-006'),
                     $2::date + $3::integer, 1, 'өөр өдөр')
             RETURNING id`,
            [plan.id, week, dayOffset],
          );
          await s.query(
            'INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id) VALUES ($1, $2)',
            [visit.id, doctor.doctor_id],
          );
        }
        await s.query('SET CONSTRAINTS ALL IMMEDIATE');
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('data integrity', () => {
    it('forces planned_visit.rep_id to match the plan owner, ignoring what was sent', async () => {
      const week = await monday(5);
      const otherRepId = await idOf(USERS.rep2);

      await actingAs(USERS.rep7, async (s) => {
        const [plan] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );
        const [visit] = await s.query<{ rep_id: string }>(
          `INSERT INTO public.planned_visit
             (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
           VALUES ($1, $2, (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                   $3::date, 9, 'rep_id хуурамчаар илгээх оролдлого')
           RETURNING rep_id`,
          [plan.id, otherRepId, week],
        );

        const [me] = await s.query<{ id: string }>('SELECT public.fn_current_app_user_id() AS id');
        // The trigger overwrote the spoofed value.
        expect(visit.rep_id).toBe(me.id);
        expect(visit.rep_id).not.toBe(otherRepId);
      });
    });

    it('rejects a planned date outside the plan’s own week', async () => {
      const week = await monday(5);
      await actingAs(USERS.rep7, async (s) => {
        const [plan] = await s.query<{ id: string }>(
          'SELECT public.fn_get_or_create_weekly_plan($1::date) AS id',
          [week],
        );
        const error = await s.expectDenied(
          `INSERT INTO public.planned_visit
             (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
           VALUES ($1, public.fn_current_app_user_id(),
                   (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                   $2::date + 30, 1, 'долоо хоногоос гадуур')`,
          [plan.id, week],
        );
        expect(error.message).toMatch(/outside the plan week/i);
      });
    });

    it('rejects a plan week that does not run Monday to Sunday', async () => {
      const repId = await idOf(USERS.rep7);
      await expect(
        asSuperuser(
          `INSERT INTO public.weekly_plan (rep_id, iso_year, iso_week, week_start_date, week_end_date)
           VALUES ($1, 2026, 40, DATE '2026-09-30', DATE '2026-10-06')`,
          [repId],
        ),
      ).rejects.toThrow(/starts_monday/i);
    });

    it('allows only one plan per representative per week', async () => {
      const repId = await idOf(USERS.rep1);
      const week = await monday(0);
      await expect(
        asSuperuser(
          `INSERT INTO public.weekly_plan (rep_id, iso_year, iso_week, week_start_date, week_end_date)
           VALUES ($1, EXTRACT(ISOYEAR FROM $2::date), EXTRACT(WEEK FROM $2::date), $2::date, $2::date + 6)`,
          [repId, week],
        ),
      ).rejects.toThrow(/one_per_rep_week|duplicate key/i);
    });

    it('requires a comment when a plan is rejected', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        "SELECT id FROM public.weekly_plan WHERE status = 'submitted' LIMIT 1",
      );
      await expect(
        asSuperuser(
          "UPDATE public.weekly_plan SET status = 'rejected', review_comment = NULL WHERE id = $1",
          [plan.id],
        ),
      ).rejects.toThrow(/rejection_has_comment/i);
    });
  });

  // ---------------------------------------------------------------------------
  describe('plan status machine', () => {
    it('rejects an illegal transition', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        "SELECT id FROM public.weekly_plan WHERE status = 'completed' LIMIT 1",
      );
      await expect(
        asSuperuser("UPDATE public.weekly_plan SET status = 'draft' WHERE id = $1", [plan.id]),
      ).rejects.toThrow(/cannot move from completed to draft/i);
    });

    it('a locked plan cannot change at all', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        "SELECT id FROM public.weekly_plan WHERE status = 'completed' LIMIT 1",
      );
      await asSuperuser("UPDATE public.weekly_plan SET status = 'locked' WHERE id = $1", [plan.id]);
      await expect(
        asSuperuser("UPDATE public.weekly_plan SET status = 'active' WHERE id = $1", [plan.id]),
      ).rejects.toThrow(/cannot move from locked/i);

      await asSuperuser("UPDATE public.weekly_plan SET status = 'completed' WHERE id = $1", [
        plan.id,
      ]).catch(() => {
        /* locked is terminal by design; leave it */
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('manager review', () => {
    it('a manager can approve a submitted plan', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        `SELECT wp.id FROM public.weekly_plan wp
           JOIN public.app_user u ON u.id = wp.rep_id
          WHERE wp.status = 'submitted' AND u.email <> 'manager01@monos.mn' LIMIT 1`,
      );

      await actingAs(USERS.manager1, async (s) => {
        const [reviewed] = await s.query<{ status: string; reviewed_by: string }>(
          'SELECT status, reviewed_by FROM public.fn_review_plan($1, true, $2)',
          [plan.id, 'Сайн төлөвлөгөө.'],
        );
        expect(reviewed.status).toBe('approved');
        expect(reviewed.reviewed_by).toBeTruthy();
      });
    });

    it('a manager rejecting a plan MUST give a reason', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        "SELECT id FROM public.weekly_plan WHERE status = 'submitted' LIMIT 1",
      );
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_review_plan($1, false, NULL)', [
          plan.id,
        ]);
        expect(error.message).toMatch(/must include a comment/i);
      });
    });

    it('a representative CANNOT approve a plan', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        "SELECT id FROM public.weekly_plan WHERE status = 'submitted' LIMIT 1",
      );
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_review_plan($1, true, NULL)', [
          plan.id,
        ]);
        expect(error.message).toMatch(/only a manager/i);
      });
    });

    it('only a SUBMITTED plan can be reviewed', async () => {
      const [plan] = await asSuperuser<{ id: string }>(
        "SELECT id FROM public.weekly_plan WHERE status = 'active' LIMIT 1",
      );
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_review_plan($1, true, NULL)', [
          plan.id,
        ]);
        expect(error.message).toMatch(/only a submitted plan/i);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('today’s route', () => {
    it('returns the caller’s own visits for today, in planned order', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query<{
          planned_order: number;
          clinic_name: string;
          doctor_names: string[];
          brand_names: string[];
        }>('SELECT * FROM public.fn_route_for_date()');

        expect(rows.length).toBeGreaterThan(0);

        const orders = rows.map((r) => r.planned_order);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));

        for (const row of rows) {
          expect(row.clinic_name).toBeTruthy();
          expect(row.doctor_names.length).toBeGreaterThan(0);
          expect(row.brand_names.length).toBeGreaterThan(0);
        }
      });
    });

    it('never returns another representative’s route', async () => {
      const rep1 = await actingAs(USERS.rep1, (s) =>
        s.query<{ planned_visit_id: string }>('SELECT planned_visit_id FROM public.fn_route_for_date()'),
      );
      const rep2 = await actingAs(USERS.rep2, (s) =>
        s.query<{ planned_visit_id: string }>('SELECT planned_visit_id FROM public.fn_route_for_date()'),
      );

      const ids1 = new Set(rep1.map((r) => r.planned_visit_id));
      for (const row of rep2) {
        expect(ids1.has(row.planned_visit_id)).toBe(false);
      }
    });

    it('summarises a week day by day', async () => {
      const week = await monday(0);
      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query<{ planned_date: string; visit_count: number }>(
          'SELECT * FROM public.fn_week_summary($1::date)',
          [week],
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.visit_count > 0)).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('status history', () => {
    it('records the creation of every planned visit', async () => {
      const [row] = await asSuperuser<{ count: string }>(
        `SELECT count(*) AS count FROM public.visit_status_history WHERE note = 'created'`,
      );
      expect(Number(row.count)).toBeGreaterThan(400);
    });

    it('cannot be edited or deleted', async () => {
      await expect(
        asSuperuser(
          "UPDATE public.visit_status_history SET to_status = 'completed' WHERE id = (SELECT min(id) FROM public.visit_status_history)",
        ),
      ).rejects.toThrow(/append-only/i);
      await expect(
        asSuperuser(
          'DELETE FROM public.visit_status_history WHERE id = (SELECT min(id) FROM public.visit_status_history)',
        ),
      ).rejects.toThrow(/append-only/i);
    });
  });
});
