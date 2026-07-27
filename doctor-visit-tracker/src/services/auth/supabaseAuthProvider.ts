/**
 * Supabase implementation of AuthProvider — e-mail one-time codes.
 *
 * `shouldCreateUser: true` looks alarming but is correct and safe: the
 * database trigger on auth.users refuses to create an account unless the
 * address is on an approved domain AND an administrator has already created
 * the staff record. Supabase therefore returns an error rather than a code,
 * and we translate that into a clear Mongolian message.
 *
 * The alternative (`false`) would silently do nothing for a first-time
 * legitimate user, which is worse.
 */
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/services/supabase';
import {
  AuthError,
  type AppSession,
  type AuthErrorCode,
  type AuthProvider,
  type Unsubscribe,
} from './types';

function toAppSession(session: Session | null): AppSession | null {
  if (!session?.user) return null;
  return {
    providerUserId: session.user.id,
    email: session.user.email ?? '',
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? null,
  };
}

/**
 * Supabase returns the database trigger's message inside its own error text.
 * Matching on our DVT_ error codes is deliberate: they are stable strings we
 * control, unlike Supabase's own wording which can change between releases.
 */
function classify(message: string): AuthErrorCode {
  const m = message.toLowerCase();
  if (m.includes('dvt_email_domain_not_allowed')) return 'domain_not_allowed';
  if (m.includes('dvt_user_not_provisioned')) return 'not_provisioned';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('429')) {
    return 'rate_limited';
  }
  if (m.includes('token has expired') || m.includes('invalid') || m.includes('otp')) {
    return 'wrong_code';
  }
  if (m.includes('network') || m.includes('fetch') || m.includes('timeout')) {
    return 'network';
  }
  return 'unknown';
}

export class SupabaseAuthProvider implements AuthProvider {
  async getSession(): Promise<AppSession | null> {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new AuthError(classify(error.message), error.message);
    return toAppSession(data.session);
  }

  async requestOtp(email: string): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw new AuthError(classify(error.message), error.message);
  }

  async verifyOtp(email: string, token: string): Promise<AppSession> {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: token.trim(),
      type: 'email',
    });
    if (error) throw new AuthError(classify(error.message), error.message);

    const session = toAppSession(data.session);
    if (!session) throw new AuthError('unknown', 'No session returned after verification');
    return session;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  onAuthStateChange(callback: (session: AppSession | null) => void): Unsubscribe {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(toAppSession(session));
    });
    return () => data.subscription.unsubscribe();
  }
}
