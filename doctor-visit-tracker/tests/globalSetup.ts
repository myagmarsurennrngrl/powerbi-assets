/**
 * Builds a fresh test database once, before the whole suite runs.
 *
 * If PostgreSQL is not reachable, the database tests are SKIPPED rather than
 * failed, and the reason is printed. The pure-domain tests still run. This
 * keeps `npm test` useful on a laptop that has no database, while CI (which
 * does have one) still enforces every policy.
 */
import { execFileSync } from 'node:child_process';

export default async function setup() {
  try {
    execFileSync('psql', ['-c', 'SELECT 1', '-d', 'postgres', '--no-psqlrc'], {
      stdio: 'ignore',
    });
  } catch {
    process.env.DVT_SKIP_DB_TESTS = '1';
    console.warn(
      '\n⚠  PostgreSQL is not reachable — database tests will be skipped.\n' +
        '   Start a local PostgreSQL and set PGHOST/PGUSER to run them.\n',
    );
    return;
  }

  const { provision } = await import('../scripts/db-provision.mjs');
  provision();
  process.env.DVT_SKIP_DB_TESTS = '0';
}
