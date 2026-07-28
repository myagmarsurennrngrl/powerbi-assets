/**
 * How long cached data may be shown, and how it must be labelled.
 *
 * Pure logic, unit-tested. The SQLite store in src/lib/offline/ applies it.
 *
 * THE PRINCIPLE: showing stale data is fine; showing it without saying so is
 * not. A representative looking at yesterday's route and believing it is
 * today's will drive to the wrong clinic. Every cached read therefore carries
 * an age, and the screen shows it whenever the data is not fresh.
 *
 * WHAT IS NEVER CACHED
 * --------------------
 * Anything whose whole purpose is to be current or private:
 *   - visit start eligibility (the geofence decision is the server's, always);
 *   - the audit log and exports (a manager reading a stale audit log is worse
 *     than one who cannot read it);
 *   - other people's KPI.
 * The absence of those from this table is the enforcement.
 */

export type CacheKey =
  | 'clinics'
  | 'doctors'
  | 'brands'
  | 'products'
  | 'doctor_clinics'
  | 'my_brand_assignments'
  | 'route_today'
  | 'week_plan'
  | 'settings'
  | 'profile';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `fresh`  — use silently.
 * `usable` — use, but tell the person how old it is.
 * Beyond `usable` the cache is still shown if there is nothing else, with a
 * stronger warning; it is never silently deleted, because a representative
 * with old data is better off than one with a blank screen in a basement.
 */
interface Policy {
  freshMs: number;
  usableMs: number;
}

const POLICIES: Record<CacheKey, Policy> = {
  // Master data changes a few times a month.
  clinics:              { freshMs: 6 * HOUR, usableMs: 30 * DAY },
  doctors:              { freshMs: 6 * HOUR, usableMs: 30 * DAY },
  brands:               { freshMs: 6 * HOUR, usableMs: 30 * DAY },
  products:             { freshMs: 6 * HOUR, usableMs: 30 * DAY },
  doctor_clinics:       { freshMs: 6 * HOUR, usableMs: 30 * DAY },
  my_brand_assignments: { freshMs: 6 * HOUR, usableMs: 30 * DAY },

  // Today's route can change during the day — a manager may add a visit.
  route_today:          { freshMs: 15 * MINUTE, usableMs: 1 * DAY },
  week_plan:            { freshMs: 1 * HOUR,    usableMs: 7 * DAY },

  // Small and cheap; refreshed on every successful sign-in anyway.
  settings:             { freshMs: 12 * HOUR, usableMs: 30 * DAY },
  profile:              { freshMs: 12 * HOUR, usableMs: 30 * DAY },
};

export type Freshness = 'fresh' | 'stale' | 'expired';

export function freshnessOf(key: CacheKey, fetchedAt: number, now: number): Freshness {
  const policy = POLICIES[key];
  // Explicit rather than a TypeError three lines later. Reaching this means
  // somebody is caching something the policy table has not sanctioned — which
  // is exactly the check that keeps eligibility and the audit log out of the
  // cache. Asserted by tests/domain/cachePolicy.test.ts.
  if (!policy) {
    throw new Error(`No cache policy for "${key}" — it must not be cached.`);
  }

  const age = now - fetchedAt;
  if (age < 0) return 'fresh';            // clock moved backwards; do not panic
  if (age <= policy.freshMs) return 'fresh';
  if (age <= policy.usableMs) return 'stale';
  return 'expired';
}

export function ageMs(fetchedAt: number, now: number): number {
  return Math.max(0, now - fetchedAt);
}

/**
 * Should a background refresh be attempted for this key?
 * Anything past `fresh` is worth refreshing when there is a connection.
 */
export function shouldRefresh(key: CacheKey, fetchedAt: number | null, now: number): boolean {
  if (fetchedAt === null) return true;
  return freshnessOf(key, fetchedAt, now) !== 'fresh';
}

/**
 * A short human description of the age, in Mongolian, for the banner.
 * Kept here rather than in the i18n file because the wording and the
 * thresholds are one decision, not two.
 */
export function describeAgeMn(fetchedAt: number, now: number): string {
  const minutes = Math.floor(ageMs(fetchedAt, now) / MINUTE);
  if (minutes < 1) return 'дөнгөж сая';
  if (minutes < 60) return `${minutes} минутын өмнө`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} цагийн өмнө`;

  const days = Math.floor(hours / 24);
  return `${days} хоногийн өмнө`;
}

/**
 * Data older than this is purged on sign-out, so a shared or returned handset
 * does not keep a former employee's routes and doctor names. See
 * docs/07-risks.md P3 and S10.
 */
export const PURGE_ON_SIGN_OUT = true;
