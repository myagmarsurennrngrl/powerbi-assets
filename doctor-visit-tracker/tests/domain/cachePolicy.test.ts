/**
 * Cache freshness rules.
 *
 * The rule being protected: cached data may be shown, but never silently. A
 * representative looking at yesterday's route and believing it is today's will
 * drive to the wrong clinic.
 */
import { describe, expect, it } from 'vitest';
import {
  ageMs,
  describeAgeMn,
  freshnessOf,
  shouldRefresh,
  type CacheKey,
} from '../../src/domain/cachePolicy';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('freshness', () => {
  it("today's route goes stale within the hour", () => {
    // A manager can add a stop mid-morning; an hour-old route is worth flagging.
    expect(freshnessOf('route_today', NOW - 5 * MINUTE, NOW)).toBe('fresh');
    expect(freshnessOf('route_today', NOW - 45 * MINUTE, NOW)).toBe('stale');
    expect(freshnessOf('route_today', NOW - 2 * DAY, NOW)).toBe('expired');
  });

  it('master data stays usable for a month', () => {
    // Clinics and doctors change a few times a month. A representative in a
    // basement with a three-week-old clinic list is fine.
    const keys: CacheKey[] = ['clinics', 'doctors', 'brands', 'products'];
    for (const key of keys) {
      expect(freshnessOf(key, NOW - 1 * HOUR, NOW)).toBe('fresh');
      expect(freshnessOf(key, NOW - 2 * DAY, NOW)).toBe('stale');
      expect(freshnessOf(key, NOW - 40 * DAY, NOW)).toBe('expired');
    }
  });

  it('survives a clock that moves backwards', () => {
    // Changing the phone's timezone or clock must not make cached data
    // "negative age" and blow up the banner arithmetic.
    expect(freshnessOf('clinics', NOW + HOUR, NOW)).toBe('fresh');
    expect(ageMs(NOW + HOUR, NOW)).toBe(0);
  });

  it('a boundary is inclusive — exactly fresh is still fresh', () => {
    expect(freshnessOf('route_today', NOW - 15 * MINUTE, NOW)).toBe('fresh');
    expect(freshnessOf('route_today', NOW - 15 * MINUTE - 1, NOW)).toBe('stale');
  });
});

describe('shouldRefresh', () => {
  it('refreshes anything never fetched', () => {
    expect(shouldRefresh('clinics', null, NOW)).toBe(true);
  });

  it('leaves fresh data alone', () => {
    expect(shouldRefresh('clinics', NOW - MINUTE, NOW)).toBe(false);
  });

  it('refreshes stale and expired data', () => {
    expect(shouldRefresh('route_today', NOW - HOUR, NOW)).toBe(true);
    expect(shouldRefresh('clinics', NOW - 90 * DAY, NOW)).toBe(true);
  });
});

describe('describing the age in Mongolian', () => {
  it.each([
    [0, 'дөнгөж сая'],
    [30_000, 'дөнгөж сая'],
    [5 * MINUTE, '5 минутын өмнө'],
    [59 * MINUTE, '59 минутын өмнө'],
    [3 * HOUR, '3 цагийн өмнө'],
    [23 * HOUR, '23 цагийн өмнө'],
    [2 * DAY, '2 хоногийн өмнө'],
  ])('%i ms → %s', (age, expected) => {
    expect(describeAgeMn(NOW - age, NOW)).toBe(expected);
  });
});

describe('what is deliberately absent', () => {
  it('has no policy for anything that must always be live', () => {
    // The geofence decision, the audit log and exports are never cached. Their
    // absence from the policy table is the enforcement: there is no key to
    // cache them under. This test fails if someone adds one.
    const cacheable = [
      'clinics', 'doctors', 'brands', 'products', 'doctor_clinics',
      'my_brand_assignments', 'route_today', 'week_plan', 'settings', 'profile',
    ];
    const forbidden = ['eligibility', 'audit_log', 'export', 'team_kpi', 'dashboard'];

    for (const key of forbidden) {
      expect(cacheable).not.toContain(key);
      // freshnessOf on an unknown key must not silently succeed.
      expect(() => freshnessOf(key as CacheKey, NOW, NOW)).toThrow();
    }
  });
});
