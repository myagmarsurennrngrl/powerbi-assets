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
  /** A specific, actionable problem with a value that IS present. */
  problem: string | null;
}

/**
 * Tidy a value copied out of a `.env` file by hand.
 *
 * Two mistakes account for almost every broken setup, and neither is visible
 * when you look at the file:
 *
 *   EXPO_PUBLIC_SUPABASE_URL="https://abc.supabase.co"   <- quotes are kept
 *   EXPO_PUBLIC_SUPABASE_URL=https://abc.supabase.co␣    <- trailing space
 *
 * A `.env` file has no quoting rules, so the quotes become part of the value
 * and the URL is then invalid. Stripping them here is not guesswork: a leading
 * and trailing quote around a URL is never intentional.
 */
function clean(value: string): string {
  const trimmed = value.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.trim();
}

/**
 * Is this something `createClient` will accept?
 *
 * Without this check a malformed URL sailed through and blew up several layers
 * down inside the Supabase client, as a red screen and a stack trace pointing
 * at supabase.ts — which tells the person nothing about the file they need to
 * edit. See tests/domain/env.test.ts.
 */
function describeUrlProblem(url: string): string | null {
  // The literal-text check comes FIRST, and it is not redundant.
  //
  // `new URL('https:abc.supabase.co')` — no slashes — succeeds, and reports
  // hostname 'abc.supabase.co'. The WHATWG parser repairs the missing slashes
  // for special schemes. So a URL object cannot tell us whether the text in
  // the file was written correctly; only the text can.
  //
  // supabase-js does not repair it. It tests the raw string against a regex
  // that requires '://' and throws
  //     Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
  // This is the exact line that produced that error in the field:
  //     EXPO_PUBLIC_SUPABASE_URL=https:vhkqjpakvuearcjmycsd.supabase.co
  if (!/^https?:\/\//i.test(url)) {
    return `EXPO_PUBLIC_SUPABASE_URL нь https:// -ээр эхлэх ёстой. Одоо: "${url}"`;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `EXPO_PUBLIC_SUPABASE_URL хаяг буруу байна: "${url}"`;
  }

  if (!parsed.hostname.includes('.')) {
    return `EXPO_PUBLIC_SUPABASE_URL бүрэн бус байна: "${url}"`;
  }
  return null;
}

/**
 * Read and validate configuration.
 *
 * Note the literal `process.env.EXPO_PUBLIC_...` references: Expo replaces
 * these at build time by textual substitution, so they cannot be read from a
 * computed key such as process.env[name].
 */
export function readEnv(): EnvResult {
  const supabaseUrl = clean(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
  const supabaseAnonKey = clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '');

  const missing: string[] = [];
  if (!supabaseUrl || supabaseUrl.includes('your-project-ref')) {
    missing.push('EXPO_PUBLIC_SUPABASE_URL');
  }
  if (!supabaseAnonKey || supabaseAnonKey.includes('paste-your')) {
    missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }

  if (missing.length > 0) {
    return { ok: false, env: null, missing, problem: null };
  }

  // Present but wrong is a different situation from absent, and needs a
  // different message: "fill in the file" versus "this line is malformed".
  const urlProblem = describeUrlProblem(supabaseUrl);
  if (urlProblem) {
    return { ok: false, env: null, missing: [], problem: urlProblem };
  }

  // The anon key is a JWT: three dot-separated parts. A truncated paste is the
  // usual cause, and it fails much later with a confusing auth error.
  if (supabaseAnonKey.split('.').length !== 3) {
    return {
      ok: false,
      env: null,
      missing: [],
      problem:
        'EXPO_PUBLIC_SUPABASE_ANON_KEY бүтэн хуулагдаагүй байна. Supabase дээрх Copy товчийг ' +
        'ашиглан бүтнээр нь дахин хуулна уу.',
    };
  }

  // A trailing slash is harmless to look at and produces doubled slashes in
  // every request path. Copying the address out of the browser's URL bar adds
  // one, so this is common rather than exotic.
  const normalisedUrl = supabaseUrl.replace(/\/+$/, '');

  return {
    ok: true,
    env: { supabaseUrl: normalisedUrl, supabaseAnonKey },
    missing: [],
    problem: null,
  };
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
