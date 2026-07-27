#!/usr/bin/env bash
# ===========================================================================
# Rebuild the test database from scratch and run every *.test.sql file.
# Exits non-zero if any assertion fails.
#
#   ./scripts/run-sql-tests.sh            quiet
#   ./scripts/run-sql-tests.sh --verbose  show every individual assertion
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-55432}"
export PGUSER="${PGUSER:-postgres}"
export DB_NAME="${DB_NAME:-dvt_test}"

VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

echo "Rebuilding $DB_NAME ..."
"$ROOT/scripts/local-db.sh" --seed > "$OUT_DIR/build.log" 2>&1 || {
  echo "Database build FAILED:"; cat "$OUT_DIR/build.log"; exit 1;
}

failed=0
total=0
for f in "$ROOT"/supabase/tests/*.test.sql; do
  name="$(basename "$f")"
  total=$((total + 1))
  log="$OUT_DIR/$name.log"

  if psql -v ON_ERROR_STOP=1 -q -t -d "$DB_NAME" -f "$f" > "$log" 2>&1; then
    passed_count=$(grep -c 'ok  ' "$log" || true)
    echo "  PASS  $name  ($passed_count assertions)"
    [[ $VERBOSE -eq 1 ]] && sed 's/^NOTICE:  //' "$log" | grep 'ok  ' || true
  else
    echo "  FAIL  $name"
    grep -E 'FAILED|ERROR' "$log" | head -5 | sed 's/^/        /'
    failed=$((failed + 1))
  fi
done

echo
if [[ $failed -ne 0 ]]; then
  echo "SQL tests: $failed of $total file(s) FAILED"
  exit 1
fi
echo "SQL tests: all $total file(s) passed"
