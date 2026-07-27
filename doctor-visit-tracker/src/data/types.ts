/**
 * TypeScript shapes for the database rows the app reads.
 *
 * Field names match the SQL columns exactly (snake_case). Keeping them
 * identical means a query result can be used directly — no mapping layer to
 * drift out of sync with a migration.
 */

export type UserRole = 'representative' | 'manager' | 'administrator';

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  manager_id: string | null;
  is_active: boolean;
}

export interface Clinic {
  id: string;
  code: string;
  name: string;
  clinic_type: string;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface Doctor {
  id: string;
  code: string;
  full_name: string;
  speciality: string;
  phone: string | null;
  email: string | null;
  professional_notes: string | null;
  is_active: boolean;
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

/** doctor_clinic joined with the clinic, as returned by the nested select. */
export interface DoctorClinicWithClinic extends DoctorClinic {
  clinic: Pick<Clinic, 'id' | 'name' | 'district' | 'address'> | null;
}

/** doctor_clinic joined with the doctor. */
export interface DoctorClinicWithDoctor extends DoctorClinic {
  doctor: Pick<Doctor, 'id' | 'full_name' | 'speciality' | 'is_active'> | null;
}

export interface Brand {
  id: string;
  code: string;
  name: string;
  category: string;
  is_active: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand_id: string;
  category: string;
  is_active: boolean;
}

export interface RepBrandAssignment {
  id: string;
  rep_id: string;
  brand_id: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

export interface AppSetting {
  key: string;
  value: unknown;
  description: string;
}

/** Standard result envelope so screens handle failure uniformly. */
export interface Result<T> {
  data: T | null;
  error: string | null;
}
