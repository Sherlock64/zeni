#!/usr/bin/env bash
# Screenshot the UI with mocked IPC (src/snapshot.ts). Needs `pnpm dev` running on port 1420.
# Usage: scripts/snapshot.sh '<page after localhost:1420/>' <out.png> [WIDTHxHEIGHT]
# Example: scripts/snapshot.sh 'snapshot.html?fail=app_info#/settings' snapshots/settings-error.png
set -euo pipefail
page=$1 out=$2 size=${3:-1280x800}
chrome=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort -V | tail -1)
[[ -x $chrome ]] || { echo "chrome-headless-shell not found under ~/.cache/ms-playwright; ask the user to install it" >&2; exit 1; }
curl -sf -o /dev/null http://localhost:1420/ || { echo "Vite is not running on :1420; start it with 'pnpm dev'" >&2; exit 1; }
mkdir -p "$(dirname "$out")"
# Virtual time lets queries settle before the capture; without it the page is blank.
"$chrome" --screenshot="$out" --window-size="${size/x/,}" --virtual-time-budget=5000 --hide-scrollbars \
  "http://localhost:1420/$page" 2>/dev/null >/dev/null
[[ -s $out ]] || { echo "No screenshot written" >&2; exit 1; }
echo "$out"
