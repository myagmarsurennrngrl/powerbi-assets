/**
 * Input validation and data-quality rules.
 *
 * The patient-identifier tests use the SAME examples as
 * supabase/tests/03_data_quality.test.sql, so the TypeScript and SQL
 * implementations cannot drift apart without one of them failing.
 */
import { describe, expect, it } from 'vitest';
import {
  brandSchema,
  clinicSchema,
  containsPersonalIdentifier,
  doctorSchema,
  isInsideMongolia,
  productSchema,
  toFieldErrors,
  userSchema,
} from '@/domain/validation';

const validClinic = {
  code: 'CL-001',
  name: 'Түмэн Арьс Судлалын Төв',
  clinic_type: 'dermatology_center' as const,
  district: 'Сүхбаатар',
  address: 'Сүхбаатар дүүрэг, 1-р хороо, Энхтайваны өргөн чөлөө 12',
  latitude: 47.9187,
  longitude: 106.9174,
  geofence_radius_m: 150,
  contact_phone: '+976 7011 0001',
  notes: '',
  is_active: true,
};

describe('clinicSchema', () => {
  it('accepts a well-formed clinic', () => {
    expect(clinicSchema.safeParse(validClinic).success).toBe(true);
  });

  it('rejects a blank or whitespace-only name', () => {
    expect(clinicSchema.safeParse({ ...validClinic, name: '' }).success).toBe(false);
    expect(clinicSchema.safeParse({ ...validClinic, name: '   ' }).success).toBe(false);
  });

  it('rejects impossible coordinates', () => {
    expect(clinicSchema.safeParse({ ...validClinic, latitude: 95 }).success).toBe(false);
    expect(clinicSchema.safeParse({ ...validClinic, latitude: -91 }).success).toBe(false);
    expect(clinicSchema.safeParse({ ...validClinic, longitude: 181 }).success).toBe(false);
    expect(clinicSchema.safeParse({ ...validClinic, longitude: Number.NaN }).success).toBe(false);
  });

  /**
   * The lower bound matters: a radius smaller than ordinary urban GPS error
   * would make check-in impossible and the app unusable.
   */
  it('keeps the geofence radius inside a workable range', () => {
    expect(clinicSchema.safeParse({ ...validClinic, geofence_radius_m: 30 }).success).toBe(true);
    expect(clinicSchema.safeParse({ ...validClinic, geofence_radius_m: 2000 }).success).toBe(true);
    expect(clinicSchema.safeParse({ ...validClinic, geofence_radius_m: 29 }).success).toBe(false);
    expect(clinicSchema.safeParse({ ...validClinic, geofence_radius_m: 2001 }).success).toBe(false);
    expect(clinicSchema.safeParse({ ...validClinic, geofence_radius_m: 150.5 }).success).toBe(false);
  });

  it('refuses notes that look like patient data', () => {
    const result = clinicSchema.safeParse({
      ...validClinic,
      notes: 'Өвчтөн УБ12345678 ирсэн',
    });
    expect(result.success).toBe(false);
  });
});

describe('isInsideMongolia', () => {
  it('recognises Ulaanbaatar', () => {
    expect(isInsideMongolia(47.9187, 106.9174)).toBe(true);
  });

  it('recognises other Mongolian cities', () => {
    expect(isInsideMongolia(49.0347, 104.0442)).toBe(true); // Darkhan
    expect(isInsideMongolia(49.6349, 100.1625)).toBe(true); // Mörön
  });

  it('flags coordinates outside the country', () => {
    expect(isInsideMongolia(39.9042, 116.4074)).toBe(false); // Beijing
    expect(isInsideMongolia(55.7558, 37.6173)).toBe(false); // Moscow
    expect(isInsideMongolia(0, 0)).toBe(false); // the classic "forgot to fill it in"
  });
});

