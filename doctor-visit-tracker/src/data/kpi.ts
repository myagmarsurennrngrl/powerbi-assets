/**
 * KPI and exception data access.
 */
import { getSupabase } from '../lib/supabase';
import { mn } from '../lib/i18n/mn';
import type { Result } from './types';

export interface RepKpi {
  rep_id: string;
  period_start: string;
  period_end: string;
  planned_visits: number;
  completed_visits: number;
  missed_visits: number;
  approved_cancellations: number;
  unapproved_cancellations: number;
  unplanned_visits: number;
  eligible_visits: number;
  /** NULL when nothing was eligible — that is NOT the same as zero. */
  completion_pct: number | null;
  avg_duration_seconds: number | null;
  on_time_pct: number | null;
  doctor_coverage_pct: number | null;
  clinic_coverage_pct: number | null;
  follow_up_completion_pct: number | null;
  kpi_rule_version_id: string;
}

export interface TeamKpiRow {
  rep_id: string;
  rep_name: string;
  planned_visits: number;
  completed_visits: number;
  missed_visits: number;
  approved_cancellations: number;
  unapproved_cancellations: number;
  unplanned_visits: number;
  eligible_visits: number;
  completion_pct: number | null;
  avg_duration_seconds: number | null;
  on_time_pct: number | null;
}

export interface BrandActivity {
  brand_id: string;
  brand_name: string;
  visit_count: number;
}

export interface PendingException {
  exception_id: string;
  planned_visit_id: string;
  rep_id: string;
  rep_name: string;
  clinic_name: string;
  doctor_names: string[];
  planned_date: string;
  reason_category: string;
  explanation: string;
  requested_at_server: string;
  distance_from_clinic_m: number | null;
  clinic_radius_m: number | null;
  accuracy_m: number | null;
  has_attachment: boolean;
  excludes_from_kpi_if_approved: boolean;
}

function noClient<T>(): Result<T> {
  return { data: null, error: mn.errors.configMissing };
}

function businessError(error: { message: string }): string {
  if (/permission denied|row-level security|insufficient|эрх алга/i.test(error.message)) {
    return mn.errors.noPermission;
  }
  if (/[Ѐ-ӿ]/.test(error.message)) return error.message;
  return error.message || mn.errors.loadFailed;
}

// -----------------------------------------------------------------------------
// KPI
// -----------------------------------------------------------------------------
export async function fetchRepKpi(
  repId: string,
  from: string,
  to: string,
): Promise<Result<RepKpi>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_kpi_for_rep', {
    p_rep_id: repId,
    p_from: from,
    p_to: to,
  });

  if (error) return { data: null, error: businessError(error) };
  const rows = (data ?? []) as RepKpi[];
  return { data: rows.length > 0 ? rows[0]! : null, error: null };
}

export async function fetchBrandActivity(
  repId: string,
  from: string,
  to: string,
): Promise<Result<BrandActivity[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_kpi_brand_activity', {
    p_rep_id: repId,
    p_from: from,
    p_to: to,
  });

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as BrandActivity[], error: null };
}

export async function fetchTeamKpi(from: string, to: string): Promise<Result<TeamKpiRow[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_kpi_for_team', { p_from: from, p_to: to });
  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as TeamKpiRow[], error: null };
}

/** The rule version number, so a KPI screen can say which rules produced it. */
export async function fetchRuleVersionNo(ruleVersionId: string): Promise<Result<number>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('kpi_rule_version')
    .select('version_no')
    .eq('id', ruleVersionId)
    .maybeSingle();

  if (error) return { data: null, error: businessError(error) };
  return { data: (data as { version_no: number } | null)?.version_no ?? null, error: null };
}

// -----------------------------------------------------------------------------
// Exceptions
// -----------------------------------------------------------------------------
export interface RequestExceptionInput {
  plannedVisitId: string;
  reason: string;
  explanation: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  deviceTimestamp?: string | null;
  clientUuid: string;
  appVersion: string;
}

export async function requestException(
  input: RequestExceptionInput,
): Promise<Result<{ id: string; status: string; distance_from_clinic_m: number | null }>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_request_exception', {
    p_planned_visit_id: input.plannedVisitId,
    p_reason: input.reason,
    p_explanation: input.explanation,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_accuracy_m: input.accuracyM ?? null,
    p_attachment_path: null,
    p_device_ts: input.deviceTimestamp ?? null,
    p_client_uuid: input.clientUuid,
    p_app_version: input.appVersion,
    p_source: 'online',
  });

  if (error) return { data: null, error: businessError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row as never, error: null };
}

export async function fetchPendingExceptions(): Promise<Result<PendingException[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_pending_exceptions');
  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as PendingException[], error: null };
}

export async function reviewException(
  exceptionId: string,
  approve: boolean,
  comment: string | null,
): Promise<Result<{ status: string }>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_review_exception', {
    p_exception_id: exceptionId,
    p_approve: approve,
    p_comment: comment,
  });

  if (error) return { data: null, error: businessError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row as { status: string }, error: null };
}

/** The caller's own exception requests, for the "what happened to it" view. */
export async function fetchMyExceptions(): Promise<
  Result<
    Array<{
      id: string;
      planned_visit_id: string;
      reason_category: string;
      explanation: string;
      status: string;
      manager_comment: string | null;
      requested_at_server: string;
      approval_ts: string | null;
    }>
  >
> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('visit_exception')
    .select(
      'id, planned_visit_id, reason_category, explanation, status, manager_comment, requested_at_server, approval_ts',
    )
    .order('requested_at_server', { ascending: false })
    .limit(50);

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as never, error: null };
}
