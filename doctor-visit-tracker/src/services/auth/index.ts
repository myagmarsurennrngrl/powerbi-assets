/**
 * Choosing the identity provider.
 *
 * TO MIGRATE TO MICROSOFT ENTRA ID LATER:
 *   1. Add `entraAuthProvider.ts` implementing the AuthProvider interface.
 *   2. Change the one line below.
 *   3. Run the mapping script that fills app_users.external_id with each
 *      person's Entra object id and sets auth_provider = 'entra_id'.
 * Nothing else in the application changes.
 */
import { SupabaseAuthProvider } from './supabaseAuthProvider';
import type { AuthProvider } from './types';

export const authProvider: AuthProvider = new SupabaseAuthProvider();

export * from './types';
