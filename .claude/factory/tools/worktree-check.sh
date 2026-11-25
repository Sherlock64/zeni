#!/usr/bin/env bash
# Run-start worktree check (spine.md, "Run start"). Self-test: worktree-check.test.sh.
# Usage: worktree-check.sh <ticket number, or 0 for a run without a ticket> <station>
# Removes snapshots/t<m>/ of any other ticket, then fails (exit 1) on tracked or untracked changes,
# or a HEAD that isn't the latest origin/main (Build, Shape and slice, Intake, Learn, Release; a
# resumed run may also sit at its pushed ticket branch) or the ticket's branch (Review, Merge).
# A folder not named t<n>-* only prints a note.
set -uo pipefail
n=${1:-} station=${2:-}
case $station in
  build | shape-slice | intake | learn | release) want=main ;;
  review | merge) want=branch ;;
  *) n= ;;
esac
[[ $n =~ ^[0-9]+$ ]] || { sed -n 's/^# Usage: /Usage: /p' "$0" >&2; exit 2; }
cd "$(git rev-parse --show-toplevel)" || exit 2
git fetch -q --prune origin || { echo "WORKTREE FAIL: git fetch origin failed"; exit 1; }

for d in snapshots/t*/; do
  [[ -d $d && $d != "snapshots/t$n/" ]] && rm -rf -- "$d" && echo "removed $d (another ticket's snapshots)"
done

st=$(git status --porcelain) || { echo "WORKTREE FAIL: git status failed"; exit 1; }
[[ -z $st ]] || { echo "WORKTREE FAIL: uncommitted or untracked changes"; git status --short; exit 1; }

head=$(git rev-parse HEAD)
main=$(git rev-parse origin/main)
mapfile -t branches < <(git for-each-ref --format='%(refname:short)' "refs/remotes/origin/t$n-*")
tip=
((${#branches[@]} == 1)) && tip=$(git rev-parse "${branches[0]}")
if [[ $want == branch && -z $tip ]]; then
  echo "WORKTREE FAIL: no single origin/t$n-* branch (found: ${branches[*]:-none})"; exit 1
fi
if [[ $want == main && $head != "$main" && $head != "$tip" ]]; then
  echo "WORKTREE FAIL: HEAD $head is not the latest origin/main $main${tip:+ or ${branches[0]}}"; exit 1
fi
if [[ $want == branch && $head != "$tip" ]]; then
  echo "WORKTREE FAIL: HEAD $head is not ${branches[0]} $tip"; exit 1
fi
# The app may hand out an old ticket's folder: only a note, since the branch and HEAD checks above are what matter.
folder=$(basename "$PWD")
[[ $n == 0 || $folder == "t$n-"* ]] || echo "WORKTREE NOTE: folder $folder is not named for ticket #$n"
echo "WORKTREE OK: ticket #$n, station $station, HEAD $head"
