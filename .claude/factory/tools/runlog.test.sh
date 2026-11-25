#!/usr/bin/env bash
# Self-test for runlog.py in a throwaway git repo.
set -euo pipefail
script=$(cd "$(dirname "$0")" && pwd)/runlog.py
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
cd "$tmp" && git init -q
tsv=$tmp/.git/factory/runs.tsv

pass=0
out=
run() { set +e; out=$(python3 -I "$script" "$@" 2>&1); code=$?; set -e; }
expect() { # expect <exit code> <grep pattern> <description>
  if [[ $code == "$1" ]] && grep -qF -- "$2" <<<"$out"; then
    pass=$((pass + 1))
  else
    printf 'FAIL: %s (exit %s, wanted %s)\n%s\n' "$3" "$code" "$1" "$out"; exit 1
  fi
}
rows() { [[ -f $tsv ]] && wc -l <"$tsv" || echo 0; }

export CLAUDE_CODE_SESSION_ID=4bfcd865-c248-4b0c-996e-dc4704c030e1
run append '#7' build done 'PR #9, checks pass'; expect 0 "" "a good row"
grep -qP '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\t4bfcd865-c248-4b0c-996e-dc4704c030e1\t#7\tbuild\tdone\tPR #9, checks pass$' "$tsv" ||
  { echo "FAIL: row format"; cat "$tsv"; exit 1; }
[[ $(stat -c %a "$tmp/.git/factory") == 700 ]] || { echo "FAIL: factory folder not 0700"; exit 1; }
run append SB-2 learn checkpoint $'two\tlines\nhere'; expect 0 "" "private ticket, tab and newline in the note"
tail -1 "$tsv" | grep -qP '\tSB-2\tlearn\tcheckpoint\ttwo lines here$' || { echo "FAIL: note not flattened"; tail -1 "$tsv"; exit 1; }
run append - release done 'v1.2.3'; expect 0 "" "a run without a ticket"
[[ $(rows) == 3 ]] || { echo "FAIL: row count"; exit 1; }

run append '#7' verify done x; expect 2 "unknown station verify" "Verify is no station"
run append '#7' build won x; expect 2 "unknown outcome won" "unknown outcome"
run append 7 build done x; expect 2 "ticket must be" "ticket without #"
run append '#7' build done; expect 2 "usage" "missing note"
CLAUDE_CODE_SESSION_ID= run append '#7' build done x; expect 2 "CLAUDE_CODE_SESSION_ID" "no session id"
[[ $(rows) == 3 ]] || { echo "FAIL: a refused row was written"; exit 1; }

echo "runlog.test.sh: $pass passed"
