/**
 * The on-device database.
 *
 * A small SQLite file holding two things:
 *   - `cache`  — the last successful response for each dataset, so the app is
 *                usable in a basement with no signal;
 *   - `outbox` — writes made while offline, waiting to be sent.
 *
 * WHAT IS NOT IN HERE, ON PURPOSE
 * -------------------------------
 * No session token. Those stay in the device keychain via expo-secure-store
 * (see src/lib/supabase.ts). SQLite is an ordinary file in the app's sandbox;
 * a keychain is not, and a lost handset should not hand over a usable session.
 *
 * No patient information, because there is none anywhere in this system.
 *
 * Everything here is wiped on sign-out (see purgeAll), so a returned or shared
 * phone does not keep a former employee's routes and doctor names.
 * See docs/07-risks.md P3 and S10.
 */
import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'dvt-offline.db';

/**
 * Bumped when the schema below changes. `migrate` is written so that running
 * it repeatedly is harmless, which is what makes an interrupted upgrade safe.
 */
const SCHEMA_VERSION = 1;

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS cache (
      key         TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,
      fetched_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      kind            TEXT    NOT NULL,
      client_uuid     TEXT    NOT NULL,
      dependency_key  TEXT    NOT NULL,
      payload         TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      status          TEXT    NOT NULL DEFAULT 'pending',
      last_error      TEXT
    );

    CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox (status, id);
    CREATE INDEX IF NOT EXISTS outbox_dependency_idx ON outbox (dependency_key, id);
  `);

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/**
 * Open the database, migrating on first use.
 *
 * The in-flight promise is cached as well as the handle: two screens mounting
 * at once must not each start their own migration.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  if (opening) return opening;

  opening = (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await migrate(db);
    database = db;
    opening = null;
    return db;
  })();

  return opening;
}

/**
 * Delete everything and close the handle. Called on sign-out.
 *
 * NOTE the ordering problem this deliberately accepts: unsent work in the
 * outbox is destroyed too. Signing out with items still queued loses them,
 * which is why the sign-out confirmation warns when the queue is not empty
 * (see app/(tabs)/settings.tsx). Keeping one person's queued visit reports on
 * a device another person then signs into would be worse.
 */
export async function purgeAll(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('DELETE FROM outbox; DELETE FROM cache;');
}

/** For diagnostics on the sync screen: roughly how much is stored locally. */
export async function storageStats(): Promise<{ cacheRows: number; outboxRows: number }> {
  const db = await getDatabase();
  const cache = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM cache');
  const outbox = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM outbox');
  return { cacheRows: cache?.n ?? 0, outboxRows: outbox?.n ?? 0 };
}
