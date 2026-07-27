/**
 * Typed data access.
 *
 * Every Supabase call in the app goes through this file. Screens never build
 * queries themselves. That keeps three promises easy to keep:
 *   - one place to add offline caching in Phase 7,
 *   - one place to translate database errors into Mongolian,
 *   - one place to audit what the client is allowed to ask for.
 *
 * Note that none of these functions filter by user. They do not need to: Row
 * Level Security in the database already returns only the rows the caller may
 * see. A missing filter here is a display bug, never a data leak.
 */
import { supabase } from '@/services/supabase';
import type { Role } from '@/domain/permissions';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------
export type ClinicType =
  | 'public_hospital'
  | 'private_hospital'
  | 'clinic'
  | 'dermatology_center'
  | 'pharmacy_chain'
  | 'other';

export interface Clinic {
  id: string;
  code: string | null;
  name: string;
  clinic_type: ClinicType;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Doctor {
  id: string;
  code: string | null;
  full_name: string;
  speciality: string;
  phone: string | null;
  email: string | null;
  professional_notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DoctorClinic {
  id: string;
  doctor_id: string;
  clinic_id: string;
  department: string | null;
  room_or_floor: string | null;
  available_days: string[];
  available_hours: string | null;
  is_active: boolean;
}

export interface Brand {
  id: string;
  name: string;
  category: string | null;
  is_active: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  brand_id: string;
  category: string | null;
  is_active: boolean;
}

export interface BrandAssignment {
  id: string;
  representative_id: string;
  brand_id: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

export interface AppUserRow {
  id: string;
  email: string;
  full_name: string;
  employee_code: string | null;
  role: Role;
  phone: string | null;
  is_active: boolean;
  manager_id: string | null;
  last_login_at: string | null;
  auth_user_id: string | null;
}

export interface AppSetting {
  key: string;
  value: unknown;
  description: string;
  is_public: boolean;
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

/**
 * Postgres error codes and our own DVT_ markers, turned into something a
 * Mongolian-speaking user can act on. Anything unrecognised keeps a generic
 * message — we never show raw SQL text to a user.
 */
export function describeDbError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  if (message.includes('uq_clinics_name_district')) {
    return 'Ийм нэртэй эмнэлэг тухайн дүүрэгт аль хэдийн бүртгэгдсэн байна.';
  }
  if (message.includes('uq_doctors_identity')) {
    return 'Ийм нэр, мэргэжилтэй эмч аль хэдийн бүртгэгдсэн байна.';
  }
  if (message.includes('uq_brands_name')) {
    return 'Ийм нэртэй брэнд аль хэдийн бүртгэгдсэн байна.';
  }
  if (message.includes('products_sku_key')) {
    return 'Ийм кодтой бүтээгдэхүүн аль хэдийн бүртгэгдсэн байна.';
  }
  if (message.includes('app_users_email_key')) {
    return 'Ийм и-мэйл хаягтай хэрэглэгч аль хэдийн бүртгэгдсэн байна.';
  }
  if (message.includes('app_users_employee_code_key')) {
    return 'Ийм ажилтны кодтой хэрэглэгч аль хэдийн бүртгэгдсэн байна.';
  }
  if (message.includes('DVT_EMAIL_DOMAIN_NOT_ALLOWED')) {
    return 'Энэ и-мэйл хаягийн домэйн зөвшөөрөгдөөгүй байна.';
  }
  if (message.includes('DVT_CANNOT_CHANGE_OWN_ROLE')) {
    return 'Та өөрийн эрхээ өөрчлөх боломжгүй.';
  }
  if (message.includes('DVT_PERSONAL_IDENTIFIER_NOT_ALLOWED')) {
    return 'Тэмдэглэлд хувийн танилтын дугаар оруулах хориотой.';
  }
  if (message.includes('DVT_NOT_A_REPRESENTATIVE')) {
    return 'Брэндийг зөвхөн эмнэлгийн төлөөлөгчид хуваарилна.';
  }
  if (message.includes('DVT_IMMUTABLE_RECORD')) {
    return 'Энэ бичлэгийг өөрчлөх боломжгүй.';
  }
  if (message.includes('chk_geofence_radius')) {
    return 'Радиус 30-2000 метрийн хооронд байна.';
  }
  if (message.includes('violates row-level security')) {
    return 'Танд энэ үйлдлийг хийх эрх байхгүй байна.';
  }
  if (message.includes('excl_assignment_overlap')) {
    return 'Энэ төлөөлөгчид тухайн брэнд давхцах хугацаанд аль хэдийн хуваарилагдсан байна.';
  }
  if (/network|fetch|timeout/i.test(message)) {
    return 'Сүлжээний алдаа. Интернэт холболтоо шалгана уу.';
  }
  return 'Алдаа гарлаа. Дахин оролдоно уу.';
}

/** Throws a already-translated Error when the Supabase response failed. */
function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw new Error(describeDbError(result.error));
  if (result.data === null) throw new Error('Алдаа гарлаа. Дахин оролдоно уу.');
  return result.data;
}

// ---------------------------------------------------------------------------
// Profile and session
// ---------------------------------------------------------------------------
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  employee_code: string | null;
  phone: string | null;
  is_active: boolean;
  manager_id: string | null;
}

export async function fetchMyProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.rpc('current_user_profile');
  if (error) throw new Error(describeDbError(error));
  const rows = (data ?? []) as Profile[];
  return rows[0] ?? null;
}

export async function recordLogin(appVersion: string): Promise<void> {
  // A failure here must never block the user from getting into the app; the
  // login itself already succeeded and is not in doubt.
  await supabase.rpc('record_login', { p_app_version: appVersion });
}

