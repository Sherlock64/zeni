#!/usr/bin/env bash
# Preflight for verify-zeni. Usage: scripts/verify/preflight.sh <data-home> <app-binary>
# Names every missing tool and refuses to run against the real data (CONSTRAINTS.md "Verification never touches real data").
set -uo pipefail
data_home=${1:-} binary=${2:-}
fail=0
bad() { echo "PREFLIGHT FAIL: $*" >&2; fail=1; }

for tool in tauri-driver WebKitWebDriver xdotool; do
  command -v "$tool" >/dev/null || bad "missing tool: $tool"
done
[[ -d node_modules/webdriverio ]] || bad "missing tool: webdriverio (run pnpm install)"

# The app resolves its data folder from XDG_DATA_HOME; the real one is the default location.
real=${HOME:-/nonexistent}/.local/share
[[ -n $data_home ]] || bad "no data home given"
if [[ -n $data_home ]]; then
  [[ $(realpath -m "$data_home") != "$(realpath -m "$real")" && $(realpath -m "$data_home") != "$(realpath -m "$real/com.sherlock64.zeni")" ]] \
    || bad "data home $data_home is the real data folder"
  [[ ${data_home%/} == "${XDG_DATA_HOME:-$real}" ]] && bad "data home is the current XDG_DATA_HOME; use a throwaway folder"
fi
# Only a debug build uses dev/ and the zeni-dev keyring item (keyring.rs, db.rs).
[[ $binary == */target/debug/* && -x $binary ]] || bad "app binary $binary is not an executable debug build (target/debug)"
exit $fail
