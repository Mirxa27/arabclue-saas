#!/usr/bin/env bash
# Apply every migration in supabase/migrations to a throwaway PostgreSQL and run
# the SQL assertions in supabase/tests/*.test.sql.
#
#   npm run db:test                 # starts a temporary local cluster (needs initdb/pg_ctl)
#   DATABASE_URL=postgres://... npm run db:test   # use an existing empty database (CI service)
#
# DB_TEST_GRANTS selects the Supabase default-privilege model the database starts from
# (see supabase/tests/00_supabase_bootstrap.sql):
#   legacy   API roles are auto-granted everything created in public (pre-2026-10-30)
#   opt-in   nothing is auto-granted — what a fresh project, branch or `supabase db reset`
#            gets from 2026-10-30; migrations must grant what they expose
#   both     (default) legacy in DATABASE_URL, then opt-in in a sibling database
#
# Afterwards every supabase/tests/preflight/<version>_<name>.seed.sql scenario is run in
# its own sibling database: migrations older than <version> are applied, the seed loads
# deliberately awkward production-like rows (e.g. duplicates), the remaining migrations
# are applied on top and <version>_<name>.check.sql asserts the outcome.
#
# Sibling databases are created next to DATABASE_URL (the role needs CREATEDB) and
# dropped again on success. Exits non-zero on the first failing migration or assertion.
set -euo pipefail
export LC_ALL=C
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"
PREFLIGHT="$TESTS/preflight"
PSQL_OPTS=(-X -q -v ON_ERROR_STOP=1)
MODE="${DB_TEST_GRANTS:-both}"
SIBLING_PREFIX="${DB_TEST_SIBLING_PREFIX:-arabclue_db_test}"

case "$MODE" in
  legacy | opt-in | both) ;;
  *) echo "DB_TEST_GRANTS must be legacy, opt-in or both (got '$MODE')" >&2; exit 2 ;;
esac

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
run_on() { local url="$1"; shift; psql "${PSQL_OPTS[@]}" "$url" "$@"; }

# URL of database $2 on the same server (and with the same options) as URL $1.
sibling_url() {
  local url="$1" name="$2" query="" scheme authority
  if [[ "$url" == *\?* ]]; then query="?${url#*\?}"; url="${url%%\?*}"; fi
  scheme="${url%%://*}://"
  authority="${url#*://}"
  authority="${authority%%/*}"
  printf '%s%s/%s%s' "$scheme" "$authority" "$name" "$query"
}

# (Re)create an empty sibling database and print its URL.
fresh_db() {
  local name="$1"
  run -c "drop database if exists \"$name\" with (force)" -c "create database \"$name\"" >&2
  sibling_url "$DATABASE_URL" "$name"
}
drop_db() { run -c "drop database if exists \"$1\" with (force)" >&2; }

migrations() { ls "$MIGRATIONS"/*.sql | sort; }

bootstrap() { # url opt_in(on|off)
  run_on "$1" -v opt_in="$2" -f "$TESTS/00_supabase_bootstrap.sql"
}

run_suite() { # mode url
  local mode="$1" url="$2" opt_in=off f t
  [[ "$mode" == "opt-in" ]] && opt_in=on
  echo "▶ [$mode] bootstrap (Supabase roles + auth schema emulation)"
  bootstrap "$url" "$opt_in"

  for f in $(migrations); do
    echo "▶ [$mode] migration $(basename "$f")"
    run_on "$url" -f "$f"
  done

  echo "▶ [$mode] re-applying all migrations (idempotency check)"
  for f in $(migrations); do
    PGOPTIONS="-c client_min_messages=warning" run_on "$url" -f "$f" >/dev/null \
      || { echo "✗ $(basename "$f") is not re-runnable" >&2; exit 1; }
  done

  shopt -s nullglob
  for t in "$TESTS"/*.test.sql; do
    echo "▶ [$mode] test $(basename "$t")"
    run_on "$url" -f "$t"
  done
  shopt -u nullglob
}

run_preflight() {
  local seed name version check db url f
  shopt -s nullglob
  local seeds=("$PREFLIGHT"/*.seed.sql)
  shopt -u nullglob
  for seed in "${seeds[@]}"; do
    name="$(basename "$seed" .seed.sql)"
    version="${name%%_*}"
    check="$PREFLIGHT/$name.check.sql"
    [[ -f "$check" ]] || { echo "✗ preflight $name: missing $(basename "$check")" >&2; exit 1; }
    db="${SIBLING_PREFIX}_preflight"
    url="$(fresh_db "$db")"
    echo "▶ [preflight $name] migrations before $version → seed → remaining migrations → check"
    echo "  (WARNING/NOTICE lines from the migrations below are expected: the seed is deliberately bad data)"
    bootstrap "$url" off
    for f in $(migrations); do
      if [[ "$(basename "$f")" < "$version" ]]; then
        PGOPTIONS="-c client_min_messages=warning" run_on "$url" -f "$f" >/dev/null
      fi
    done
    run_on "$url" -f "$seed"
    for f in $(migrations); do
      if [[ ! "$(basename "$f")" < "$version" ]]; then run_on "$url" -f "$f"; fi
    done
    run_on "$url" -f "$check"
    drop_db "$db"
  done
}

case "$MODE" in
  legacy) run_suite legacy "$DATABASE_URL" ;;
  opt-in) run_suite opt-in "$DATABASE_URL" ;;
  both)
    run_suite legacy "$DATABASE_URL"
    OPTIN_DB="${SIBLING_PREFIX}_optin"
    run_suite opt-in "$(fresh_db "$OPTIN_DB")"
    drop_db "$OPTIN_DB"
    ;;
esac
run_preflight
echo "✓ all migrations applied and all database assertions passed (grants: $MODE)"
