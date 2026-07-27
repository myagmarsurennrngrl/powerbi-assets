/**
 * Environment configuration.
 *
 * Rules enforced here:
 *  - No secret is ever written in source code. Values come from .env, which is
 *    git-ignored.
 *  - Only EXPO_PUBLIC_* variables are readable in the app. Anything with that
 *    prefix is compiled into the bundle and must be assumed public — which is
 *    why the service_role key must never be given that prefix.
 *  - Missing configuration fails loudly at startup with a Mongolian message,
 *    rather than producing a confusing network error later.
 */

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface EnvResult {
  ok: boolean;
  env: AppEnv | null;
  missing: string[];
}

/**
 * Read and validate configuration.
 *
 * Note the literal `process.env.EXPO_PUBLIC_...` references: Expo replaces
 * these at build time by textual substitution, so they cannot be read from a
 * computed key such as process.env[name].
 */
export function readEnv(): EnvResult {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const missing: string[] = [];
  if (!supabaseUrl || supabaseUrl.includes('your-project-ref')) {
    missing.push('EXPO_PUBLIC_SUPABASE_URL');
  }
  if (!supabaseAnonKey || supabaseAnonKey.includes('paste-your')) {
    missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }

  if (missing.length > 0) {
    return { ok: false, env: null, missing };
  }

  return { ok: true, env: { supabaseUrl, supabaseAnonKey }, missing: [] };
}

/**
 * A service_role key starts with a JWT header whose payload contains
 * "service_role". Shipping one in a mobile app would hand every user full
 * database access, bypassing every policy in this project. Refuse to start.
 */
export function assertNotServiceRoleKey(key: string): void {
  try {
    const payload = key.split('.')[1];
    if (!payload) return;
    const decoded = globalThis.atob
      ? globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
      : '';
    if (decoded.includes('service_role')) {
      throw new Error(
        'FATAL: EXPO_PUBLIC_SUPABASE_ANON_KEY contains a service_role key. ' +
          'That key bypasses all security rules and must never be in the mobile app. ' +
          'Use the anon/public key instead.',
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('FATAL')) throw error;
    // A key we cannot decode is not proof of a problem; leave it alone.
  }
}
