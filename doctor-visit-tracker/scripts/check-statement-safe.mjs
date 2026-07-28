#!/usr/bin/env node
/**
 * Are the migrations and seeds safe to run statement-by-statement, and safe to
 * re-run?
 *
 * WHY THIS EXISTS
 * ---------------
 * `psql -f file.sql` runs a whole file in ONE session and, with an explicit
 * BEGIN, one transaction. The Supabase SQL editor — which is what the setup
 * guide tells a non-technical administrator to use — does not: it sends
 * statements separately, and session-scoped state does not survive between
 * them.
 *
 * Seed 0003 used `CREATE TEMP TABLE ... ON COMMIT DROP`. Perfect under psql,
 * and in the SQL editor the table was gone before the next statement could
 * read it:
 *
 *     ERROR: 42P01: relation "tmp_completed" does not exist
 *
 * It passed every automated test, because every automated test used psql.
 *
 * This script closes that gap: it replays each file with every statement on
 * its own connection — harsher than any real tool — and then checks the data
 * matches what the normal path produces.
 *
 * USAGE
 *   node scripts/check-statement-safe.mjs
 *
 * Needs a reachable PostgreSQL (the same PGHOST/PGUSER the tests use). It
 * builds and drops its own scratch database and touches nothing else.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATABASE = 'dvt_stmt_check';
const ROOT = new URL('..', import.meta.url).pathname;

function psql(args, { db = 'postgres', quiet = true } = {}) {
  return execFileSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '--no-psqlrc', '-d', db, ...args],
    { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' },
  );
}

/**
 * Split SQL on statement boundaries, respecting single-quoted strings,
 * dollar-quoted bodies ($$ ... $$, $tag$ ... $tag$) and line comments.
 */
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let dollarTag = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
    } else if (inSingle) {
      if (ch === "'") inSingle = false;
    } else {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        dollarTag = tag[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
      } else if (sql.startsWith('/*', i)) {
        // Block comment. A semicolon inside one must not split the statement —
        // that is what broke migration 0025 the first time this ran.
        const end = sql.indexOf('*/', i + 2);
        const stop = end === -1 ? sql.length : end + 2;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      } else if (sql.startsWith('--', i)) {
        const end = sql.indexOf('\n', i);
        const stop = end === -1 ? sql.length : end;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      } else if (ch === ';') {
        out.push(buf + ';');
        buf = '';
        i += 1;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  if (buf.trim()) out.push(buf);

  // Keep only chunks with something other than comments and whitespace. A
  // statement preceded by a comment block is still a statement — dropping it
  // is how the first version of this check silently tested nothing.
  return out.filter((chunk) => {
    // Strip comments before deciding a chunk is empty. A statement preceded by
    // a comment block is still a statement — discarding those is how the first
    // version of this check silently tested almost nothing.
    const bare = chunk.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    return bare.trim().length > 0;
  });
}

function filesIn(dir) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(ROOT, dir, f));
}

function runSplit(file) {
  const statements = splitStatements(readFileSync(file, 'utf8'));
  statements.forEach((stmt, n) => {
    try {
      psql(['-c', stmt], { db: DATABASE });
    } catch (error) {
      const code = stmt
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 90);
      throw new Error(
        `${file.split('/').pop()} statement ${n + 1} failed when run on its own:\n` +
          `  ${code}\n${error.stderr ?? error.message}`,
      );
    }
  });
  return statements.length;
}

function count(sql) {
  return Number(psql(['-tAc', sql], { db: DATABASE }).trim());
}

console.log(`▸ Rebuilding "${DATABASE}" and replaying every statement separately\n`);

psql(['-c', `DROP DATABASE IF EXISTS ${DATABASE};`]);
psql(['-c', `CREATE DATABASE ${DATABASE};`]);
psql(['-f', join(ROOT, 'supabase/tests/00_local_shim.sql')], { db: DATABASE });

