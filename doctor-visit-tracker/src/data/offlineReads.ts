/**
 * Cache-backed versions of the reads a representative needs in the field.
 *
 * Each one wraps the ordinary online repository function in `cachedRead`, which
 * tries the network first and falls back to the last stored copy. The online
 * functions are untouched — screens that must always be live keep calling them
 * directly, and there is no way to accidentally cache something by using the
 * "normal" function.
 *
 * WHAT IS NOT HERE
 * ----------------
 * Visit start eligibility, the audit log, exports, the manager dashboard and
 * team KPI. Those must be current or must not be seen at all. There is no
 * cache key for them in src/domain/cachePolicy.ts, so wrapping one would throw
 * rather than silently work — see the test in tests/domain/cachePolicy.test.ts.
 */
import { cachedRead, type CachedResult } from '../lib/offline/cache';
import {
  fetchBrands,
  fetchClientSettings,
  fetchClinics,
  fetchDoctors,
  fetchMyBrandAssignments,
  fetchProducts,
} from './repositories';
import { fetchPlanForWeek, fetchRoute, type RouteStop, type WeeklyPlan } from './planning';
import type { Brand, Clinic, Doctor, Product, RepBrandAssignment } from './types';

export type { CachedResult };

export function fetchClinicsCached(): Promise<CachedResult<Clinic[]>> {
  return cachedRead('clinics', fetchClinics);
}

export function fetchDoctorsCached(): Promise<CachedResult<Doctor[]>> {
  return cachedRead('doctors', fetchDoctors);
}

export function fetchBrandsCached(): Promise<CachedResult<Brand[]>> {
  return cachedRead('brands', fetchBrands);
}

export function fetchProductsCached(): Promise<CachedResult<Product[]>> {
  return cachedRead('products', fetchProducts);
}

export function fetchMyBrandAssignmentsCached(
  repId: string,
): Promise<CachedResult<RepBrandAssignment[]>> {
  return cachedRead('my_brand_assignments', () => fetchMyBrandAssignments(repId));
}

export function fetchSettingsCached(): Promise<CachedResult<Record<string, unknown>>> {
  return cachedRead('settings', fetchClientSettings);
}

/**
 * Today's route — the single most important thing to have offline. A
 * representative in a hospital basement still needs to know which doctor they
 * came to see and what they came to talk about.
 *
 * Cached under one key rather than per-date: only today's route is ever needed
 * without a connection, and a cache holding thirty days of routes is thirty
 * days of clinic and doctor names on a phone that might be lost.
 */
export function fetchRouteCached(): Promise<CachedResult<RouteStop[]>> {
  return cachedRead('route_today', () => fetchRoute());
}

export function fetchPlanForWeekCached(
  weekStartDate: string,
): Promise<CachedResult<WeeklyPlan | null>> {
  return cachedRead('week_plan', () => fetchPlanForWeek(weekStartDate));
}
