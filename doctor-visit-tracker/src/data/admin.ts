/**
 * Administration data access — user accounts and master data.
 *
 * Two different mechanisms are used deliberately:
 *
 *  - User accounts go through the fn_admin_* functions (migration 0023),
 *    because those operations have consequences a single-row policy cannot
 *    see: an unapproved email domain, the last administrator, an open visit.
 *
 *  - Clinics, doctors, brands and products are written straight to the table.
 *    RLS already restricts them to administrators, CHECK constraints validate
 *    the values, and a trigger writes the audit entry. Wrapping them in a
 *    function would add a layer without adding a rule.
 *
 * As everywhere else in this app, nothing here is the security boundary. If a
 * manager somehow reached these calls, the database would refuse them.
 */
import { getSupabase } from '../lib/supabase';
import { mn } from '../lib/i18n/mn';
import type { Brand, Clinic, Doctor, Product, Result, UserRole } from './types';

function noClient<T>(): Result<T> {
  return { data: null, error: mn.errors.configMissing };
}

/**
 * Business rules raise Mongolian messages (migration 0023); those are shown as
 * written. Anything else is a technical failure the administrator cannot act
 * on, so it gets a generic message.
 */
function adminError(error: { message: string }): string {
  if (/permission denied|row-level security|insufficient/i.test(error.message)) {
    return mn.errors.noPermission;
  }
  if (/[Ѐ-ӿ]/.test(error.message)) return error.message;
  if (/duplicate key|unique/i.test(error.message)) return mn.admin.errorDuplicate;
  if (/violates check constraint|check_violation/i.test(error.message)) {
    return mn.admin.errorInvalidValue;
  }
  return mn.errors.loadFailed;
}

function ok(error: { message: string } | null): Result<true> {
  if (error) return { data: null, error: adminError(error) };
  return { data: true, error: null };
}

// =============================================================================
// Users
// =============================================================================

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  manager_id: string | null;
  manager_name: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  /** False until the person has signed in for the first time. */
  has_signed_in: boolean;
  brand_count: number;
  brand_names: string | null;
  created_at: string;
}

export async function fetchAdminUsers(): Promise<Result<AdminUserRow[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_admin_users');
  if (error) return { data: null, error: adminError(error) };
  return { data: (data ?? []) as AdminUserRow[], error: null };
}

export async function createUser(input: {
  email: string;
  full_name: string;
  role: UserRole;
  manager_id: string | null;
  phone: string | null;
}): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_admin_create_user', {
    p_email: input.email,
    p_full_name: input.full_name,
    p_role: input.role,
    p_manager_id: input.manager_id,
    p_phone: input.phone,
  });

  if (error) return { data: null, error: adminError(error) };
  return { data: data as string, error: null };
}

export async function updateUser(input: {
  id: string;
  full_name: string;
  phone: string | null;
  manager_id: string | null;
}): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.rpc('fn_admin_update_user', {
    p_user_id: input.id,
    p_full_name: input.full_name,
    p_phone: input.phone,
    p_manager_id: input.manager_id,
  });
  return ok(error);
}

export async function setUserRole(userId: string, role: UserRole): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.rpc('fn_admin_set_user_role', {
    p_user_id: userId,
    p_role: role,
  });
  return ok(error);
}

export async function setUserActive(
  userId: string,
  active: boolean,
  reason: string | null,
): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.rpc('fn_admin_set_user_active', {
    p_user_id: userId,
    p_active: active,
    p_reason: reason,
  });
  return ok(error);
}

// =============================================================================
// Brand assignments
// =============================================================================

export interface AdminAssignment {
  id: string;
  brand_id: string;
  brand_name: string;
  start_date: string;
}

export async function fetchAssignments(repId: string): Promise<Result<AdminAssignment[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('rep_brand_assignment')
    .select('id, brand_id, start_date, brand!inner(name)')
    .eq('rep_id', repId)
    .eq('is_active', true);

  if (error) return { data: null, error: adminError(error) };

  const rows = (data ?? []).map((row: any) => ({
    id: row.id as string,
    brand_id: row.brand_id as string,
    brand_name: (row.brand?.name ?? '') as string,
    start_date: row.start_date as string,
  }));
  rows.sort((a, b) => a.brand_name.localeCompare(b.brand_name, 'mn'));
  return { data: rows, error: null };
}

