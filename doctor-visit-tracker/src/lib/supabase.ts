/**
 * The Supabase client.
 *
 * Session tokens are stored in the device keychain (iOS) / keystore (Android)
 * via expo-secure-store, not in plain AsyncStorage. A stolen or lost phone
 * therefore does not leak a usable session to anyone who can read the app's
 * files. See docs/07-risks.md S10.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { assertNotServiceRoleKey, readEnv } from './env';

/**
 * SecureStore has a 2048-byte limit per value on iOS, and Supabase sessions
 * can exceed that once a JWT carries claims. Chunk the value across keys.
 */
const CHUNK_SIZE = 1800;

const secureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(`${key}.0`);
    if (head === null) {
      // Fall back to a single unchunked value written by an older version.
      return SecureStore.getItemAsync(key);
    }
    let value = head;
    for (let i = 1; ; i += 1) {
      const chunk = await SecureStore.getItemAsync(`${key}.${i}`);
      if (chunk === null) break;
      value += chunk;
    }
    return value;
  },

  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    for (let i = 0; i * CHUNK_SIZE < value.length; i += 1) {
      await SecureStore.setItemAsync(
        `${key}.${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
  },

  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key).catch(() => {});
    for (let i = 0; i < 20; i += 1) {
      const existing = await SecureStore.getItemAsync(`${key}.${i}`);
      if (existing === null) break;
      await SecureStore.deleteItemAsync(`${key}.${i}`);
    }
  },
};

let client: SupabaseClient | null = null;
let configError: string[] | null = null;

/**
 * Returns the shared client, or null when configuration is missing.
 * Callers show `mn.errors.configMissing` rather than crashing.
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (configError) return null;

  const { ok, env, missing } = readEnv();
  if (!ok || !env) {
    configError = missing;
    console.warn(
      `Supabase is not configured. Missing: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill it in — see docs/90-setup-for-non-technical.md',
    );
    return null;
  }

  assertNotServiceRoleKey(env.supabaseAnonKey);

  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: secureStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      // The app has no browser redirect flow; codes are typed in by hand.
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'x-application': 'doctor-visit-tracker',
        'x-platform': Platform.OS,
      },
    },
  });

  return client;
}

/** Which variables are missing, for the configuration error screen. */
export function getConfigError(): string[] | null {
  if (!client && !configError) getSupabase();
  return configError;
}
