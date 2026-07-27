/**
 * The permissions matrix, expressed in TypeScript.
 *
 * This mirrors docs/03-ROLES-PERMISSIONS.md and the database policies, and is
 * used to decide which buttons and tabs to show. It is a USABILITY layer only:
 * hiding a button stops an honest person doing the wrong thing by accident, it
 * does not stop a dishonest one. Every capability below is independently
 * enforced by Row Level Security or by a SECURITY DEFINER function, and the
 * SQL test suite proves it.
 */

export type Role = 'representative' | 'manager' | 'administrator';

export type Capability =
  // plans
  | 'plan.viewOwn'
  | 'plan.viewAll'
  | 'plan.editOwn'
  | 'plan.submitOwn'
  | 'plan.decide'
  | 'plan.reschedule'
  // visits
  | 'visit.startOwn'
  | 'visit.completeOwn'
  | 'visit.addAddendum'
  | 'visit.viewAll'
  // doctor history
  | 'history.read'
  // master data
  | 'masterData.read'
  | 'masterData.manage'
  // exceptions
  | 'exception.request'
  | 'exception.decide'
  | 'absence.decide'
  // kpi and reporting
  | 'kpi.viewOwn'
  | 'kpi.viewTeam'
  | 'export.csv'
  | 'kpi.configure'
  // administration
  | 'user.manage'
  | 'settings.viewPrivate'
  | 'settings.manage'
  | 'emailDomain.manage'
  // audit
  | 'audit.read';

const REPRESENTATIVE: readonly Capability[] = [
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

const MANAGER: readonly Capability[] = [
  'plan.viewOwn',
  'plan.viewAll',
  'plan.decide',
  'plan.reschedule',
  'visit.viewAll',
  'visit.addAddendum',
  'history.read',
  'masterData.read',
  'exception.decide',
  'absence.decide',
  'kpi.viewOwn',
  'kpi.viewTeam',
  'export.csv',
  'audit.read',
];

/**
 * Note what an administrator deliberately CANNOT do: approve exceptions,
 * submit visits, or decide plans. Administrators configure the system; they do
 * not operate it. That separation is what stops one account from both creating
 * work and signing it off.
 */
const ADMINISTRATOR: readonly Capability[] = [
  'plan.viewOwn',
  'plan.viewAll',
  'visit.viewAll',
  'visit.addAddendum',
  'history.read',
  'masterData.read',
  'masterData.manage',
  'kpi.viewOwn',
  'kpi.viewTeam',
  'kpi.configure',
  'export.csv',
  'user.manage',
  'settings.viewPrivate',
  'settings.manage',
  'emailDomain.manage',
  'audit.read',
];

export const CAPABILITIES: Record<Role, readonly Capability[]> = {
  representative: REPRESENTATIVE,
  manager: MANAGER,
  administrator: ADMINISTRATOR,
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAPABILITIES[role].includes(capability);
}

/** Ownership checks that a role alone cannot answer. */
export function canEditPlan(
  role: Role | null,
  planOwnerId: string,
  currentUserId: string,
  planStatus: string,
  isPastDeadline: boolean,
): boolean {
  if (!can(role, 'plan.editOwn')) return false;
  if (planOwnerId !== currentUserId) return false;
  if (!['draft', 'rejected'].includes(planStatus)) return false;
  return !isPastDeadline;
}

/** A person may never decide their own exception, whatever their role. */
export function canDecideException(
  role: Role | null,
  requesterId: string,
  currentUserId: string,
): boolean {
  if (!can(role, 'exception.decide')) return false;
  return requesterId !== currentUserId;
}

/** Tabs each role sees, in order. Keys match the route folder names. */
export const TABS_BY_ROLE: Record<Role, readonly string[]> = {
  representative: ['home', 'today', 'plan', 'directory', 'kpi'],
  manager: ['home', 'dashboard', 'exceptions', 'directory', 'kpi'],
  administrator: ['home', 'master-data', 'users', 'settings'],
};
