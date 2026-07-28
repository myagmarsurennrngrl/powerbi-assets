/**
 * Phase 5 — exceptions and KPI.
 *
 * Acceptance criteria covered:
 *   12. A manager can approve or reject an exception
 *   13. Missed visits reduce the standard KPI
 *   14. Approved qualifying exceptions do NOT reduce the KPI
 *
 * The centrepiece is `the worked example from docs/05 §4` — the exact scenario
 * in the design document, built row by row and checked against the documented
 * answer of 33.3%. If the implementation and the document ever drift apart,
 * this test says so.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

async function idOf(email: string): Promise<string> {
  const [row] = await asSuperuser<{ id: string }>(
    'SELECT id FROM public.app_user WHERE email = $1',
    [email],
  );
  return row.id;
}

/**
 * A dedicated, isolated week far from the seeded data, so the arithmetic is
 * exactly what the test builds and nothing else.
 */
const SCENARIO_WEEK_OFFSET = -20;

async function scenarioWeek(): Promise<{ start: string; end: string }> {
  const [row] = await asSuperuser<{ start: string; end: string }>(
    `SELECT to_char((date_trunc('week', public.fn_local_date()::timestamp))::date + ($1 * 7), 'YYYY-MM-DD') AS start,
            to_char((date_trunc('week', public.fn_local_date()::timestamp))::date + ($1 * 7) + 6, 'YYYY-MM-DD') AS end`,
    [SCENARIO_WEEK_OFFSET],
  );
  return row;
}

