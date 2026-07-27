/**
 * Data access.
 *
 * Every read goes through here rather than screens calling Supabase directly,
 * so that:
 *  - Phase 7 can add offline caching in ONE place;
 *  - error handling and Mongolian messages are consistent;
 *  - no screen can accidentally construct an unfiltered query.
 *
 * Note that none of these functions add "WHERE rep_id = me" style filters for
 * security. Row Level Security already does that on the server. Filtering here
 * would only be cosmetic, and relying on it would be exactly the client-side
 * enforcement mistake this project forbids.
 */
import { getSupabase } from '../lib/supabase';
import { mn } from '../lib/i18n/mn';
import type {
  Brand,
  Clinic,
  Doctor,
  DoctorClinicWithClinic,
  DoctorClinicWithDoctor,
  Product,
  RepBrandAssignment,
  Result,
} from './types';

function noClient<T>(): Result<T> {
  return { data: null, error: mn.errors.configMissing };
}

function wrap<T>(data: T | null, error: { message: string } | null): Result<T> {
  if (error) {
    // Postgres permission failures are not useful to a representative outdoors.
    const message = /permission denied|row-level security/i.test(error.message)
      ? mn.errors.noPermission
      : mn.errors.loadFailed;
    return { data: null, error: message };
  }
  return { data, error: null };
}

// -----------------------------------------------------------------------------
// Clinics
// -----------------------------------------------------------------------------
export async function fetchClinics(): Promise<Result<Clinic[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('clinic')
    .select(
      'id, code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m, contact_phone, notes, is_active',
    )
    .is('deleted_at', null)
    .order('name');

  return wrap(data as Clinic[] | null, error);
}

export async function fetchClinic(id: string): Promise<Result<Clinic>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('clinic')
    .select(
      'id, code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m, contact_phone, notes, is_active',
    )
    .eq('id', id)
    .maybeSingle();

  return wrap(data as Clinic | null, error);
}

/** Doctors working at a clinic, with their department and hours. */
export async function fetchDoctorsAtClinic(
  clinicId: string,
): Promise<Result<DoctorClinicWithDoctor[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('doctor_clinic')
    .select(
      `id, doctor_id, clinic_id, department, room_or_floor, available_days, available_hours, is_active,
       doctor:doctor_id (id, full_name, speciality, is_active)`,
    )
    .eq('clinic_id', clinicId)
    .eq('is_active', true);

  return wrap(data as unknown as DoctorClinicWithDoctor[] | null, error);
}

// -----------------------------------------------------------------------------
// Doctors
// -----------------------------------------------------------------------------
export async function fetchDoctors(): Promise<Result<Doctor[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('doctor')
    .select('id, code, full_name, speciality, phone, email, professional_notes, is_active')
    .is('deleted_at', null)
    .order('full_name');

  return wrap(data as Doctor[] | null, error);
}

export async function fetchDoctor(id: string): Promise<Result<Doctor>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('doctor')
    .select('id, code, full_name, speciality, phone, email, professional_notes, is_active')
    .eq('id', id)
    .maybeSingle();

  return wrap(data as Doctor | null, error);
}

/** The clinics a doctor works at. */
export async function fetchClinicsForDoctor(
  doctorId: string,
): Promise<Result<DoctorClinicWithClinic[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('doctor_clinic')
    .select(
      `id, doctor_id, clinic_id, department, room_or_floor, available_days, available_hours, is_active,
       clinic:clinic_id (id, name, district, address)`,
    )
    .eq('doctor_id', doctorId)
    .eq('is_active', true);

  return wrap(data as unknown as DoctorClinicWithClinic[] | null, error);
}

// -----------------------------------------------------------------------------
// Brands and products
// -----------------------------------------------------------------------------
export async function fetchBrands(): Promise<Result<Brand[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('brand')
    .select('id, code, name, category, is_active')
    .is('deleted_at', null)
    .order('name');

  return wrap(data as Brand[] | null, error);
}

export async function fetchProducts(): Promise<Result<Product[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('product')
    .select('id, sku, name, brand_id, category, is_active')
    .is('deleted_at', null)
    .order('name');

  return wrap(data as Product[] | null, error);
}

/**
 * The caller's own brand assignments.
 *
 * RLS restricts a representative to their own rows; a manager sees everyone's,
 * which is why the rep_id filter is passed explicitly for the "my brands"
 * view rather than being assumed.
 */
export async function fetchMyBrandAssignments(
  repId: string,
): Promise<Result<RepBrandAssignment[]>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase
    .from('rep_brand_assignment')
    .select('id, rep_id, brand_id, start_date, end_date, is_active')
    .eq('rep_id', repId)
    .eq('is_active', true);

  return wrap(data as RepBrandAssignment[] | null, error);
}

// -----------------------------------------------------------------------------
// Settings the device is allowed to read
// -----------------------------------------------------------------------------
export async function fetchClientSettings(): Promise<Result<Record<string, unknown>>> {
  const supabase = getSupabase();
  if (!supabase) return noClient();

  const { data, error } = await supabase.from('app_setting').select('key, value');
  if (error) return wrap<Record<string, unknown>>(null, error);

  const settings = Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
  return { data: settings, error: null };
}