export async function checkEmailAllowed(email: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_login_email_allowed', { p_email: email });
  if (error) return true; // offline or unreachable: let the server decide later
  return data === true;
}

// ---------------------------------------------------------------------------
// Master data — reads
// ---------------------------------------------------------------------------
export async function fetchClinics(includeInactive = false): Promise<Clinic[]> {
  let query = supabase.from('clinics').select('*').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  return unwrap(await query);
}

export async function fetchClinic(id: string): Promise<Clinic> {
  return unwrap(await supabase.from('clinics').select('*').eq('id', id).single());
}

export async function fetchDoctors(includeInactive = false): Promise<Doctor[]> {
  let query = supabase.from('doctors').select('*').order('full_name');
  if (!includeInactive) query = query.eq('is_active', true);
  return unwrap(await query);
}

export async function fetchDoctor(id: string): Promise<Doctor> {
  return unwrap(await supabase.from('doctors').select('*').eq('id', id).single());
}

export async function fetchDoctorClinics(doctorId: string): Promise<DoctorClinic[]> {
  return unwrap(
    await supabase.from('doctor_clinics').select('*').eq('doctor_id', doctorId).eq('is_active', true),
  );
}

export async function fetchClinicDoctors(clinicId: string): Promise<DoctorClinic[]> {
  return unwrap(
    await supabase.from('doctor_clinics').select('*').eq('clinic_id', clinicId).eq('is_active', true),
  );
}

export async function fetchBrands(includeInactive = false): Promise<Brand[]> {
  let query = supabase.from('brands').select('*').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  return unwrap(await query);
}

export async function fetchProducts(includeInactive = false): Promise<Product[]> {
  let query = supabase.from('products').select('*').order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  return unwrap(await query);
}

/** RLS returns only the caller's own rows unless they are a manager. */
export async function fetchMyBrandAssignments(): Promise<BrandAssignment[]> {
  return unwrap(
    await supabase.from('representative_brand_assignments').select('*').eq('is_active', true),
  );
}

export async function fetchStaffDirectory(): Promise<
  { id: string; full_name: string; role: Role; employee_code: string | null; is_active: boolean }[]
> {
  return unwrap(await supabase.from('staff_directory').select('*').order('full_name'));
}

export async function fetchPublicSettings(): Promise<Record<string, unknown>> {
  const rows = unwrap(await supabase.from('app_settings').select('key, value'));
  const out: Record<string, unknown> = {};
  for (const row of rows as { key: string; value: unknown }[]) out[row.key] = row.value;
  return out;
}

// ---------------------------------------------------------------------------
// Master data — writes (administrators only; RLS enforces it)
// ---------------------------------------------------------------------------
export async function upsertClinic(
  input: Partial<Clinic> & { name: string },
  id?: string,
): Promise<Clinic> {
  const query = id
    ? supabase.from('clinics').update(input).eq('id', id).select().single()
    : supabase.from('clinics').insert(input).select().single();
  return unwrap(await query);
}

export async function upsertDoctor(
  input: Partial<Doctor> & { full_name: string },
  id?: string,
): Promise<Doctor> {
  const query = id
    ? supabase.from('doctors').update(input).eq('id', id).select().single()
    : supabase.from('doctors').insert(input).select().single();
  return unwrap(await query);
}

export async function upsertBrand(
  input: Partial<Brand> & { name: string },
  id?: string,
): Promise<Brand> {
  const query = id
    ? supabase.from('brands').update(input).eq('id', id).select().single()
    : supabase.from('brands').insert(input).select().single();
  return unwrap(await query);
}

export async function upsertProduct(
  input: Partial<Product> & { name: string; sku: string; brand_id: string },
  id?: string,
): Promise<Product> {
  const query = id
    ? supabase.from('products').update(input).eq('id', id).select().single()
    : supabase.from('products').insert(input).select().single();
  return unwrap(await query);
}

/** Master data is never hard-deleted, so history and reports stay intact. */
export async function softDeleteClinic(id: string): Promise<void> {
  const { error } = await supabase
    .from('clinics')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id);
  if (error) throw new Error(describeDbError(error));
}

export async function softDeleteDoctor(id: string): Promise<void> {
  const { error } = await supabase
    .from('doctors')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id);
  if (error) throw new Error(describeDbError(error));
}

// ---------------------------------------------------------------------------
// Users (administrators only)
// ---------------------------------------------------------------------------
export async function fetchUsers(): Promise<AppUserRow[]> {
  return unwrap(await supabase.from('app_users').select('*').order('role').order('full_name'));
}

export async function createUser(input: {
  email: string;
  full_name: string;
  role: Role;
  employee_code?: string | null;
  phone?: string | null;
}): Promise<AppUserRow> {
  return unwrap(await supabase.from('app_users').insert(input).select().single());
}

export async function updateUser(
  id: string,
  input: Partial<Pick<AppUserRow, 'full_name' | 'role' | 'employee_code' | 'phone' | 'is_active'>>,
): Promise<AppUserRow> {
  return unwrap(await supabase.from('app_users').update(input).eq('id', id).select().single());
}

// ---------------------------------------------------------------------------
// Audit (managers and administrators)
// ---------------------------------------------------------------------------
export interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  actor_role: Role | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
}

export async function fetchAuditLog(limit = 100): Promise<AuditEntry[]> {
  return unwrap(
    await supabase
      .from('audit_logs')
      .select('id, occurred_at, actor_email, actor_role, action, entity_type, entity_id')
      .order('occurred_at', { ascending: false })
      .limit(limit),
  );
}
