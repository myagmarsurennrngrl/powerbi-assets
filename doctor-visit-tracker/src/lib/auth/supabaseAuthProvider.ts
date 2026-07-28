/**
 * AuthProvider backed by Supabase email + password.
 *
 * This is the ONLY file in the app that talks to Supabase Auth. Replacing it
 * with an Entra ID implementation is the whole migration on the client side.
 */
import { getSupabase } from '../supabase';
import { AuthError, type AuthIdentity, type AuthProvider } from './types';

export class SupabaseAuthProvider implements AuthProvider {
  private get client() {
    const supabase = getSupabase();
    if (!supabase) {
      throw new AuthError('unknown', 'Supabase is not configured.');
    }
    return supabase;
  }

  async signIn(email: string, password: string): Promise<AuthIdentity> {
    const normalised = email.trim().toLowerCase();

    // Ask the server whether this address may sign in at all, so somebody
    // using a personal address is told so instead of being left to wonder
    // about their password. Courtesy only — the authoritative rejection is the
    // database trigger on auth.users (migration 0006).
    const { data: allowed, error: checkError } = await this.client.rpc('fn_can_email_sign_in', {
      p_email: normalised,
    });

    if (!checkError && allowed === false) {
      throw new AuthError('domain_not_allowed', 'Email domain is not approved.');
    }
    // A failed check (offline, RPC unavailable) must not block a legitimate
    // login attempt — fall through and let the server decide.

    const { data, error } = await this.client.auth.signInWithPassword({
      email: normalised,
      password,
    });

    if (error) throw mapAuthError(error);
    if (!data.user) throw new AuthError('unknown', 'No user returned after sign-in.');

    return { id: data.user.id, email: data.user.email ?? normalised };
  }

  async changePassword(newPassword: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw mapAuthError(error);
  }

  async getIdentity(): Promise<AuthIdentity | null> {
    const supabase = getSupabase();
    if (!supabase) return null;

    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) return null;

    return {
      id: data.session.user.id,
      email: data.session.user.email ?? '',
    };
  }

  async signOut(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  onIdentityChange(callback: (identity: AuthIdentity | null) => void): () => void {
    const supabase = getSupabase();
    if (!supabase) return () => {};

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(
        session?.user
          ? { id: session.user.id, email: session.user.email ?? '' }
          : null,
      );
    });

    return () => data.subscription.unsubscribe();
  }
}

/**
 * Translate a provider error into one of our stable error codes.
 *
 * Note what is deliberately NOT distinguished: a wrong password and an unknown
 * address both become `invalid_credentials`. Supabase returns the same "Invalid
 * login credentials" for both, and that is right — telling an attacker which
 * addresses are registered is exactly the enumeration that
 * fn_can_email_sign_in was written to avoid leaking.
 */
export function mapAuthError(error: { message?: string; status?: number }): AuthError {
  const message = (error.message ?? '').toLowerCase();

  if (message.includes('approved company email domain') || message.includes('restricted')) {
    return new AuthError('domain_not_allowed', error.message ?? '', error);
  }
  if (error.status === 429 || message.includes('rate limit')) {
    return new AuthError('rate_limited', error.message ?? '', error);
  }
  // Ordered before the credentials case on purpose: "Password should be at
  // least 6 characters" also contains the word "password".
  if (
    message.includes('password should be') ||
    message.includes('weak password') ||
    message.includes('password is too')
  ) {
    return new AuthError('weak_password', error.message ?? '', error);
  }
  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid credentials') ||
    message.includes('email not confirmed')
  ) {
    return new AuthError('invalid_credentials', error.message ?? '', error);
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return new AuthError('network', error.message ?? '', error);
  }
  return new AuthError('unknown', error.message ?? 'Unknown authentication error', error);
}
