/**
 * Administration: user accounts, brand assignments, archive guards.
 *
 * The theme running through this file is that the administration screen can
 * lock the company out of its own system in ways no single-row policy can see:
 * an account that can never sign in, a last administrator who removes their own
 * rights, a clinic archived while representatives still have it on Thursday's
 * route. Each of those is tested here as a refusal, not as a warning.
 *
 * Every test runs inside a rolled-back transaction (see helpers.ts), so the
 * seed data is never actually modified.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { actingAs, asSuperuser, closePool, DB_AVAILABLE, USERS } from './helpers';

/** The seed's single administrator, resolved once per test that needs the id. */
async function userIdOf(email: string): Promise<string> {
  const [row] = await asSuperuser<{ id: string }>(
    'SELECT id FROM public.app_user WHERE email = $1',
    [email],
  );
  return row.id;
}

describe.skipIf(!DB_AVAILABLE)('administration', () => {
  afterAll(closePool);

  // ===========================================================================
  describe('who may administer', () => {
    it('fn_admin_users returns the full list to an administrator', async () => {
      await actingAs(USERS.admin, async (s) => {
        const rows = await s.query('SELECT * FROM public.fn_admin_users()');
        // 7 representatives + 3 managers + 1 administrator.
        expect(rows).toHaveLength(11);
        expect(rows.every((r: any) => typeof r.email === 'string')).toBe(true);
      });
    });

    it('fn_admin_users returns NOTHING to a manager', async () => {
      await actingAs(USERS.manager1, async (s) => {
        await s.expectInvisible('SELECT * FROM public.fn_admin_users()');
      });
    });

    it('fn_admin_users returns NOTHING to a representative', async () => {
      await actingAs(USERS.rep1, async (s) => {
        await s.expectInvisible('SELECT * FROM public.fn_admin_users()');
      });
    });

    it('includes the brands each representative currently holds', async () => {
      await actingAs(USERS.admin, async (s) => {
        const rows = await s.query(
          `SELECT brand_count, brand_names FROM public.fn_admin_users() WHERE email = $1`,
          [USERS.rep1],
        );
        expect(rows[0].brand_count).toBeGreaterThan(0);
        expect(rows[0].brand_names).toBeTruthy();
      });
    });

    it('a manager cannot create a user', async () => {
      await actingAs(USERS.manager1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_create_user('newperson@monos.mn', 'Шинэ Хүн', 'representative')`,
        );
        expect(error.code).toBe('42501');
      });
    });

    it('a representative cannot change anyone’s role', async () => {
      const repId = await userIdOf(USERS.rep2);
      await actingAs(USERS.rep1, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_set_user_role($1, 'manager')`,
          [repId],
        );
        expect(error.code).toBe('42501');
      });
    });
  });

  // ===========================================================================
  describe('creating a user', () => {
    it('creates a representative and records a user_created audit entry', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('rep99@monos.mn', 'Тест Төлөөлөгч', 'representative')`,
        );
        expect(id).toBeTruthy();

        const [user] = await s.query('SELECT * FROM public.app_user WHERE id = $1', [id]);
        expect(user.email).toBe('rep99@monos.mn');
        expect(user.role).toBe('representative');
        expect(user.is_active).toBe(true);
        // No login exists yet — the account is provisioned, not signed in.
        expect(user.auth_user_id).toBeNull();

        const audit = await s.query(
          `SELECT 1 FROM public.audit_log
           WHERE action = 'user_created' AND entity_id = $1`,
          [id],
        );
        expect(audit).toHaveLength(1);
      });
    });

    it('lowercases and trims the address', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('  Rep98@MONOS.MN ', 'Том Үсэг', 'representative')`,
        );
        const [user] = await s.query('SELECT email FROM public.app_user WHERE id = $1', [id]);
        expect(user.email).toBe('rep98@monos.mn');
      });
    });

    it('REFUSES an address outside the approved domain', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_create_user('someone@gmail.com', 'Гадны Хүн', 'representative')`,
        );
        expect(error.message).toMatch(/домэйн/);
      });
    });

    it('refuses a duplicate address regardless of case', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_create_user('REP01@monos.mn', 'Хуулбар', 'representative')`,
        );
        expect(error.message).toMatch(/бүртгэгдсэн/);
      });
    });

    it('refuses a blank name', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_create_user('rep97@monos.mn', '   ', 'representative')`,
        );
        expect(error.message).toMatch(/Нэр/);
      });
    });

    it('refuses a malformed address before it reaches the domain check', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_create_user('not-an-address', 'Буруу', 'representative')`,
        );
        expect(error.message).toMatch(/И-мэйл/);
      });
    });

    it('accepts a manager as the reporting line', async () => {
      const managerId = await userIdOf(USERS.manager1);
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('rep96@monos.mn', 'Шинэ', 'representative', $1)`,
          [managerId],
        );
        const [user] = await s.query('SELECT manager_id FROM public.app_user WHERE id = $1', [id]);
        expect(user.manager_id).toBe(managerId);
      });
    });

    it('REFUSES a representative as somebody’s manager', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_create_user('rep95@monos.mn', 'Шинэ', 'representative', $1)`,
          [repId],
        );
        expect(error.message).toMatch(/менежер эсвэл администратор/);
      });
    });
  });

  // ===========================================================================
  describe('editing a user', () => {
    it('updates name, phone and reporting line', async () => {
      const repId = await userIdOf(USERS.rep3);
      const managerId = await userIdOf(USERS.manager2);
      await actingAs(USERS.admin, async (s) => {
        await s.query(`SELECT public.fn_admin_update_user($1, 'Шинэчилсэн Нэр', '99001122', $2)`, [
          repId,
          managerId,
        ]);
        const [user] = await s.query(
          'SELECT full_name, phone, manager_id FROM public.app_user WHERE id = $1',
          [repId],
        );
        expect(user.full_name).toBe('Шинэчилсэн Нэр');
        expect(user.phone).toBe('99001122');
        expect(user.manager_id).toBe(managerId);
      });
    });

    it('stores an empty phone as NULL rather than an empty string', async () => {
      const repId = await userIdOf(USERS.rep3);
      await actingAs(USERS.admin, async (s) => {
        await s.query(`SELECT public.fn_admin_update_user($1, 'Нэр', '   ', NULL)`, [repId]);
        const [user] = await s.query('SELECT phone FROM public.app_user WHERE id = $1', [repId]);
        expect(user.phone).toBeNull();
      });
    });

    it('refuses to make a user their own manager', async () => {
      const repId = await userIdOf(USERS.rep3);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_update_user($1, 'Нэр', NULL, $1)`,
          [repId],
        );
        expect(error.message).toMatch(/өөрийгөө удирдах/);
      });
    });

    it('refuses a mutual management loop', async () => {
      const managerA = await userIdOf(USERS.manager1);
      const managerB = await userIdOf(USERS.manager2);
      await actingAs(USERS.admin, async (s) => {
        // A reports to B …
        await s.query(`SELECT public.fn_admin_update_user($1, 'Менежер А', NULL, $2)`, [
          managerA,
          managerB,
        ]);
        // … so B may not then report to A.
        const error = await s.expectDenied(
          `SELECT public.fn_admin_update_user($1, 'Менежер Б', NULL, $2)`,
          [managerB, managerA],
        );
        expect(error.message).toMatch(/бие биенээ/);
      });
    });

    it('refuses an inactive user as a manager', async () => {
      const managerId = await userIdOf(USERS.manager3);
      const repId = await userIdOf(USERS.rep4);
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          `UPDATE public.app_user SET manager_id = NULL WHERE manager_id = $1`,
          [managerId],
        );
        await s.query(`SELECT public.fn_admin_set_user_active($1, false, 'тест')`, [managerId]);

        const error = await s.expectDenied(
          `SELECT public.fn_admin_update_user($1, 'Нэр', NULL, $2)`,
          [repId, managerId],
        );
        expect(error.message).toMatch(/Идэвхгүй/);
      });
    });
  });

  // ===========================================================================
  describe('role changes', () => {
    it('promotes a representative with no brands to manager', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('rep94@monos.mn', 'Дэвших Хүн', 'representative')`,
        );
        await s.query(`SELECT public.fn_admin_set_user_role($1, 'manager')`, [id]);
        const [user] = await s.query('SELECT role FROM public.app_user WHERE id = $1', [id]);
        expect(user.role).toBe('manager');
      });
    });

    it('records a user_role_changed audit entry', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('rep93@monos.mn', 'Аудит Хүн', 'representative')`,
        );
        await s.query(`SELECT public.fn_admin_set_user_role($1, 'manager')`, [id]);

        const audit = await s.query(
          `SELECT before_data, after_data FROM public.audit_log
           WHERE action = 'user_role_changed' AND entity_id = $1`,
          [id],
        );
        expect(audit).toHaveLength(1);
        expect(audit[0].before_data.role).toBe('representative');
        expect(audit[0].after_data.role).toBe('manager');
      });
    });

    it('setting the same role again is a no-op, not an error', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        await s.query(`SELECT public.fn_admin_set_user_role($1, 'representative')`, [repId]);
        const audit = await s.query(
          `SELECT 1 FROM public.audit_log
           WHERE action = 'user_role_changed' AND entity_id = $1`,
          [repId],
        );
        expect(audit).toHaveLength(0);
      });
    });

    it('REFUSES to move a representative who still holds brands', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_set_user_role($1, 'manager')`,
          [repId],
        );
        expect(error.message).toMatch(/брэнд/);
      });
    });

    it('REFUSES to demote the last administrator', async () => {
      const adminId = await userIdOf(USERS.admin);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_set_user_role($1, 'manager')`,
          [adminId],
        );
        expect(error.message).toMatch(/Сүүлийн администратор/);
      });
    });

    it('ALLOWS demoting an administrator once a second one exists', async () => {
      const adminId = await userIdOf(USERS.admin);
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          `SELECT public.fn_admin_create_user('admin2@monos.mn', 'Хоёр Дахь Админ', 'administrator')`,
        );
        await s.query(`SELECT public.fn_admin_set_user_role($1, 'manager')`, [adminId]);
        const [user] = await s.query('SELECT role FROM public.app_user WHERE id = $1', [adminId]);
        expect(user.role).toBe('manager');
      });
    });

    it('REFUSES to demote a manager who still has direct reports', async () => {
      const managerId = await userIdOf(USERS.manager1);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_set_user_role($1, 'representative')`,
          [managerId],
        );
        expect(error.message).toMatch(/менежер байна/);
      });
    });
  });

  // ===========================================================================
  describe('deactivating a user', () => {
    it('sets is_active and deactivated_at together', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('rep92@monos.mn', 'Гарах Хүн', 'representative')`,
        );
        await s.query(`SELECT public.fn_admin_set_user_active($1, false, 'ажлаас гарсан')`, [id]);

        const [user] = await s.query(
          'SELECT is_active, deactivated_at FROM public.app_user WHERE id = $1',
          [id],
        );
        expect(user.is_active).toBe(false);
        expect(user.deactivated_at).not.toBeNull();
      });
    });

    it('records the reason in the audit log', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('rep91@monos.mn', 'Шалтгаан', 'representative')`,
        );
        await s.query(`SELECT public.fn_admin_set_user_active($1, false, 'ажлаас гарсан')`, [id]);

        const audit = await s.query(
          `SELECT note FROM public.audit_log
           WHERE action = 'user_deactivated' AND entity_id = $1 AND note IS NOT NULL`,
          [id],
        );
        expect(audit).toHaveLength(1);
        expect(audit[0].note).toBe('ажлаас гарсан');
      });
    });

    it('reactivating clears deactivated_at', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [{ fn_admin_create_user: id }] = await s.query(
          `SELECT public.fn_admin_create_user('rep90@monos.mn', 'Буцаж Ирсэн', 'representative')`,
        );
        await s.query(`SELECT public.fn_admin_set_user_active($1, false, NULL)`, [id]);
        await s.query(`SELECT public.fn_admin_set_user_active($1, true, NULL)`, [id]);

        const [user] = await s.query(
          'SELECT is_active, deactivated_at FROM public.app_user WHERE id = $1',
          [id],
        );
        expect(user.is_active).toBe(true);
        expect(user.deactivated_at).toBeNull();
      });
    });

    it('REFUSES self-deactivation', async () => {
      const adminId = await userIdOf(USERS.admin);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_set_user_active($1, false, NULL)`,
          [adminId],
        );
        expect(error.message).toMatch(/Өөрийгөө/);
      });
    });

    it('REFUSES deactivating a representative with an open visit', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        // Give rep1 an in-progress visit. INSERT on `visit` is granted to
        // nobody — visits exist only via fn_start_visit — so this steps out of
        // the application role to build the scenario, then steps back in. The
        // assertion itself still runs as the administrator.
        await s.query('RESET ROLE');
        await s.query(
          `INSERT INTO public.visit (rep_id, clinic_id, visit_date, status, started_at_server)
           SELECT $1, c.id, CURRENT_DATE, 'in_progress', now()
           FROM public.clinic c WHERE c.code = 'CL-001'`,
          [repId],
        );
        await s.query('SET LOCAL ROLE authenticated');

        const error = await s.expectDenied(
          `SELECT public.fn_admin_set_user_active($1, false, NULL)`,
          [repId],
        );
        expect(error.message).toMatch(/дуусаагүй уулзалт/);
      });
    });

    it('REFUSES deactivating someone who is still a manager of active users', async () => {
      const managerId = await userIdOf(USERS.manager1);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `SELECT public.fn_admin_set_user_active($1, false, NULL)`,
          [managerId],
        );
        expect(error.message).toMatch(/менежер байна/);
      });
    });

    it('there is still no way to DELETE a user', async () => {
      const repId = await userIdOf(USERS.rep5);
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied('DELETE FROM public.app_user WHERE id = $1', [repId]);
        expect(error.code).toBe('42501');
      });
    });
  });

  // ===========================================================================
  describe('brand assignments', () => {
    it('assigns a brand a representative does not yet hold', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        const [free] = await s.query(
          `SELECT b.id FROM public.brand b
           WHERE b.deleted_at IS NULL AND b.is_active
             AND NOT EXISTS (
               SELECT 1 FROM public.rep_brand_assignment a
               WHERE a.brand_id = b.id AND a.rep_id = $1 AND a.is_active)
           LIMIT 1`,
          [repId],
        );
        const [{ fn_admin_assign_brand: id }] = await s.query(
          `SELECT public.fn_admin_assign_brand($1, $2)`,
          [repId, free.id],
        );
        const [row] = await s.query(
          'SELECT is_active, start_date FROM public.rep_brand_assignment WHERE id = $1',
          [id],
        );
        expect(row.is_active).toBe(true);
        expect(row.start_date).not.toBeNull();
      });
    });

    it('refuses to assign the same brand twice', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        const [held] = await s.query(
          `SELECT brand_id FROM public.rep_brand_assignment WHERE rep_id = $1 AND is_active LIMIT 1`,
          [repId],
        );
        const error = await s.expectDenied(`SELECT public.fn_admin_assign_brand($1, $2)`, [
          repId,
          held.brand_id,
        ]);
        expect(error.message).toMatch(/аль хэдийн хуваарилагдсан/);
      });
    });

    it('REFUSES to assign a brand to a manager', async () => {
      const managerId = await userIdOf(USERS.manager1);
      await actingAs(USERS.admin, async (s) => {
        const [brand] = await s.query('SELECT id FROM public.brand LIMIT 1');
        const error = await s.expectDenied(`SELECT public.fn_admin_assign_brand($1, $2)`, [
          managerId,
          brand.id,
        ]);
        expect(error.message).toMatch(/төлөөлөгчид/);
      });
    });

    it('ending an assignment keeps the row and sets an end date', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        const [held] = await s.query(
          `SELECT id FROM public.rep_brand_assignment WHERE rep_id = $1 AND is_active LIMIT 1`,
          [repId],
        );
        await s.query(`SELECT public.fn_admin_end_brand_assignment($1)`, [held.id]);

        const [row] = await s.query(
          'SELECT is_active, end_date FROM public.rep_brand_assignment WHERE id = $1',
          [held.id],
        );
        // The row survives: past visits are attributed to brands held at the time.
        expect(row.is_active).toBe(false);
        expect(row.end_date).not.toBeNull();
      });
    });

    it('refuses an end date before the start date', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.admin, async (s) => {
        const [held] = await s.query(
          `SELECT id FROM public.rep_brand_assignment WHERE rep_id = $1 AND is_active LIMIT 1`,
          [repId],
        );
        const error = await s.expectDenied(
          `SELECT public.fn_admin_end_brand_assignment($1, '2000-01-01'::date)`,
          [held.id],
        );
        expect(error.message).toMatch(/Дуусах огноо/);
      });
    });

    it('a manager cannot assign brands', async () => {
      const repId = await userIdOf(USERS.rep1);
      await actingAs(USERS.manager1, async (s) => {
        const [brand] = await s.query('SELECT id FROM public.brand LIMIT 1');
        const error = await s.expectDenied(`SELECT public.fn_admin_assign_brand($1, $2)`, [
          repId,
          brand.id,
        ]);
        expect(error.code).toBe('42501');
      });
    });
  });

  // ===========================================================================
  describe('editing clinic geofences', () => {
    it('an administrator can change coordinates and radius', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          `UPDATE public.clinic SET geofence_radius_m = 400, latitude = 47.918000
           WHERE code = 'CL-001'`,
        );
        const [row] = await s.query(
          `SELECT geofence_radius_m, latitude FROM public.clinic WHERE code = 'CL-001'`,
        );
        expect(row.geofence_radius_m).toBe(400);
      });
    });

    it('the change is audited with the old and new values', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.query(`UPDATE public.clinic SET geofence_radius_m = 500 WHERE code = 'CL-001'`);
        const rows = await s.query(
          `SELECT before_data, after_data FROM public.audit_log
           WHERE action = 'master_data_changed' AND entity_type = 'clinic'
           ORDER BY id DESC LIMIT 1`,
        );
        expect(rows[0].after_data.geofence_radius_m).toBe(500);
        expect(rows[0].before_data.geofence_radius_m).not.toBe(500);
      });
    });

    it('refuses a radius smaller than typical GPS error', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `UPDATE public.clinic SET geofence_radius_m = 10 WHERE code = 'CL-001'`,
        );
        expect(error.message).toMatch(/geofence_radius_sane/);
      });
    });

    it('a manager cannot change a geofence', async () => {
      await actingAs(USERS.manager1, async (s) => {
        // RLS hides the row from the UPDATE rather than raising, so the test is
        // that nothing changed — the classic silent-no-op failure mode.
        await s.query(`UPDATE public.clinic SET geofence_radius_m = 999 WHERE code = 'CL-001'`);
        const [row] = await s.query(
          `SELECT geofence_radius_m FROM public.clinic WHERE code = 'CL-001'`,
        );
        expect(row.geofence_radius_m).not.toBe(999);
      });
    });
  });

  // ===========================================================================
  describe('archive guards', () => {
    it('refuses to archive a clinic that is still active', async () => {
      await actingAs(USERS.admin, async (s) => {
        const error = await s.expectDenied(
          `UPDATE public.clinic SET deleted_at = now() WHERE code = 'CL-001'`,
        );
        expect(error.message).toMatch(/идэвхгүй болгоно/);
      });
    });

    it('REFUSES to archive a clinic with visits still planned', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [target] = await s.query(
          `SELECT clinic_id FROM public.planned_visit
           WHERE status = 'planned' AND planned_date >= CURRENT_DATE LIMIT 1`,
        );
        const error = await s.expectDenied(
          `UPDATE public.clinic SET is_active = false, deleted_at = now() WHERE id = $1`,
          [target.clinic_id],
        );
        expect(error.message).toMatch(/төлөвлөгдсөн/);
      });
    });

    it('ALLOWS archiving a clinic with nothing scheduled', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('CL-ARCH', 'Хаагдах Эмнэлэг', 'Хувийн', 'Сүхбаатар', 'хаяг', 47.92, 106.92)`,
        );
        await s.query(
          `UPDATE public.clinic SET is_active = false, deleted_at = now() WHERE code = 'CL-ARCH'`,
        );
        const [row] = await s.query(
          `SELECT deleted_at FROM public.clinic WHERE code = 'CL-ARCH'`,
        );
        expect(row.deleted_at).not.toBeNull();
      });
    });

    it('an archived clinic disappears from the app’s clinic list', async () => {
      await actingAs(USERS.admin, async (s) => {
        await s.query(
          `INSERT INTO public.clinic (code, name, clinic_type, district, address, latitude, longitude)
           VALUES ('CL-GONE', 'Алга Болох', 'Хувийн', 'Сүхбаатар', 'хаяг', 47.92, 106.92)`,
        );
        await s.query(
          `UPDATE public.clinic SET is_active = false, deleted_at = now() WHERE code = 'CL-GONE'`,
        );
        // The same filter every repository read uses.
        await s.expectInvisible(
          `SELECT 1 FROM public.clinic WHERE code = 'CL-GONE' AND deleted_at IS NULL`,
        );
      });
    });

    it('REFUSES to archive a doctor with visits still planned', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [target] = await s.query(
          `SELECT pvd.doctor_id
           FROM public.planned_visit_doctor pvd
           JOIN public.planned_visit pv ON pv.id = pvd.planned_visit_id
           WHERE pv.status = 'planned' AND pv.planned_date >= CURRENT_DATE
           LIMIT 1`,
        );
        const error = await s.expectDenied(
          `UPDATE public.doctor SET is_active = false, deleted_at = now() WHERE id = $1`,
          [target.doctor_id],
        );
        expect(error.message).toMatch(/төлөвлөгдсөн/);
      });
    });

    it('REFUSES to archive a brand that is still assigned', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [assigned] = await s.query(
          `SELECT brand_id FROM public.rep_brand_assignment WHERE is_active LIMIT 1`,
        );
        const error = await s.expectDenied(
          `UPDATE public.brand SET is_active = false, deleted_at = now() WHERE id = $1`,
          [assigned.brand_id],
        );
        expect(error.message).toMatch(/хуваарилагдсан/);
      });
    });

    it('REFUSES to archive a brand that still has products', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [brand] = await s.query(
          `SELECT b.id FROM public.brand b
           WHERE EXISTS (SELECT 1 FROM public.product p
                         WHERE p.brand_id = b.id AND p.deleted_at IS NULL)
           LIMIT 1`,
        );
        // Remove the assignment blocker so the product rule is what we observe.
        await s.query(
          `UPDATE public.rep_brand_assignment SET is_active = false, end_date = CURRENT_DATE
           WHERE brand_id = $1 AND is_active`,
          [brand.id],
        );
        const error = await s.expectDenied(
          `UPDATE public.brand SET is_active = false, deleted_at = now() WHERE id = $1`,
          [brand.id],
        );
        expect(error.message).toMatch(/бүтээгдэхүүн/);
      });
    });

    it('the guard counts rows the caller cannot see', async () => {
      // The guard is SECURITY DEFINER precisely so that an archive cannot slip
      // through because RLS hid the dependency from the person doing it.
      const [row] = await asSuperuser<{ prosecdef: boolean }>(
        `SELECT prosecdef FROM pg_proc WHERE proname = 'fn_guard_clinic_archive'`,
      );
      expect(row.prosecdef).toBe(true);
    });
  });

  // ===========================================================================
  describe('master data counts', () => {
    it('reports live totals to an administrator', async () => {
      await actingAs(USERS.admin, async (s) => {
        const [row] = await s.query('SELECT * FROM public.fn_admin_master_data_counts()');
        expect(row.clinics_active).toBe(15);
        expect(row.doctors_active).toBe(50);
        expect(row.brands_active).toBe(10);
        expect(row.products_active).toBe(50);
        expect(row.users_active).toBe(11);
      });
    });

    it('returns nothing to a manager', async () => {
      await actingAs(USERS.manager1, async (s) => {
        await s.expectInvisible('SELECT * FROM public.fn_admin_master_data_counts()');
      });
    });
  });
});
