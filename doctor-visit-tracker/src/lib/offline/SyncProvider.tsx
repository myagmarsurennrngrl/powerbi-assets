/**
 * Connectivity and queue state for the whole app.
 *
 * One provider so that the offline banner, the sync screen and the sign-out
 * warning all read the same numbers. Screens never poll the queue themselves.
 *
 * Polling rather than a network event subscription: expo-network's listener
 * support differs across platforms and versions, and a 10-second poll of a
 * local SQLite count is cheap and predictable. Being wrong for ten seconds
 * about whether a queue is empty costs nothing; a missed event costs a
 * representative their afternoon's reports.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { summarise, type OutboxOperation, type OutboxSummary } from '../../domain/outbox';
import { listOutbox, recoverInterrupted } from './outboxStore';
import { drainSync, isOnline } from './sync';
import { purgeAll } from './db';

const POLL_MS = 10_000;

const EMPTY_SUMMARY: OutboxSummary = {
  pending: 0,
  blocked: 0,
  sending: 0,
  total: 0,
  oldestPendingAt: null,
};

interface SyncContextValue {
  online: boolean;
  summary: OutboxSummary;
  operations: OutboxOperation[];
  syncing: boolean;
  /** Send whatever is due, now. Safe to call from anywhere. */
  sync: () => Promise<void>;
  /** Re-read the queue without sending. */
  refresh: () => Promise<void>;
  /** Wipe every local trace. Called on sign-out. */
  purge: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [operations, setOperations] = useState<OutboxOperation[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Read inside the interval callback without making it a dependency, so the
  // timer is created once rather than on every connectivity change.
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const refresh = useCallback(async () => {
    try {
      setOperations(await listOutbox());
    } catch {
      // A failing local database must not take the app down. The sync screen
      // will show an empty queue, which is the honest thing it can say.
      setOperations([]);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await drainSync();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  const purge = useCallback(async () => {
    await purgeAll();
    setOperations([]);
  }, []);

  // Startup: reclaim anything interrupted by the app being killed mid-request,
  // then try to send.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await recoverInterrupted().catch(() => 0);
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      await sync();
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll connectivity, and send as soon as it comes back.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const nowOnline = await isOnline();
      if (cancelled) return;

      const cameBack = nowOnline && !onlineRef.current;
      setOnline(nowOnline);
      await refresh();

      if (cameBack) await sync();
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);

    // Coming back to the app is the moment a person most expects their queue
    // to move, and the poll may be nine seconds away.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tick();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh, sync]);

  const value = useMemo<SyncContextValue>(
    () => ({
      online,
      summary: operations.length === 0 ? EMPTY_SUMMARY : summarise(operations),
      operations,
      syncing,
      sync,
      refresh,
      purge,
    }),
    [online, operations, syncing, sync, refresh, purge],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * Returns a safe default when used outside the provider, so a screen rendered
 * in isolation (a test, a deep link before the tree is ready) does not crash.
 */
export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (context) return context;

  return {
    online: true,
    summary: EMPTY_SUMMARY,
    operations: [],
    syncing: false,
    sync: async () => {},
    refresh: async () => {},
    purge: async () => {},
  };
}
