/**
 * A small loader hook so every screen handles loading / error / empty the same
 * way, and so pull-to-refresh works everywhere without repeated boilerplate.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Result } from './types';

export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
  refresh: () => void;
}

export function useAsyncData<T>(
  loader: () => Promise<Result<T>>,
  dependencies: unknown[] = [],
): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      const result = await loader();
      setData(result.data);
      setError(result.error);

      setLoading(false);
      setRefreshing(false);
    },
    // The loader is recreated by the caller when its inputs change; the
    // dependency array is what the caller declares.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    dependencies,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await run('initial');
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  return {
    data,
    loading,
    refreshing,
    error,
    reload: () => void run('initial'),
    refresh: () => void run('refresh'),
  };
}
