#!/usr/bin/env bash
# Hostinger hPanel cron entry — run this script EVERY 5 MINUTES:
# */5 * * * * /bin/bash /home/USER/domains/arabclue.com/public_html/scripts/hostinger-cron.sh
#
# Each run calls the jobs that are due, matching the schedules in vercel.json:
#   AI employees tick   every 5 minutes   GET /api/cron/employees-tick
#   ZATCA sweep         every 10 minutes  GET /api/zatca/sweep
#   Social scheduler    every 15 minutes  GET /api/cron/social-scheduler
# A failing job does not stop the others; the script exits non-zero if any job failed,
# so hPanel's cron mail shows the failure.
#
# Needs CRON_SECRET in the environment (the same value as the app's CRON_SECRET).
# ARABCLUE_BASE_URL overrides the site URL (default https://arabclue.com).

set -uo pipefail

BASE_URL="${ARABCLUE_BASE_URL:-${NEXT_PUBLIC_SITE_URL:-https://arabclue.com}}"
BASE_URL="${BASE_URL%/}"
if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "hostinger-cron: CRON_SECRET is required" >&2
  exit 2
fi

# Minute of the hour without a leading zero (10# avoids "08" being read as octal).
MINUTE=$((10#$(date -u +%M)))
FAILED=0

run_job() {
  local name="$1" path="$2" max_time="$3"
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$max_time" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "${BASE_URL}${path}") || status="curl-error"
  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    echo "hostinger-cron: ${name} ok (${status})"
  else
    echo "hostinger-cron: ${name} FAILED (${status}) ${BASE_URL}${path}" >&2
    FAILED=1
  fi
}

# The route timeouts below are the routes' maxDuration plus a margin.
run_job "employees-tick" "/api/cron/employees-tick" 90
if (( MINUTE % 10 < 5 )); then
  run_job "zatca-sweep" "/api/zatca/sweep" 90
fi
if (( MINUTE % 15 < 5 )); then
  run_job "social-scheduler" "/api/cron/social-scheduler" 330
fi

exit "$FAILED"
