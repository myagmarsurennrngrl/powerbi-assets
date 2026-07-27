#!/usr/bin/env bash
# ===========================================================================
# Rebuild a throwaway PostgreSQL database, apply every migration in order and
# (optionally) the seed data. Used by the SQL test suite and handy for anyone
# who wants to inspect the schema without a Supabase account.
#
#   ./scripts/local-db.sh            rebuild schema only
#   ./scripts/local-db.sh --seed     rebuild schema and load the test data
#
# Requires: a running PostgreSQL 15+ reachable with the PG* variables below.
# ===========================================================================
set -euo pipefail

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
DB_NAME="${DB_NAME:-dvt_test}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGHOST PGPORT PGUSER

psql_root() { psql -v ON_ERROR_STOP=1 -q -d postgres "$@"; }
psql_db()   { psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" "$@"; }

echo "==> Recreating database '$DB_NAME'"
psql_root -c "drop database if exists ${DB_NAME} with (force);" >/dev/null

# The locale matters. Under the "C" locale PostgreSQL's lower() leaves Cyrillic
# untouched, which would silently break the duplicate-detection indexes on
# clinic and doctor names. Supabase projects run a UTF-8 locale, so the test
# database must too, otherwise the tests would not reflect production.
LOCALE=""
for candidate in en_US.UTF-8 en_US.utf8 C.UTF-8 C.utf8; do
  if psql_root -tAc "select 1 from pg_collation where collname = '${candidate}' limit 1" | grep -q 1 \
     || locale -a 2>/dev/null | grep -qix "${candidate}"; then
    LOCALE="$candidate"
    break
  fi
done

if [[ -z "$LOCALE" ]]; then
  echo "ERROR: no UTF-8 locale available. Install one (e.g. locale-gen en_US.UTF-8)." >&2
  exit 1
fi

echo "    using locale $LOCALE"
psql_root -c "create database ${DB_NAME}
                template template0
                encoding 'UTF8'
                lc_collate '${LOCALE}'
                lc_ctype   '${LOCALE}';" >/dev/null

echo "==> Applying Supabase stub (test harness only)"
psql_db -f "$ROOT/supabase/tests/00_supabase_stub.sql" >/dev/null

echo "==> Applying migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    - $(basename "$f")"
  psql_db -f "$f" >/dev/null
done

if [[ "${1:-}" == "--seed" ]]; then
  echo "==> Loading seed data"
  psql_db -f "$ROOT/supabase/seed/seed.sql" >/dev/null
fi

echo "==> Done. Connect with: psql -h $PGHOST -p $PGPORT -U $PGUSER -d $DB_NAME"
