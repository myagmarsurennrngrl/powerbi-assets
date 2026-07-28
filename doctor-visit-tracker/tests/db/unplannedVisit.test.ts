/**
 * Unplanned visits (migration 0024).
 *
 * The point of these tests is that "unplanned" relaxes the PLAN rules and
 * nothing else. Every location rule that protects a planned check-in must still
 * hold, and the KPI denominator must stay untouched — otherwise the way to a
 * perfect score would be to plan two visits and walk into twenty.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

/** A point inside CL-001's geofence, and one far outside it. */
async function clinicFixture() {
  const [clinic] = await asSuperuser<{
    id: string;
    latitude: string;
    longitude: string;
    geofence_radius_m: number;
  }>(
    `SELECT id, latitude, longitude, geofence_radius_m
     FROM public.clinic WHERE code = 'CL-001'`,
  );
  return {
    id: clinic.id,
    lat: Number(clinic.latitude),
    lon: Number(clinic.longitude),
    radius: clinic.geofence_radius_m,
  };
}

/** Clear the seed's in-progress state for a rep inside the test transaction. */
const NO_OPEN_VISIT = `
  SELECT 1 FROM public.visit v
  JOIN public.app_user u ON u.id = v.rep_id
  WHERE u.email = $1 AND v.status = 'in_progress'`;

