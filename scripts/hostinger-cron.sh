#!/usr/bin/env bash
# Hostinger hPanel cron entry (every 15 minutes):
# */15 * * * * /bin/bash /home/USER/domains/arabclue.com/public_html/scripts/hostinger-cron.sh
#
# Or use hPanel → Advanced → Cron Jobs with this one-liner:
# curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" "https://arabclue.com/api/cron/social-scheduler"

set -euo pipefail

BASE_URL="${NEXT_PUBLIC_SITE_URL:-https://arabclue.com}"
CRON_SECRET="${CRON_SECRET:?CRON_SECRET is required}"

curl -fsS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${BASE_URL%/}/api/cron/social-scheduler"

curl -fsS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${BASE_URL%/}/api/cron/employees-tick"
