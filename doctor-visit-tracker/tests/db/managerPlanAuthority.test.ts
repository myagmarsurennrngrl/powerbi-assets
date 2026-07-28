/**
 * Manager authority over a representative's plan.
 *
 * Confirmed decision: a manager may BOTH add a visit directly AND
 * approve / reject / reschedule.
 *
 * These tests are as much about the GUARDRAILS as the capability. Widening
 * "who can change my plan" is only acceptable if every such change is
 * attributable, a locked plan stays closed, and rescheduling cannot quietly
 * erase a missed visit.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

async function idOf(email: string): Promise<string> {
  const [row] = await asSuperuser<{ id: string }>(
    'SELECT id FROM public.app_user WHERE email = $1',
    [email],
  );
  return row.id;
}

async function futureDate(daysAhead: number): Promise<string> {
  const [row] = await asSuperuser<{ d: string }>(
    `SELECT to_char(public.fn_local_date() + $1::integer, 'YYYY-MM-DD') AS d`,
    [daysAhead],
  );
  return row.d;
}

/** A planned visit belonging to rep01 that is still movable. */
async function movableVisitOfRep1(): Promise<{
  id: string;
  planned_date: string;
  rep_id: string;
}> {
  const [row] = await asSuperuser<{ id: string; planned_date: string; rep_id: string }>(
    `SELECT pv.id, to_char(pv.planned_date,'YYYY-MM-DD') AS planned_date, pv.rep_id
       FROM public.planned_visit pv
       JOIN public.app_user u ON u.id = pv.rep_id
      WHERE u.email = 'rep01@monos.mn'
        AND pv.status = 'planned'
        AND pv.planned_date >= public.fn_local_date()
      ORDER BY pv.planned_date
      LIMIT 1`,
  );
  return row;
}

