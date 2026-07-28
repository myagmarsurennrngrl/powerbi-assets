/**
 * The eight start conditions, as pure logic.
 *
 * The final block is the one that matters most: it runs the SAME scenarios
 * through the TypeScript implementation and the SQL implementation and asserts
 * they agree. If they ever drift, a representative could see an enabled button
 * and then be refused — or, worse, see a disabled button while standing inside
 * the clinic. Either destroys trust in the app faster than any bug.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  canRequestException,
  evaluateStartEligibility,
  type EligibilityInput,
} from '../../src/domain/visitEligibility';
import { asSuperuser, closePool, DB_AVAILABLE } from '../db/helpers';

const CLINIC = { latitude: 47.9187, longitude: 106.9172 };

/** Offset a latitude by a number of metres due north. */
const north = (metres: number) => CLINIC.latitude + metres / 111_320;

const base = (overrides: Partial<EligibilityInput> = {}): EligibilityInput => ({
  isOwner: true,
  plannedDate: '2026-07-27',
  today: '2026-07-27',
  status: 'planned',
  hasOtherVisitInProgress: false,
  position: { latitude: CLINIC.latitude, longitude: CLINIC.longitude, accuracyM: 10 },
  clinic: CLINIC,
  clinicRadiusM: 150,
  accuracyThresholdM: 50,
  ...overrides,
});

describe('start eligibility', () => {
  it('allows a start when all eight conditions hold', () => {
    const result = evaluateStartEligibility(base());
    expect(result.canStart).toBe(true);
    expect(result.blockingReason).toBeNull();
    expect(result.distanceM).toBeCloseTo(0, 1);
  });

  it('blocks a visit the caller does not own', () => {
    const result = evaluateStartEligibility(base({ isOwner: false }));
    expect(result.canStart).toBe(false);
    expect(result.blockingReason).toBe('not_owner');
  });

  it('blocks a visit planned for another day', () => {
    expect(evaluateStartEligibility(base({ plannedDate: '2026-07-28' })).blockingReason).toBe(
      'not_today',
    );
    expect(evaluateStartEligibility(base({ plannedDate: '2026-07-26' })).blockingReason).toBe(
      'not_today',
    );
  });

  it('blocks a visit that is not in planned status', () => {
    for (const status of ['in_progress', 'completed', 'missed', 'cancelled_approved']) {
      expect(evaluateStartEligibility(base({ status })).blockingReason).toBe('wrong_status');
    }
  });

  it('blocks a second visit while another is running', () => {
    const result = evaluateStartEligibility(base({ hasOtherVisitInProgress: true }));
    expect(result.canStart).toBe(false);
    expect(result.blockingReason).toBe('other_visit_in_progress');
  });

  it('blocks when there is no position at all', () => {
    const result = evaluateStartEligibility(base({ position: null }));
    expect(result.blockingReason).toBe('no_location');
    expect(result.distanceM).toBeNull();
  });

  it('blocks a null-island reading', () => {
    const result = evaluateStartEligibility(
      base({ position: { latitude: 0, longitude: 0, accuracyM: 5 } }),
    );
    expect(result.blockingReason).toBe('no_location');
  });

  it('treats UNKNOWN accuracy as unacceptable', () => {
    const result = evaluateStartEligibility(
      base({ position: { ...CLINIC, accuracyM: null } }),
    );
    expect(result.canStart).toBe(false);
    expect(result.blockingReason).toBe('poor_accuracy');
  });

  it('blocks a fix less precise than the threshold', () => {
    expect(
      evaluateStartEligibility(base({ position: { ...CLINIC, accuracyM: 51 } })).blockingReason,
    ).toBe('poor_accuracy');
    // Exactly at the threshold is acceptable.
    expect(
      evaluateStartEligibility(base({ position: { ...CLINIC, accuracyM: 50 } })).canStart,
    ).toBe(true);
  });

  it('blocks a position outside the clinic radius', () => {
    const result = evaluateStartEligibility(
      base({ position: { latitude: north(400), longitude: CLINIC.longitude, accuracyM: 10 } }),
    );
    expect(result.canStart).toBe(false);
    expect(result.blockingReason).toBe('outside_radius');
    expect(result.distanceM).toBeGreaterThan(390);
    expect(result.distanceM).toBeLessThan(410);
  });

  it('respects a per-clinic radius rather than a fixed 150 m', () => {
    const position = { latitude: north(250), longitude: CLINIC.longitude, accuracyM: 10 };
    expect(evaluateStartEligibility(base({ position, clinicRadiusM: 150 })).canStart).toBe(false);
    // A large hospital campus configured at 300 m.
    expect(evaluateStartEligibility(base({ position, clinicRadiusM: 300 })).canStart).toBe(true);
  });

  it('reports reasons in a stable order of usefulness', () => {
    // Everything wrong at once: ownership is the most fundamental failure and
    // must be reported first, or the user chases the wrong problem.
    const result = evaluateStartEligibility(
      base({
        isOwner: false,
        status: 'completed',
        plannedDate: '2026-01-01',
        hasOtherVisitInProgress: true,
        position: null,
      }),
    );
    expect(result.blockingReason).toBe('not_owner');
  });
});

