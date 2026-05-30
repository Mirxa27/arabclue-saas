#!/usr/bin/env bash
# Optional wrapper for /daily-sync via Claude Code CLI (external cron).
# Example (macOS LaunchAgent or hPanel cron):
#   0 8 * * * cd /path/to/arabclue-repo && ./scripts/agentic-daily-sync.sh
#
# Requires: `claude` CLI on PATH and auth configured.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found; run /daily-sync manually in Cursor." >&2
  exit 1
fi

claude --cwd "$ROOT" --command /daily-sync
