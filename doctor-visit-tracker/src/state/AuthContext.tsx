/**
 * Session and profile state for the whole app.
 *
 * Two separate things are tracked, and the difference matters:
 *   session — the identity provider says who you are
 *   profile — the database says what you may do
 *
 * A person can hold a valid session and still have no usable profile (their
 * account was deactivated after they logged in). In that case they are signed
 * out with a clear message rather than shown an empty, broken app.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authProvider, type AppSession } from '@/services/auth';
import { fetchMyProfile, recordLogin, type Profile } from '@/services/api';
import { env } from '@/config/env';

export type AuthStatus =
  | 'loading'
  | 'signedOut'
  | 'signedIn'
  /** Authenticated but the account is missing or deactivated. */
  | 'noAccess';

interface AuthContextValue {
  status: AuthStatus;
  session: AppSession | null;
  profile: Profile | null;
  /** Set when the account exists but cannot be used. */
  accessProblem: 'not_provisioned' | 'inactive' | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProviderComponent({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AppSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accessProblem, setAccessProblem] =
    useState<'not_provisioned' | 'inactive' | null>(null);

  const loadProfile = useCallback(async (activeSession: AppSession | null) => {
    if (!activeSession) {
      setProfile(null);
      setAccessProblem(null);
      setStatus('signedOut');
      return;
    }

    try {
      const p = await fetchMyProfile();

      if (!p) {
        setProfile(null);
        setAccessProblem('not_provisioned');
        setStatus('noAccess');
        return;
      }

      if (!p.is_active) {
        setProfile(null);
        setAccessProblem('inactive');
        setStatus('noAccess');
        return;
      }

      setProfile(p);
      setAccessProblem(null);
      setStatus('signedIn');
      void recordLogin(env.appVersion);
    } catch {
      // The session is valid but the profile could not be fetched — almost
      // always a network problem. Keep the person signed in rather than
      // throwing them out; the screens show their own error states.
      setProfile(null);
      setAccessProblem(null);
      setStatus('noAccess');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const existing = await authProvider.getSession();
        if (cancelled) return;
        setSession(existing);
        await loadProfile(existing);
      } catch {
        if (!cancelled) setStatus('signedOut');
      }
    })();

    const unsubscribe = authProvider.onAuthStateChange((next) => {
      setSession(next);
      void loadProfile(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session);
  }, [loadProfile, session]);

  const signOut = useCallback(async () => {
    await authProvider.signOut();
    setSession(null);
    setProfile(null);
    setAccessProblem(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, profile, accessProblem, refreshProfile, signOut }),
    [status, session, profile, accessProblem, refreshProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProviderComponent');
  return ctx;
}
