/**
 * The single Supabase client used by the whole app.
 *
 * Session tokens are kept in expo-secure-store, which puts them in the iOS
 * Keychain and the Android Keystore — encrypted by the operating system and
 * unreadable by other apps. They are never written to ordinary files.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { env } from '@/config/env';

/**
 * SecureStore rejects keys containing characters outside [A-Za-z0-9._-], and
 * Supabase uses keys like `sb-<ref>-auth-token`. Sanitising keeps both happy.
 */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * SecureStore has a 2048-byte practical limit per item on some Android
 * devices. Supabase sessions can exceed that once a JWT carries claims, so
 * long values are split across numbered chunks.
 */
const CHUNK_SIZE = 1800;

const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const head = await SecureStore.getItemAsync(base);
    if (head === null) return null;

    if (!head.startsWith('__chunks__:')) return head;

    const count = Number.parseInt(head.slice('__chunks__:'.length), 10);
    if (!Number.isFinite(count) || count <= 0) return null;

    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(`${base}_${i}`);
      if (part === null) return null; // incomplete write — treat as no session
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    await this.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(base, value);
      return;
    }

    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(
        `${base}_${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    await SecureStore.setItemAsync(base, `__chunks__:${count}`);
  },

  async removeItem(key: string): Promise<void> {
    const base = safeKey(key);
    const head = await SecureStore.getItemAsync(base);
    if (head?.startsWith('__chunks__:')) {
      const count = Number.parseInt(head.slice('__chunks__:'.length), 10);
      for (let i = 0; i < count; i += 1) {
        await SecureStore.deleteItemAsync(`${base}_${i}`);
      }
    }
    await SecureStore.deleteItemAsync(base);
  },
};

export const supabase: SupabaseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth redirect flow is used, so URL parsing is unnecessary and would
    // only add a way for a malicious deep link to reach the auth code path.
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      'x-app-version': env.appVersion,
      'x-app-platform': Platform.OS,
    },
  },
});
