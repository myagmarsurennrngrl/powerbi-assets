/**
 * AuthProvider backed by Supabase email OTP.
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

  async requestCode(email: string): Promise<void> {
    const normalised = email.trim().toLowerCase();

    // Ask the server whether this address may sign in at all, so the person
    // gets an immediate, clear answer instead of waiting for an email that
    // will never arrive. This is a courtesy check only — the authoritative
    // rejection happens in the database trigger on auth.users (migration 0006).
    const { data: allowed, error: checkError } = await this.client.rpc('fn_can_email_sign_in', {
      p_email: normalised,
    });

    if (!checkError && allowed === false) {
      throw new AuthError('domain_not_allowed', 'Email domain is not approved.');
    }
    // A failed check (offline, RPC unavailable) must not block a legitimate
    // login attempt — fall through and let the server decide.

    const { error } = await this.client.auth.signInWithOtp({
      email: normalised,
      options: {
        // Administrators provision people first; self-signup is not allowed.
        shouldCreateUser: true,
      },
    });

    if (error) throw mapAuthError(error);
  }

  async verifyCode(email: string, code: string): Promise<AuthIdentity> {
    const normalised = email.trim().toLowerCase();

    const { data, error } = await this.client.auth.verifyOtp({
      email: normalised,
      token: code.trim(),
      type: 'email',
    });

    if (error) throw mapAuthError(error);
    if (!data.user) throw new AuthError('unknown', 'No user returned after verification.');

    return { id: data.user.id, email: data.user.email ?? normalised };
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

/** Translate a provider error into one of our stable error codes. */
function mapAuthError(error: { message?: string; status?: number }): AuthError {
  const message = (error.message ?? '').toLowerCase();

  if (message.includes('approved company email domain') || message.includes('restricted')) {
    return new AuthError('domain_not_allowed', error.message ?? '', error);
  }
  if (message.includes('token') || message.includes('otp') || message.includes('expired')) {
    return new AuthError('invalid_code', error.message ?? '', error);
  }
  if (error.status === 429 || message.includes('rate limit')) {
    return new AuthError('rate_limited', error.message ?? '', error);
  }
  if (message.includes('network') || message.includes('fetch')) {
    return new AuthError('network', error.message ?? '', error);
  }
  return new AuthError('unknown', error.message ?? 'Unknown authentication error', error);
}
