/**
 * Session state for the whole app.
 *
 * Holds two distinct things, and the distinction matters:
 *   identity — who the auth provider says you are (Supabase / later Entra ID)
 *   profile  — your app_user row: role, name, manager
 *
 * You can have an identity and no profile. That is the "authenticated but not
 * provisioned by an administrator" case, and the app must say so clearly
 * rather than showing an empty, broken interface.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getSupabase } from '../supabase';
import { SupabaseAuthProvider } from './supabaseAuthProvider';
import { AuthError, type AuthIdentity, type AuthProvider } from './types';

export type UserRole = 'representative' | 'manager' | 'administrator';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  manager_id: string | null;
  is_active: boolean;
}

/**
 * SWAP POINT FOR MICROSOFT ENTRA ID.
 * Replace this one line with `new EntraAuthProvider()` and the rest of the
 * application is unchanged.
 */
const authProvider: AuthProvider = new SupabaseAuthProvider();

interface SessionState {
  status: 'loading' | 'signed_out' | 'not_provisioned' | 'ready';
  identity: AuthIdentity | null;
  profile: UserProfile | null;
  error: string | null;
}

interface SessionContextValue extends SessionState {
  auth: AuthProvider;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  isRep: boolean;
  isManager: boolean;
  isAdmin: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    identity: null,
    profile: null,
    error: null,
  });

  const loadProfile = useCallback(async (identity: AuthIdentity | null) => {
    if (!identity) {
      setState({ status: 'signed_out', identity: null, profile: null, error: null });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setState({ status: 'signed_out', identity, profile: null, error: 'config' });
      return;
    }

    // RLS restricts this to the caller's own row.
    const { data, error } = await supabase
      .from('app_user')
      .select('id, email, full_name, phone, role, manager_id, is_active')
      .eq('auth_user_id', identity.id)
      .maybeSingle();

    if (error) {
      setState({ status: 'signed_out', identity, profile: null, error: error.message });
      return;
    }

    if (!data || !data.is_active) {
      // Authenticated, but the administrator has not provisioned (or has
      // deactivated) this person. Every policy will deny them, so say so.
      setState({ status: 'not_provisioned', identity, profile: null, error: null });
      return;
    }

    setState({
      status: 'ready',
      identity,
      profile: data as UserProfile,
      error: null,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    authProvider
      .getIdentity()
      .then((identity) => {
        if (!cancelled) return loadProfile(identity);
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'signed_out', identity: null, profile: null, error: null });
        }
      });

    const unsubscribe = authProvider.onIdentityChange((identity) => {
      if (!cancelled) void loadProfile(identity);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    const identity = await authProvider.getIdentity();
    await loadProfile(identity);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await authProvider.signOut();
    setState({ status: 'signed_out', identity: null, profile: null, error: null });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      auth: authProvider,
      refreshProfile,
      signOut,
      isRep: state.profile?.role === 'representative',
      isManager: state.profile?.role === 'manager' || state.profile?.role === 'administrator',
      isAdmin: state.profile?.role === 'administrator',
    }),
    [state, refreshProfile, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return context;
}

export { AuthError };
export type { AuthIdentity, AuthProvider };
