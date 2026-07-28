/**
 * Visit execution — check-in, active visit, check-out.
 *
 * Every function here calls a database function rather than writing rows. The
 * app has no INSERT rights on `visit` or `visit_event` at all, which is what
 * makes the geofence meaningful: there is no path by which the phone can
 * fabricate a check-in.
 */
import { getSupabase } from '../lib/supabase';
import { mn } from '../lib/i18n/mn';
import type { Result } from './types';
import type { BlockingReason } from '../domain/visitEligibility';

export interface ServerEligibility {
  can_start: boolean;
  is_owner: boolean;
  is_today: boolean;
  is_status_planned: boolean;
  no_other_in_progress: boolean;
  has_location: boolean;
  accuracy_ok: boolean;
  within_radius: boolean;
  distance_m: number | null;
  radius_m: number | null;
  accuracy_threshold_m: number;
  planned_date: string | null;
  visit_status: string | null;
  blocking_reason: BlockingReason | null;
}

export interface ActiveVisit {
  visit_id: string;
  planned_visit_id: string | null;
  clinic_id: string;
  clinic_name: string;
  clinic_address: string;
  started_at_server: string;
  completed_at_server: string | null;
  objective: string;
  doctor_names: string[];
  brand_names: string[];
  awaiting_report: boolean;
}

export interface VisitRow {
  id: string;
  planned_visit_id: string | null;
  status: string;
  started_at_server: string;
  completed_at_server: string | null;
  duration_seconds: number | null;
  is_draft: boolean;
}

function noClient<T>(): Result<T> {
  return { data: null, error: mn.errors.configMissing };
}

/**
 * Business rules from the database already speak Mongolian and carry the
 * numbers that matter ("you are 240 m away, the limit is 150 m"). Passing them
 * through unchanged is far more useful than a generic failure message.
 */
function businessError(error: { message: string }): string {
  if (/permission denied|row-level security|insufficient/i.test(error.message)) {
    return mn.errors.noPermission;
  }
  if (/[Ѐ-ӿ]/.test(error.message)) return error.message;
  return error.message || mn.errors.loadFailed;
}

/**
 * Ask the SERVER whether this visit may start.
 *
 * The app also computes this locally (src/domain/visitEligibility.ts) for an
 * instant answer, but the screen confirms with the server before enabling the
 * button so the two can never disagree in front of the user.
 */
export async function checkStartEligibility(
  plannedVisitId: string,
  position: { latitude: number; longitude: number; accuracyM: number | null } | null,
): Promise<Result<ServerEligibility>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_visit_start_eligibility', {
    p_planned_visit_id: plannedVisitId,
    p_latitude: position?.latitude ?? null,
    p_longitude: position?.longitude ?? null,
    p_accuracy_m: position?.accuracyM ?? null,
  });

  if (error) return { data: null, error: businessError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  return { data: (row ?? null) as ServerEligibility | null, error: null };
}

export interface StartVisitInput {
  plannedVisitId: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  deviceTimestamp: string;
  isMocked: boolean;
  /** Stable per attempt, so a retry on a flaky network cannot double-start. */
  clientUuid: string;
  appVersion: string;
}

export async function startVisit(input: StartVisitInput): Promise<Result<VisitRow>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_start_visit', {
    p_planned_visit_id: input.plannedVisitId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_accuracy_m: input.accuracyM,
    p_device_ts: input.deviceTimestamp,
    p_client_uuid: input.clientUuid,
    p_app_version: input.appVersion,
    p_is_mocked: input.isMocked,
    p_source: 'online',
  });

  if (error) return { data: null, error: businessError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  return { data: row as VisitRow, error: null };
}

export interface CheckOutInput {
  visitId: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  deviceTimestamp: string;
  isMocked: boolean;
  clientUuid: string;
  appVersion: string;
}

export async function checkOut(input: CheckOutInput): Promise<Result<VisitRow>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_check_out', {
    p_visit_id: input.visitId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_accuracy_m: input.accuracyM,
    p_device_ts: input.deviceTimestamp,
    p_client_uuid: input.clientUuid,
    p_app_version: input.appVersion,
    p_is_mocked: input.isMocked,
    p_source: 'online',
  });

  if (error) return { data: null, error: businessError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  return { data: row as VisitRow, error: null };
}

// -----------------------------------------------------------------------------
// Unplanned visits (migration 0024)
//
// Same location rules as a planned check-in — the geofence is not relaxed
// because the visit was not planned. What changes is that there is no plan to
// own, and a reason is required instead.
// -----------------------------------------------------------------------------

export interface UnplannedEligibility {
  can_start: boolean;
  is_rep: boolean;
  clinic_is_active: boolean;
  no_other_in_progress: boolean;
  has_location: boolean;
  accuracy_ok: boolean;
  within_radius: boolean;
  distance_m: number | null;
  radius_m: number | null;
  accuracy_threshold_m: number;
  /** Advisory only: today's plan already includes this clinic. */
  already_planned_here: boolean;
  blocking_reason: string | null;
}

export interface NearbyClinic {
  clinic_id: string;
  clinic_name: string;
  district: string;
  distance_m: number;
  radius_m: number;
  within_radius: boolean;
}

export async function fetchNearbyClinics(position: {
  latitude: number;
  longitude: number;
}): Promise<Result<NearbyClinic[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_nearby_clinics', {
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_limit: 10,
  });

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as NearbyClinic[], error: null };
}

export async function checkUnplannedEligibility(
  clinicId: string,
  position: { latitude: number; longitude: number; accuracyM: number | null } | null,
): Promise<Result<UnplannedEligibility>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_unplanned_start_eligibility', {
    p_clinic_id: clinicId,
    p_latitude: position?.latitude ?? null,
    p_longitude: position?.longitude ?? null,
    p_accuracy_m: position?.accuracyM ?? null,
  });

  if (error) return { data: null, error: businessError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  return { data: (row ?? null) as UnplannedEligibility | null, error: null };
}

export interface StartUnplannedInput {
  clinicId: string;
  reason: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  deviceTimestamp: string;
  isMocked: boolean;
  clientUuid: string;
  appVersion: string;
}

export async function startUnplannedVisit(
  input: StartUnplannedInput,
): Promise<Result<VisitRow>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_start_unplanned_visit', {
    p_clinic_id: input.clinicId,
    p_reason: input.reason,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_accuracy_m: input.accuracyM,
    p_device_ts: input.deviceTimestamp,
    p_client_uuid: input.clientUuid,
    p_app_version: input.appVersion,
    p_is_mocked: input.isMocked,
    p_source: 'online',
  });

  if (error) return { data: null, error: businessError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  return { data: row as VisitRow, error: null };
}

/** The caller's currently running visit, or null. */
export async function fetchActiveVisit(): Promise<Result<ActiveVisit | null>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_active_visit');
  if (error) return { data: null, error: businessError(error) };

  const rows = (data ?? []) as ActiveVisit[];
  return { data: rows.length > 0 ? rows[0]! : null, error: null };
}
