#!/usr/bin/env bash
# Self-test for preflight.sh: each refusal fires, and a clean setup passes.
set -uo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd); cd "$here"
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/node_modules/webdriverio" "$t/home" "$t/src-tauri/target/debug" "$t/src-tauri/target/release"
for x in tauri-driver WebKitWebDriver xdotool; do printf '#!/bin/sh\n' > "$t/bin/$x"; chmod +x "$t/bin/$x"; done
: > "$t/src-tauri/target/debug/zeni"; chmod +x "$t/src-tauri/target/debug/zeni"
: > "$t/src-tauri/target/release/zeni"; chmod +x "$t/src-tauri/target/release/zeni"
pf() { (cd "$t" && PATH="$t/bin:/usr/bin:/bin" HOME="$t/home" "$here/scripts/verify/preflight.sh" "$@" 2>&1); }
failures=0
expect() { # name, want-exit, want-text, args...
  local name=$1 want=$2 text=$3; shift 3
  out=$(pf "$@"); rc=$?
  if [[ $rc -eq $want && $out == *"$text"* ]]; then echo "ok   $name"; else echo "FAIL $name (rc=$rc): $out"; failures=1; fi
}
dbg=$t/src-tauri/target/debug/zeni
expect clean-passes 0 "" "$t/throwaway" "$dbg"
expect real-data-refused 1 "real data folder" "$t/home/.local/share/com.sherlock64.zeni" "$dbg"
expect release-binary-refused 1 "not an executable debug build" "$t/throwaway" "$t/src-tauri/target/release/zeni"
rm "$t/bin/tauri-driver"; rm -r "$t/node_modules/webdriverio"
expect missing-tools-named 1 "missing tool: tauri-driver" "$t/throwaway" "$dbg"
expect missing-webdriverio-named 1 "missing tool: webdriverio" "$t/throwaway" "$dbg"
exit $failures
