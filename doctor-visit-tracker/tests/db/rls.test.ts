/**
 * ACCEPTANCE CRITERION 11: a representative cannot change another
 * representative's data — and, more broadly, the permissions matrix in
 * docs/03-roles-permissions.md holds at the DATABASE level.
 *
 * Every assertion here runs as the `authenticated` or `anon` role with a real
 * JWT subject claim, which is exactly how PostgREST executes a request from
 * the mobile app. Passing these tests means the rules survive a stolen anon
 * key and a hand-written curl request.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  actingAs,
  actingAsAnon,
  actingAsUnprovisioned,
  asSuperuser,
  closePool,
  DB_AVAILABLE,
  USERS,
} from './helpers';

describe.skipIf(!DB_AVAILABLE)('row level security', () => {
  afterAll(closePool);

  // ---------------------------------------------------------------------------
  describe('structural guarantees', () => {
    it('every table in the public schema has RLS enabled', async () => {
      const rows = await asSuperuser<{ table_name: string }>(
        'SELECT * FROM public.fn_tables_without_rls()',
      );
      expect(rows.map((r) => r.table_name)).toEqual([]);
    });

    it('every RLS-enabled table has at least one policy', async () => {
      const rows = await asSuperuser<{ table_name: string }>(
        'SELECT * FROM public.fn_tables_with_rls_but_no_policy()',
      );
      expect(rows.map((r) => r.table_name)).toEqual([]);
    });

    it('DELETE is granted to nobody on any application table', async () => {
      const rows = await asSuperuser<{ table_name: string; grantee: string }>(
        `SELECT table_name, grantee
           FROM information_schema.role_table_grants
          WHERE table_schema = 'public'
            AND privilege_type = 'DELETE'
            AND grantee IN ('anon', 'authenticated')`,
      );
      expect(rows).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('anonymous callers', () => {
    it('cannot read clinics', async () => {
      await actingAsAnon(async (s) => {
        await s.expectDenied('SELECT * FROM public.clinic');
      });
    });

    it('cannot read doctors', async () => {
      await actingAsAnon(async (s) => {
        await s.expectDenied('SELECT * FROM public.doctor');
      });
    });

    it('cannot read the audit log', async () => {
      await actingAsAnon(async (s) => {
        await s.expectDenied('SELECT * FROM public.audit_log');
      });
    });

    it('CAN check whether an address is allowed to sign in (login screen only)', async () => {
      await actingAsAnon(async (s) => {
        const rows = await s.query<{ ok: boolean }>(
          "SELECT public.fn_can_email_sign_in('rep01@monos.mn') AS ok",
        );
        expect(rows[0].ok).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('an authenticated identity with no app_user row', () => {
    it('sees nothing at all, even though its domain is approved', async () => {
      await asSuperuser("DELETE FROM auth.users WHERE email = 'ghost@monos.mn'");
      const [authUser] = await asSuperuser<{ id: string }>(
        "INSERT INTO auth.users (email) VALUES ('ghost@monos.mn') RETURNING id",
      );

      await actingAsUnprovisioned(authUser.id, async (s) => {
        await s.expectInvisible('SELECT * FROM public.clinic');
        await s.expectInvisible('SELECT * FROM public.doctor');
        await s.expectInvisible('SELECT * FROM public.brand');
      });

      await asSuperuser("DELETE FROM auth.users WHERE email = 'ghost@monos.mn'");
    });
  });

  // ---------------------------------------------------------------------------
  describe('representative', () => {
    it('can read clinics, doctors, brands and products', async () => {
      await actingAs(USERS.rep1, async (s) => {
        expect((await s.query('SELECT * FROM public.clinic')).length).toBe(15);
        expect((await s.query('SELECT * FROM public.doctor')).length).toBe(50);
        expect((await s.query('SELECT * FROM public.brand')).length).toBe(10);
        expect((await s.query('SELECT * FROM public.product')).length).toBe(50);
      });
    });

    it('CANNOT create a clinic', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('X-999', 'Хууль бус эмнэлэг', 'Хувийн', 'Сүхбаатар', 'хаяг', 47.9, 106.9)`,
        );
        expect(error.message).toMatch(/row-level security/i);
      });
    });

    it('CANNOT modify a clinic (including its geofence radius)', async () => {
      await actingAs(USERS.rep1, async (s) => {
        // RLS UPDATE with a USING clause that matches nothing does not raise —
        // it simply affects zero rows. Assert the data is genuinely unchanged.
        await s.query("UPDATE public.clinic SET geofence_radius_m = 2000 WHERE code = 'CL-001'");
      });
      const [clinic] = await asSuperuser<{ geofence_radius_m: number }>(
        "SELECT geofence_radius_m FROM public.clinic WHERE code = 'CL-001'",
      );
      expect(clinic.geofence_radius_m).toBe(150);
    });

    it('CANNOT create a doctor', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.doctor (code, full_name, speciality)
           VALUES ('DR-999', 'Шинэ Эмч', 'Арьс судлаач')`,
        );
      });
    });

    it('CANNOT promote themselves to administrator', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `UPDATE public.app_user SET role = 'administrator'
            WHERE email = 'rep01@monos.mn'`,
        );
        expect(error.message).toMatch(/only an administrator/i);
      });

      const [user] = await asSuperuser<{ role: string }>(
        "SELECT role FROM public.app_user WHERE email = 'rep01@monos.mn'",
      );
      expect(user.role).toBe('representative');
    });

    it('CANNOT change another representative’s record', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.query(
          "UPDATE public.app_user SET full_name = 'Хакердсан нэр' WHERE email = 'rep02@monos.mn'",
        );
      });
      const [victim] = await asSuperuser<{ full_name: string }>(
        "SELECT full_name FROM public.app_user WHERE email = 'rep02@monos.mn'",
      );
      expect(victim.full_name).toBe('Б. Болормаа');
    });

    it('CAN correct their own name and phone', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.query(
          "UPDATE public.app_user SET full_name = 'А. Ариунзаяа (шинэ)' WHERE email = 'rep01@monos.mn'",
        );
        const [row] = await s.query<{ full_name: string }>(
          "SELECT full_name FROM public.app_user WHERE email = 'rep01@monos.mn'",
        );
        expect(row.full_name).toBe('А. Ариунзаяа (шинэ)');
      });
      // rolled back by the helper — confirm nothing persisted
      const [after] = await asSuperuser<{ full_name: string }>(
        "SELECT full_name FROM public.app_user WHERE email = 'rep01@monos.mn'",
      );
      expect(after.full_name).toBe('А. Ариунзаяа');
    });

    it('sees only their OWN brand assignments', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const rows = await s.query<{ rep_id: string }>(
          'SELECT DISTINCT rep_id FROM public.rep_brand_assignment',
        );
        expect(rows).toHaveLength(1);

        const [me] = await s.query<{ id: string }>('SELECT public.fn_current_app_user_id() AS id');
        expect(rows[0].rep_id).toBe(me.id);
      });
    });

    it('CANNOT read the audit log', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectInvisible('SELECT * FROM public.audit_log');
      });
    });

    it('CANNOT write to the audit log', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectDenied(
          "INSERT INTO public.audit_log (action) VALUES ('login')",
        );
      });
    });

    it('CANNOT read the approved email domain list', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectInvisible('SELECT * FROM public.approved_email_domain');
      });
    });

    it('reads client-safe settings but NOT retention configuration', async () => {
      await actingAs(USERS.rep1, async (s) => {
        const visible = await s.query<{ key: string }>('SELECT key FROM public.app_setting');
        const keys = visible.map((r) => r.key);
        expect(keys).toContain('gps_accuracy_threshold_m');
        expect(keys).toContain('default_geofence_radius_m');
        expect(keys).not.toContain('retention_days_visit');
      });
    });

    it('CANNOT change a setting', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.query(
          "UPDATE public.app_setting SET value = '5000'::jsonb WHERE key = 'default_geofence_radius_m'",
        );
      });
      const [setting] = await asSuperuser<{ value: number }>(
        "SELECT value FROM public.app_setting WHERE key = 'default_geofence_radius_m'",
      );
      expect(Number(setting.value)).toBe(150);
    });

    it('CANNOT turn on the audio recording feature flag', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.query(
          "UPDATE public.app_setting SET value = 'true'::jsonb WHERE key = 'feature_audio_recording_enabled'",
        );
      });
      const [flag] = await asSuperuser<{ value: boolean }>(
        "SELECT value FROM public.app_setting WHERE key = 'feature_audio_recording_enabled'",
      );
      expect(flag.value).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('manager', () => {
    it('sees every representative’s brand assignments', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query<{ rep_id: string }>(
          'SELECT DISTINCT rep_id FROM public.rep_brand_assignment',
        );
        expect(rows.length).toBe(7);
      });
    });

    it('CAN read the audit log', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const rows = await s.query('SELECT * FROM public.audit_log LIMIT 5');
        expect(rows.length).toBeGreaterThan(0);
      });
    });

    it('CANNOT edit the audit log', async () => {
      await actingAs(USERS.manager1, async (s) => {
        await s.expectDenied("UPDATE public.audit_log SET action = 'login'");
        await s.expectDenied('DELETE FROM public.audit_log');
      });
    });

    it('CANNOT create a clinic — that is an administrator task', async () => {
      await actingAs(USERS.manager1, async (s) => {
        await s.expectDenied(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('X-998', 'Менежерийн эмнэлэг', 'Хувийн', 'Сүхбаатар', 'хаяг', 47.9, 106.9)`,
        );
      });
    });

    it('CANNOT change anyone’s role', async () => {
      // The UPDATE policy's USING clause matches no row for a manager, so the
      // statement affects zero rows rather than raising. Asserting on the
      // resulting DATA is the assertion that actually matters.
      await actingAs(USERS.manager1, async (s) => {
        await s.query(
          "UPDATE public.app_user SET role = 'administrator' WHERE email = 'rep01@monos.mn'",
        );
        const [target] = await s.query<{ role: string }>(
          "SELECT role FROM public.app_user WHERE email = 'rep01@monos.mn'",
        );
        expect(target.role).toBe('representative');
      });

      const [after] = await asSuperuser<{ role: string }>(
        "SELECT role FROM public.app_user WHERE email = 'rep01@monos.mn'",
      );
      expect(after.role).toBe('representative');
    });
  });

  // ---------------------------------------------------------------------------
  describe('administrator', () => {
    it('CAN create and soft-delete a clinic', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('CL-900', 'Шинэ Тест Эмнэлэг', 'Хувийн клиник', 'Сүхбаатар', 'Тест хаяг 1', 47.9200, 106.9200)`,
        );
        const rows = await s.query("SELECT * FROM public.clinic WHERE code = 'CL-900'");
        expect(rows).toHaveLength(1);

        await s.query("UPDATE public.clinic SET deleted_at = now(), is_active = false WHERE code = 'CL-900'");
        const [after] = await s.query<{ deleted_at: Date | null }>(
          "SELECT deleted_at FROM public.clinic WHERE code = 'CL-900'",
        );
        expect(after.deleted_at).not.toBeNull();
      });
    });

    it('CAN change a representative’s role, and it is audited', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.query("UPDATE public.app_user SET role = 'manager' WHERE email = 'rep07@monos.mn'");

        const audit = await s.query<{ action: string }>(
          `SELECT action FROM public.audit_log
            WHERE action = 'user_role_changed'
              AND entity_id = (SELECT id FROM public.app_user WHERE email = 'rep07@monos.mn')`,
        );
        expect(audit.length).toBeGreaterThan(0);
      });
    });

    it('CAN read the approved domain list and retention settings', async () => {
      await actingAs(USERS.admin, async (s) => {
        expect((await s.query('SELECT * FROM public.approved_email_domain')).length).toBe(1);
        const keys = (await s.query<{ key: string }>('SELECT key FROM public.app_setting')).map(
          (r) => r.key,
        );
        expect(keys).toContain('retention_days_visit');
      });
    });

    it('still CANNOT delete an audit entry', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied('DELETE FROM public.audit_log');
      });
    });

    it('still CANNOT delete a clinic outright — soft delete only', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.expectDenied("DELETE FROM public.clinic WHERE code = 'CL-001'");
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('deactivated user', () => {
    it('loses all access the moment is_active becomes false', async () => {
      await asSuperuser(
        `UPDATE public.app_user SET is_active = false, deactivated_at = now()
          WHERE email = 'rep04@monos.mn'`,
      );
      try {
        await actingAs(USERS.rep4, async (s) => {
          await s.expectInvisible('SELECT * FROM public.clinic');
          const [me] = await s.query<{ id: string | null }>(
            'SELECT public.fn_current_app_user_id() AS id',
          );
          expect(me.id).toBeNull();
        });
      } finally {
        await asSuperuser(
          `UPDATE public.app_user SET is_active = true, deactivated_at = NULL
            WHERE email = 'rep04@monos.mn'`,
        );
      }
    });
  });
});
