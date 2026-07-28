/**
 * Phase 3 — check-in, active visit, check-out.
 *
 * Acceptance criteria covered here:
 *   5.  A visit cannot normally start outside the clinic radius
 *   6.  A visit CAN start inside the clinic radius
 *   7.  Check-in time and location are saved
 *   9.  Completed visit records cannot be edited
 *   19. No continuous location tracking (only check-in/check-out rows exist)
 *
 * Plus duplicate-active-visit prevention and the anti-spoofing behaviour.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

/** Seed clinic CL-001 — a real Ulaanbaatar point with a 150 m radius. */
const CLINIC_CODE = 'CL-001';

async function clinicCoords(code = CLINIC_CODE) {
  const [row] = await asSuperuser<{ lat: number; lon: number; radius: number; id: string }>(
    `SELECT latitude::float8 AS lat, longitude::float8 AS lon,
            geofence_radius_m AS radius, id
       FROM public.clinic WHERE code = $1`,
    [code],
  );
  return row;
}

/**
 * Offset a coordinate by a number of metres due north. 1 degree of latitude is
 * ~111.32 km everywhere, which makes the maths exact enough for a geofence test.
 */
function metresNorth(lat: number, metres: number): number {
  return lat + metres / 111_320;
}

/**
 * Give a representative a fresh, startable planned visit for TODAY at the given
 * clinic, and return its id. Created as superuser so the test controls the
 * starting conditions precisely.
 *
 * It attaches a doctor and a brand as well. These rows are COMMITTED (they
 * outlive the per-test transaction), so they must look like data a real plan
 * builder would produce — a doctor-less visit would be invalid data that other
 * test files would then trip over.
 */
async function givenPlannedVisitToday(
  email: string,
  clinicCode = CLINIC_CODE,
): Promise<string> {
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
    [email, clinicCode],
  );

  const [row] = await asSuperuser<{ id: string }>(
    `WITH rep AS (SELECT id FROM public.app_user WHERE email = $1),
          wk  AS (SELECT (date_trunc('week', public.fn_local_date()::timestamp))::date AS monday),
          plan AS (
            SELECT wp.id
              FROM public.weekly_plan wp, rep, wk
             WHERE wp.rep_id = rep.id AND wp.week_start_date = wk.monday
          )
     INSERT INTO public.planned_visit
       (weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, objective)
     SELECT plan.id, rep.id,
            (SELECT id FROM public.clinic WHERE code = $2),
            public.fn_local_date(),
            -- planned_order is capped at 50 by constraint.
            (SELECT LEAST(COALESCE(max(planned_order), 0) + 1, 50)
               FROM public.planned_visit pv, rep
              WHERE pv.rep_id = rep.id AND pv.planned_date = public.fn_local_date()),
            'тестийн уулзалт'
       FROM plan, rep
     RETURNING id`,
    [email, clinicCode],
  );

  // A doctor who genuinely works at that clinic, and a brand the rep carries.
  // Prefer one not already booked by this rep here today, but always attach
  // SOMEONE — a doctorless planned visit is not data the app can produce.
  await asSuperuser(
    `INSERT INTO public.planned_visit_doctor (planned_visit_id, doctor_id)
     SELECT $1, dc.doctor_id
       FROM public.doctor_clinic dc
      WHERE dc.clinic_id = (SELECT clinic_id FROM public.planned_visit WHERE id = $1)
        AND dc.is_active
      ORDER BY EXISTS (
        SELECT 1 FROM public.planned_visit_doctor other_d
          JOIN public.planned_visit other ON other.id = other_d.planned_visit_id
         WHERE other_d.doctor_id = dc.doctor_id
           AND other.rep_id = (SELECT rep_id FROM public.planned_visit WHERE id = $1)
           AND other.clinic_id = (SELECT clinic_id FROM public.planned_visit WHERE id = $1)
           AND other.planned_date = (SELECT planned_date FROM public.planned_visit WHERE id = $1)
           AND other.status NOT IN ('cancelled_approved','cancelled_unapproved','rescheduled')
      ), dc.doctor_id
      LIMIT 1`,
    [row.id],
  );

  await asSuperuser(
    `INSERT INTO public.planned_visit_brand (planned_visit_id, brand_id)
     SELECT $1, a.brand_id
       FROM public.rep_brand_assignment a
      WHERE a.rep_id = (SELECT rep_id FROM public.planned_visit WHERE id = $1)
        AND a.is_active
      LIMIT 1`,
    [row.id],
  );

  return row.id;
}

