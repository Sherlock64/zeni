#!/usr/bin/env bash
# Self-test for worktree-check.sh against a throwaway origin and clone in a temp dir.
set -euo pipefail
script=$(cd "$(dirname "$0")" && pwd)/worktree-check.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@"; }
g init -q --bare "$tmp/origin.git"
g clone -q "$tmp/origin.git" "$tmp/wt" 2>/dev/null
cd "$tmp/wt"
printf 'snapshots/\n' >.gitignore
g add .gitignore && g commit -qm base && g push -q origin main

pass=0
out=
run() { set +e; out=$("$script" "$@" 2>&1); code=$?; set -e; }
expect() { # expect <exit code> <grep pattern> <description>
  if [[ $code == "$1" ]] && grep -qF -- "$2" <<<"$out"; then
    pass=$((pass + 1))
  else
    printf 'FAIL: %s (exit %s, wanted %s)\n%s\n' "$3" "$code" "$1" "$out"; exit 1
  fi
}

run 7 build; expect 0 "WORKTREE OK" "clean build at origin/main"
run; expect 2 "Usage" "no arguments"
run 7 nope; expect 2 "Usage" "unknown station"

mkdir -p snapshots/t5 snapshots/t7 && touch snapshots/t5/a.png snapshots/t7/b.png snapshots/notes.txt
run 7 build; expect 0 "removed snapshots/t5/" "another ticket's snapshots are removed"
[[ ! -e snapshots/t5 && -e snapshots/t7/b.png && -e snapshots/notes.txt ]] || { echo "FAIL: only snapshots/t5 goes"; exit 1; }

touch stray.txt
run 7 build; expect 1 "WORKTREE FAIL: uncommitted or untracked changes" "untracked file"
rm stray.txt
echo x >>.gitignore
run 7 build; expect 1 "WORKTREE FAIL: uncommitted or untracked changes" "tracked change"
g checkout -q .gitignore

g commit -q --allow-empty -m local
run 7 build; expect 1 "WORKTREE FAIL: HEAD" "build not at origin/main"

g switch -q -c t7-thing && g push -q origin t7-thing
run 7 build; expect 0 "WORKTREE OK" "resumed build at its pushed ticket branch"
run 7 verify; expect 0 "WORKTREE OK" "verify at the ticket branch"
g switch -q --detach origin/main
run 7 review; expect 1 "WORKTREE FAIL: HEAD" "review not at the ticket branch"
run 8 verify; expect 1 "WORKTREE FAIL: no single origin/t8-* branch" "later station without a ticket branch"

echo "worktree-check.test.sh: $pass passed"
