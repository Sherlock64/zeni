#!/usr/bin/env bash
# Screenshot the UI with mocked IPC (src/snapshot.ts). Needs `pnpm dev` running on port ${ZENI_VITE_PORT:-1420}.
# Usage: scripts/snapshot.sh '<page after localhost:1420/>' <out.png> [WIDTHxHEIGHT]
# Example: scripts/snapshot.sh 'snapshot.html?fail=app_info#/settings' snapshots/settings-error.png
set -euo pipefail
page=$1 out=$2 size=${3:-1280x800} port=${ZENI_VITE_PORT:-1420} # parallel runs: pnpm dev --port <n>
chrome=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort -V | tail -1)
[[ -x $chrome ]] || { echo "chrome-headless-shell not found under ~/.cache/ms-playwright; ask the user to install it" >&2; exit 1; }
curl -sf -o /dev/null http://localhost:$port/ || { echo "Vite is not running on :$port; start it with 'pnpm dev --port $port'" >&2; exit 1; }
mkdir -p "$(dirname "$out")"
# A throwaway profile with no disk cache, so a capture never shows a stale build.
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
# Virtual time lets queries settle before the capture; without it the page is blank.
"$chrome" --screenshot="$out" --window-size="${size/x/,}" --virtual-time-budget=5000 --hide-scrollbars \
  --user-data-dir="$profile" --disk-cache-size=1 \
  "http://localhost:$port/$page" 2>/dev/null >/dev/null
[[ -s $out ]] || { echo "No screenshot written" >&2; exit 1; }
echo "$out"
