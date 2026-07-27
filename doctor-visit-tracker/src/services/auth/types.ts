/**
 * The authentication boundary.
 *
 * Nothing in the app calls Supabase Auth directly. Screens depend only on this
 * interface, so replacing Supabase e-mail codes with Microsoft Entra ID later
 * means writing one new file — `entraAuthProvider.ts` — and changing one line
 * in `index.ts`. No screen, table or report has to move.
 *
 * See docs/01-ARCHITECTURE.md §5 for the full migration note.
 */

export type Role = 'representative' | 'manager' | 'administrator';

export interface AppSession {
  /** Identifier issued by the identity provider (Supabase user id today). */
  providerUserId: string;
  email: string;
  /** Bearer token sent to the API. */
  accessToken: string;
  expiresAt: number | null;
}

export interface AppUserProfile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  employeeCode: string | null;
  phone: string | null;
  isActive: boolean;
  managerId: string | null;
}

export type AuthErrorCode =
  | 'invalid_email'
  | 'domain_not_allowed'
  | 'not_provisioned'
  | 'inactive'
  | 'wrong_code'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}

export type Unsubscribe = () => void;

export interface AuthProvider {
  /** Current session, or null. Reads from secure device storage. */
  getSession(): Promise<AppSession | null>;

  /** Ask the provider to send a one-time code to this address. */
  requestOtp(email: string): Promise<void>;

  /** Exchange the code for a session. */
  verifyOtp(email: string, token: string): Promise<AppSession>;

  signOut(): Promise<void>;

  onAuthStateChange(callback: (session: AppSession | null) => void): Unsubscribe;
}