let total = 0;
for (const file of [...filesIn('supabase/migrations'), ...filesIn('supabase/seed')]) {
  const n = runSplit(file);
  total += n;
  console.log(`  · ${file.split('/').pop().padEnd(34)} ${String(n).padStart(3)} statements`);
}

// -----------------------------------------------------------------------------
// Every seed must also be re-runnable against a FULLY POPULATED database.
//
// Each seed clears its own data first, but "its own" grew with every phase. The
// Phase 1 seed deleted only Phase 1 tables, so re-running it once visits
// existed failed on a foreign key from planned_visit_brand to product. Running
// the seeds a second time, in order, is the shortest test that catches it.
// -----------------------------------------------------------------------------
console.log('\n▸ Re-running every seed against the populated database');
for (const file of filesIn('supabase/seed')) {
  const n = runSplit(file);
  console.log(`  · ${file.split('/').pop().padEnd(34)} ${String(n).padStart(3)} statements (re-run)`);
}

// The point is not only that nothing errored — a silent no-op passes that.
// These are the numbers `node scripts/db-provision.mjs` produces, and a second
// pass must land on exactly the same ones.
const expected = { visit: 204, visit_event: 408, clinic: 15, doctor: 50 };
const problems = [];

for (const [table, want] of Object.entries(expected)) {
  const got = count(`SELECT count(*) FROM public.${table}`);
  if (got !== want) problems.push(`${table}: expected ${want}, got ${got}`);
}
if (count(`SELECT count(*) FROM pg_class WHERE relname LIKE 'seed_tmp_%'`) > 0) {
  problems.push('a seed scratch table was left behind');
}

// Seed 0003 repeats the same CTE in three statements, and every derived value
// hangs off the row_number() it computes. If the three copies ever disagree —
// a changed ORDER BY, a changed WHERE — the visits and their events drift
// apart silently. These invariants catch that.
const visitsWithoutTwoEvents = count(
  `SELECT count(*) FROM public.visit v
   WHERE (SELECT count(*) FROM public.visit_event e WHERE e.visit_id = v.id) <> 2`,
);
if (visitsWithoutTwoEvents > 0) {
  problems.push(`${visitsWithoutTwoEvents} visits do not have exactly one check-in and one check-out`);
}

const eventClinicMismatch = count(
  `SELECT count(*) FROM public.visit_event e
   JOIN public.visit v ON v.id = e.visit_id
   WHERE e.clinic_id <> v.clinic_id`,
);
if (eventClinicMismatch > 0) {
  problems.push(`${eventClinicMismatch} location events point at a different clinic than their visit`);
}

// The deliberate anomalies exist so the manager review list is not empty on
// day one. Losing them would quietly remove the only test data that exercises
// that screen.
for (const [what, sql, want] of [
  ['outside the geofence', 'SELECT count(*) FROM public.visit_event WHERE outside_geofence', 4],
  ['mocked location', 'SELECT count(*) FROM public.visit_event WHERE is_mocked_location', 1],
  ['too short', 'SELECT count(*) FROM public.visit WHERE duration_seconds < 120', 2],
]) {
  const got = count(sql);
  if (got !== want) problems.push(`seeded anomalies "${what}": expected ${want}, got ${got}`);
}
const findings = count('SELECT count(*) FROM public.fn_security_findings()');
if (findings > 0) problems.push(`fn_security_findings() returned ${findings} rows`);

psql(['-c', `DROP DATABASE IF EXISTS ${DATABASE};`]);

if (problems.length > 0) {
  console.error('\n✖ Statement-by-statement run produced the wrong result:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nThe statements did not error, which is worse: an administrator using the\n' +
      'Supabase SQL editor would get a quietly incomplete database.',
  );
  process.exit(1);
}

console.log(
  `\n✅ ${total} statements ran individually and produced identical data.\n` +
    '   Safe for the Supabase SQL editor as well as psql.',
);