describe.skipIf(!DB_AVAILABLE)('unplanned visits', () => {
  afterAll(closePool);

  // ===========================================================================
  describe('eligibility', () => {
    it('a representative standing at the clinic can start', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility($1, $2, $3, 10)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(row.can_start).toBe(true);
        expect(Number(row.distance_m)).toBeLessThan(5);
        expect(row.blocking_reason).toBeNull();
      });
    });

    it('refuses a location outside the clinic radius', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        // ~0.05° of latitude is roughly 5.5 km.
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility($1, $2, $3, 10)`,
          [clinic.id, clinic.lat + 0.05, clinic.lon],
        );
        expect(row.can_start).toBe(false);
        expect(row.blocking_reason).toBe('outside_radius');
        expect(Number(row.distance_m)).toBeGreaterThan(clinic.radius);
      });
    });

    it('refuses a GPS fix too imprecise to mean anything', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility($1, $2, $3, 500)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(row.can_start).toBe(false);
        expect(row.blocking_reason).toBe('poor_accuracy');
      });
    });

    it('treats an unknown accuracy as unacceptable, not as good', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility($1, $2, $3, NULL)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(row.accuracy_ok).toBe(false);
        expect(row.can_start).toBe(false);
      });
    });

    it('refuses with no location at all', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility($1, NULL, NULL, NULL)`,
          [clinic.id],
        );
        expect(row.blocking_reason).toBe('no_location');
      });
    });

    it('refuses a manager — recording visits is the representative’s job', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.manager1, async (s) => {
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility($1, $2, $3, 10)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(row.can_start).toBe(false);
        expect(row.blocking_reason).toBe('not_representative');
      });
    });

    it('warns — but does not block — when today’s plan already has this clinic', async () => {
      // Any representative with a stop on today's route will do; the seed has
      // planned visits for the current date.
      const planned = await asSuperuser<{
        email: string;
        clinic_id: string;
        latitude: string;
        longitude: string;
      }>(
        `SELECT u.email, c.id AS clinic_id, c.latitude, c.longitude
         FROM public.planned_visit pv
         JOIN public.app_user u ON u.id = pv.rep_id
         JOIN public.clinic c   ON c.id = pv.clinic_id
         WHERE pv.planned_date = CURRENT_DATE AND pv.status = 'planned'
         LIMIT 1`,
      );
      if (planned.length === 0) return; // no route today in the seed; nothing to assert

      const row0 = planned[0];
      await actingAs(row0.email, async (s) => {
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility($1, $2, $3, 10)`,
          [row0.clinic_id, Number(row0.latitude), Number(row0.longitude)],
        );
        // The warning is advisory: an unplanned visit here would leave the
        // planned one looking missed, which the screen says out loud.
        expect(row.already_planned_here).toBe(true);
        expect(row.can_start).toBe(true);
        expect(row.blocking_reason).toBeNull();
      });
    });

    it('reports an unknown clinic rather than throwing', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const [row] = await s.query(
          `SELECT * FROM public.fn_unplanned_start_eligibility(
             '00000000-0000-0000-0000-000000000000'::uuid, 47.9, 106.9, 10)`,
        );
        expect(row.blocking_reason).toBe('not_found');
      });
    });
  });

  // ===========================================================================
  describe('starting one', () => {
    it('creates a visit with no planned_visit_id and the reason as its objective', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [visit] = await s.query(
          `SELECT * FROM public.fn_start_unplanned_visit($1, 'Эмчтэй санамсаргүй уулзсан', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(visit.planned_visit_id).toBeNull();
        expect(visit.status).toBe('in_progress');
        expect(visit.is_draft).toBe(true);
        expect(visit.objective).toBe('Эмчтэй санамсаргүй уулзсан');
        expect(visit.clinic_id).toBe(clinic.id);
      });
    });

    it('records a check-in event with the SERVER-computed distance', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [visit] = await s.query(
          `SELECT * FROM public.fn_start_unplanned_visit($1, 'шалтгаан', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        const [event] = await s.query(
          `SELECT * FROM public.visit_event WHERE visit_id = $1 AND event_type = 'check_in'`,
          [visit.id],
        );
        expect(event.planned_visit_id).toBeNull();
        expect(Number(event.distance_from_clinic_m)).toBeLessThan(5);
        expect(event.clinic_radius_m_at_event).toBe(clinic.radius);
      });
    });

    it('REQUIRES a reason', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_start_unplanned_visit($1, '   ', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(error.message).toMatch(/шалтгаан/);
      });
    });

    it('REFUSES from outside the radius, with the distance in the message', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_start_unplanned_visit($1, 'шалтгаан', $2, $3, 12)`,
          [clinic.id, clinic.lat + 0.05, clinic.lon],
        );
        expect(error.message).toMatch(/зайд байна/);
      });
    });

    it('refuses a second visit while one is already running', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        await s.query(
          `SELECT public.fn_start_unplanned_visit($1, 'нэг дэх', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        const error = await s.expectDenied(
          `SELECT public.fn_start_unplanned_visit($1, 'хоёр дахь', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(error.message).toMatch(/үргэлжилж буй/);
      });
    });

    it('is idempotent on client_uuid — a replayed request returns the same visit', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [first] = await s.query(
          `SELECT * FROM public.fn_start_unplanned_visit(
             $1, 'шалтгаан', $2, $3, 12, NULL,
             '11111111-1111-1111-1111-111111111111'::uuid)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        const [second] = await s.query(
          `SELECT * FROM public.fn_start_unplanned_visit(
             $1, 'шалтгаан', $2, $3, 12, NULL,
             '11111111-1111-1111-1111-111111111111'::uuid)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(second.id).toBe(first.id);

        const events = await s.query(
          `SELECT 1 FROM public.visit_event WHERE visit_id = $1 AND event_type = 'check_in'`,
          [first.id],
        );
        expect(events).toHaveLength(1);
      });
    });

    it('a manager cannot start one', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_start_unplanned_visit($1, 'шалтгаан', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        expect(error.message).toMatch(/төлөөлөгч/);
      });
    });

    it('is audited as an unplanned visit', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const [visit] = await s.query(
          `SELECT * FROM public.fn_start_unplanned_visit($1, 'шалтгаан', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );
        // A representative cannot read audit_log — that is the design. Step out
        // of the application role inside the same transaction to inspect it.
        await s.query('RESET ROLE');
        const [entry] = await s.query(
          `SELECT after_data, note FROM public.audit_log
           WHERE action = 'visit_started' AND entity_id = $1`,
          [visit.id],
        );
        await s.query('SET LOCAL ROLE authenticated');

        expect(entry.after_data.unplanned).toBe(true);
        expect(entry.after_data.planned_visit_id).toBeNull();
        expect(entry.note).toBe('unplanned visit');
      });
    });
  });

  // ===========================================================================
  describe('the KPI is not affected', () => {
    it('an unplanned visit is counted separately and never in the denominator', async () => {
      const clinic = await clinicFixture();
      const [{ id: repId }] = await asSuperuser<{ id: string }>(
        'SELECT id FROM public.app_user WHERE email = $1',
        [USERS.rep1],
      );

      await actingAs(USERS.rep1, async (s) => {
        const week = `(date_trunc('week', CURRENT_DATE)::date)`;
        const [before] = await s.query(
          `SELECT * FROM public.fn_kpi_for_rep($1, ${week}, ${week} + 6)`,
          [repId],
        );

        await s.query(
          `SELECT public.fn_start_unplanned_visit($1, 'шалтгаан', $2, $3, 12)`,
          [clinic.id, clinic.lat, clinic.lon],
        );

        const [after] = await s.query(
          `SELECT * FROM public.fn_kpi_for_rep($1, ${week}, ${week} + 6)`,
          [repId],
        );

        expect(after.eligible_visits).toBe(before.eligible_visits);
        expect(after.completed_visits).toBe(before.completed_visits);
      });
    });
  });

  // ===========================================================================
  describe('nearby clinics', () => {
    it('returns clinics sorted by distance, nearest first', async () => {
      const clinic = await clinicFixture();
      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query(`SELECT * FROM public.fn_nearby_clinics($1, $2, 5)`, [
          clinic.lat,
          clinic.lon,
        ]);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].clinic_id).toBe(clinic.id);
        expect(rows[0].within_radius).toBe(true);

        const distances = rows.map((r: any) => Number(r.distance_m));
        expect([...distances].sort((a, b) => a - b)).toEqual(distances);
      });
    });

    it('returns nothing without a location', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectInvisible(`SELECT * FROM public.fn_nearby_clinics(NULL, NULL, 5)`);
      });
    });

    it('returns nothing to an unauthenticated caller', async () => {
      const clinic = await clinicFixture();
      const rows = await asSuperuser(
        `SELECT * FROM public.fn_nearby_clinics($1, $2, 5)`,
        [clinic.lat, clinic.lon],
      );
      // No signed-in user, so fn_current_app_user_id() is NULL and the guard in
      // the function body excludes every row.
      expect(rows).toHaveLength(0);
    });
  });
});
