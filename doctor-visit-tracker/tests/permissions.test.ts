/**
 * The permissions matrix.
 *
 * These assertions restate docs/03-ROLES-PERMISSIONS.md line by line, so a
 * capability cannot be quietly widened without a test turning red. The
 * database is tested separately in supabase/tests/02_role_permissions.test.sql
 * — that is what actually protects the data; this protects the interface from
 * offering something the server will refuse.
 */
import { describe, expect, it } from 'vitest';
import {
  can,
  canDecideException,
  canEditPlan,
  TABS_BY_ROLE,
  type Capability,
} from '@/domain/permissions';

describe('representative', () => {
  const allowed: Capability[] = [
    'plan.viewOwn',
    'plan.editOwn',
    'plan.submitOwn',
    'visit.startOwn',
    'visit.completeOwn',
    'history.read',
    'masterData.read',
    'exception.request',
    'kpi.viewOwn',
  ];

  const denied: Capability[] = [
    'plan.viewAll',
    'plan.decide',
    'plan.reschedule',
    'visit.addAddendum',
    'visit.viewAll',
    'masterData.manage',
    'exception.decide',
    'absence.decide',
    'kpi.viewTeam',
    'kpi.configure',
    'export.csv',
    'user.manage',
    'settings.viewPrivate',
    'settings.manage',
    'emailDomain.manage',
    'audit.read',
  ];

  it.each(allowed)('can %s', (c) => expect(can('representative', c)).toBe(true));
  it.each(denied)('cannot %s', (c) => expect(can('representative', c)).toBe(false));
});

describe('manager', () => {
  const allowed: Capability[] = [
    'plan.viewAll',
    'plan.decide',
    'plan.reschedule',
    'visit.viewAll',
    'visit.addAddendum',
    'exception.decide',
    'absence.decide',
    'kpi.viewTeam',
    'export.csv',
    'audit.read',
    'history.read',
    'masterData.read',
  ];

  const denied: Capability[] = [
    'masterData.manage',
    'user.manage',
    'settings.manage',
    'emailDomain.manage',
    'kpi.configure',
    // A manager does not do a representative's job:
    'visit.startOwn',
    'visit.completeOwn',
    'plan.editOwn',
    'plan.submitOwn',
    'exception.request',
  ];

  it.each(allowed)('can %s', (c) => expect(can('manager', c)).toBe(true));
  it.each(denied)('cannot %s', (c) => expect(can('manager', c)).toBe(false));
});

describe('administrator', () => {
  const allowed: Capability[] = [
    'masterData.manage',
    'user.manage',
    'settings.manage',
    'settings.viewPrivate',
    'emailDomain.manage',
    'kpi.configure',
    'export.csv',
    'audit.read',
  ];

  /**
   * Separation of duties: an administrator configures the system but never
   * operates it, so they cannot approve exceptions, decide plans, or record
   * visits. One account must not be able to both create work and sign it off.
   */
  const denied: Capability[] = [
    'exception.decide',
    'absence.decide',
    'plan.decide',
    'plan.reschedule',
    'visit.startOwn',
    'visit.completeOwn',
    'exception.request',
  ];

  it.each(allowed)('can %s', (c) => expect(can('administrator', c)).toBe(true));
  it.each(denied)('cannot %s', (c) => expect(can('administrator', c)).toBe(false));
});

describe('unauthenticated', () => {
  it('can do nothing at all', () => {
    const every: Capability[] = [
      'plan.viewOwn',
      'masterData.read',
      'audit.read',
      'user.manage',
      'visit.startOwn',
    ];
    for (const c of every) {
      expect(can(null, c)).toBe(false);
      expect(can(undefined, c)).toBe(false);
    }
  });
});

describe('canEditPlan', () => {
  const ME = 'user-me';
  const OTHER = 'user-other';

  it('allows a representative to edit their own draft before the deadline', () => {
    expect(canEditPlan('representative', ME, ME, 'draft', false)).toBe(true);
    expect(canEditPlan('representative', ME, ME, 'rejected', false)).toBe(true);
  });

  it('refuses another representative’s plan', () => {
    expect(canEditPlan('representative', OTHER, ME, 'draft', false)).toBe(false);
  });

  it('refuses after the planning deadline', () => {
    expect(canEditPlan('representative', ME, ME, 'draft', true)).toBe(false);
  });

  it('refuses once the plan has moved past draft', () => {
    for (const status of ['submitted', 'approved', 'active', 'completed', 'locked']) {
      expect(canEditPlan('representative', ME, ME, status, false)).toBe(false);
    }
  });

  it('refuses managers and administrators — they reschedule, they do not edit', () => {
    expect(canEditPlan('manager', ME, ME, 'draft', false)).toBe(false);
    expect(canEditPlan('administrator', ME, ME, 'draft', false)).toBe(false);
  });
});

describe('canDecideException', () => {
  const MANAGER = 'manager-1';
  const REP = 'rep-1';

  it('lets a manager decide somebody else’s request', () => {
    expect(canDecideException('manager', REP, MANAGER)).toBe(true);
  });

  /** The single most important integrity rule in the exception workflow. */
  it('never lets anybody approve their own request', () => {
    expect(canDecideException('manager', MANAGER, MANAGER)).toBe(false);
    expect(canDecideException('administrator', MANAGER, MANAGER)).toBe(false);
    expect(canDecideException('representative', REP, REP)).toBe(false);
  });

  it('refuses representatives and administrators outright', () => {
    expect(canDecideException('representative', MANAGER, REP)).toBe(false);
    expect(canDecideException('administrator', REP, 'admin-1')).toBe(false);
  });
});

describe('tab visibility', () => {
  it('gives each role only its own tabs', () => {
    expect(TABS_BY_ROLE.representative).toEqual(['home', 'today', 'plan', 'directory', 'kpi']);
    expect(TABS_BY_ROLE.manager).toEqual(['home', 'dashboard', 'exceptions', 'directory', 'kpi']);
    expect(TABS_BY_ROLE.administrator).toEqual(['home', 'master-data', 'users', 'settings']);
  });

  it('never shows a representative the administrative tabs', () => {
    expect(TABS_BY_ROLE.representative).not.toContain('users');
    expect(TABS_BY_ROLE.representative).not.toContain('master-data');
    expect(TABS_BY_ROLE.representative).not.toContain('exceptions');
  });
});
