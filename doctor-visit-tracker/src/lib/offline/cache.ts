/**
 * Read-through cache for the datasets a representative needs in a building
 * with no signal.
 *
 * The pattern every caller uses is `cachedRead`:
 *   1. try the network;
 *   2. on success, store the result and return it as fresh;
 *   3. on failure, return whatever was stored, labelled with its age.
 *
 * Step 3 is the whole point, and step 3's *label* is what keeps it honest. A
 * screen that shows old data without saying so is worse than one that shows an
 * error, because the person acts on it.
 *
 * What may be cached is fixed by src/domain/cachePolicy.ts. There is no key
 * for visit eligibility, the audit log or exports — those must always be live.
 */
import { freshnessOf, type CacheKey, type Freshness } from '../../domain/cachePolicy';
import type { Result } from '../../data/types';
import { getDatabase } from './db';

export interface CachedResult<T> extends Result<T> {
  /** True when the value came from disk rather than the network. */
  fromCache: boolean;
  freshness: Freshness | null;
  fetchedAt: number | null;
}

export async function readCache<T>(
  key: CacheKey,
): Promise<{ value: T; fetchedAt: number } | null> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ payload: string; fetched_at: number }>(
      'SELECT payload, fetched_at FROM cache WHERE key = ?',
      [key],
    );
    if (!row) return null;
    return { value: JSON.parse(row.payload) as T, fetchedAt: row.fetched_at };
  } catch {
    // A corrupt or unavailable cache must never break a screen that could
    // otherwise have shown live data.
    return null;
  }
}

export async function writeCache<T>(key: CacheKey, value: T): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO cache (key, payload, fetched_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(value), Date.now()],
    );
  } catch {
    // Failing to cache is not a reason to fail the read the user asked for.
  }
}

/**
 * Network first, disk as the fallback.
 *
 * `fetcher` is the ordinary online repository function. Nothing about it
 * changes to become cacheable — which is what keeps the caching in one place
 * rather than smeared across every screen.
 */
export async function cachedRead<T>(
  key: CacheKey,
  fetcher: () => Promise<Result<T>>,
): Promise<CachedResult<T>> {
  let networkResult: Result<T> | null = null;

  try {
    networkResult = await fetcher();
  } catch (error) {
    networkResult = {
      data: null,
      error: error instanceof Error ? error.message : 'network',
    };
  }

  if (networkResult.data !== null && !networkResult.error) {
    await writeCache(key, networkResult.data);
    return {
      data: networkResult.data,
      error: null,
      fromCache: false,
      freshness: 'fresh',
      fetchedAt: Date.now(),
    };
  }

  const cached = await readCache<T>(key);
  if (cached) {
    return {
      data: cached.value,
      // The network error is deliberately dropped here: the screen has data to
      // show, and an error banner over usable content only causes doubt. The
      // age banner is what the person needs instead.
      error: null,
      fromCache: true,
      freshness: freshnessOf(key, cached.fetchedAt, Date.now()),
      fetchedAt: cached.fetchedAt,
    };
  }

  // Nothing live and nothing stored: the real error is the useful answer.
  return {
    data: null,
    error: networkResult.error,
    fromCache: false,
    freshness: null,
    fetchedAt: null,
  };
}

export async function clearCacheKey(key: CacheKey): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM cache WHERE key = ?', [key]);
}
