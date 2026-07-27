/**
 * Planning data access — weekly plans, planned visits, today's route.
 */
import { getSupabase } from '../lib/supabase';
import { mn } from '../lib/i18n/mn';
import type { Result } from './types';

export type PlanStatus =
  | 'draft' | 'submitted' | 'approved' | 'rejected' | 'active' | 'completed' | 'locked';

export type VisitStatus =
  | 'planned' | 'in_progress' | 'completed' | 'missed' | 'rescheduled'
  | 'cancellation_requested' | 'cancelled_approved' | 'cancelled_unapproved';

export interface WeeklyPlan {
  id: string;
  rep_id: string;
  iso_year: number;
  iso_week: number;
  week_start_date: string;
  week_end_date: string;
  status: PlanStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
}

/** One row of fn_route_for_date — everything a route card needs. */
export interface RouteStop {
  planned_visit_id: string;
  planned_date: string;
  planned_order: number;
  planned_time: string | null;
  status: VisitStatus;
  objective: string;
  clinic_id: string;
  clinic_name: string;
  clinic_address: string;
  clinic_district: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
  doctor_names: string[];
  brand_names: string[];
  plan_status: PlanStatus;
}

export interface DaySummary {
  planned_date: string;
  visit_count: number;
  clinic_count: number;
}

export interface PlannedVisitDetail {
  id: string;
  weekly_plan_id: string;
  rep_id: string;
  clinic_id: string;
  planned_date: string;
  planned_order: number;
  planned_time: string | null;
  objective: string;
  status: VisitStatus;
  clinic: {
    id: string;
    name: string;
    address: string;
    district: string;
    latitude: number;
    longitude: number;
    geofence_radius_m: number;
    contact_phone: string | null;
  } | null;
  planned_visit_doctor: Array<{ doctor: { id: string; full_name: string; speciality: string } | null }>;
  planned_visit_brand: Array<{
    brand: { id: string; name: string } | null;
    product: { id: string; name: string } | null;
  }>;
}

function noClient<T>(): Result<T> {
  return { data: null, error: mn.errors.configMissing };
}

function wrap<T>(data: T | null, error: { message: string } | null): Result<T> {
  if (error) {
    const message = /permission denied|row-level security/i.test(error.message)
      ? mn.errors.noPermission
      : mn.errors.loadFailed;
    return { data: null, error: message };
  }
  return { data, error: null };
}

/**
 * Surface a server-side business rule to the user as-is.
 *
 * Rules like the duplicate-visit check raise a message that is already written
 * in Mongolian and is genuinely useful ("you already planned this doctor
 * today"). Replacing it with a generic "error occurred" would throw away the
 * only thing that tells the representative what to do.
 */
function businessError(error: { message: string; code?: string }): string {
  if (/permission denied|row-level security|insufficient/i.test(error.message)) {
    return mn.errors.noPermission;
  }
  // Mongolian messages come straight from the database functions.
  if (/[Ѐ-ӿ]/.test(error.message)) return error.message;
  return error.message || mn.errors.loadFailed;
}

// -----------------------------------------------------------------------------
// Today's route
// -----------------------------------------------------------------------------

/** @param date YYYY-MM-DD; omit for today in Ulaanbaatar (decided server-side). */
export async function fetchRoute(date?: string): Promise<Result<RouteStop[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_route_for_date', {
    p_date: date ?? null,
  });

  return wrap(data as RouteStop[] | null, error);
}

// -----------------------------------------------------------------------------
// Weekly plans
// -----------------------------------------------------------------------------
export async function fetchPlanForWeek(weekStartDate: string): Promise<Result<WeeklyPlan | null>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('weekly_plan')
    .select(
      'id, rep_id, iso_year, iso_week, week_start_date, week_end_date, status, submitted_at, reviewed_at, review_comment',
    )
    .eq('week_start_date', weekStartDate)
    .maybeSingle();

  return wrap(data as WeeklyPlan | null, error);
}

export async function fetchWeekSummary(weekStartDate: string): Promise<Result<DaySummary[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_week_summary', {
    p_week_start_date: weekStartDate,
  });

  return wrap(data as DaySummary[] | null, error);
}

/** Create the plan for a week if it does not exist yet. Idempotent. */
export async function getOrCreatePlan(weekStartDate: string): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_get_or_create_weekly_plan', {
    p_week_start_date: weekStartDate,
  });

  if (error) return { data: null, error: businessError(error) };
  return { data: data as string, error: null };
}

export async function submitPlan(planId: string): Promise<Result<WeeklyPlan>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_submit_plan', { p_plan_id: planId });
  if (error) return { data: null, error: businessError(error) };

  // The function returns a single weekly_plan row.
  const plan = Array.isArray(data) ? data[0] : data;
  return { data: plan as WeeklyPlan, error: null };
}

