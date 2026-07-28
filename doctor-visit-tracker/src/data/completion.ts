/**
 * Visit report data access — drafting, submitting, doctor history, addenda.
 */
import { getSupabase } from '../lib/supabase';
import { mn } from '../lib/i18n/mn';
import type { Result } from './types';

export interface CompletionIssue {
  field: string;
  issue: 'required' | 'missing' | 'in_the_past' | 'not_found';
}

export interface VisitReport {
  id: string;
  planned_visit_id: string | null;
  clinic_id: string;
  visit_date: string;
  status: string;
  is_draft: boolean;
  started_at_server: string;
  completed_at_server: string | null;
  duration_seconds: number | null;
  objective: string | null;
  meeting_status: string | null;
  outcome: string | null;
  interest_level: string | null;
  doctor_feedback: string | null;
  rep_summary: string | null;
  next_action: string | null;
  samples_provided: string | null;
  materials_provided: string | null;
  follow_up_required: boolean | null;
  follow_up_date: string | null;
  clinic: { id: string; name: string; address: string } | null;
}

export interface HistoryEntry {
  visit_id: string;
  visit_date: string;
  rep_id: string;
  rep_name: string;
  clinic_id: string;
  clinic_name: string;
  meeting_status: string | null;
  outcome: string | null;
  interest_level: string | null;
  doctor_feedback: string | null;
  rep_summary: string | null;
  next_action: string | null;
  duration_seconds: number | null;
  follow_up_required: boolean | null;
  follow_up_date: string | null;
  brand_names: string[];
  product_names: string[];
  addendum_count: number;
}

export interface Addendum {
  id: string;
  visit_id: string;
  correction_text: string;
  reason: string;
  author_email: string | null;
  author_role: string | null;
  created_at: string;
}

function noClient<T>(): Result<T> {
  return { data: null, error: mn.errors.configMissing };
}

function businessError(error: { message: string }): string {
  if (/permission denied|row-level security|insufficient/i.test(error.message)) {
    return mn.errors.noPermission;
  }
  if (/[Ѐ-ӿ]/.test(error.message)) return error.message;
  return error.message || mn.errors.loadFailed;
}

// -----------------------------------------------------------------------------
// The report being written
// -----------------------------------------------------------------------------
export async function fetchVisitReport(visitId: string): Promise<Result<VisitReport>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('visit')
    .select(
      `id, planned_visit_id, clinic_id, visit_date, status, is_draft,
       started_at_server, completed_at_server, duration_seconds, objective,
       meeting_status, outcome, interest_level, doctor_feedback, rep_summary,
       next_action, samples_provided, materials_provided,
       follow_up_required, follow_up_date,
       clinic:clinic_id (id, name, address)`,
    )
    .eq('id', visitId)
    .maybeSingle();

  if (error) return { data: null, error: businessError(error) };
  return { data: data as unknown as VisitReport | null, error: null };
}

/**
 * Save the report so far.
 *
 * Every field is optional here: a draft is allowed to be half-finished. The
 * completeness rules apply at submission, not while typing — otherwise the
 * form would fight the person filling it in.
 */
export async function saveVisitDraft(
  visitId: string,
  fields: Partial<
    Pick<
      VisitReport,
      | 'objective' | 'meeting_status' | 'outcome' | 'interest_level'
      | 'doctor_feedback' | 'rep_summary' | 'next_action'
      | 'samples_provided' | 'materials_provided'
      | 'follow_up_required' | 'follow_up_date'
    >
  >,
): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.from('visit').update(fields).eq('id', visitId);
  if (error) return { data: null, error: businessError(error) };
  return { data: true, error: null };
}

/** Replace the set of doctors actually met. */
export async function setVisitDoctors(
  visitId: string,
  doctorIds: string[],
): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error: deleteError } = await supabase
    .from('visit_doctor')
    .delete()
    .eq('visit_id', visitId);
  if (deleteError) return { data: null, error: businessError(deleteError) };

  if (doctorIds.length > 0) {
    const { error } = await supabase
      .from('visit_doctor')
      .insert(doctorIds.map((doctorId) => ({ visit_id: visitId, doctor_id: doctorId })));
    if (error) return { data: null, error: businessError(error) };
  }
  return { data: true, error: null };
}

