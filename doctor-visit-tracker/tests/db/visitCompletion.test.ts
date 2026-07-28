/**
 * Phase 4 — visit documentation, addenda and doctor history.
 *
 * Acceptance criteria covered:
 *    8. A representative can complete a structured visit report
 *    9. Completed visit records cannot be edited
 *   10. Another authorised representative can read the doctor's history
 *   18. No patient information is collected
 *
 * The conditional-requirement rules get particular attention, because the
 * literal reading of the brief would make a "clinic closed" visit impossible
 * to submit — see the header of migration 0017.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

/** A committed, in-progress, checked-out visit for the given rep. */
async function givenCheckedOutVisit(email: string): Promise<string> {
  // Retire EVERY scaffolding visit this rep has at this clinic today —
  // including ones created by the other test file. Two helpers both booking
  // CL-001 would otherwise exhaust the planned_order cap and collide on the
  // duplicate-doctor rule. Cancelled visits are excluded from that rule.
  await asSuperuser(
    `UPDATE public.planned_visit pv
        SET status = 'cancelled_unapproved'
       FROM public.app_user u
      WHERE u.id = pv.rep_id
        AND u.email = $1
        AND pv.clinic_id = (SELECT id FROM public.clinic WHERE code = $2)
        AND pv.planned_date = public.fn_local_date()
        AND pv.objective IN ('тестийн уулзалт', 'тайлангийн тест')
        AND pv.status NOT IN ('cancelled_unapproved', 'cancelled_approved', 'completed')`,
    [email, 'CL-001'],
  );

  const [planned] = await asSuperuser<{ id: string }>(
    `WITH rep AS (SELECT id FROM public.app_user WHERE email = $1),
          wk  AS (SELECT (date_trunc('week', public.fn_local_date()::timestamp))::date AS monday)
     INSERT INTO public.planned_visit
       (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
     SELECT wp.id, rep.id,
            (SELECT id FROM public.clinic WHERE code = 'CL-001'),
            public.fn_local_date(),
            -- planned_order is capped at 50 by constraint; these scaffolding
            -- visits only need a valid slot, not a unique one.
            (SELECT LEAST(COALESCE(max(planned_order), 0) + 1, 50)
               FROM public.planned_visit pv, rep
              WHERE pv.rep_id = rep.id AND pv.planned_date = public.fn_local_date()),
            'тайлангийн тест'
       FROM public.weekly_plan wp, rep, wk
      WHERE wp.rep_id = rep.id AND wp.week_start_date = wk.monday
     RETURNING id`,
    [email],
  );

  // A doctor AND a brand: scaffolding must look like data the plan builder
  // could produce, because it is committed and other test files read it.
  await asSuperuser(
    `INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id)
     SELECT $1, dc.doctor_id FROM public.doctor_clinic dc
      WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-001')
      LIMIT 1`,
    [planned.id],
  );

  await asSuperuser(
    `INSERT INTO public.planned_visit_brand (planned_visit_id, brand_id)
     SELECT $1, a.brand_id
       FROM public.rep_brand_assignment a
      WHERE a.rep_id = (SELECT rep_id FROM public.planned_visit WHERE id = $1)
        AND a.is_active
      LIMIT 1`,
    [planned.id],
  );

  // Any earlier in-progress visit would trip the one-active-visit index.
  await asSuperuser(
    `UPDATE public.visit SET status = 'missed'
      WHERE status = 'in_progress'
        AND rep_id = (SELECT id FROM public.app_user WHERE email = $1)`,
    [email],
  );

  const [visit] = await asSuperuser<{ id: string }>(
    `INSERT INTO public.visit
       (planned_visit_id, rep_id, clinic_id, visit_date, status,
        started_at_server, completed_at_server, is_draft, objective)
     SELECT pv.id, pv.rep_id, pv.clinic_id, public.fn_local_date(), 'in_progress',
            now() - interval '40 minutes', now(), true, pv.objective
       FROM public.planned_visit pv WHERE pv.id = $1
     RETURNING id`,
    [planned.id],
  );

  return visit.id;
}

async function issuesFor(visitId: string): Promise<string[]> {
  const rows = await asSuperuser<{ field: string }>(
    'SELECT field FROM public.fn_visit_completion_issues($1) ORDER BY field',
    [visitId],
  );
  return rows.map((r) => r.field);
}

