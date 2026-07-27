/**
 * The authentication contract.
 *
 * THIS INTERFACE IS THE MIGRATION PATH TO MICROSOFT ENTRA ID.
 *
 * No screen, no repository and no piece of business logic imports Supabase
 * Auth directly — everything depends on this interface. Switching to Entra ID
 * means writing one more class that implements AuthProvider and changing a
 * single line in src/lib/auth/index.ts. The database side is equally isolated:
 * app_user.auth_user_id is the only column that knows a provider exists.
 *
 * See docs/01-architecture.md §5.
 */

export type AuthErrorCode =
  | 'domain_not_allowed'   // address is outside the approved company domains
  | 'not_provisioned'      // authenticated, but no active app_user row exists
  | 'invalid_code'         // wrong or expired one-time code
  | 'network'              // no connectivity
  | 'rate_limited'         // too many attempts
  | 'unknown';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** The identity as the provider sees it — deliberately minimal. */
export interface AuthIdentity {
  /** Provider subject id. Maps to app_user.auth_user_id. */
  id: string;
  email: string;
}

export interface AuthProvider {
  /**
   * Ask the provider to send a one-time code / magic link.
   * Implementations must check the approved-domain rule first so the user gets
   * a clear message instead of an email that will never let them in.
   */
  requestCode(email: string): Promise<void>;

  /** Exchange the emailed code for a session. */
  verifyCode(email: string, code: string): Promise<AuthIdentity>;

  /** The current identity, or null when signed out. */
  getIdentity(): Promise<AuthIdentity | null>;

  signOut(): Promise<void>;

  /** Notifies when the session appears or disappears (e.g. token expiry). */
  onIdentityChange(callback: (identity: AuthIdentity | null) => void): () => void;
}