/** Replace the set of brands actually discussed. */
export async function setVisitBrands(visitId: string, brandIds: string[]): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error: deleteError } = await supabase
    .from('visit_brand')
    .delete()
    .eq('visit_id', visitId);
  if (deleteError) return { data: null, error: businessError(deleteError) };

  if (brandIds.length > 0) {
    const { error } = await supabase
      .from('visit_brand')
      .insert(brandIds.map((brandId) => ({ visit_id: visitId, brand_id: brandId })));
    if (error) return { data: null, error: businessError(error) };
  }
  return { data: true, error: null };
}

export async function setVisitProducts(
  visitId: string,
  productIds: string[],
): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error: deleteError } = await supabase
    .from('visit_product')
    .delete()
    .eq('visit_id', visitId);
  if (deleteError) return { data: null, error: businessError(deleteError) };

  if (productIds.length > 0) {
    const { error } = await supabase
      .from('visit_product')
      .insert(productIds.map((productId) => ({ visit_id: visitId, product_id: productId })));
    if (error) return { data: null, error: businessError(error) };
  }
  return { data: true, error: null };
}

export async function fetchVisitSelections(
  visitId: string,
): Promise<Result<{ doctorIds: string[]; brandIds: string[]; productIds: string[] }>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const [doctors, brands, products] = await Promise.all([
    supabase.from('visit_doctor').select('doctor_id').eq('visit_id', visitId),
    supabase.from('visit_brand').select('brand_id').eq('visit_id', visitId),
    supabase.from('visit_product').select('product_id').eq('visit_id', visitId),
  ]);

  const firstError = doctors.error ?? brands.error ?? products.error;
  if (firstError) return { data: null, error: businessError(firstError) };

  return {
    data: {
      doctorIds: (doctors.data ?? []).map((r) => r.doctor_id as string),
      brandIds: (brands.data ?? []).map((r) => r.brand_id as string),
      productIds: (products.data ?? []).map((r) => r.product_id as string),
    },
    error: null,
  };
}

/** Ask the server what is still missing. The same rules it will enforce. */
export async function fetchCompletionIssues(
  visitId: string,
): Promise<Result<CompletionIssue[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_visit_completion_issues', {
    p_visit_id: visitId,
  });
  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as CompletionIssue[], error: null };
}

export async function submitVisitReport(visitId: string): Promise<Result<VisitReport>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_complete_visit', { p_visit_id: visitId });
  if (error) return { data: null, error: businessError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  return { data: row as VisitReport, error: null };
}

// -----------------------------------------------------------------------------
// Doctor history
// -----------------------------------------------------------------------------
export interface HistoryFilters {
  fromDate?: string | null;
  toDate?: string | null;
  brandId?: string | null;
  repId?: string | null;
  clinicId?: string | null;
  outcome?: string | null;
}

export async function fetchDoctorHistory(
  doctorId: string,
  filters: HistoryFilters = {},
): Promise<Result<HistoryEntry[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_doctor_visit_history', {
    p_doctor_id: doctorId,
    p_from_date: filters.fromDate ?? null,
    p_to_date: filters.toDate ?? null,
    p_brand_id: filters.brandId ?? null,
    p_rep_id: filters.repId ?? null,
    p_clinic_id: filters.clinicId ?? null,
    p_outcome: filters.outcome ?? null,
  });

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as HistoryEntry[], error: null };
}

export async function fetchAddenda(visitIds: string[]): Promise<Result<Addendum[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();
  if (visitIds.length === 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from('visit_addendum')
    .select('id, visit_id, correction_text, reason, author_email, author_role, created_at')
    .in('visit_id', visitIds)
    .order('created_at');

  if (error) return { data: null, error: businessError(error) };
  return { data: (data ?? []) as Addendum[], error: null };
}

export async function addAddendum(
  visitId: string,
  correctionText: string,
  reason: string,
): Promise<Result<Addendum>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_add_addendum', {
    p_visit_id: visitId,
    p_correction_text: correctionText,
    p_reason: reason,
  });

  if (error) return { data: null, error: businessError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row as Addendum, error: null };
}