/** Remove any in-progress visit so each test starts from a clean state. */
async function clearActiveVisits(): Promise<void> {
  // Visits cannot be deleted by design, so move them out of 'in_progress'
  // through the normal path instead: mark them missed.
  await asSuperuser(
    `UPDATE public.visit SET status = 'missed' WHERE status = 'in_progress'`,
  );
}

describe.skipIf(!DB_AVAILABLE)('check-in and check-out', () => {
  afterAll(closePool);
  beforeEach(clearActiveVisits);

  // ---------------------------------------------------------------------------
  describe('eligibility — the eight conditions', () => {
    it('allows a start when everything is right', async () => {
      const visitId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [e] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, $4)',
          [visitId, clinic.lat, clinic.lon, 10],
        );
        expect(e.can_start).toBe(true);
        expect(e.blocking_reason).toBeNull();
        expect(Number(e.distance_m)).toBeLessThan(1);
      });
    });

    it('refuses when the caller does not own the visit', async () => {
      const visitId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep2, async (s) => {
        const [e] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, $4)',
          [visitId, clinic.lat, clinic.lon, 10],
        );
        expect(e.can_start).toBe(false);
        expect(e.blocking_reason).toBe('not_owner');
      });
    });

    it('refuses a visit planned for another day', async () => {
      const clinic = await clinicCoords();
      const [tomorrow] = await asSuperuser<{ id: string }>(
        `WITH rep AS (SELECT id FROM public.app_user WHERE email = 'rep01@monos.mn')
         SELECT pv.id FROM public.planned_visit pv, rep
          WHERE pv.rep_id = rep.id
            AND pv.planned_date > public.fn_local_date()
            AND pv.status = 'planned'
          LIMIT 1`,
      );

      await actingAs(USERS.rep1, async (s) => {
        const [e] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, $4)',
          [tomorrow.id, clinic.lat, clinic.lon, 10],
        );
        expect(e.can_start).toBe(false);
        expect(e.blocking_reason).toBe('not_today');
      });
    });

    it('refuses when there is no location at all', async () => {
      const visitId = await givenPlannedVisitToday(USERS.rep1);

      await actingAs(USERS.rep1, async (s) => {
        const [e] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, NULL, NULL, NULL)',
          [visitId],
        );
        expect(e.can_start).toBe(false);
        expect(e.blocking_reason).toBe('no_location');
        expect(e.distance_m).toBeNull();
      });
    });

    it('treats an UNKNOWN accuracy as unacceptable, not as good', async () => {
      // An unknown error radius is not evidence of being anywhere in particular.
      const visitId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [e] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, NULL)',
          [visitId, clinic.lat, clinic.lon],
        );
        expect(e.can_start).toBe(false);
        expect(e.blocking_reason).toBe('poor_accuracy');
      });
    });

    it('refuses a fix less precise than the configured threshold', async () => {
      const visitId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [e] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, $4)',
          [visitId, clinic.lat, clinic.lon, 500],
        );
        expect(e.can_start).toBe(false);
        expect(e.blocking_reason).toBe('poor_accuracy');
        expect(Number(e.accuracy_threshold_m)).toBe(50);
      });
    });

    it('refuses when outside the clinic radius, and reports the real distance', async () => {
      const visitId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();
      const farLat = metresNorth(clinic.lat, 400); // radius is 150 m

      await actingAs(USERS.rep1, async (s) => {
        const [e] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, $4)',
          [visitId, farLat, clinic.lon, 10],
        );
        expect(e.can_start).toBe(false);
        expect(e.blocking_reason).toBe('outside_radius');
        expect(Number(e.distance_m)).toBeGreaterThan(390);
        expect(Number(e.distance_m)).toBeLessThan(410);
        expect(Number(e.radius_m)).toBe(150);
      });
    });

    it('allows a start just inside the boundary and refuses just outside it', async () => {
      const visitId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [inside] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, $4)',
          [visitId, metresNorth(clinic.lat, 140), clinic.lon, 10],
        );
        expect(inside.within_radius).toBe(true);

        const [outside] = await s.query<Record<string, unknown>>(
          'SELECT * FROM public.fn_visit_start_eligibility($1, $2, $3, $4)',
          [visitId, metresNorth(clinic.lat, 160), clinic.lon, 10],
        );
        expect(outside.within_radius).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('starting a visit', () => {
    it('ACCEPTANCE 6 & 7: starts inside the radius and saves time and location', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();
      const deviceTs = new Date().toISOString();

      await actingAs(USERS.rep1, async (s) => {
        const [visit] = await s.query<{
          id: string;
          status: string;
          started_at_server: string;
          visit_date: string;
          is_draft: boolean;
        }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4, $5::timestamptz, NULL, $6)',
          [plannedId, metresNorth(clinic.lat, 50), clinic.lon, 12, deviceTs, '0.1.0'],
        );

        expect(visit.status).toBe('in_progress');
        expect(visit.started_at_server).toBeTruthy();
        expect(visit.is_draft).toBe(true);

        const [event] = await s.query<{
          event_type: string;
          latitude: string;
          longitude: string;
          gps_accuracy_m: string;
          distance_from_clinic_m: string;
          clinic_radius_m_at_event: number;
          server_ts: string;
          device_ts: string;
        }>('SELECT * FROM public.visit_event WHERE visit_id = $1', [visit.id]);

        expect(event.event_type).toBe('check_in');
        expect(Number(event.gps_accuracy_m)).toBe(12);
        expect(Number(event.distance_from_clinic_m)).toBeGreaterThan(45);
        expect(Number(event.distance_from_clinic_m)).toBeLessThan(55);
        expect(event.clinic_radius_m_at_event).toBe(150);
        expect(event.server_ts).toBeTruthy();
        expect(event.device_ts).toBeTruthy();

        // The planned visit follows along.
        const [pv] = await s.query<{ status: string }>(
          'SELECT status FROM public.planned_visit WHERE id = $1',
          [plannedId],
        );
        expect(pv.status).toBe('in_progress');
      });
    });

    it('ACCEPTANCE 5: refuses to start outside the radius, in Mongolian, with numbers', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          'SELECT public.fn_start_visit($1, $2, $3, $4)',
          [plannedId, metresNorth(clinic.lat, 400), clinic.lon, 10],
        );
        expect(error.message).toMatch(/эмнэлгээс/i);
        expect(error.message).toMatch(/400|39\d|40\d/);
        expect(error.message).toMatch(/150/);
        expect(error.detail).toBe('outside_radius');
      });
    });

    it('IGNORES a distance the client tries to supply — it recomputes its own', async () => {
      // fn_start_visit takes no distance parameter at all, by design. The only
      // way to influence the stored distance is to move.
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [visit] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4)',
          [plannedId, metresNorth(clinic.lat, 100), clinic.lon, 10],
        );
        const [event] = await s.query<{ distance_from_clinic_m: string }>(
          'SELECT distance_from_clinic_m FROM public.visit_event WHERE visit_id = $1',
          [visit.id],
        );
        // ~100 m, computed by the server from the coordinates alone.
        expect(Number(event.distance_from_clinic_m)).toBeGreaterThan(95);
        expect(Number(event.distance_from_clinic_m)).toBeLessThan(105);
      });
    });

    it('prevents a SECOND visit while one is in progress', async () => {
      const first = await givenPlannedVisitToday(USERS.rep1);
      const second = await givenPlannedVisitToday(USERS.rep1, 'CL-003');
      const clinic = await clinicCoords();
      const clinic3 = await clinicCoords('CL-003');

      await actingAs(USERS.rep1, async (s) => {
        await s.query('SELECT public.fn_start_visit($1, $2, $3, $4)', [
          first, clinic.lat, clinic.lon, 10,
        ]);

        const error = await s.expectDenied('SELECT public.fn_start_visit($1, $2, $3, $4)', [
          second, clinic3.lat, clinic3.lon, 10,
        ]);
        expect(error.message).toMatch(/үргэлжилж буй өөр уулзалт/i);
      });
    });

    it('is idempotent: replaying the same client_uuid returns the same visit', async () => {
      // This is what makes the Phase 7 offline queue safe to retry.
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [clientUuid] = await s.query<{ u: string }>('SELECT gen_random_uuid() AS u');

        const [first] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4, NULL, $5)',
          [plannedId, clinic.lat, clinic.lon, 10, clientUuid.u],
        );
        const [again] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4, NULL, $5)',
          [plannedId, clinic.lat, clinic.lon, 10, clientUuid.u],
        );

        expect(again.id).toBe(first.id);

        const events = await s.query('SELECT * FROM public.visit_event WHERE visit_id = $1', [
          first.id,
        ]);
        expect(events).toHaveLength(1);
      });
    });

    it('records a mocked-location flag rather than silently trusting it', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [visit] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4, NULL, NULL, NULL, true)',
          [plannedId, clinic.lat, clinic.lon, 10],
        );
        const [event] = await s.query<{ is_mocked_location: boolean }>(
          'SELECT is_mocked_location FROM public.visit_event WHERE visit_id = $1',
          [visit.id],
        );
        expect(event.is_mocked_location).toBe(true);
      });
    });

    it('records device/server clock drift for later review', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();
      const skewed = new Date(Date.now() + 45 * 60_000).toISOString(); // 45 min fast

      await actingAs(USERS.rep1, async (s) => {
        const [visit] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4, $5::timestamptz)',
          [plannedId, clinic.lat, clinic.lon, 10, skewed],
        );
        const [event] = await s.query<{ clock_drift_seconds: number }>(
          'SELECT clock_drift_seconds FROM public.visit_event WHERE visit_id = $1',
          [visit.id],
        );
        expect(event.clock_drift_seconds).toBeGreaterThan(2600);
      });
    });

    it('a REPRESENTATIVE cannot INSERT a visit directly, bypassing the check', async () => {
      // The whole geofence is worthless if a client can write the row itself.
      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.visit (rep_id, clinic_id, visit_date, started_at_server)
           VALUES (public.fn_current_app_user_id(),
                   (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                   public.fn_local_date(), now())`,
        );
      });
    });

    it('a REPRESENTATIVE cannot INSERT a visit_event directly', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.visit_event
             (visit_id, event_type, latitude, longitude, distance_from_clinic_m,
              clinic_radius_m_at_event, clinic_id, app_user_id)
           VALUES (gen_random_uuid(), 'check_in', 47.9, 106.9, 0, 150,
                   (SELECT id FROM public.clinic WHERE code = 'CL-001'),
                   public.fn_current_app_user_id())`,
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('checking out', () => {
    it('records the check-out event and fixes the duration', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [started] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4)',
          [plannedId, clinic.lat, clinic.lon, 10],
        );

        const [out] = await s.query<{
          completed_at_server: string;
          duration_seconds: number;
          status: string;
        }>('SELECT * FROM public.fn_check_out($1, $2, $3, $4)', [
          started.id, clinic.lat, clinic.lon, 15,
        ]);

        expect(out.completed_at_server).toBeTruthy();
        expect(out.duration_seconds).toBeGreaterThanOrEqual(0);
        // Deliberately still in progress: documentation comes in Phase 4.
        expect(out.status).toBe('in_progress');

        const events = await s.query<{ event_type: string }>(
          'SELECT event_type FROM public.visit_event WHERE visit_id = $1 ORDER BY event_type',
          [started.id],
        );
        expect(events.map((e) => e.event_type)).toEqual(['check_in', 'check_out']);
      });
    });

    it('ALLOWS a check-out from outside the radius, but flags it', async () => {
      // A representative may already be walking to the car. Refusing would
      // leave the visit open for ever; flagging keeps it visible instead.
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [started] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4)',
          [plannedId, clinic.lat, clinic.lon, 10],
        );

        await s.query('SELECT public.fn_check_out($1, $2, $3, $4)', [
          started.id, metresNorth(clinic.lat, 800), clinic.lon, 20,
        ]);

        const [event] = await s.query<{ outside_geofence: boolean; distance_from_clinic_m: string }>(
          `SELECT outside_geofence, distance_from_clinic_m FROM public.visit_event
            WHERE visit_id = $1 AND event_type = 'check_out'`,
          [started.id],
        );
        expect(event.outside_geofence).toBe(true);
        expect(Number(event.distance_from_clinic_m)).toBeGreaterThan(700);
      });
    });

    it('refuses to check out of someone else’s visit', async () => {
      // Committed outside a test transaction so a different user can see it.
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      const [visit] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit (planned_visit_id, rep_id, clinic_id, visit_date, status, started_at_server)
         SELECT $1, rep_id, clinic_id, public.fn_local_date(), 'in_progress', now()
           FROM public.planned_visit WHERE id = $1
         RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.rep2, async (s) => {
        const error = await s.expectDenied('SELECT public.fn_check_out($1, $2, $3, $4)', [
          visit.id, clinic.lat, clinic.lon, 10,
        ]);
        expect(error.message).toMatch(/хамааралгүй/i);
      });
    });

    it('is idempotent: a replayed check-out does not create a second event', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [started] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4)',
          [plannedId, clinic.lat, clinic.lon, 10],
        );
        await s.query('SELECT public.fn_check_out($1, $2, $3, $4)', [
          started.id, clinic.lat, clinic.lon, 10,
        ]);
        await s.query('SELECT public.fn_check_out($1, $2, $3, $4)', [
          started.id, clinic.lat, clinic.lon, 10,
        ]);

        const events = await s.query(
          `SELECT 1 FROM public.visit_event WHERE visit_id = $1 AND event_type = 'check_out'`,
          [started.id],
        );
        expect(events).toHaveLength(1);
      });
    });

    it('requires a location to check out', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [started] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4)',
          [plannedId, clinic.lat, clinic.lon, 10],
        );
        const error = await s.expectDenied(
          'SELECT public.fn_check_out($1, NULL, NULL)',
          [started.id],
        );
        expect(error.message).toMatch(/байршил шаардлагатай/i);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('immutability', () => {
    async function committedVisit(): Promise<string> {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const [visit] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit (planned_visit_id, rep_id, clinic_id, visit_date, status, started_at_server)
         SELECT $1, rep_id, clinic_id, public.fn_local_date(), 'in_progress', now()
           FROM public.planned_visit WHERE id = $1
         RETURNING id`,
        [plannedId],
      );
      return visit.id;
    }

    it('check-in facts can never be rewritten, even by the owner', async () => {
      const visitId = await committedVisit();

      await expect(
        asSuperuser(
          "UPDATE public.visit SET started_at_server = now() - interval '3 hours' WHERE id = $1",
          [visitId],
        ),
      ).rejects.toThrow(/check-in facts of a visit cannot be changed/i);

      await expect(
        asSuperuser('UPDATE public.visit SET clinic_id = clinic_id, rep_id = gen_random_uuid() WHERE id = $1', [
          visitId,
        ]),
      ).rejects.toThrow(/check-in facts/i);
    });

    it('ACCEPTANCE 9: a completed, submitted visit is frozen', async () => {
      const visitId = await committedVisit();
      await asSuperuser(
        `UPDATE public.visit
            SET completed_at_server = now(), status = 'completed', is_draft = false
          WHERE id = $1`,
        [visitId],
      );

      await expect(
        asSuperuser("UPDATE public.visit SET rep_summary = 'rewritten' WHERE id = $1", [visitId]),
      ).rejects.toThrow(/completed visits are immutable/i);
    });

    it('a visit can never be deleted, by anyone', async () => {
      const visitId = await committedVisit();
      await expect(
        asSuperuser('DELETE FROM public.visit WHERE id = $1', [visitId]),
      ).rejects.toThrow(/visits are never deleted/i);
    });

    it('a visit_event can never be altered or removed', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      const [visit] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit (planned_visit_id, rep_id, clinic_id, visit_date, status, started_at_server)
         SELECT $1, rep_id, clinic_id, public.fn_local_date(), 'in_progress', now()
           FROM public.planned_visit WHERE id = $1 RETURNING id`,
        [plannedId],
      );
      await asSuperuser(
        `INSERT INTO public.visit_event
           (visit_id, event_type, latitude, longitude, distance_from_clinic_m,
            clinic_radius_m_at_event, clinic_id, app_user_id)
         SELECT $1, 'check_in', $2, $3, 10, 150, v.clinic_id, v.rep_id
           FROM public.visit v WHERE v.id = $1`,
        [visit.id, clinic.lat, clinic.lon],
      );

      await expect(
        asSuperuser('UPDATE public.visit_event SET latitude = 0.5 WHERE visit_id = $1', [visit.id]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        asSuperuser('DELETE FROM public.visit_event WHERE visit_id = $1', [visit.id]),
      ).rejects.toThrow(/append-only/i);
    });
  });

  // ---------------------------------------------------------------------------
  describe('visibility', () => {
    it('ACCEPTANCE 18: another rep cannot see an unsubmitted draft', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const [visit] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit (planned_visit_id, rep_id, clinic_id, visit_date, status, started_at_server, is_draft)
         SELECT $1, rep_id, clinic_id, public.fn_local_date(), 'in_progress', now(), true
           FROM public.planned_visit WHERE id = $1 RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.rep2, async (s) => {
        await s.expectInvisible('SELECT * FROM public.visit WHERE id = $1', [visit.id]);
      });
    });

    it('ACCEPTANCE 10: another rep CAN read a submitted visit', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const [visit] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit (planned_visit_id, rep_id, clinic_id, visit_date, status,
                                   started_at_server, completed_at_server, is_draft)
         SELECT $1, rep_id, clinic_id, public.fn_local_date(), 'completed', now(), now(), false
           FROM public.planned_visit WHERE id = $1 RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.rep2, async (s) => {
        const rows = await s.query('SELECT * FROM public.visit WHERE id = $1', [visit.id]);
        expect(rows).toHaveLength(1);
      });
    });

    it('a manager sees everything, including drafts', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const [visit] = await asSuperuser<{ id: string }>(
        `INSERT INTO public.visit (planned_visit_id, rep_id, clinic_id, visit_date, status, started_at_server, is_draft)
         SELECT $1, rep_id, clinic_id, public.fn_local_date(), 'in_progress', now(), true
           FROM public.planned_visit WHERE id = $1 RETURNING id`,
        [plannedId],
      );

      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query('SELECT * FROM public.visit WHERE id = $1', [visit.id]);
        expect(rows).toHaveLength(1);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('ACCEPTANCE 19: no continuous tracking', () => {
    it('stores location ONLY in check-in and check-out events', async () => {
      // If a future change ever adds a location column somewhere else, this
      // fails and forces the conversation.
      const rows = await asSuperuser<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (column_name IN ('latitude', 'longitude')
                 OR column_name LIKE '%_latitude' OR column_name LIKE '%_longitude')
          ORDER BY table_name, column_name`,
      );

      const tables = [...new Set(rows.map((r) => r.table_name))].sort();
      // clinic  — the fixed location of a building, not a person.
      // visit_event — check-in and check-out only.
      expect(tables).toEqual(['clinic', 'visit_event']);
    });

    it('produces exactly two location rows per completed visit — no trail', async () => {
      const plannedId = await givenPlannedVisitToday(USERS.rep1);
      const clinic = await clinicCoords();

      await actingAs(USERS.rep1, async (s) => {
        const [started] = await s.query<{ id: string }>(
          'SELECT * FROM public.fn_start_visit($1, $2, $3, $4)',
          [plannedId, clinic.lat, clinic.lon, 10],
        );
        await s.query('SELECT public.fn_check_out($1, $2, $3, $4)', [
          started.id, clinic.lat, clinic.lon, 10,
        ]);

        const [{ count }] = await s.query<{ count: string }>(
          'SELECT count(*) AS count FROM public.visit_event WHERE visit_id = $1',
          [started.id],
        );
        expect(Number(count)).toBe(2);
      });
    });
  });
});