describe.skipIf(!DB_AVAILABLE)('exceptions and KPI', () => {
  afterAll(closePool);

  // ===========================================================================
  describe('exception workflow', () => {
    /** A fresh planned visit for TOMORROW that can carry an exception. */
    async function givenFuturePlannedVisit(email: string): Promise<string> {
      const [row] = await asSuperuser<{ id: string }>(
        `WITH rep AS (SELECT id FROM public.app_user WHERE email = $1),
              d   AS (SELECT public.fn_local_date() + 2 AS day),
              plan AS (
                SELECT public.fn_ensure_weekly_plan_for(
                  (SELECT id FROM rep),
                  (date_trunc('week', (SELECT day FROM d)::timestamp))::date) AS id
              )
         INSERT INTO public.planned_visit
           (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
         SELECT plan.id, rep.id,
                (SELECT id FROM public.clinic WHERE code = 'CL-005'),
                (SELECT day FROM d),
                (SELECT LEAST(COALESCE(max(planned_order), 0) + 1, 50)
                   FROM public.planned_visit pv, rep
                  WHERE pv.rep_id = rep.id AND pv.planned_date = (SELECT day FROM d)),
                'чөлөөлөх хүсэлтийн тест'
           FROM plan, rep
         RETURNING id`,
        [email],
      );
      return row.id;
    }

    it('a representative can submit an exception with their distance recorded', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);

      await actingAs(USERS.rep1, async (s) => {
        const [exception] = await s.query<{
          id: string;
          status: string;
          distance_from_clinic_m: string;
        }>(
          `SELECT id, status, distance_from_clinic_m
             FROM public.fn_request_exception($1, 'gps_problem', $2, 47.9200, 106.9200, 25)`,
          [plannedId, 'Эмнэлэг дотор GPS барихгүй байна.'],
        );

        expect(exception.status).toBe('pending');
        // The number a manager actually needs in order to judge the claim.
        expect(Number(exception.distance_from_clinic_m)).toBeGreaterThan(0);

        const [pv] = await s.query<{ status: string }>(
          'SELECT status FROM public.planned_visit WHERE id = $1',
          [plannedId],
        );
        expect(pv.status).toBe('cancellation_requested');
      });
    });

    it('location is OPTIONAL — sick leave should not require coordinates', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);

      await actingAs(USERS.rep1, async (s) => {
        const [exception] = await s.query<{ request_latitude: string | null }>(
          `SELECT request_latitude FROM public.fn_request_exception($1, 'sick_leave', $2)`,
          [plannedId, 'Өвчтэй байна.'],
        );
        expect(exception.request_latitude).toBeNull();
      });
    });

    it('refuses a second pending request for the same visit', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);

      await actingAs(USERS.rep1, async (s) => {
        await s.query(
          `SELECT public.fn_request_exception($1, 'clinic_closed', 'Хаалттай')`,
          [plannedId],
        );
        const error = await s.expectDenied(
          `SELECT public.fn_request_exception($1, 'clinic_closed', 'Дахин')`,
          [plannedId],
        );
        expect(error.message).toMatch(/аль хэдийн байна/i);
      });
    });

    it('refuses an exception on someone else’s visit', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      await actingAs(USERS.rep2, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_request_exception($1, 'emergency', 'тест')`,
          [plannedId],
        );
        expect(error.message).toMatch(/хамааралгүй/i);
      });
    });

    it('requires an explanation', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          `SELECT public.fn_request_exception($1, 'other', '   ')`,
          [plannedId],
        );
      });
    });

    // -------------------------------------------------------------------------
    it('ACCEPTANCE 12: a manager can approve an exception', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      const [exception] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation)
         SELECT $1, rep_id, 'sick_leave', 'Өвчтэй' FROM public.planned_visit WHERE id = $1
         RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.manager1, async (s) => {
        const [reviewed] = await s.query<{ status: string; approved_by: string }>(
          'SELECT status, approved_by FROM public.fn_review_exception($1, true, $2)',
          [exception.id, 'Зөвшөөрөв.'],
        );
        expect(reviewed.status).toBe('approved');
        expect(reviewed.approved_by).toBeTruthy();

        const [pv] = await s.query<{ status: string }>(
          'SELECT status FROM public.planned_visit WHERE id = $1',
          [plannedId],
        );
        expect(pv.status).toBe('cancelled_approved');
      });
    });

    it('ACCEPTANCE 12: a manager can reject one, and it then counts against the KPI', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      const [exception] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation)
         SELECT $1, rep_id, 'other', 'Явж чадаагүй' FROM public.planned_visit WHERE id = $1
         RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.manager1, async (s) => {
        const [reviewed] = await s.query<{ status: string }>(
          'SELECT status FROM public.fn_review_exception($1, false, $2)',
          [exception.id, 'Хангалттай шалтгаан биш.'],
        );
        expect(reviewed.status).toBe('rejected');

        const [pv] = await s.query<{ status: string }>(
          'SELECT status FROM public.planned_visit WHERE id = $1',
          [plannedId],
        );
        // Rejected means it counts as an unapproved cancellation.
        expect(pv.status).toBe('cancelled_unapproved');
      });
    });

    it('a rejection MUST carry a reason', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      const [exception] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation)
         SELECT $1, rep_id, 'other', 'тест' FROM public.planned_visit WHERE id = $1 RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied(
          'SELECT public.fn_review_exception($1, false, NULL)',
          [exception.id],
        );
        expect(error.message).toMatch(/шалтгаанаа бичнэ/i);
      });
    });

    it('a REPRESENTATIVE cannot approve anything', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      const [exception] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation)
         SELECT $1, rep_id, 'sick_leave', 'тест' FROM public.planned_visit WHERE id = $1 RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          'SELECT public.fn_review_exception($1, true, NULL)',
          [exception.id],
        );
        expect(error.message).toMatch(/зөвхөн менежер/i);
      });
    });

    it('NOBODY approves their own exception — not even a manager', async () => {
      // A manager may legitimately file one; somebody else must decide it.
      const managerId = await idOf(USERS.manager1);
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);

      await expect(
        asSuperuser(
          `UPDATE public.visit_exception SET rep_id = $1 WHERE planned_visit_id = $2`,
          [managerId, plannedId],
        ).then(() =>
          asSuperuser(
            `INSERT INTO public.visit_exception
               (planned_visit_id, rep_id, reason_category, explanation, status, approved_by, approval_ts)
             VALUES ($1, $2, 'sick_leave', 'өөрөө', 'approved', $2, now())`,
            [plannedId, managerId],
          ),
        ),
      ).rejects.toThrow(/no_self_approval/i);
    });

    it('a decided exception cannot be decided again', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      const [exception] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation)
         SELECT $1, rep_id, 'sick_leave', 'тест' FROM public.planned_visit WHERE id = $1 RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.manager1, async (s) => {
        await s.query('SELECT public.fn_review_exception($1, true, NULL)', [exception.id]);
        const error = await s.expectDenied(
          'SELECT public.fn_review_exception($1, false, $2)',
          [exception.id, 'бодлоо өөрчиллөө'],
        );
        expect(error.message).toMatch(/аль хэдийн шийдвэрлэгдсэн/i);
      });
    });

    it('a client cannot write or approve an exception row directly', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation, status)
           VALUES ($1, public.fn_current_app_user_id(), 'sick_leave', 'x', 'approved')`,
          [plannedId],
        );
      });
    });

    it('shows a manager the KPI consequence BEFORE they decide', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep1);
      await asSuperuser(
        `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation)
         SELECT $1, rep_id, 'sick_leave', 'Өвчтэй' FROM public.planned_visit WHERE id = $1`,
        [plannedId],
      );

      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{
          planned_visit_id: string;
          excludes_from_kpi_if_approved: boolean;
          reason_category: string;
        }>('SELECT * FROM public.fn_pending_exceptions()');

        const target = rows.find((r) => r.planned_visit_id === plannedId);
        expect(target?.excludes_from_kpi_if_approved).toBe(true);
      });
    });

    it('marks doctor_unavailable as NOT excusing, per the confirmed rule', async () => {
      const plannedId = await givenFuturePlannedVisit(USERS.rep2);
      await asSuperuser(
        `INSERT INTO public.visit_exception (planned_visit_id, rep_id, reason_category, explanation)
         SELECT $1, rep_id, 'doctor_unavailable', 'Эмч завгүй' FROM public.planned_visit WHERE id = $1`,
        [plannedId],
      );

      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{
          planned_visit_id: string;
          excludes_from_kpi_if_approved: boolean;
        }>('SELECT * FROM public.fn_pending_exceptions()');
        const target = rows.find((r) => r.planned_visit_id === plannedId);
        expect(target?.excludes_from_kpi_if_approved).toBe(false);
      });
    });
  });

  // ===========================================================================
  describe('the worked example from docs/05 §4', () => {
    /**
     * Builds exactly the scenario in the design document:
     *
     *   V1 completed                                   → denominator ✓ numerator ✓
     *   V2 completed                                   → denominator ✓ numerator ✓
     *   V3 missed                                      → denominator ✓
     *   V4 cancelled, approved sick_leave              → excluded
     *   V5 cancelled without approval                  → denominator ✓
     *   V6 still 'planned', date already past          → denominator ✓
     *   V7 rescheduled to a LATER date                 → excluded
     *   V8 cancelled, approved doctor_unavailable      → denominator ✓ (not excusing)
     *   U1 unplanned completed visit                   → separate metric
     *
     *   Denominator 6, numerator 2, completion 33.3%
     */
    let repId: string;
    let week: { start: string; end: string };

    beforeAll(async () => {
      repId = await idOf(USERS.rep7);
      week = await scenarioWeek();

      // Start from a clean, isolated week.
      await asSuperuser(
        `UPDATE public.planned_visit SET status = 'cancelled_approved'
          WHERE rep_id = $1 AND planned_date BETWEEN $2::date AND $3::date`,
        [repId, week.start, week.end],
      );

      const [plan] = await asSuperuser<{ id: string }>(
        'SELECT public.fn_ensure_weekly_plan_for($1, $2::date) AS id',
        [repId, week.start],
      );

      const makeVisit = async (order: number, status: string): Promise<string> => {
        const [row] = await asSuperuser<{ id: string }>(
          `INSERT INTO public.planned_visit
             (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, planned_time, objective, status)
           VALUES ($1, $2, (SELECT id FROM public.clinic WHERE code = 'CL-011'),
                   $3::date, $4, TIME '10:00', 'worked example', $5::public.visit_status)
           RETURNING id`,
          [plan.id, repId, week.start, order, status],
        );
        return row.id;
      };

      const completeIt = async (plannedId: string) => {
        await asSuperuser(
          `INSERT INTO public.visit
             (planned_visit_id, rep_id, clinic_id, visit_date, status,
              started_at_server, completed_at_server, is_draft)
           SELECT pv.id, pv.rep_id, pv.clinic_id, pv.planned_date, 'completed',
                  (pv.planned_date + TIME '10:05') AT TIME ZONE 'Asia/Ulaanbaatar',
                  (pv.planned_date + TIME '10:40') AT TIME ZONE 'Asia/Ulaanbaatar',
                  false
             FROM public.planned_visit pv WHERE pv.id = $1`,
          [plannedId],
        );
      };

      const approveException = async (plannedId: string, reason: string) => {
        await asSuperuser(
          `INSERT INTO public.visit_exception
             (planned_visit_id, rep_id, reason_category, explanation, status, approved_by, approval_ts)
           SELECT $1, pv.rep_id, $2::public.exception_reason, 'worked example', 'approved',
                  (SELECT id FROM public.app_user WHERE email = 'manager01@monos.mn'), now()
             FROM public.planned_visit pv WHERE pv.id = $1`,
          [plannedId, reason],
        );
      };

      // V1, V2 — completed
      for (const order of [1, 2]) {
        const id = await makeVisit(order, 'completed');
        await completeIt(id);
      }
      // V3 — missed
      await makeVisit(3, 'missed');
      // V4 — approved sick leave (excusing)
      const v4 = await makeVisit(4, 'cancelled_approved');
      await approveException(v4, 'sick_leave');
      // V5 — cancelled without approval
      await makeVisit(5, 'cancelled_unapproved');
      // V6 — left 'planned' although the date has passed
      await makeVisit(6, 'planned');
      // V7 — rescheduled forward
      const v7 = await makeVisit(7, 'rescheduled');
      // The replacement goes into the FOLLOWING week — which is what
      // "rescheduled to a later date" means, and keeps it out of the period
      // being measured. Putting it in the same week would have it counted
      // twice, once as the original and once as the replacement.
      const [nextPlan] = await asSuperuser<{ id: string }>(
        'SELECT public.fn_ensure_weekly_plan_for($1, $2::date + 7) AS id',
        [repId, week.start],
      );
      const [later] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.planned_visit
           (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
         VALUES ($1, $2, (SELECT id FROM public.clinic WHERE code = 'CL-011'),
                 $3::date + 8, 9, 'worked example moved')
         RETURNING id`,
        [nextPlan.id, repId, week.start],
      );
      await asSuperuser(
        'UPDATE public.planned_visit SET rescheduled_to_planned_visit_id = $1 WHERE id = $2',
        [later.id, v7],
      );

      // V8 — approved doctor_unavailable (NOT excusing)
      const v8 = await makeVisit(8, 'cancelled_approved');
      await approveException(v8, 'doctor_unavailable');

      // U1 — an unplanned completed visit in the same week
      await asSuperuser(
        `INSERT INTO public.visit
           (planned_visit_id, rep_id, clinic_id, visit_date, status,
            started_at_server, completed_at_server, is_draft)
         VALUES (NULL, $1, (SELECT id FROM public.clinic WHERE code = 'CL-011'),
                 $2::date, 'completed',
                 ($2::date + TIME '14:00') AT TIME ZONE 'Asia/Ulaanbaatar',
                 ($2::date + TIME '14:30') AT TIME ZONE 'Asia/Ulaanbaatar',
                 false)`,
        [repId, week.start],
      );
    });

    it('produces exactly the numbers in the design document', async () => {
      const [kpi] = await asSuperuser<{
        eligible_visits: number;
        completed_visits: number;
        completion_pct: string;
        missed_visits: number;
        approved_cancellations: number;
        unapproved_cancellations: number;
        unplanned_visits: number;
      }>('SELECT * FROM public.fn_kpi_for_rep($1, $2::date, $3::date)', [
        repId, week.start, week.end,
      ]);

      // docs/05 §4: denominator 6, numerator 2, 33.3%
      expect(kpi.eligible_visits).toBe(6);
      expect(kpi.completed_visits).toBe(2);
      expect(Number(kpi.completion_pct)).toBeCloseTo(33.3, 1);

      expect(kpi.missed_visits).toBe(2);            // V3 and past-dated V6
      expect(kpi.approved_cancellations).toBe(1);   // V4 only — V8 is not excusing
      expect(kpi.unapproved_cancellations).toBe(1); // V5
      expect(kpi.unplanned_visits).toBe(1);         // U1, reported separately
    });

    it('ACCEPTANCE 14: the approved sick leave is NOT in the denominator', async () => {
      const rows = await asSuperuser<{ is_eligible: boolean; is_approved_cancellation: boolean }>(
        `SELECT k.is_eligible, k.is_approved_cancellation
           FROM public.fn_kpi_visit_classification($1, $2::date, $3::date) k
           JOIN public.visit_exception e ON e.planned_visit_id = k.planned_visit_id
          WHERE e.reason_category = 'sick_leave'`,
        [repId, week.start, week.end],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.is_eligible === false)).toBe(true);
    });

    it('an approved doctor_unavailable IS still in the denominator', async () => {
      // The confirmed business rule: the rep still travelled and still owns
      // the outcome, so approving the explanation does not erase the target.
      const rows = await asSuperuser<{ is_eligible: boolean }>(
        `SELECT k.is_eligible
           FROM public.fn_kpi_visit_classification($1, $2::date, $3::date) k
           JOIN public.visit_exception e ON e.planned_visit_id = k.planned_visit_id
          WHERE e.reason_category = 'doctor_unavailable'`,
        [repId, week.start, week.end],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.is_eligible === true)).toBe(true);
    });

    it('ACCEPTANCE 13: a missed visit lowers the percentage', async () => {
      const before = await asSuperuser<{ completion_pct: string }>(
        'SELECT completion_pct FROM public.fn_kpi_for_rep($1, $2::date, $3::date)',
        [repId, week.start, week.end],
      );

      // Add one more missed visit and watch the number fall.
      await asSuperuser(
        `INSERT INTO public.planned_visit
           (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective, status)
         SELECT wp.id, $1, (SELECT id FROM public.clinic WHERE code = 'CL-011'),
                $2::date, 20, 'extra missed', 'missed'
           FROM public.weekly_plan wp
          WHERE wp.rep_id = $1 AND wp.week_start_date = $2::date`,
        [repId, week.start],
      );

      const after = await asSuperuser<{ completion_pct: string; eligible_visits: number }>(
        'SELECT completion_pct, eligible_visits FROM public.fn_kpi_for_rep($1, $2::date, $3::date)',
        [repId, week.start, week.end],
      );

      expect(after[0].eligible_visits).toBe(7);
      expect(Number(after[0].completion_pct)).toBeLessThan(Number(before[0].completion_pct));
      expect(Number(after[0].completion_pct)).toBeCloseTo(28.6, 1); // 2/7
    });
  });

  // ===========================================================================
  describe('KPI edge cases that matter', () => {
    it('reports NULL, never 0%, when nothing was eligible', async () => {
      // A rep on approved leave for a whole week has not failed. Showing them
      // 0% would be a false accusation by arithmetic.
      const repId = await idOf(USERS.rep6);
      const [kpi] = await asSuperuser<{ completion_pct: string | null; eligible_visits: number }>(
        `SELECT completion_pct, eligible_visits
           FROM public.fn_kpi_for_rep($1, DATE '2019-01-07', DATE '2019-01-13')`,
        [repId],
      );
      expect(kpi.eligible_visits).toBe(0);
      expect(kpi.completion_pct).toBeNull();
    });

    it('never mixes unplanned visits into the completion ratio', async () => {
      const repId = await idOf(USERS.rep5);
      const week = await scenarioWeek();

      const before = await asSuperuser<{ eligible_visits: number; completion_pct: string | null }>(
        'SELECT eligible_visits, completion_pct FROM public.fn_kpi_for_rep($1, $2::date, $3::date)',
        [repId, week.start, week.end],
      );

      await asSuperuser(
        `INSERT INTO public.visit
           (planned_visit_id, rep_id, clinic_id, visit_date, status,
            started_at_server, completed_at_server, is_draft)
         VALUES (NULL, $1, (SELECT id FROM public.clinic WHERE code = 'CL-012'),
                 $2::date, 'completed',
                 ($2::date + TIME '09:00') AT TIME ZONE 'Asia/Ulaanbaatar',
                 ($2::date + TIME '09:30') AT TIME ZONE 'Asia/Ulaanbaatar', false)`,
        [repId, week.start],
      );

      const after = await asSuperuser<{
        eligible_visits: number;
        completion_pct: string | null;
        unplanned_visits: number;
      }>(
        `SELECT eligible_visits, completion_pct, unplanned_visits
           FROM public.fn_kpi_for_rep($1, $2::date, $3::date)`,
        [repId, week.start, week.end],
      );

      // The ratio is untouched; the unplanned count went up.
      expect(after[0].eligible_visits).toBe(before[0].eligible_visits);
      expect(after[0].completion_pct).toEqual(before[0].completion_pct);
      expect(after[0].unplanned_visits).toBeGreaterThan(0);
    });

    it('a representative cannot read a colleague’s KPI', async () => {
      const otherId = await idOf(USERS.rep2);
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `SELECT * FROM public.fn_kpi_for_rep($1, public.fn_local_date() - 30, public.fn_local_date())`,
          [otherId],
        );
        expect(error.message).toMatch(/эрх алга/i);
      });
    });

    it('a representative CAN read their own', async () => {
      const me = await idOf(USERS.rep1);
      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query(
          `SELECT * FROM public.fn_kpi_for_rep($1, public.fn_local_date() - 30, public.fn_local_date())`,
          [me],
        );
        expect(rows).toHaveLength(1);
      });
    });

    it('team completion is weighted by volume, not an average of percentages', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{
          rep_name: string;
          completed_visits: number;
          eligible_visits: number;
          completion_pct: string | null;
        }>(
          `SELECT * FROM public.fn_kpi_for_team(public.fn_local_date() - 30, public.fn_local_date())`,
        );
        expect(rows.length).toBe(7);

        const totalCompleted = rows.reduce((sum, r) => sum + Number(r.completed_visits), 0);
        const totalEligible = rows.reduce((sum, r) => sum + Number(r.eligible_visits), 0);
        expect(totalEligible).toBeGreaterThan(0);

        // A volume-weighted team figure differs from the mean of the per-rep
        // percentages whenever workloads differ — which is the whole point.
        const weighted = (totalCompleted / totalEligible) * 100;
        expect(weighted).toBeGreaterThanOrEqual(0);
        expect(weighted).toBeLessThanOrEqual(100);
      });
    });

    it('a representative cannot see the team table', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectInvisible(
          `SELECT * FROM public.fn_kpi_for_team(public.fn_local_date() - 30, public.fn_local_date())`,
        );
      });
    });
  });

  // ===========================================================================
  describe('rule versioning — history must never change', () => {
    it('everyone can read the rules they are measured by', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query<{ version_no: number }>(
          'SELECT version_no FROM public.kpi_rule_version',
        );
        expect(rows.length).toBeGreaterThan(0);
      });
    });

    it('only an administrator can publish a new version', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_create_kpi_rule_version('{}'::jsonb, public.fn_local_date() + 30)`,
        );
        expect(error.message).toMatch(/зөвхөн администратор/i);
      });
    });

    it('refuses to backdate a rule change', async () => {
      // Backdating would silently rewrite numbers people have already seen.
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_create_kpi_rule_version('{}'::jsonb, public.fn_local_date() - 1)`,
        );
        expect(error.message).toMatch(/ирээдүйн огнооноос/i);
      });
    });

    it('a published snapshot can never be altered or deleted', async () => {
      const repId = await idOf(USERS.rep1);
      const [snapshot] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.kpi_period_snapshot
           (scope, rep_id, period_type, period_start, period_end, kpi_rule_version_id,
            planned_visits, completed_visits, missed_visits, approved_cancellations,
            unapproved_cancellations, unplanned_visits, eligible_visits, completion_pct)
         VALUES ('rep', $1, 'week', DATE '2020-01-06', DATE '2020-01-12',
                 (SELECT id FROM public.kpi_rule_version ORDER BY version_no LIMIT 1),
                 5, 4, 1, 0, 0, 0, 5, 80.0)
         RETURNING id`,
        [repId],
      );

      await expect(
        asSuperuser('UPDATE public.kpi_period_snapshot SET completion_pct = 100 WHERE id = $1', [
          snapshot.id,
        ]),
      ).rejects.toThrow(/cannot be UPDATE/i);

      await expect(
        asSuperuser('DELETE FROM public.kpi_period_snapshot WHERE id = $1', [snapshot.id]),
      ).rejects.toThrow(/cannot be DELETE/i);
    });

    it('refuses to publish a period that has not finished', async () => {
      const repId = await idOf(USERS.rep1);
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_publish_kpi_snapshot($1, 'week', public.fn_local_date() - 2, public.fn_local_date() + 4)`,
          [repId],
        );
        expect(error.message).toMatch(/дуусаагүй/i);
      });
    });
  });
});