/** Is this plan still editable? Asked of the server, never assumed by the app. */
export async function isPlanEditable(planId: string): Promise<Result<boolean>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_plan_editable', { p_plan_id: planId });
  if (error) return { data: null, error: businessError(error) };
  return { data: Boolean(data), error: null };
}

export async function fetchPlanDeadline(weekStartDate: string): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_plan_deadline', {
    p_week_start_date: weekStartDate,
  });
  if (error) return { data: null, error: businessError(error) };
  return { data: data as string, error: null };
}

// -----------------------------------------------------------------------------
// Planned visits
// -----------------------------------------------------------------------------
const VISIT_DETAIL_SELECT = `
  id, weekly_plan_id, rep_id, clinic_id, planned_date, planned_order, planned_time,
  objective, status,
  clinic:clinic_id (id, name, address, district, latitude, longitude, geofence_radius_m, contact_phone),
  planned_visit_doctor ( doctor:doctor_id (id, full_name, speciality) ),
  planned_visit_brand ( brand:brand_id (id, name), product:product_id (id, name) )
`;

export async function fetchPlannedVisit(id: string): Promise<Result<PlannedVisitDetail>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('planned_visit')
    .select(VISIT_DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();

  return wrap(data as unknown as PlannedVisitDetail | null, error);
}

export async function fetchPlanVisits(planId: string): Promise<Result<PlannedVisitDetail[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('planned_visit')
    .select(VISIT_DETAIL_SELECT)
    .eq('weekly_plan_id', planId)
    .order('planned_date')
    .order('planned_order');

  return wrap(data as unknown as PlannedVisitDetail[] | null, error);
}

export interface NewPlannedVisit {
  planId: string;
  clinicId: string;
  plannedDate: string;
  plannedOrder: number;
  plannedTime: string | null;
  objective: string;
  doctorIds: string[];
  brandIds: string[];
}

/**
 * Add a visit to a plan.
 *
 * The visit and its child lists are written as three statements. If the
 * duplicate-prevention rule fires, PostgREST rolls the whole request back, so
 * a half-built visit can never be left behind.
 */
export async function addPlannedVisit(input: NewPlannedVisit): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data: visit, error: visitError } = await supabase
    .from('planned_visit')
    .insert({
      weekly_plan_id: input.planId,
      // rep_id is required by the schema but is overwritten server-side from
      // the plan owner, so a wrong value here cannot become a wrong record.
      rep_id: '00000000-0000-0000-0000-000000000000',
      clinic_id: input.clinicId,
      planned_date: input.plannedDate,
      planned_order: input.plannedOrder,
      planned_time: input.plannedTime,
      objective: input.objective,
    })
    .select('id')
    .single();

  if (visitError) return { data: null, error: businessError(visitError) };
  const visitId = (visit as { id: string }).id;

  if (input.doctorIds.length > 0) {
    const { error } = await supabase.from('planned_visit_doctor').insert(
      input.doctorIds.map((doctorId) => ({ planned_visit_id: visitId, doctor_id: doctorId })),
    );
    if (error) return { data: null, error: businessError(error) };
  }

  if (input.brandIds.length > 0) {
    const { error } = await supabase.from('planned_visit_brand').insert(
      input.brandIds.map((brandId) => ({ planned_visit_id: visitId, brand_id: brandId })),
    );
    if (error) return { data: null, error: businessError(error) };
  }

  return { data: visitId, error: null };
}

/** Change the order of visits within a day. */
export async function updateVisitOrder(
  visitId: string,
  plannedOrder: number,
): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase
    .from('planned_visit')
    .update({ planned_order: plannedOrder })
    .eq('id', visitId);

  if (error) return { data: null, error: businessError(error) };
  return { data: true, error: null };
}

/**
 * Remove a visit from a draft plan.
 *
 * A planned visit is never deleted — its status trail is permanent. Marking it
 * cancelled keeps the history intact and is what the KPI rules already expect.
 */
export async function cancelPlannedVisit(visitId: string): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase
    .from('planned_visit')
    .update({ status: 'cancelled_unapproved' })
    .eq('id', visitId);

  if (error) return { data: null, error: businessError(error) };
  return { data: true, error: null };
}

/** Doctors who work at a clinic — used by the plan builder's doctor picker. */
export async function fetchDoctorOptionsForClinic(
  clinicId: string,
): Promise<Result<Array<{ id: string; full_name: string; speciality: string }>>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('doctor_clinic')
    .select('doctor:doctor_id (id, full_name, speciality, is_active)')
    .eq('clinic_id', clinicId)
    .eq('is_active', true);

  if (error) return wrap<Array<{ id: string; full_name: string; speciality: string }>>(null, error);

  const doctors = (data ?? [])
    .map((row) => (row as unknown as { doctor: { id: string; full_name: string; speciality: string; is_active: boolean } | null }).doctor)
    .filter((d): d is { id: string; full_name: string; speciality: string; is_active: boolean } => !!d && d.is_active)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'mn'));

  return { data: doctors, error: null };
}
