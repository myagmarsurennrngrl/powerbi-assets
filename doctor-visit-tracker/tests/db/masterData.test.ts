/**
 * Data-quality rules from docs/02-database-schema.md §12.
 *
 * These run as the administrator, because they test the constraints an
 * administrator will meet when importing a spreadsheet full of typos.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

const NEW_CLINIC = (overrides: Record<string, unknown> = {}) => ({
  code: 'CL-TEST',
  name: 'Тест Эмнэлэг',
  clinic_type: 'Хувийн клиник',
  district: 'Сүхбаатар',
  address: 'Тест хаяг 1',
  latitude: 47.92,
  longitude: 106.92,
  ...overrides,
});

async function insertClinic(s: any, c: Record<string, unknown>) {
  return s.query(
    `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, 150))`,
    [c.code, c.name, c.clinic_type, c.district, c.address, c.latitude, c.longitude, c.geofence_radius_m ?? null],
  );
}

describe.skipIf(!DB_AVAILABLE)('master data quality', () => {
  afterAll(closePool);

  // ---------------------------------------------------------------------------
  describe('clinic', () => {
    it('rejects a duplicate clinic name in the same district', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('CL-DUP', 'Дермалайф арьс судлалын төв', 'Хувийн', 'Сүхбаатар', 'хаяг', 47.92, 106.92)`,
        );
        expect(error.message).toMatch(/clinic_unique_name_district|duplicate key/i);
      });
    });

    it('ALLOWS the same clinic name in a different district', async () => {
      await actingAs(USERS.admin, async (s) => {
        await insertClinic(s, NEW_CLINIC({
          code: 'CL-OTHER',
          name: 'Дермалайф арьс судлалын төв',
          district: 'Баянгол',
        }));
        const rows = await s.query("SELECT 1 FROM public.clinic WHERE code = 'CL-OTHER'");
        expect(rows).toHaveLength(1);
      });
    });

    it('rejects coordinates at null island (0,0)', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('CL-ZERO', 'Тэг Эмнэлэг', 'Хувийн', 'Сүхбаатар', 'хаяг', 0, 0)`,
        );
        expect(error.message).toMatch(/null_island/i);
      });
    });

    it('rejects out-of-range coordinates', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('CL-BAD', 'Буруу Эмнэлэг', 'Хувийн', 'Сүхбаатар', 'хаяг', 91, 200)`,
        );
      });
    });

    it('rejects a geofence radius that is too small to ever satisfy', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m)
           VALUES ('CL-TINY', 'Жижиг Радиус', 'Хувийн', 'Сүхбаатар', 'хаяг', 47.92, 106.92, 5)`,
        );
        expect(error.message).toMatch(/geofence_radius_sane/i);
      });
    });

    it('rejects a geofence radius so large it stops meaning "at the clinic"', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude, geofence_radius_m)
           VALUES ('CL-HUGE', 'Том Радиус', 'Хувийн', 'Сүхбаатар', 'хаяг', 47.92, 106.92, 50000)`,
        );
      });
    });

    it('warns (without blocking) about coordinates outside Mongolia', async () => {
      const [ok] = await asSuperuser<{ plausible: boolean }>(
        'SELECT public.fn_clinic_coordinates_plausible(47.9187, 106.9172) AS plausible',
      );
      expect(ok.plausible).toBe(true);

      // Swapped latitude/longitude — the most common import mistake.
      const [swapped] = await asSuperuser<{ plausible: boolean }>(
        'SELECT public.fn_clinic_coordinates_plausible(106.9172, 47.9187) AS plausible',
      );
      expect(swapped.plausible).toBe(false);
    });

    it('allows re-adding a clinic after it was soft-deleted', async () => {
      await actingAs(USERS.admin, async (s) => {
        // Archive a clinic with nothing scheduled. Phase 6 added a trigger that
        // refuses to archive a clinic representatives still have on their
        // route, so this test creates its own throwaway clinic rather than
        // borrowing a seeded one that has planned visits.
        await insertClinic(s, NEW_CLINIC({ code: 'CL-REUSE', name: 'Дахин Нэр' }));
        await s.query(
          "UPDATE public.clinic SET is_active = false, deleted_at = now() WHERE code = 'CL-REUSE'",
        );
        // The partial unique index ignores soft-deleted rows, so the name frees up.
        await insertClinic(s, NEW_CLINIC({ code: 'CL-REUSE-B', name: 'Дахин Нэр' }));
        const rows = await s.query(
          "SELECT * FROM public.clinic WHERE lower(name) = lower('Дахин Нэр')",
        );
        expect(rows).toHaveLength(2);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('doctor', () => {
    it('rejects a duplicate doctor name in the same speciality', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.doctor (code, full_name, speciality)
           VALUES ('DR-DUP', 'А. Алтанцэцэг', 'Арьс судлаач')`,
        );
      });
    });

    it('finds near-duplicate names for the import preview', async () => {
      const rows = await asSuperuser<{ full_name: string; similarity: number }>(
        "SELECT * FROM public.fn_find_similar_doctors('А. Алтанцэцэг', 0.6)",
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].full_name).toBe('А. Алтанцэцэг');
    });

    it('rejects a malformed doctor email', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.doctor (code, full_name, speciality, email)
           VALUES ('DR-MAIL', 'Тест Эмч', 'Арьс судлаач', 'not-an-email')`,
        );
      });
    });

    it('has no column that could hold patient information', async () => {
      const columns = await asSuperuser<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'doctor'`,
      );
      const names = columns.map((c) => c.column_name);
      for (const forbidden of ['patient', 'diagnosis', 'treatment', 'prescription', 'medical_record']) {
        expect(names.some((n) => n.includes(forbidden))).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('orphan prevention', () => {
    it('refuses to delete a brand that has products', async () => {
      await asSuperuser("SAVEPOINT s").catch(() => {});
      await expect(
        asSuperuser("DELETE FROM public.brand WHERE code = 'BR-01'"),
      ).rejects.toThrow(/violates foreign key constraint/i);
    });

    it('refuses to point a product at a brand that does not exist', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.product (sku, name, brand_id, category)
           VALUES ('P-ORPHAN', 'Өнчин бүтээгдэхүүн', gen_random_uuid(), 'Тест')`,
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('representative-brand assignments', () => {
    it('refuses to assign a brand to a manager', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `INSERT INTO public.rep_brand_assignment (rep_id, brand_id, start_date)
           SELECT u.id, b.id, CURRENT_DATE
             FROM public.app_user u, public.brand b
            WHERE u.email = 'manager01@monos.mn' AND b.code = 'BR-01'`,
        );
        expect(error.message).toMatch(/only be assigned to a representative/i);
      });
    });

    it('refuses an end date before the start date', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.rep_brand_assignment (rep_id, brand_id, start_date, end_date)
           SELECT u.id, b.id, DATE '2026-06-01', DATE '2026-01-01'
             FROM public.app_user u, public.brand b
            WHERE u.email = 'rep01@monos.mn' AND b.code = 'BR-10'`,
        );
      });
    });

    it('refuses the same active brand twice for one representative', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.rep_brand_assignment (rep_id, brand_id, start_date)
           SELECT u.id, b.id, CURRENT_DATE
             FROM public.app_user u, public.brand b
            WHERE u.email = 'rep01@monos.mn' AND b.code = 'BR-01'`,
        );
      });
    });

    it('ALLOWS two representatives to carry the same brand', async () => {
      // This is what makes two reps legitimately visiting the same doctor valid.
      const rows = await asSuperuser<{ rep_count: string }>(
        `SELECT count(DISTINCT rep_id) AS rep_count
           FROM public.rep_brand_assignment a
           JOIN public.brand b ON b.id = a.brand_id
          WHERE b.code = 'BR-01' AND a.is_active`,
      );
      expect(Number(rows[0].rep_count)).toBeGreaterThan(1);
    });

    it('reports the brands a representative currently holds', async () => {
      const rows = await asSuperuser(
        `SELECT public.fn_rep_brand_ids(
           (SELECT id FROM public.app_user WHERE email = 'rep01@monos.mn'),
           CURRENT_DATE)`,
      );
      expect(rows).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  describe('audit log', () => {
    it('records a master-data change automatically', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          "UPDATE public.clinic SET contact_phone = '+976 0000 0000' WHERE code = 'CL-005'",
        );

        const [entry] = await s.query<{
          action: string;
          entity_type: string;
          before_data: Record<string, unknown>;
          after_data: Record<string, unknown>;
          actor_email: string;
        }>(
          `SELECT action, entity_type, before_data, after_data, actor_email
             FROM public.audit_log
            WHERE entity_type = 'clinic'
              AND entity_id = (SELECT id FROM public.clinic WHERE code = 'CL-005')
            ORDER BY occurred_at DESC LIMIT 1`,
        );

        expect(entry.action).toBe('master_data_changed');
        expect(entry.actor_email).toBe('admin@monos.mn');
        expect(entry.before_data.contact_phone).toBe('+976 7011 0005');
        expect(entry.after_data.contact_phone).toBe('+976 0000 0000');
      });
    });

    it('does not record a no-op update', async () => {
      await actingAs(USERS.admin, async (s) => {
        const before = await s.query<{ n: string }>(
          "SELECT count(*) AS n FROM public.audit_log WHERE entity_type = 'clinic'",
        );
        await s.query(
          "UPDATE public.clinic SET contact_phone = contact_phone WHERE code = 'CL-006'",
        );
        const after = await s.query<{ n: string }>(
          "SELECT count(*) AS n FROM public.audit_log WHERE entity_type = 'clinic'",
        );
        expect(after[0].n).toBe(before[0].n);
      });
    });

    it('cannot be rewritten even by the table owner’s trigger path', async () => {
      await expect(
        asSuperuser("UPDATE public.audit_log SET action = 'login' WHERE id = (SELECT min(id) FROM public.audit_log)"),
      ).rejects.toThrow(/append-only/i);

      await expect(
        asSuperuser('DELETE FROM public.audit_log WHERE id = (SELECT min(id) FROM public.audit_log)'),
      ).rejects.toThrow(/append-only/i);
    });
  });
});