export async function assignBrand(repId: string, brandId: string): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.rpc('fn_admin_assign_brand', {
    p_rep_id: repId,
    p_brand_id: brandId,
    p_start_date: null,
  });
  return ok(error);
}

export async function endAssignment(assignmentId: string): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.rpc('fn_admin_end_brand_assignment', {
    p_assignment_id: assignmentId,
    p_end_date: null,
  });
  return ok(error);
}

// =============================================================================
// Master data counts
// =============================================================================

export interface MasterDataCounts {
  clinics_active: number;
  clinics_archived: number;
  doctors_active: number;
  doctors_archived: number;
  brands_active: number;
  products_active: number;
  users_active: number;
  clinics_default_radius: number;
}

export async function fetchMasterDataCounts(): Promise<Result<MasterDataCounts>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_admin_master_data_counts');
  if (error) return { data: null, error: adminError(error) };

  const rows = (data ?? []) as MasterDataCounts[];
  return { data: rows.length > 0 ? rows[0]! : null, error: null };
}

// =============================================================================
// Clinics
// =============================================================================

export type ClinicInput = Omit<Clinic, 'id'>;

export async function fetchClinicById(id: string): Promise<Result<Clinic>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('clinic')
    .select(
      'id, code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m, contact_phone, notes, is_active',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) return { data: null, error: adminError(error) };
  return { data: (data as Clinic) ?? null, error: null };
}

export async function createClinic(input: ClinicInput): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.from('clinic').insert(input).select('id').single();
  if (error) return { data: null, error: adminError(error) };
  return { data: (data as { id: string }).id, error: null };
}

export async function updateClinic(id: string, input: ClinicInput): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.from('clinic').update(input).eq('id', id);
  return ok(error);
}

/**
 * Archive = soft delete. The row stays so that historical visits keep a valid
 * clinic. A database trigger refuses the archive if visits are still planned
 * here; that error is shown to the administrator as written.
 */
export async function archiveClinic(id: string): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase
    .from('clinic')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', id);
  return ok(error);
}

// =============================================================================
// Doctors
// =============================================================================

export type DoctorInput = Omit<Doctor, 'id'>;

export async function fetchDoctorById(id: string): Promise<Result<Doctor>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('doctor')
    .select('id, code, full_name, speciality, phone, email, professional_notes, is_active')
    .eq('id', id)
    .maybeSingle();

  if (error) return { data: null, error: adminError(error) };
  return { data: (data as Doctor) ?? null, error: null };
}

export async function createDoctor(input: DoctorInput): Promise<Result<string>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.from('doctor').insert(input).select('id').single();
  if (error) return { data: null, error: adminError(error) };
  return { data: (data as { id: string }).id, error: null };
}

export async function updateDoctor(id: string, input: DoctorInput): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase.from('doctor').update(input).eq('id', id);
  return ok(error);
}

export async function archiveDoctor(id: string): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { error } = await supabase
    .from('doctor')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', id);
  return ok(error);
}

/**
 * Fuzzy duplicate check before creating a doctor. Two clinics spelling the same
 * person's name slightly differently is the most common way this table rots.
 */
export async function findSimilarDoctors(
  fullName: string,
): Promise<Result<{ id: string; full_name: string; speciality: string }[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.rpc('fn_find_similar_doctors', {
    p_full_name: fullName,
    p_threshold: 0.6,
  });

  if (error) return { data: null, error: adminError(error) };
  return { data: (data ?? []) as { id: string; full_name: string; speciality: string }[], error: null };
}

// =============================================================================
// Brands and products
// =============================================================================

export async function saveBrand(input: {
  id: string | null;
  code: string;
  name: string;
  category: string;
  is_active: boolean;
}): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const payload = {
    code: input.code,
    name: input.name,
    category: input.category,
    is_active: input.is_active,
  };

  const { error } = input.id
    ? await supabase.from('brand').update(payload).eq('id', input.id)
    : await supabase.from('brand').insert(payload);

  return ok(error);
}

export async function saveProduct(input: {
  id: string | null;
  sku: string;
  name: string;
  brand_id: string;
  category: string;
  is_active: boolean;
}): Promise<Result<true>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const payload = {
    sku: input.sku,
    name: input.name,
    brand_id: input.brand_id,
    category: input.category,
    is_active: input.is_active,
  };

  const { error } = input.id
    ? await supabase.from('product').update(payload).eq('id', input.id)
    : await supabase.from('product').insert(payload);

  return ok(error);
}

export type { Brand, Clinic, Doctor, Product };
