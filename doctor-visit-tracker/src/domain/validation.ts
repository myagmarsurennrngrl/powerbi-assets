/**
 * Input validation schemas shared by the admin forms.
 *
 * These run on the phone so the user gets an immediate, Mongolian error
 * message. The database repeats every one of these rules as a CHECK
 * constraint, a unique index or a trigger, so a bypassed client changes
 * nothing.
 */
import { z } from 'zod';
import { mn } from '@/i18n/mn';

/** Mongolia's bounding box, used to warn about obviously wrong coordinates. */
export const MONGOLIA_BOUNDS = {
  minLat: 41.5,
  maxLat: 52.2,
  minLng: 87.7,
  maxLng: 119.95,
} as const;

export function isInsideMongolia(lat: number, lng: number): boolean {
  return (
    lat >= MONGOLIA_BOUNDS.minLat &&
    lat <= MONGOLIA_BOUNDS.maxLat &&
    lng >= MONGOLIA_BOUNDS.minLng &&
    lng <= MONGOLIA_BOUNDS.maxLng
  );
}

/**
 * Blocks anything that looks like a national ID or registration number.
 * Mirrors public.contains_personal_identifier() in the database — the two are
 * tested against the same examples so they cannot drift apart.
 */
const NATIONAL_ID = /[А-ЯӨҮЁа-яөүё]{2}\s?[0-9]{8}/;
const LONG_DIGIT_RUN = /(^|[^0-9])[0-9]{8,}([^0-9]|$)/;

export function containsPersonalIdentifier(text: string): boolean {
  return NATIONAL_ID.test(text) || LONG_DIGIT_RUN.test(text);
}

const noPatientData = (label: string) =>
  z.string().refine((v) => !containsPersonalIdentifier(v), {
    message: `${label}: ${mn.doctors.noPatientData}`,
  });

const nonBlank = (min: number, message: string) =>
  z.string().trim().min(min, message);

// ---------------------------------------------------------------------------
// Clinic
// ---------------------------------------------------------------------------
export const clinicSchema = z.object({
  code: z.string().trim().max(32).optional().or(z.literal('')),
  name: nonBlank(2, 'Эмнэлгийн нэрийг оруулна уу.').max(200),
  clinic_type: z.enum([
    'public_hospital',
    'private_hospital',
    'clinic',
    'dermatology_center',
    'pharmacy_chain',
    'other',
  ]),
  district: nonBlank(2, 'Дүүргийг оруулна уу.').max(100),
  address: nonBlank(5, 'Дэлгэрэнгүй хаягийг оруулна уу.').max(400),
  latitude: z
    .number({ message: 'Өргөрөг тоо байх ёстой.' })
    .min(-90, mn.admin.invalidCoordinates)
    .max(90, mn.admin.invalidCoordinates),
  longitude: z
    .number({ message: 'Уртраг тоо байх ёстой.' })
    .min(-180, mn.admin.invalidCoordinates)
    .max(180, mn.admin.invalidCoordinates),
  geofence_radius_m: z
    .number({ message: 'Радиус тоо байх ёстой.' })
    .int()
    .min(30, 'Радиус хамгийн багадаа 30 м байна.')
    .max(2000, 'Радиус хамгийн ихдээ 2000 м байна.'),
  contact_phone: z.string().trim().max(40).optional().or(z.literal('')),
  notes: noPatientData('Тэмдэглэл').max(2000).optional().or(z.literal('')),
  is_active: z.boolean(),
});

export type ClinicInput = z.infer<typeof clinicSchema>;

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------
export const doctorSchema = z.object({
  code: z.string().trim().max(32).optional().or(z.literal('')),
  full_name: nonBlank(2, 'Эмчийн нэрийг оруулна уу.').max(200),
  speciality: nonBlank(2, 'Мэргэжлийг оруулна уу.').max(120),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z
    .string()
    .trim()
    .email('И-мэйл хаяг буруу байна.')
    .max(254)
    .optional()
    .or(z.literal('')),
  professional_notes: noPatientData('Мэргэжлийн тэмдэглэл')
    .max(2000)
    .optional()
    .or(z.literal('')),
  is_active: z.boolean(),
});

export type DoctorInput = z.infer<typeof doctorSchema>;

// ---------------------------------------------------------------------------
// Brand and product
// ---------------------------------------------------------------------------
export const brandSchema = z.object({
  name: nonBlank(2, 'Брэндийн нэрийг оруулна уу.').max(120),
  category: z.string().trim().max(120).optional().or(z.literal('')),
  is_active: z.boolean(),
});

export const productSchema = z.object({
  name: nonBlank(2, 'Бүтээгдэхүүний нэрийг оруулна уу.').max(200),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9._-]{1,31}$/,
      'Код нь латин том үсэг, тоо, . _ - тэмдэгтээс бүрдэх ба 2-32 тэмдэгт байна.',
    ),
  brand_id: z.string().uuid('Брэнд сонгоно уу.'),
  category: z.string().trim().max(120).optional().or(z.literal('')),
  is_active: z.boolean(),
});

export type BrandInput = z.infer<typeof brandSchema>;
export type ProductInput = z.infer<typeof productSchema>;

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------
export const userSchema = z.object({
  full_name: nonBlank(2, 'Овог нэрийг оруулна уу.').max(200),
  email: z.string().trim().toLowerCase().email('И-мэйл хаяг буруу байна.').max(254),
  employee_code: z.string().trim().max(32).optional().or(z.literal('')),
  role: z.enum(['representative', 'manager', 'administrator']),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  is_active: z.boolean(),
});

export type UserInput = z.infer<typeof userSchema>;

/** Turns a Zod error into `{ fieldName: 'Mongolian message' }` for the forms. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
