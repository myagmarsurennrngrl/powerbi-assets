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
 *
 * WHY PASSWORDS RATHER THAN ONE-TIME CODES
 * ----------------------------------------
 * This started as email OTP, which is the better mechanism: nothing to steal,
 * nothing to forget, no reset flow to abuse. It was replaced because the email
 * never arrived. On the Supabase free tier the stock template sends a link a
 * phone app cannot use, editing that template requires custom SMTP, and custom
 * SMTP on a company domain requires the IT department. See
 * docs/99-password-login.md.
 *
 * What that costs, recorded honestly:
 *
 *   * There is no self-service reset. Without email delivery there is no way
 *     to prove somebody owns a mailbox, so a forgotten password is an
 *     administrator's job — `npm run dev:set-password`.
 *   * For the same reason there is NO SELF-REGISTRATION. If anyone could
 *     choose the password for an address, an employee could claim their
 *     manager's address before the manager did and inherit their access. With
 *     a one-time code, holding the mailbox was the proof. Now the
 *     administrator issues the first password and the person changes it.
 *
 * If SMTP is ever configured, a self-service reset becomes implementable and
 * the OTP path can return as an option. Nothing here forecloses either.
 */

export type AuthErrorCode =
  | 'domain_not_allowed'   // address is outside the approved company domains
  | 'not_provisioned'      // authenticated, but no active app_user row exists
  | 'invalid_credentials'  // wrong email or wrong password — deliberately one code
  | 'weak_password'        // rejected when setting a new one
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
   * Exchange an email and password for a session.
   *
   * Implementations must check the approved-domain rule first, so somebody
   * using a personal address gets told that rather than being left to wonder
   * about their password.
   */
  signIn(email: string, password: string): Promise<AuthIdentity>;

  /**
   * Change the signed-in user's own password.
   *
   * Requires a live session — this is a change, not a reset. There is
   * deliberately no `resetPassword(email)`; see the note at the top.
   */
  changePassword(newPassword: string): Promise<void>;

  /** The current identity, or null when signed out. */
  getIdentity(): Promise<AuthIdentity | null>;

  signOut(): Promise<void>;

  /** Notifies when the session appears or disappears (e.g. token expiry). */
  onIdentityChange(callback: (identity: AuthIdentity | null) => void): () => void;
}
