/**
 * Environment configuration.
 *
 * Values come from the .env file (see .env.example). Expo inlines any variable
 * whose name starts with EXPO_PUBLIC_ at build time.
 *
 * Nothing secret lives here. The Supabase "anon" key is a public identifier:
 * on its own it can read and write nothing, because every table is protected
 * by Row Level Security in the database. The service-role key — which IS
 * secret — never appears in the mobile app at all.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  supabaseUrl: z.string().url('EXPO_PUBLIC_SUPABASE_URL must be a full https:// address'),
  supabaseAnonKey: z.string().min(20, 'EXPO_PUBLIC_SUPABASE_ANON_KEY looks too short'),
  allowedEmailDomains: z.array(z.string().min(3)).min(1),
  appVersion: z.string().min(1),
  debugLogging: z.boolean(),
});

export type Env = z.infer<typeof EnvSchema>;

function parseDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter((d) => d.length > 0);
}

const raw = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  allowedEmailDomains: parseDomains(process.env.EXPO_PUBLIC_ALLOWED_EMAIL_DOMAINS),
  appVersion: process.env.EXPO_PUBLIC_APP_VERSION ?? '0.0.0-dev',
  debugLogging: process.env.EXPO_PUBLIC_DEBUG_LOGGING === 'true',
};

const parsed = EnvSchema.safeParse(raw);

/**
 * When configuration is missing we do NOT crash on import — that would show
 * the user a white screen with a stack trace. Instead the app renders a
 * readable setup screen explaining exactly which line of .env is wrong.
 */
export const envError: string | null = parsed.success
  ? null
  : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');

export const env: Env = parsed.success
  ? parsed.data
  : {
      supabaseUrl: 'https://not-configured.invalid',
      supabaseAnonKey: 'not-configured-not-configured',
      allowedEmailDomains: [],
      appVersion: raw.appVersion,
      debugLogging: false,
    };

export const isConfigured = parsed.success;
