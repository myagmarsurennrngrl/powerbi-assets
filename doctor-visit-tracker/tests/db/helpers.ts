/**
 * Test helpers for exercising the database exactly the way PostgREST does.
 *
 * Why this matters: it would be easy (and worthless) to test policies while
 * connected as the superuser, because a superuser bypasses row-level security.
 * Every helper here switches to the `authenticated` (or `anon`) role and sets
 * the same `request.jwt.claim.sub` GUC that Supabase populates from the JWT.
 * What the tests exercise is therefore the real policy, not an approximation.
 */
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;

export const TEST_DATABASE = process.env.TEST_DATABASE ?? 'dvt_test';

/**
 * Is the provisioned test database reachable?
 *
 * Checked synchronously at import time so test files can use
 * `describe.skipIf(!DB_AVAILABLE)`, which needs its value during collection.
 * On a machine with no PostgreSQL the database tests are skipped with a clear
 * message instead of failing; the pure-domain tests still run.
 */
export const DB_AVAILABLE: boolean = (() => {
  try {
    execFileSync('psql', ['-c', 'SELECT 1', '-d', TEST_DATABASE, '--no-psqlrc'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      database: TEST_DATABASE,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      max: 4,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Run a query with full privileges (setup, and assertions about raw state). */
export async function asSuperuser<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

/**
 * Simulate a first sign-in: create the auth.users row, which fires the trigger
 * that links it to the pre-provisioned app_user. Returns the auth user id.
 * This is also how the tests prove the linking trigger works.
 */
export async function signIn(email: string): Promise<string> {
  const existing = await asSuperuser<{ id: string }>(
    'SELECT id FROM auth.users WHERE email = $1',
    [email],
  );
  if (existing.length > 0) return existing[0].id;

  const [row] = await asSuperuser<{ id: string }>(
    'INSERT INTO auth.users (email) VALUES ($1) RETURNING id',
    [email],
  );
  return row.id;
}

export interface ActingSession {
  /** Run a statement as this user. Rejects if RLS or a grant denies it. */
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Assert that a statement is rejected, and return the PostgreSQL error. */
  expectDenied(sql: string, params?: unknown[]): Promise<pg.DatabaseError>;
  /**
   * Assert that a SELECT returns no rows. RLS hides rows rather than raising,
   * so "denied" for a read means "invisible", not "error".
   */
  expectInvisible(sql: string, params?: unknown[]): Promise<void>;
}

/**
 * Shared session body. Every call runs inside a transaction that is always
 * rolled back, so no test can leave state behind that affects another.
 */
async function withSession<T>(
  configure: (client: pg.PoolClient) => Promise<void>,
  fn: (session: ActingSession) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await configure(client);

    const session: ActingSession = {
      async query<R = any>(sql: string, params: unknown[] = []): Promise<R[]> {
        const result = await client.query(sql, params);
        return result.rows as R[];
      },

      async expectDenied(sql: string, params: unknown[] = []) {
        // A failed statement aborts the transaction. Wrap each attempt in its
        // own savepoint so the caller can keep asserting afterwards.
        await client.query('SAVEPOINT attempt');
        try {
          await client.query(sql, params);
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT attempt');
          return error as pg.DatabaseError;
        }
        await client.query('ROLLBACK TO SAVEPOINT attempt');
        throw new Error(`Expected this statement to be denied, but it succeeded:\n${sql}`);
      },

      async expectInvisible(sql: string, params: unknown[] = []) {
        const result = await client.query(sql, params);
        if (result.rows.length > 0) {
          throw new Error(
            `Expected no visible rows, but ${result.rows.length} were returned:\n${sql}`,
          );
        }
      },
    };

    return await fn(session);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** Act as a signed-in application user. */
export async function actingAs<T>(
  email: string,
  fn: (session: ActingSession) => Promise<T>,
): Promise<T> {
  const authUserId = await signIn(email);
  return withSession(async (client) => {
    // Set the claim BEFORE switching role: a non-superuser role may not be
    // allowed to set arbitrary configuration parameters.
    await client.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claim.sub',
      authUserId,
    ]);
    await client.query('SET LOCAL ROLE authenticated');
  }, fn);
}

/** Act as an unauthenticated visitor (Supabase `anon`). */
export async function actingAsAnon<T>(fn: (session: ActingSession) => Promise<T>): Promise<T> {
  return withSession(async (client) => {
    await client.query('SET LOCAL ROLE anon');
  }, fn);
}

/**
 * Act as a signed-in identity that has NO app_user row — i.e. someone whose
 * address is in an approved domain but whom an administrator never provisioned.
 */
export async function actingAsUnprovisioned<T>(
  authUserId: string,
  fn: (session: ActingSession) => Promise<T>,
): Promise<T> {
  return withSession(async (client) => {
    await client.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claim.sub',
      authUserId,
    ]);
    await client.query('SET LOCAL ROLE authenticated');
  }, fn);
}

/** Seed identities, so the tests read clearly. */
export const USERS = {
  admin: 'admin@monos.mn',
  manager1: 'manager01@monos.mn',
  manager2: 'manager02@monos.mn',
  manager3: 'manager03@monos.mn',
  rep1: 'rep01@monos.mn',
  rep2: 'rep02@monos.mn',
  rep4: 'rep04@monos.mn',
  rep7: 'rep07@monos.mn',
} as const;