describe('containsPersonalIdentifier', () => {
  it('detects Mongolian national ID patterns', () => {
    expect(containsPersonalIdentifier('Өвчтөн УБ12345678 ирсэн')).toBe(true);
    expect(containsPersonalIdentifier('ЧД 87654321')).toBe(true);
  });

  it('detects long bare digit runs such as registration numbers', () => {
    expect(containsPersonalIdentifier('регистр 99123456 дугаартай')).toBe(true);
    expect(containsPersonalIdentifier('12345678')).toBe(true);
  });

  it('leaves ordinary professional text alone', () => {
    expect(containsPersonalIdentifier('Dermaline SPF50 бүтээгдэхүүнийг танилцууллаа')).toBe(false);
    expect(containsPersonalIdentifier('2026 оны 7 сард 15 ширхэг сорьц өглөө')).toBe(false);
    expect(containsPersonalIdentifier('Утас: +976 9911 0001')).toBe(false);
    expect(containsPersonalIdentifier('')).toBe(false);
  });
});

describe('doctorSchema', () => {
  const valid = {
    code: 'DR-001',
    full_name: 'Д.Оюунчимэг',
    speciality: 'Арьс өвчин судлал',
    phone: '',
    email: '',
    professional_notes: '',
    is_active: true,
  };

  it('accepts a doctor with only the required fields', () => {
    expect(doctorSchema.safeParse(valid).success).toBe(true);
  });

  it('requires a name and a speciality', () => {
    expect(doctorSchema.safeParse({ ...valid, full_name: '' }).success).toBe(false);
    expect(doctorSchema.safeParse({ ...valid, speciality: '' }).success).toBe(false);
  });

  it('validates an optional e-mail only when one is given', () => {
    expect(doctorSchema.safeParse({ ...valid, email: '' }).success).toBe(true);
    expect(doctorSchema.safeParse({ ...valid, email: 'ok@example.test' }).success).toBe(true);
    expect(doctorSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('refuses professional notes containing patient identifiers', () => {
    expect(
      doctorSchema.safeParse({ ...valid, professional_notes: 'Өвчтөн УБ12345678' }).success,
    ).toBe(false);
  });
});

describe('productSchema', () => {
  const valid = {
    name: 'Dermaline Serum 30ml',
    sku: 'DERMALINE-03',
    brand_id: '30000000-0000-4000-a000-000000000001',
    category: 'Дермокосметик',
    is_active: true,
  };

  it('accepts a well-formed product', () => {
    expect(productSchema.safeParse(valid).success).toBe(true);
  });

  it('upper-cases the SKU so codes cannot differ only by case', () => {
    const result = productSchema.safeParse({ ...valid, sku: 'dermaline-03' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sku).toBe('DERMALINE-03');
  });

  it('rejects SKUs with spaces or unsupported characters', () => {
    expect(productSchema.safeParse({ ...valid, sku: 'HAS SPACE' }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, sku: 'a' }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, sku: 'ЖИШЭЭ-01' }).success).toBe(false);
  });

  it('requires a brand — no orphan products', () => {
    expect(productSchema.safeParse({ ...valid, brand_id: '' }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, brand_id: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('brandSchema', () => {
  it('requires a name', () => {
    expect(brandSchema.safeParse({ name: 'Dermaline', category: '', is_active: true }).success).toBe(
      true,
    );
    expect(brandSchema.safeParse({ name: ' ', category: '', is_active: true }).success).toBe(false);
  });
});

describe('userSchema', () => {
  const valid = {
    full_name: 'Е.Ариунзаяа',
    email: 'rep1@company.mn',
    employee_code: 'EMP-021',
    role: 'representative' as const,
    phone: '+976 9911 0021',
    is_active: true,
  };

  it('accepts a well-formed user', () => {
    expect(userSchema.safeParse(valid).success).toBe(true);
  });

  it('normalises the e-mail to lower case', () => {
    const result = userSchema.safeParse({ ...valid, email: 'REP1@Company.MN' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('rep1@company.mn');
  });

  it('only accepts the three known roles', () => {
    expect(userSchema.safeParse({ ...valid, role: 'superuser' }).success).toBe(false);
  });
});

describe('toFieldErrors', () => {
  it('maps each field to its first Mongolian message', () => {
    const result = clinicSchema.safeParse({ ...validClinic, name: '', district: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = toFieldErrors(result.error);
      expect(errors.name).toBeTruthy();
      expect(errors.district).toBeTruthy();
      expect(errors.address).toBeUndefined();
    }
  });
});