describe('when an exception is the right next step', () => {
  it('offers one for a location problem — the visit may still be genuine', () => {
    for (const reason of ['outside_radius', 'poor_accuracy', 'no_location'] as const) {
      expect(canRequestException({ blockingReason: reason } as never)).toBe(true);
    }
  });

  it('does NOT offer one for a problem an exception cannot fix', () => {
    for (const reason of ['not_owner', 'not_today', 'wrong_status', 'other_visit_in_progress'] as const) {
      expect(canRequestException({ blockingReason: reason } as never)).toBe(false);
    }
  });
});

/**
 * Parity: the button the representative sees must agree with the verdict the
 * server will reach.
 */
describe.skipIf(!DB_AVAILABLE)('TypeScript and SQL agree on eligibility', () => {
  afterAll(closePool);

  it('reaches the same verdict for every geofence scenario', async () => {
    const [clinic] = await asSuperuser<{ lat: number; lon: number; radius: number }>(
      `SELECT latitude::float8 AS lat, longitude::float8 AS lon, geofence_radius_m AS radius
         FROM public.clinic WHERE code = 'CL-001'`,
    );

    const scenarios = [
      { label: 'at the clinic', metres: 0, accuracy: 10 },
      { label: 'just inside', metres: 140, accuracy: 10 },
      { label: 'just outside', metres: 160, accuracy: 10 },
      { label: 'far away', metres: 900, accuracy: 10 },
      { label: 'poor accuracy', metres: 0, accuracy: 120 },
      { label: 'accuracy exactly at threshold', metres: 0, accuracy: 50 },
    ];

    for (const scenario of scenarios) {
      const latitude = clinic.lat + scenario.metres / 111_320;

      // The SQL side, using the same helper the server uses at check-in.
      const [sql] = await asSuperuser<{ distance: number }>(
        'SELECT public.fn_haversine_metres($1, $2, $3, $4) AS distance',
        [latitude, clinic.lon, clinic.lat, clinic.lon],
      );

      const ts = evaluateStartEligibility(
        base({
          clinic: { latitude: clinic.lat, longitude: clinic.lon },
          clinicRadiusM: clinic.radius,
          position: { latitude, longitude: clinic.lon, accuracyM: scenario.accuracy },
        }),
      );

      // Same distance...
      expect(Number(sql.distance), scenario.label).toBeCloseTo(ts.distanceM!, 2);

      // ...and therefore the same verdict on the radius.
      const sqlWithinRadius = Number(sql.distance) <= clinic.radius;
      expect(ts.withinRadius, scenario.label).toBe(sqlWithinRadius);
    }
  });

  it('agrees with fn_visit_start_eligibility on a real planned visit', async () => {
    const [clinic] = await asSuperuser<{ lat: number; lon: number; radius: number }>(
      `SELECT latitude::float8 AS lat, longitude::float8 AS lon, geofence_radius_m AS radius
         FROM public.clinic WHERE code = 'CL-001'`,
    );

    // Compare against the real SQL entry point, not just the distance helper.
    for (const metres of [0, 100, 200, 500]) {
      const latitude = clinic.lat + metres / 111_320;

      // The planned visit MUST be one at CL-001, otherwise the SQL function
      // measures against a different clinic and the comparison is meaningless.
      const [sql] = await asSuperuser<{
        within_radius: boolean;
        distance_m: string;
        accuracy_threshold_m: number;
      }>(
        `SELECT * FROM public.fn_visit_start_eligibility(
           (SELECT pv.id FROM public.planned_visit pv
              JOIN public.clinic c ON c.id = pv.clinic_id
             WHERE c.code = 'CL-001' LIMIT 1),
           $1, $2, 10)`,
        [latitude, clinic.lon],
      );

      const ts = evaluateStartEligibility(
        base({
          clinic: { latitude: clinic.lat, longitude: clinic.lon },
          clinicRadiusM: clinic.radius,
          accuracyThresholdM: sql.accuracy_threshold_m,
          position: { latitude, longitude: clinic.lon, accuracyM: 10 },
        }),
      );

      expect(ts.withinRadius, `${metres} m`).toBe(sql.within_radius);
      expect(ts.distanceM!, `${metres} m`).toBeCloseTo(Number(sql.distance_m), 1);
    }
  });
});
