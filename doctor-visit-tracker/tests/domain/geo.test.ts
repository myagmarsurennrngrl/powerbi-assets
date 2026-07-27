import { afterAll, describe, expect, it } from 'vitest';
import {
  formatDistanceMn,
  haversineMetres,
  isPlausiblyInMongolia,
  isValidCoordinate,
} from '../../src/domain/geo';
import { asSuperuser, closePool, DB_AVAILABLE } from '../db/helpers';

// A real Ulaanbaatar reference point (seed clinic CL-001).
const CLINIC = { latitude: 47.9187, longitude: 106.9172 };

describe('haversine distance', () => {
  it('is zero at the same point', () => {
    expect(haversineMetres(CLINIC, CLINIC)).toBeCloseTo(0, 6);
  });

  it('is symmetric', () => {
    const other = { latitude: 47.9234, longitude: 106.9301 };
    expect(haversineMetres(CLINIC, other)).toBeCloseTo(haversineMetres(other, CLINIC), 9);
  });

  it('matches a known north-south offset', () => {
    // 0.001 degrees of latitude ≈ 111.2 m anywhere on Earth.
    const north = { latitude: CLINIC.latitude + 0.001, longitude: CLINIC.longitude };
    expect(haversineMetres(CLINIC, north)).toBeGreaterThan(110);
    expect(haversineMetres(CLINIC, north)).toBeLessThan(113);
  });

  it('accounts for latitude when measuring east-west distance', () => {
    // At 47.9°N a degree of longitude is cos(47.9) ≈ 0.67 of a degree of
    // latitude. A naive implementation that forgets the cosine would report
    // these as equal.
    const east = { latitude: CLINIC.latitude, longitude: CLINIC.longitude + 0.001 };
    const north = { latitude: CLINIC.latitude + 0.001, longitude: CLINIC.longitude };
    const ratio = haversineMetres(CLINIC, east) / haversineMetres(CLINIC, north);
    expect(ratio).toBeCloseTo(Math.cos((47.9187 * Math.PI) / 180), 3);
  });

  it('handles a long distance sanely (Ulaanbaatar to Nalaikh ≈ 27 km)', () => {
    const nalaikh = { latitude: 47.7722, longitude: 107.2533 };
    const km = haversineMetres(CLINIC, nalaikh) / 1000;
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(32);
  });

  it('is precise enough to decide a 150 m geofence', () => {
    // A point ~100 m north must be inside; ~200 m north must be outside.
    const inside = { latitude: CLINIC.latitude + 0.0009, longitude: CLINIC.longitude };
    const outside = { latitude: CLINIC.latitude + 0.0018, longitude: CLINIC.longitude };
    expect(haversineMetres(CLINIC, inside)).toBeLessThan(150);
    expect(haversineMetres(CLINIC, outside)).toBeGreaterThan(150);
  });
});

describe('coordinate validation', () => {
  it('accepts a real Ulaanbaatar coordinate', () => {
    expect(isValidCoordinate(CLINIC)).toBe(true);
    expect(isPlausiblyInMongolia(CLINIC)).toBe(true);
  });

  it('rejects null island (0,0) — the classic empty-field value', () => {
    expect(isValidCoordinate({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidCoordinate({ latitude: 91, longitude: 10 })).toBe(false);
    expect(isValidCoordinate({ latitude: 10, longitude: 181 })).toBe(false);
    expect(isValidCoordinate({ latitude: NaN, longitude: 10 })).toBe(false);
  });

  it('flags swapped latitude/longitude as implausible for Mongolia', () => {
    const swapped = { latitude: 106.9172, longitude: 47.9187 };
    expect(isPlausiblyInMongolia(swapped)).toBe(false);
  });
});

describe('Mongolian distance formatting', () => {
  it('shows metres below a kilometre', () => {
    expect(formatDistanceMn(0)).toBe('0 м');
    expect(formatDistanceMn(147.4)).toBe('147 м');
    expect(formatDistanceMn(999)).toBe('999 м');
  });

  it('shows kilometres above that', () => {
    expect(formatDistanceMn(1000)).toBe('1.0 км');
    expect(formatDistanceMn(27350)).toBe('27.4 км');
  });

  it('shows a dash when the distance is unknown', () => {
    expect(formatDistanceMn(NaN)).toBe('—');
  });
});

/**
 * The important one: the button the representative sees must agree with the
 * verdict the server reaches. If these two implementations ever drift, a rep
 * could see an enabled button and then be refused — or worse, see a disabled
 * button while standing at the clinic.
 */
describe.skipIf(!DB_AVAILABLE)('TypeScript and SQL agree on distance', () => {
  afterAll(closePool);

  it('produces the same metres as public.fn_haversine_metres', async () => {
    const cases: Array<[{ latitude: number; longitude: number }, { latitude: number; longitude: number }]> = [
      [CLINIC, CLINIC],
      [CLINIC, { latitude: 47.9234, longitude: 106.9301 }],
      [CLINIC, { latitude: 47.7722, longitude: 107.2533 }],
      [CLINIC, { latitude: 47.9187, longitude: 106.9182 }],
      [{ latitude: -33.8688, longitude: 151.2093 }, { latitude: 51.5074, longitude: -0.1278 }],
    ];

    for (const [a, b] of cases) {
      const [row] = await asSuperuser<{ metres: number }>(
        'SELECT public.fn_haversine_metres($1, $2, $3, $4) AS metres',
        [a.latitude, a.longitude, b.latitude, b.longitude],
      );
      expect(Number(row.metres)).toBeCloseTo(haversineMetres(a, b), 2);
    }
  });
});
