#!/usr/bin/env bash
# Apply every migration in supabase/migrations to a throwaway PostgreSQL and run
# the SQL assertions in supabase/tests/*.test.sql.
#
#   npm run db:test                 # starts a temporary local cluster (needs initdb/pg_ctl)
#   DATABASE_URL=postgres://... npm run db:test   # use an existing empty database (CI service)
#
# Exits non-zero on the first failing migration or assertion.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"
PSQL_OPTS=(-X -q -v ON_ERROR_STOP=1)

cleanup() { :; }
if [[ -z "${DATABASE_URL:-}" ]]; then
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  [[ -x "$PGBIN/initdb" ]] || { echo "initdb not found; set PGBIN or DATABASE_URL" >&2; exit 2; }
  TMP="$(mktemp -d)"
  chmod 755 "$TMP"
  RUN_AS=()
  if [[ "$(id -u)" == "0" ]]; then chown postgres "$TMP"; RUN_AS=(runuser -u postgres --); fi
  "${RUN_AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
  "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -c listen_addresses='' -c fsync=off" -l "$TMP/log" -w start >/dev/null
  cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
  trap cleanup EXIT
  DATABASE_URL="postgresql://postgres@/postgres?host=$TMP"
fi

run() { psql "${PSQL_OPTS[@]}" "$DATABASE_URL" "$@"; }

echo "▶ bootstrap (Supabase roles + auth schema emulation)"
run -f "$TESTS/00_supabase_bootstrap.sql"

for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  echo "▶ migration $(basename "$f")"
  run -f "$f"
done

echo "▶ re-applying all migrations (idempotency check)"
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  run -f "$f" >/dev/null || { echo "✗ $(basename "$f") is not re-runnable" >&2; exit 1; }
done

shopt -s nullglob
for t in "$TESTS"/*.test.sql; do
  echo "▶ test $(basename "$t")"
  run -f "$t"
done
echo "✓ all migrations applied and all database assertions passed"