/** Fill in everything a "doctor met" report needs. */
async function fillFullReport(visitId: string): Promise<void> {
  await asSuperuser(
    `UPDATE public.visit
        SET meeting_status = 'doctor_met',
            outcome = 'doctor_interested',
            interest_level = 'high',
            doctor_feedback = 'Сонирхолтой байна гэв.',
            rep_summary = 'Товч танилцуулга хийв.',
            next_action = 'Үнийн санал илгээх',
            follow_up_required = false
      WHERE id = $1`,
    [visitId],
  );
  await asSuperuser(
    `INSERT INTO public.visit_doctor (visit_id, doctor_id)
     SELECT $1, pvd.doctor_id
       FROM public.planned_visit_doctor pvd
       JOIN public.visit v ON v.planned_visit_id = pvd.planned_visit_id
      WHERE v.id = $1
     ON CONFLICT DO NOTHING`,
    [visitId],
  );
  await asSuperuser(
    `INSERT INTO public.visit_brand (visit_id, brand_id)
     SELECT $1, a.brand_id FROM public.rep_brand_assignment a
       JOIN public.visit v ON v.rep_id = a.rep_id
      WHERE v.id = $1 AND a.is_active LIMIT 1
     ON CONFLICT DO NOTHING`,
    [visitId],
  );
}

