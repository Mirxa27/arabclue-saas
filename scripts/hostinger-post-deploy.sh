#!/usr/bin/env bash
# Run on the Hostinger server after MCP/hPanel deploy (from repo root on server or copy paths).
set -euo pipefail

DOMAIN_ROOT="${DOMAIN_ROOT:-$HOME/domains/arabclue.com}"
HTACCESS_SRC="${HTACCESS_SRC:-scripts/hostinger-public_html.htaccess}"

cp "$HTACCESS_SRC" "$DOMAIN_ROOT/public_html/.htaccess"
mkdir -p "$DOMAIN_ROOT/nodejs/tmp"
touch "$DOMAIN_ROOT/nodejs/tmp/restart.txt"
echo "Applied Passenger .htaccess and restarted Node app."
