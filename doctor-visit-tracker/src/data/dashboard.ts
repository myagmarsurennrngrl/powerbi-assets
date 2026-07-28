/**
 * Manager dashboard, audit log and export data access.
 */
import { getSupabase } from '../lib/supabase';
import { mn } from '../lib/i18n/mn';
import type { Result } from './types';

export interface DashboardSummary {
  period_start: string;
  period_end: string;
  team_completion_pct: number | null;
  team_completed: number;
  team_eligible: number;
  total_missed: number;
  pending_exceptions: number;
  visits_needing_review: number;
  clinics_not_visited: number;
  doctors_not_visited: number;
  active_reps: number;
}

export interface ReviewItem {
  visit_key: string;
  visit_date: string;
  rep_name: string;
  clinic_name: string;
  distance_m: number | null;
  radius_m: number | null;
  accuracy_m: number | null;
  duration_seconds: number | null;
  reasons: string[];
}

export interface UncoveredClinic {
  clinic_key: string;
  clinic_name: string;
  district: string;
  last_visit_date: string | null;
}

export interface RecentVisit {
  visit_key: string;
  visit_date: string;
  rep_name: string;
  clinic_name: string;
  outcome: string | null;
  duration_seconds: number | null;
  needs_review: boolean;
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  note: string | null;
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

export async function fetchDashboard(
  from?: string,
  to?: string,
): Promise<Result<DashboardSummary>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_manager_dashboard', {
    p_from: from ?? null,
    p_to: to ?? null,
  });

  if (error) return { data: null, error: businessError(error) };
  const rows = (data ?? []) as DashboardSummary[];
  return { data: rows.length > 0 ? rows[0]! : null, error: null };
}

export async function fetchReviewList(
  from?: string,
  to?: string,
): Promise<Result<ReviewItem[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_visits_needing_review', {
    p_from: from ?? null,
    p_to: to ?? null,
    p_limit: 100,
  });

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as ReviewItem[], error: null };
}

export async function fetchUncoveredClinics(
  from?: string,
  to?: string,
): Promise<Result<UncoveredClinic[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_uncovered_clinics', {
    p_from: from ?? null,
    p_to: to ?? null,
  });

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as UncoveredClinic[], error: null };
}

export async function fetchRecentVisits(limit = 25): Promise<Result<RecentVisit[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_recent_visits', { p_limit: limit });
  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as RecentVisit[], error: null };
}

export async function fetchAuditLog(
  filters: { action?: string | null; from?: string | null; to?: string | null } = {},
  offset = 0,
): Promise<Result<AuditEntry[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_audit_log_page', {
    p_action: filters.action ?? null,
    p_actor_id: null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: 50,
    p_offset: offset,
  });

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as AuditEntry[], error: null };
}

/**
 * Fetch the export rows and render them as CSV text.
 *
 * The server writes the `data_export` audit entry as part of the query, so the
 * log records the export even if the user never saves the file.
 */
export async function exportVisitsCsv(
  from: string,
  to: string,
): Promise<Result<{ csv: string; rowCount: number }>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_export_visits', { p_from: from, p_to: to });
  if (error) return { data: null, error: businessError(error) };

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { data: { csv: '', rowCount: 0 }, error: null };

  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    // Quote whenever the value could break the row structure.
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');

  // A UTF-8 BOM, so Excel on Windows renders Mongolian Cyrillic correctly
  // instead of mojibake. Without it the file looks corrupted to the user.
  return { data: { csv: `﻿${csv}`, rowCount: rows.length }, error: null };
}