describe.skipIf(!DB_AVAILABLE)('visit documentation', () => {
  afterAll(closePool);

  // ---------------------------------------------------------------------------
  describe('completion validation', () => {
    it('lists every missing field on an empty report', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      const issues = await issuesFor(visitId);
      // Without meeting_status the conditional rules cannot be applied, so it
      // is reported alone rather than alongside a misleading list.
      expect(issues).toEqual(['meeting_status']);
    });

    it('requires doctor, brand, feedback and interest when the doctor WAS met', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await asSuperuser(
        "UPDATE public.visit SET meeting_status = 'doctor_met' WHERE id = $1",
        [visitId],
      );

      const issues = await issuesFor(visitId);
      expect(issues).toContain('doctors');
      expect(issues).toContain('brands');
      expect(issues).toContain('doctor_feedback');
      expect(issues).toContain('interest_level');
      expect(issues).toContain('outcome');
      expect(issues).toContain('next_action');
      expect(issues).toContain('rep_summary');
      expect(issues).toContain('follow_up_required');
    });

    it('does NOT demand a doctor when the clinic was closed', async () => {
      // The heart of the conditional-rules decision: a closed clinic still
      // deserves an honest record, and there is no doctor to name.
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await asSuperuser(
        `UPDATE public.visit
            SET meeting_status = 'clinic_closed',
                outcome = 'other',
                rep_summary = 'Эмнэлэг хаалттай байлаа.',
                next_action = 'Маргааш дахин очих',
                follow_up_required = false
          WHERE id = $1`,
        [visitId],
      );

      const issues = await issuesFor(visitId);
      expect(issues).not.toContain('doctors');
      expect(issues).not.toContain('doctor_feedback');
      expect(issues).not.toContain('interest_level');
      expect(issues).not.toContain('brands');
      expect(issues).toEqual([]);
    });

    it('requires brands but not a doctor when only staff were met', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await asSuperuser(
        `UPDATE public.visit
            SET meeting_status = 'met_clinic_staff_only',
                outcome = 'product_introduced',
                rep_summary = 'Ажилтантай ярилцав.',
                next_action = 'Эмчтэй дараа уулзах',
                follow_up_required = false
          WHERE id = $1`,
        [visitId],
      );

      const issues = await issuesFor(visitId);
      expect(issues).toContain('brands');
      expect(issues).not.toContain('doctors');
      expect(issues).not.toContain('doctor_feedback');
    });

    it('requires a follow-up date only when a follow-up is needed', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);

      await asSuperuser(
        'UPDATE public.visit SET follow_up_required = true, follow_up_date = NULL WHERE id = $1',
        [visitId],
      );
      expect(await issuesFor(visitId)).toContain('follow_up_date');

      await asSuperuser(
        `UPDATE public.visit SET follow_up_date = public.fn_local_date() + 14 WHERE id = $1`,
        [visitId],
      );
      expect(await issuesFor(visitId)).toEqual([]);
    });

    it('rejects a follow-up date in the past', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);
      await asSuperuser(
        `UPDATE public.visit
            SET follow_up_required = true, follow_up_date = public.fn_local_date() - 5
          WHERE id = $1`,
        [visitId],
      );

      const rows = await asSuperuser<{ field: string; issue: string }>(
        'SELECT * FROM public.fn_visit_completion_issues($1)',
        [visitId],
      );
      expect(rows).toContainEqual({ field: 'follow_up_date', issue: 'in_the_past' });
    });

    it('requires the check-out to have happened', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await asSuperuser(
        'UPDATE public.visit SET completed_at_server = NULL WHERE id = $1',
        [visitId],
      );
      expect(await issuesFor(visitId)).toContain('check_out');
    });
  });

  // ---------------------------------------------------------------------------
  describe('submitting the report', () => {
    it('ACCEPTANCE 8: completes a fully valid report', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);

      await actingAs(USERS.rep1, async (s) => {
        const [result] = await s.query<{ status: string; is_draft: boolean }>(
          'SELECT status, is_draft FROM public.fn_complete_visit($1)',
          [visitId],
        );
        expect(result.status).toBe('completed');
        expect(result.is_draft).toBe(false);
      });
    });

    it('refuses an incomplete report and says exactly what is missing', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await asSuperuser(
        "UPDATE public.visit SET meeting_status = 'doctor_met' WHERE id = $1",
        [visitId],
      );

      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_complete_visit($1)', [visitId]);
        expect(error.message).toMatch(/бүрэн бөглөгдөөгүй/i);
        expect(error.detail).toMatch(/doctor_feedback:required/);
        expect(error.detail).toMatch(/outcome:required/);
      });
    });

    it('refuses to complete someone else’s visit', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);

      await actingAs(USERS.rep2, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_complete_visit($1)', [visitId]);
        expect(error.message).toMatch(/хамааралгүй/i);
      });
    });

    it('is idempotent — submitting twice is harmless', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);

      await actingAs(USERS.rep1, async (s) => {
        await s.query('SELECT public.fn_complete_visit($1)', [visitId]);
        const [second] = await s.query<{ status: string }>(
          'SELECT status FROM public.fn_complete_visit($1)',
          [visitId],
        );
        expect(second.status).toBe('completed');
      });
    });

    it('creates a trackable follow-up when one is required', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);
      await asSuperuser(
        `UPDATE public.visit
            SET follow_up_required = true,
                follow_up_date = public.fn_local_date() + 21,
                next_action = 'Сорьц хүргэх'
          WHERE id = $1`,
        [visitId],
      );

      await actingAs(USERS.rep1, async (s) => {
        await s.query('SELECT public.fn_complete_visit($1)', [visitId]);

        const [followUp] = await s.query<{ description: string; status: string; due_date: string }>(
          'SELECT description, status, due_date FROM public.follow_up WHERE visit_id = $1',
          [visitId],
        );
        expect(followUp.description).toBe('Сорьц хүргэх');
        expect(followUp.status).toBe('open');
      });
    });

    it('marks the planned visit completed too', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);

      await actingAs(USERS.rep1, async (s) => {
        await s.query('SELECT public.fn_complete_visit($1)', [visitId]);
        const [pv] = await s.query<{ status: string }>(
          `SELECT pv.status FROM public.planned_visit pv
             JOIN public.visit v ON v.planned_visit_id = pv.id WHERE v.id = $1`,
          [visitId],
        );
        expect(pv.status).toBe('completed');
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('ACCEPTANCE 9: immutability after submission', () => {
    async function submittedVisit(): Promise<string> {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);
      await asSuperuser(
        "UPDATE public.visit SET status = 'completed', is_draft = false WHERE id = $1",
        [visitId],
      );
      return visitId;
    }

    it('the author cannot edit their own submitted report', async () => {
      const visitId = await submittedVisit();
      await actingAs(USERS.rep1, async (s) => {
        // RLS hides the row from the UPDATE (is_draft = false), so it affects
        // zero rows; the data is what matters.
        await s.query("UPDATE public.visit SET rep_summary = 'өөрчлөв' WHERE id = $1", [visitId]);
      });
      const [after] = await asSuperuser<{ rep_summary: string }>(
        'SELECT rep_summary FROM public.visit WHERE id = $1',
        [visitId],
      );
      expect(after.rep_summary).toBe('Товч танилцуулга хийв.');
    });

    it('not even the database owner can edit it — the trigger refuses', async () => {
      const visitId = await submittedVisit();
      await expect(
        asSuperuser("UPDATE public.visit SET outcome = 'not_interested' WHERE id = $1", [visitId]),
      ).rejects.toThrow(/completed visits are immutable/i);
    });

    it('a manager cannot edit it either', async () => {
      const visitId = await submittedVisit();
      // The UPDATE policy matches no row for a manager, so the statement
      // affects zero rows rather than raising. The data is the assertion.
      await actingAs(USERS.manager1, async (s) => {
        await s.query("UPDATE public.visit SET rep_summary = 'менежер' WHERE id = $1", [visitId]);
      });
      const [after] = await asSuperuser<{ rep_summary: string }>(
        'SELECT rep_summary FROM public.visit WHERE id = $1',
        [visitId],
      );
      expect(after.rep_summary).toBe('Товч танилцуулга хийв.');
    });
  });

  // ---------------------------------------------------------------------------
  describe('addenda — corrections that never overwrite', () => {
    async function submittedVisit(): Promise<string> {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);
      await asSuperuser(
        "UPDATE public.visit SET status = 'completed', is_draft = false WHERE id = $1",
        [visitId],
      );
      return visitId;
    }

    it('a manager can add a correction, and the original is untouched', async () => {
      const visitId = await submittedVisit();

      await actingAs(USERS.manager1, async (s) => {
        const [addendum] = await s.query<{ correction_text: string; author_email: string }>(
          'SELECT correction_text, author_email FROM public.fn_add_addendum($1, $2, $3)',
          [visitId, 'Уулзалт 40 биш 25 минут үргэлжилсэн.', 'Төлөөлөгчийн мэдээлэл буруу байсан'],
        );
        expect(addendum.correction_text).toMatch(/25 минут/);
        expect(addendum.author_email).toBe('manager01@monos.mn');
      });

      // The original still says what it always said.
      const [visit] = await asSuperuser<{ rep_summary: string }>(
        'SELECT rep_summary FROM public.visit WHERE id = $1',
        [visitId],
      );
      expect(visit.rep_summary).toBe('Товч танилцуулга хийв.');
    });

    it('a REPRESENTATIVE cannot add an addendum', async () => {
      const visitId = await submittedVisit();
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_add_addendum($1, $2, $3)', [
          visitId, 'засвар', 'шалтгаан',
        ]);
        expect(error.message).toMatch(/зөвхөн менежер/i);
      });
    });

    it('requires both the correction and a reason', async () => {
      const visitId = await submittedVisit();
      await actingAs(USERS.manager1, async (s) => {
        await s.expectDenied('SELECT public.fn_add_addendum($1, $2, $3)', [visitId, '', 'reason']);
        await s.expectDenied('SELECT public.fn_add_addendum($1, $2, $3)', [visitId, 'text', '  ']);
      });
    });

    it('cannot be added to an unsubmitted draft', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_add_addendum($1, $2, $3)', [
          visitId, 'засвар', 'шалтгаан',
        ]);
        expect(error.message).toMatch(/илгээгээгүй/i);
      });
    });

    it('an addendum itself can never be edited or deleted', async () => {
      const visitId = await submittedVisit();
      const [addendum] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit_addendum (visit_id, correction_text, reason, author_id)
         SELECT $1, 'тест', 'тест',
                (SELECT id FROM public.app_user WHERE email = 'manager01@monos.mn')
         RETURNING id`,
        [visitId],
      );

      await expect(
        asSuperuser("UPDATE public.visit_addendum SET correction_text = 'x' WHERE id = $1", [
          addendum.id,
        ]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        asSuperuser('DELETE FROM public.visit_addendum WHERE id = $1', [addendum.id]),
      ).rejects.toThrow(/append-only/i);
    });
  });

  // ---------------------------------------------------------------------------
  describe('ACCEPTANCE 10: shared doctor visit history', () => {
    it('another representative can read a colleague’s submitted visits', async () => {
      const [doctor] = await asSuperuser<{ doctor_id: string }>(
        `SELECT vd.doctor_id FROM public.visit_doctor vd
           JOIN public.visit v ON v.id = vd.visit_id
          WHERE v.is_draft = false
          GROUP BY vd.doctor_id
         HAVING count(*) > 1
          LIMIT 1`,
      );

      await actingAs(USERS.rep2, async (s) => {
        const rows = await s.query<{ rep_name: string; visit_date: string; brand_names: string[] }>(
          'SELECT * FROM public.fn_doctor_visit_history($1)',
          [doctor.doctor_id],
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].rep_name).toBeTruthy();
      });
    });

    it('returns visits in reverse date order', async () => {
      const [doctor] = await asSuperuser<{ doctor_id: string }>(
        `SELECT vd.doctor_id FROM public.visit_doctor vd
           JOIN public.visit v ON v.id = vd.visit_id
          WHERE v.is_draft = false
          GROUP BY vd.doctor_id HAVING count(*) > 2 LIMIT 1`,
      );

      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query<{ visit_date: string }>(
          'SELECT visit_date FROM public.fn_doctor_visit_history($1)',
          [doctor.doctor_id],
        );
        // node-postgres parses a `date` column into a JS Date. A bare
        // .sort() would compare them as "Wed Jul 15 2026…" strings, which is
        // not chronological — compare timestamps instead.
        const times = rows.map((r) => new Date(r.visit_date).getTime());
        expect(times).toEqual([...times].sort((a, b) => b - a));
      });
    });

    it('never includes an unsubmitted draft', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await asSuperuser(
        `INSERT INTO public.visit_doctor (visit_id, doctor_id)
         SELECT $1, dc.doctor_id FROM public.doctor_clinic dc
          WHERE dc.clinic_id = (SELECT id FROM public.clinic WHERE code = 'CL-001') LIMIT 1`,
        [visitId],
      );
      const [row] = await asSuperuser<{ doctor_id: string }>(
        'SELECT doctor_id FROM public.visit_doctor WHERE visit_id = $1',
        [visitId],
      );

      await actingAs(USERS.rep2, async (s) => {
        const rows = await s.query<{ visit_id: string }>(
          'SELECT visit_id FROM public.fn_doctor_visit_history($1)',
          [row.doctor_id],
        );
        expect(rows.map((r) => r.visit_id)).not.toContain(visitId);
      });
    });

    it('supports all five filters', async () => {
      const [doctor] = await asSuperuser<{ doctor_id: string }>(
        `SELECT vd.doctor_id FROM public.visit_doctor vd
           JOIN public.visit v ON v.id = vd.visit_id
          WHERE v.is_draft = false
          GROUP BY vd.doctor_id HAVING count(*) > 2 LIMIT 1`,
      );

      await actingAs(USERS.rep1, async (s) => {
        const all = await s.query<{ visit_id: string; rep_id: string; clinic_id: string; outcome: string }>(
          'SELECT * FROM public.fn_doctor_visit_history($1)',
          [doctor.doctor_id],
        );
        expect(all.length).toBeGreaterThan(1);

        // by representative
        const byRep = await s.query(
          'SELECT * FROM public.fn_doctor_visit_history($1, NULL, NULL, NULL, $2)',
          [doctor.doctor_id, all[0].rep_id],
        );
        expect(byRep.length).toBeGreaterThan(0);
        expect(byRep.every((r: any) => r.rep_id === all[0].rep_id)).toBe(true);

        // by clinic
        const byClinic = await s.query(
          'SELECT * FROM public.fn_doctor_visit_history($1, NULL, NULL, NULL, NULL, $2)',
          [doctor.doctor_id, all[0].clinic_id],
        );
        expect(byClinic.every((r: any) => r.clinic_id === all[0].clinic_id)).toBe(true);

        // by outcome
        const byOutcome = await s.query(
          'SELECT * FROM public.fn_doctor_visit_history($1, NULL, NULL, NULL, NULL, NULL, $2)',
          [doctor.doctor_id, all[0].outcome],
        );
        expect(byOutcome.every((r: any) => r.outcome === all[0].outcome)).toBe(true);

        // by date range — a window that excludes everything
        const byDate = await s.query(
          'SELECT * FROM public.fn_doctor_visit_history($1, $2::date, $3::date)',
          [doctor.doctor_id, '1990-01-01', '1990-12-31'],
        );
        expect(byDate).toHaveLength(0);

        // by brand
        const [brand] = await s.query<{ id: string }>(
          `SELECT b.id FROM public.brand b
             JOIN public.visit_brand vb ON vb.brand_id = b.id
            WHERE vb.visit_id = $1 LIMIT 1`,
          [all[0].visit_id],
        );
        if (brand) {
          const byBrand = await s.query(
            'SELECT * FROM public.fn_doctor_visit_history($1, NULL, NULL, $2)',
            [doctor.doctor_id, brand.id],
          );
          expect(byBrand.length).toBeGreaterThan(0);
        }
      });
    });

    it('reports how many corrections a visit carries', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);
      await asSuperuser(
        "UPDATE public.visit SET status = 'completed', is_draft = false WHERE id = $1",
        [visitId],
      );
      await asSuperuser(
        `INSERT INTO public.visit_addendum (visit_id, correction_text, reason, author_id)
         SELECT $1, 'залруулга', 'шалтгаан',
                (SELECT id FROM public.app_user WHERE email = 'manager01@monos.mn')`,
        [visitId],
      );

      const [doctorRow] = await asSuperuser<{ doctor_id: string }>(
        'SELECT doctor_id FROM public.visit_doctor WHERE visit_id = $1 LIMIT 1',
        [visitId],
      );

      await actingAs(USERS.rep2, async (s) => {
        const rows = await s.query<{ visit_id: string; addendum_count: number }>(
          'SELECT * FROM public.fn_doctor_visit_history($1)',
          [doctorRow.doctor_id],
        );
        const target = rows.find((r) => r.visit_id === visitId);
        expect(target?.addendum_count).toBe(1);
      });
    });

    it('returns nothing to an unprovisioned session, despite SECURITY DEFINER', async () => {
      // The function bypasses RLS by design, so it has to check the caller
      // itself — otherwise it would be a hole straight through the policies.
      const rows = await asSuperuser(
        `SELECT * FROM public.fn_doctor_visit_history(
           (SELECT doctor_id FROM public.visit_doctor LIMIT 1))`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('ACCEPTANCE 18: no patient information', () => {
    it('no visit table has a column that could hold patient data', async () => {
      const columns = await asSuperuser<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name LIKE 'visit%'`,
      );
      for (const forbidden of [
        'patient', 'diagnosis', 'treatment', 'prescription', 'medical_record', 'symptom',
      ]) {
        const hit = columns.find((c) => c.column_name.includes(forbidden));
        expect(hit, `unexpected column ${hit?.table_name}.${hit?.column_name}`).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('follow-ups', () => {
    it('the owning representative can close their own follow-up', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);
      await asSuperuser(
        `UPDATE public.visit
            SET follow_up_required = true, follow_up_date = public.fn_local_date() + 10
          WHERE id = $1`,
        [visitId],
      );

      await actingAs(USERS.rep1, async (s) => {
        await s.query('SELECT public.fn_complete_visit($1)', [visitId]);
        const [followUp] = await s.query<{ id: string }>(
          'SELECT id FROM public.follow_up WHERE visit_id = $1',
          [visitId],
        );

        const [done] = await s.query<{ status: string; completed_at: string }>(
          'SELECT status, completed_at FROM public.fn_complete_follow_up($1)',
          [followUp.id],
        );
        expect(done.status).toBe('done');
        expect(done.completed_at).toBeTruthy();
      });
    });

    it('another representative cannot close it', async () => {
      const visitId = await givenCheckedOutVisit(USERS.rep1);
      await fillFullReport(visitId);
      await asSuperuser(
        `UPDATE public.visit
            SET follow_up_required = true, follow_up_date = public.fn_local_date() + 10,
                status = 'completed', is_draft = false
          WHERE id = $1`,
        [visitId],
      );
      const [followUp] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.follow_up (visit_id, rep_id, due_date, description)
         SELECT id, rep_id, public.fn_local_date() + 10, 'тест'
           FROM public.visit WHERE id = $1
         RETURNING id`,
        [visitId],
      );

      await actingAs(USERS.rep2, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_complete_follow_up($1)', [
          followUp.id,
        ]);
        expect(error.message).toMatch(/хамааралгүй/i);
      });
    });
  });
});
