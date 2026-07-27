#!/usr/bin/env node
/**
 * db-provision.mjs
 *
 * Builds a throwaway PostgreSQL database from scratch:
 *   1. drop + create the database
 *   2. apply the local Supabase shim (auth schema + anon/authenticated roles)
 *   3. apply every migration in supabase/migrations, in filename order
 *   4. apply every seed file in supabase/seed, in filename order
 *
 * Used by the automated tests, and by a developer who wants a clean local
 * database. It intentionally uses the same psql invocation a person would type,
 * so there is no "works in tests, fails by hand" gap.
 *
 * Configuration comes from environment variables (see .env.example):
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD  — standard libpq variables
 *   TEST_DATABASE                        — database name (default: dvt_test)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const database = process.env.TEST_DATABASE ?? 'dvt_test';
const quiet = process.argv.includes('--quiet');

function psql(args, { db } = {}) {
  return execFileSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '--no-psqlrc', '-d', db ?? 'postgres', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function sqlFilesIn(dir) {
  const path = join(root, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(path, f));
}

function log(...args) {
  if (!quiet) console.log(...args);
}

export function provision() {
  log(`▸ Rebuilding database "${database}"`);

  // Terminate stragglers so DROP DATABASE cannot hang on an idle connection.
  psql([
    '-c',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${database}' AND pid <> pg_backend_pid();`,
  ]);
  psql(['-c', `DROP DATABASE IF EXISTS ${database};`]);
  psql(['-c', `CREATE DATABASE ${database};`]);

  const shim = join(root, 'supabase/tests/00_local_shim.sql');
  if (existsSync(shim)) {
    log('  · local Supabase shim');
    psql(['-f', shim], { db: database });
  }

  for (const file of sqlFilesIn('supabase/migrations')) {
    log(`  · migration ${file.split('/').pop()}`);
    psql(['-f', file], { db: database });
  }

  for (const file of sqlFilesIn('supabase/seed')) {
    log(`  · seed ${file.split('/').pop()}`);
    psql(['-f', file], { db: database });
  }

  log(`▸ Database "${database}" ready`);
  return database;
}

// Allow both `node scripts/db-provision.mjs` and `import { provision }`.
if (process.argv[1] && process.argv[1].endsWith('db-provision.mjs')) {
  try {
    provision();
  } catch (error) {
    console.error('\n✖ Provisioning failed.\n');
    console.error(error.stderr?.toString() ?? error.message);
    process.exit(1);
  }
}