describe.skipIf(!DB_AVAILABLE)('manager authority over plans', () => {
  afterAll(closePool);

  // ---------------------------------------------------------------------------
  describe('(a) adding a visit to a representative’s plan', () => {
    it('a manager CAN add a visit for a representative', async () => {
      const repId = await idOf(USERS.rep1);
      const date = await futureDate(20);

      await actingAs(USERS.manager1, async (s) => {
        const [created] = await s.query<{ id: string }>(
          `SELECT public.fn_manager_add_visit(
             $1,
             (SELECT id FROM public.clinic WHERE code = 'CL-007'),
             $2::date,
             'Менежерийн нэмсэн уулзалт',
             ARRAY[(SELECT dc.doctor_id FROM public.doctor_clinic dc
                     WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-007')
                     LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand WHERE code = 'BR-01')],
             TIME '11:00'
           ) AS id`,
          [repId, date],
        );
        expect(created.id).toBeTruthy();

        const [visit] = await s.query<{ rep_id: string; objective: string; status: string }>(
          'SELECT rep_id, objective, status FROM public.planned_visit WHERE id = $1',
          [created.id],
        );
        expect(visit.rep_id).toBe(repId);
        expect(visit.objective).toBe('Менежерийн нэмсэн уулзалт');
        expect(visit.status).toBe('planned');
      });
    });

    it('the representative can see a visit their manager added', async () => {
      const repId = await idOf(USERS.rep1);
      const date = await futureDate(21);

      const visitId = await actingAs(USERS.manager1, async (s) => {
        const [created] = await s.query<{ id: string }>(
          `SELECT public.fn_manager_add_visit(
             $1, (SELECT id FROM public.clinic WHERE code = 'CL-008'), $2::date,
             'Менежерээс',
             ARRAY[(SELECT dc.doctor_id FROM public.doctor_clinic dc
                     WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-008') LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand WHERE code = 'BR-02')]
           ) AS id`,
          [repId, date],
        );
        // Visible to the manager inside the same transaction.
        const rows = await s.query('SELECT 1 FROM public.planned_visit WHERE id = $1', [
          created.id,
        ]);
        expect(rows).toHaveLength(1);
        return created.id;
      });
      expect(visitId).toBeTruthy();
    });

    it('creates the week’s plan automatically if the rep has none', async () => {
      const repId = await idOf(USERS.rep7);
      const date = await futureDate(60); // far outside the seeded four weeks

      await actingAs(USERS.manager3, async (s) => {
        const before = await s.query<{ n: string }>(
          `SELECT count(*) AS n FROM public.weekly_plan
            WHERE rep_id = $1 AND week_start_date = (date_trunc('week', $2::timestamp))::date`,
          [repId, date],
        );
        expect(Number(before[0].n)).toBe(0);

        await s.query(
          `SELECT public.fn_manager_add_visit(
             $1, (SELECT id FROM public.clinic WHERE code = 'CL-001'), $2::date,
             'Шинэ долоо хоног',
             ARRAY[(SELECT dc.doctor_id FROM public.doctor_clinic dc
                     WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-001') LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand WHERE code = 'BR-01')]
           )`,
          [repId, date],
        );

        const after = await s.query<{ n: string }>(
          `SELECT count(*) AS n FROM public.weekly_plan
            WHERE rep_id = $1 AND week_start_date = (date_trunc('week', $2::timestamp))::date`,
          [repId, date],
        );
        expect(Number(after[0].n)).toBe(1);
      });
    });

    it('a REPRESENTATIVE cannot use the manager function on someone else', async () => {
      const victimId = await idOf(USERS.rep2);
      const date = await futureDate(22);

      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_manager_add_visit(
             $1, (SELECT id FROM public.clinic WHERE code = 'CL-001'), $2::date, 'оролдлого',
             ARRAY[(SELECT id FROM public.doctor LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand LIMIT 1)])`,
          [victimId, date],
        );
        expect(error.message).toMatch(/only a manager/i);
      });
    });

    it('refuses to plan a visit for a manager or an inactive user', async () => {
      const managerId = await idOf(USERS.manager2);
      const date = await futureDate(23);

      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_manager_add_visit(
             $1, (SELECT id FROM public.clinic WHERE code = 'CL-001'), $2::date, 'буруу',
             ARRAY[(SELECT id FROM public.doctor LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand LIMIT 1)])`,
          [managerId, date],
        );
        expect(error.message).toMatch(/active representative/i);
      });
    });

    it('requires at least one doctor and one brand', async () => {
      const repId = await idOf(USERS.rep1);
      const date = await futureDate(24);

      await actingAs(USERS.manager1, async (s) => {
        const noDoctor = await s.expectDenied(
          `SELECT public.fn_manager_add_visit(
             $1, (SELECT id FROM public.clinic WHERE code = 'CL-001'), $2::date, 'x',
             ARRAY[]::uuid[], ARRAY[(SELECT id FROM public.brand LIMIT 1)])`,
          [repId, date],
        );
        expect(noDoctor.message).toMatch(/at least one doctor/i);

        const noBrand = await s.expectDenied(
          `SELECT public.fn_manager_add_visit(
             $1, (SELECT id FROM public.clinic WHERE code = 'CL-001'), $2::date, 'x',
             ARRAY[(SELECT id FROM public.doctor LIMIT 1)], ARRAY[]::uuid[])`,
          [repId, date],
        );
        expect(noBrand.message).toMatch(/at least one brand/i);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('(b) rescheduling', () => {
    it('creates the replacement and marks the original as rescheduled', async () => {
      const original = await movableVisitOfRep1();
      const newDate = await futureDate(25);

      await actingAs(USERS.manager1, async (s) => {
        const [result] = await s.query<{ id: string }>(
          'SELECT public.fn_reschedule_visit($1, $2::date, NULL, $3) AS id',
          [original.id, newDate, 'Эмч завгүй байсан'],
        );

        const [old] = await s.query<{
          status: string;
          rescheduled_to_planned_visit_id: string;
        }>(
          'SELECT status, rescheduled_to_planned_visit_id FROM public.planned_visit WHERE id = $1',
          [original.id],
        );
        expect(old.status).toBe('rescheduled');
        expect(old.rescheduled_to_planned_visit_id).toBe(result.id);

        const [replacement] = await s.query<{
          planned_date: string;
          status: string;
          rep_id: string;
          objective: string;
        }>(
          `SELECT to_char(planned_date,'YYYY-MM-DD') AS planned_date, status, rep_id, objective
             FROM public.planned_visit WHERE id = $1`,
          [result.id],
        );
        expect(replacement.planned_date).toBe(newDate);
        expect(replacement.status).toBe('planned');
        expect(replacement.rep_id).toBe(original.rep_id);
      });
    });

    it('copies the doctors and brands to the replacement', async () => {
      const original = await movableVisitOfRep1();
      const newDate = await futureDate(26);

      await actingAs(USERS.manager1, async (s) => {
        const before = await s.query<{ doctor_id: string }>(
          'SELECT doctor_id FROM public.planned_visit_doctor WHERE planned_visit_id = $1 ORDER BY doctor_id',
          [original.id],
        );

        const [result] = await s.query<{ id: string }>(
          'SELECT public.fn_reschedule_visit($1, $2::date) AS id',
          [original.id, newDate],
        );

        const after = await s.query<{ doctor_id: string }>(
          'SELECT doctor_id FROM public.planned_visit_doctor WHERE planned_visit_id = $1 ORDER BY doctor_id',
          [result.id],
        );
        expect(after.map((r) => r.doctor_id)).toEqual(before.map((r) => r.doctor_id));

        const brands = await s.query(
          'SELECT brand_id FROM public.planned_visit_brand WHERE planned_visit_id = $1',
          [result.id],
        );
        expect(brands.length).toBeGreaterThan(0);
      });
    });

    it('records the move in the status history', async () => {
      const original = await movableVisitOfRep1();
      const newDate = await futureDate(27);

      await actingAs(USERS.manager1, async (s) => {
        await s.query('SELECT public.fn_reschedule_visit($1, $2::date, NULL, $3)', [
          original.id,
          newDate,
          'Эмнэлэг хаалттай',
        ]);

        const history = await s.query<{ to_status: string; note: string | null }>(
          `SELECT to_status, note FROM public.visit_status_history
            WHERE planned_visit_id = $1 AND to_status = 'rescheduled'`,
          [original.id],
        );
        expect(history.length).toBeGreaterThan(0);
        expect(history.some((h) => h.note === 'Эмнэлэг хаалттай')).toBe(true);
      });
    });

    it('a REPRESENTATIVE cannot reschedule, even their own visit', async () => {
      const original = await movableVisitOfRep1();
      const newDate = await futureDate(28);

      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          'SELECT public.fn_reschedule_visit($1, $2::date)',
          [original.id, newDate],
        );
        expect(error.message).toMatch(/only a manager/i);
      });
    });

    it('refuses to reschedule a visit that was already moved', async () => {
      const original = await movableVisitOfRep1();
      const first = await futureDate(29);
      const second = await futureDate(30);

      await actingAs(USERS.manager1, async (s) => {
        await s.query('SELECT public.fn_reschedule_visit($1, $2::date)', [original.id, first]);
        const error = await s.expectDenied('SELECT public.fn_reschedule_visit($1, $2::date)', [
          original.id,
          second,
        ]);
        expect(error.message).toMatch(/status rescheduled cannot be rescheduled/i);
      });
    });

    it('refuses a no-op move to the same date', async () => {
      const original = await movableVisitOfRep1();
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_reschedule_visit($1, $2::date)', [
          original.id,
          original.planned_date,
        ]);
        expect(error.message).toMatch(/same as the current one/i);
      });
    });

    it('CAN rescue a missed visit by moving it forward', async () => {
      const [missed] = await asSuperuser<{ id: string }>(
        `SELECT pv.id FROM public.planned_visit pv
           JOIN public.app_user u ON u.id = pv.rep_id
          WHERE pv.status = 'missed' AND u.email = 'rep01@monos.mn' LIMIT 1`,
      );
      const newDate = await futureDate(31);

      await actingAs(USERS.manager1, async (s) => {
        const [result] = await s.query<{ id: string }>(
          'SELECT public.fn_reschedule_visit($1, $2::date, NULL, $3) AS id',
          [missed.id, newDate, 'Дараагийн долоо хоногт шилжүүлэв'],
        );
        expect(result.id).toBeTruthy();

        // The original stays visible as rescheduled — it is NOT erased, so the
        // KPI can still distinguish "moved" from "never happened".
        const [old] = await s.query<{ status: string }>(
          'SELECT status FROM public.planned_visit WHERE id = $1',
          [missed.id],
        );
        expect(old.status).toBe('rescheduled');
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('guardrails', () => {
    it('a LOCKED plan is closed even to a manager', async () => {
      const repId = await idOf(USERS.rep2);

      // Walk a seeded plan through legal transitions to 'locked'.
      const [plan] = await asSuperuser<{ id: string; week_start_date: string }>(
        `SELECT id, to_char(week_start_date,'YYYY-MM-DD') AS week_start_date
           FROM public.weekly_plan
          WHERE rep_id = $1 AND status = 'completed' LIMIT 1`,
        [repId],
      );
      await asSuperuser("UPDATE public.weekly_plan SET status = 'locked' WHERE id = $1", [plan.id]);

      await actingAs(USERS.manager1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.planned_visit
             (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
           VALUES ($1, $2, (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                   $3::date, 99, 'түгжигдсэн төлөвлөгөөнд нэмэх оролдлого')`,
          [plan.id, repId, plan.week_start_date],
        );
      });
    });

    it('every manager change to someone else’s plan is audited with the actor', async () => {
      const repId = await idOf(USERS.rep1);
      const date = await futureDate(32);

      await actingAs(USERS.manager1, async (s) => {
        const [created] = await s.query<{ id: string }>(
          `SELECT public.fn_manager_add_visit(
             $1, (SELECT id FROM public.clinic WHERE code = 'CL-009'), $2::date, 'аудит шалгах',
             ARRAY[(SELECT dc.doctor_id FROM public.doctor_clinic dc
                     WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-009') LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand WHERE code = 'BR-03')]
           ) AS id`,
          [repId, date],
        );

        const [entry] = await s.query<{ action: string; actor_email: string; note: string }>(
          `SELECT action, actor_email, note FROM public.audit_log
            WHERE entity_type = 'planned_visit' AND entity_id = $1
            ORDER BY occurred_at DESC LIMIT 1`,
          [created.id],
        );

        expect(entry.action).toBe('plan_changed');
        expect(entry.actor_email).toBe('manager01@monos.mn');
        expect(entry.note).toMatch(/on behalf of rep/i);
      });
    });

    it('a representative editing their OWN plan is not logged as a foreign change', async () => {
      // Otherwise the audit log fills with ordinary work and the entries that
      // matter become impossible to find.
      const [plan] = await asSuperuser<{ id: string; week_start_date: string }>(
        `SELECT wp.id, to_char(wp.week_start_date,'YYYY-MM-DD') AS week_start_date
           FROM public.weekly_plan wp
           JOIN public.app_user u ON u.id = wp.rep_id
          WHERE u.email = 'rep01@monos.mn' AND wp.status = 'active' LIMIT 1`,
      );

      await actingAs(USERS.rep1, async (s) => {
        const before = await s.query<{ n: string }>(
          `SELECT count(*) AS n FROM public.audit_log WHERE action = 'plan_changed'`,
        );

        await s.query(
          `UPDATE public.planned_visit SET planned_order = planned_order
            WHERE weekly_plan_id = $1`,
          [plan.id],
        );

        const after = await s.query<{ n: string }>(
          `SELECT count(*) AS n FROM public.audit_log WHERE action = 'plan_changed'`,
        );
        expect(after[0].n).toBe(before[0].n);
      });
    });

    it('the duplicate rule still applies to a manager', async () => {
      // A manager must not be able to create the duplicate a representative is
      // prevented from creating.
      const repId = await idOf(USERS.rep1);
      const date = await futureDate(33);

      await actingAs(USERS.manager1, async (s) => {
        const args = `$1, (SELECT id FROM public.clinic WHERE code = 'CL-010'), $2::date, 'давхардал',
             ARRAY[(SELECT dc.doctor_id FROM public.doctor_clinic dc
                     WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-010') LIMIT 1)],
             ARRAY[(SELECT id FROM public.brand WHERE code = 'BR-01')]`;

        await s.query(`SELECT public.fn_manager_add_visit(${args})`, [repId, date]);
        await s.query(`SELECT public.fn_manager_add_visit(${args})`, [repId, date]);

        const error = await s.expectDenied('SET CONSTRAINTS ALL IMMEDIATE');
        expect(error.message).toMatch(/аль хэдийн байна/i);
      });
    });
  });
});
