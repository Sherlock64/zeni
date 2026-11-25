#!/usr/bin/env bash
# Zeni verification gate. What each check enforces: CONSTRAINTS.md.
# Usage: scripts/check.sh fast
#        scripts/check.sh task [--rust <cargo test filter>]... [--ts <vitest path or pattern>]...
#        scripts/check.sh integration [--evidence snapshots/t<issue>/evidence.yaml]
#        scripts/check.sh fresh snapshots/t<issue>/evidence.yaml   (FAILED when the manifest's ticket is not the branch's;
#          lists each OPEN runtime criterion)
#        scripts/check.sh scope   (prints light or full: which checks CI runs for this change)
# Overrides: ZENI_DEPS_APPROVED=1, ZENI_SUPPRESSIONS_APPROVED=1 (only for what the user approved).
set -uo pipefail
export LC_ALL=C # stable sort order for comm and the diff hash
cd "$(git rev-parse --show-toplevel)" || exit 2
base=$(git merge-base HEAD origin/main) || { echo "no merge base with origin/main" >&2; exit 2; }

failed=0
results=() # "outcome<TAB>command" per step, for the evidence manifest

step() { # step <label> <command...>: run, print CHECK line, record outcome
  local label=$1 outcome=pass
  shift
  "$@" || { outcome=fail; failed=1; }
  echo "CHECK $label: $outcome"
  results+=("$outcome"$'\t'"$label")
}

untracked() { git ls-files -z --others --exclude-standard -- "$@" | sort -z; }

# sha256 of the change vs base: tracked diff (working tree), then each untracked file's path and contents.
tree_sha() {
  {
    git diff --binary --no-color --no-ext-diff "$base" -- "$@"
    untracked "$@" | while IFS= read -r -d '' f; do printf '%s\0' "$f"; cat -- "$f"; done
  } | sha256sum | cut -d' ' -f1
}

# Dependency lines of a manifest, each prefixed with its section, one per line.
dep_lines() { # dep_lines cargo|npm < file
  if [[ $1 == cargo ]]; then
    awk '/^[[:space:]]*\[/ { sec = ($0 ~ /dependencies/) ? $0 : ""; next }
         sec != "" && /^[[:space:]]*[^#[:space:]]/ { print sec "\t" $0 }'
  else
    # A section opened and closed on one line ("devDependencies": {}) is itself the record.
    awk '/^  "(dependencies|devDependencies)"[[:space:]]*:/ { if ($0 ~ /}/) { sub(/,[[:space:]]*$/, ""); print } else sec = $1; next }
         sec != "" && /^  [}\]]/ { sec = ""; next }
         sec != "" { sub(/,[[:space:]]*$/, ""); print sec "\t" $0 }'
  fi
}

policy() {
  local ok=0 f kind
  # 1. Applied migrations are immutable: no tracked file at base may be modified, deleted or renamed.
  while IFS= read -r -d '' f; do
    echo "POLICY FAIL: applied migration changed $f"; ok=1
  done < <(git diff -z --no-renames --name-only --diff-filter=DMT "$base" -- src-tauri/migrations/)

  # 2. Dependency lines added or removed vs base; task mode only notes them (integration gates them).
  if [[ ${ZENI_DEPS_APPROVED:-} != 1 ]]; then
    for f in src-tauri/Cargo.toml package.json; do
      kind=npm; [[ $f == *.toml ]] && kind=cargo
      if [[ -n $(comm -3 <(git show "$base:$f" 2>/dev/null | dep_lines $kind | sort) \
                         <(cat -- "$f" 2>/dev/null | dep_lines $kind | sort)) ]]; then
        if [[ $mode == task ]]; then
          echo "POLICY NOTE: dependency change $f (gated in integration)"
        else
          echo "POLICY FAIL: dependency change $f"; ok=1
        fi
      fi
    done
  fi

  # 3. New lint/test suppressions in added lines (tracked diff) or untracked files, per language.
  if [[ ${ZENI_SUPPRESSIONS_APPROVED:-} != 1 ]]; then
    while IFS= read -r f; do
      echo "POLICY FAIL: new suppression $f"; ok=1
    done < <({
      suppressions 'src-tauri/*.rs' -- '#[allow(' '#![allow(' '#[ignore'
      suppressions 'src/*.ts' 'src/*.tsx' ':!src/components/ui/' ':!src/types/bindings/' -- \
        'eslint-disable' '@ts-ignore' '@ts-expect-error' '@ts-nocheck' '.skip(' '.only(' 'it.todo('
    } | sort -u)
  fi

  # 4. Rule greps over the whole tree, tracked and untracked (CONSTRAINTS.md).
  while IFS= read -r f; do
    echo "POLICY FAIL: $f"; ok=1
  done < <(rules)
  return $ok
}

# rule <message> <extended regex> <pathspec>...: print "<message> <file>:<line>" per hit.
# A line marked float-ok is skipped (the only exemption marker).
rule() {
  local msg=$1 re=$2
  shift 2
  git grep --untracked -nIE -e "$re" -- "$@" | grep -v 'float-ok' | cut -d: -f1,2 | sed "s|^|$msg |"
}

rules() {
  # A non-money float carries "// float-ok: <why>" on its line.
  rule "float type (money is integer cents)" '\bf(32|64)\b' 'src-tauri/src/*.rs'
  rule "backend call outside src/lib/commands.ts" '@tauri-apps/api/core' 'src/*.ts' 'src/*.tsx' \
    ':!src/lib/commands.ts' ':!src/lib/commands.test.ts'
  rule "raw colour (use theme tokens)" \
    '-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}\b|#[0-9a-fA-F]{6}\b' \
    'src/*.tsx' ':!src/components/ui/'
  rule "console.log" 'console\.log' 'src/*.ts' 'src/*.tsx'
  rule "invalidateQueries outside src/lib (use invalidate(change))" 'invalidateQueries\(' 'src/*.ts' 'src/*.tsx' ':!src/lib/'
  # Types live in type modules (CLAUDE.md): top-level type aliases, interfaces and inline parameter types in UI code,
  # top-level pub structs and enums in Rust. shadcn owns ui/ and use-mobile.ts; keyring.rs holds the SecretService unit struct.
  rule "type outside the type modules" '^(export )?(declare )?(type [A-Za-z_][A-Za-z0-9_]*.*=|interface [A-Za-z_])|\}: \{' \
    'src/*.ts' 'src/*.tsx' ':!src/types/' ':!src/components/ui/' ':!src/hooks/use-mobile.ts' ':!*.test.ts' ':!*.test.tsx'
  rule "type outside the type modules" '^pub (struct|enum|type) ' 'src-tauri/src/*.rs' ':!src-tauri/src/types/' ':!src-tauri/src/keyring.rs'
}

# suppressions <pathspec>... -- <pattern>...: print each file with an added line containing a pattern.
# shortcut: paths with tabs or newlines are not supported; fine for this repo.
suppressions() {
  local spec=() pats=() p
  while [[ $1 != -- ]]; do spec+=("$1"); shift; done
  shift
  for p; do pats+=(-e "$p"); done
  git diff -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ "$base" -- "${spec[@]}" | awk '
    /^\+\+\+ / { f = substr($0, 7); next }
    /^\+/ { print f "\t" substr($0, 2) }' | grep -F "${pats[@]}" | cut -f1
  untracked "${spec[@]}" | xargs -0 -r grep -lF "${pats[@]}" --
}

fast() {
  step policy policy
  step "pnpm exec tsc" pnpm exec tsc
  step "cargo fmt --check" bash -c 'cd src-tauri && cargo fmt --check'
  step "cargo clippy --locked --all-targets -- -D warnings" bash -c 'cd src-tauri && cargo clippy --locked --all-targets -- -D warnings'
  local board=(tools/factory-board/*.check.js)
  [[ -e ${board[0]} ]] && step "factory board self-checks" node --test "${board[@]}"
  [[ -e .claude/factory/tools/worktree-check.test.sh ]] && step "worktree check self-test" .claude/factory/tools/worktree-check.test.sh
  [[ -e .claude/factory/tools/runlog.test.sh ]] && step "run log self-test" .claude/factory/tools/runlog.test.sh
  return 0
}

# Paths the app is never built from. CHANGELOG.md is compiled in (release_notes.rs), so it is full.
light_path() {
  case $1 in
    docs/* | plans/* | .claude/* | tools/factory-board/* | LICENSE) return 0 ;;
    CHANGELOG.md | */*) return 1 ;;
    *.md) return 0 ;;
  esac
  return 1
}

# light when every changed file (tracked or untracked; a rename under both names) is a light path; empty is full.
scope() {
  local f n=0 full=0
  # Read the whole list: leaving early breaks the pipe and sort writes errors (#177).
  while IFS= read -r -d '' f; do
    light_path "$f" || full=1
    n=$((n + 1))
  done < <(git diff -z --no-renames --name-only "$base"; untracked)
  ((n && !full)) && echo light || echo full
}

# The ticket of the branch (t<n>), or of the pushed origin/t<n>-* branch a detached HEAD sits at; empty when none.
branch_ticket() {
  local b
  b=$(git symbolic-ref -q --short HEAD) ||
    b=$(git for-each-ref --points-at HEAD --format='%(refname:lstrip=3)' 'refs/remotes/origin/t[0-9]*' | head -1)
  [[ $b =~ (^|/)t([0-9]+)- ]] && echo "t${BASH_REMATCH[2]}"
}

usage() { sed -n '/^# Usage:/,/^# Overrides:/p' "$0" >&2; exit 2; }

q() { local s=${1//\'/\'\'}; printf "'%s'" "$s"; } # YAML single-quoted scalar

write_evidence() {
  local path=$1 tmp r f
  mkdir -p "$(dirname "$path")"
  tmp=$(mktemp "$path.XXXXXX") # same directory, so mv is atomic
  {
    echo "version: $(basename "$(dirname "$path")")"
    echo "base_ref: $base"
    echo "head_ref: $(git rev-parse HEAD)"
    echo "diff_sha256: $(tree_sha)"
    echo "generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "changed_files:"
    { git diff -z --no-renames --name-only "$base"; untracked; } | sort -zu |
      while IFS= read -r -d '' f; do echo "  - $(q "$f")"; done
    echo "test_results:"
    for r in "${results[@]}"; do
      echo "  - command: $(q "${r#*$'\t'}")"
      echo "    outcome: ${r%%$'\t'*}"
    done
    [[ -f $path ]] && sed -En '/^(runtime|review):/,$p' "$path"
  } >"$tmp"
  mv "$tmp" "$path"
  echo "evidence written: $path"
}

mode=${1:-}
shift || true
case $mode in
  fast) fast ;;
  scope) scope ;;
  task)
    rust=() ts=()
    while (($#)); do
      case $1 in
        --rust) [[ -n ${2:-} ]] || usage; rust+=("$2"); shift 2 ;;
        --ts) [[ -n ${2:-} ]] || usage; ts+=("$2"); shift 2 ;;
        *) usage ;;
      esac
    done
    fast
    for r in "${rust[@]}"; do step "cargo test --locked $r" bash -c 'cd src-tauri && cargo test --locked "$1"' _ "$r"; done
    ((${#ts[@]})) && step "pnpm test ${ts[*]}" pnpm test "${ts[@]}"
    ((${#rust[@]} + ${#ts[@]})) || echo "no --rust or --ts filters given: ran fast checks only"
    ;;
  integration)
    evidence=
    if (($#)); then
      [[ $1 == --evidence && -n ${2:-} ]] || usage
      evidence=$2
    fi
    fast
    before=$(tree_sha src/types/bindings)
    step "cargo test --locked" bash -c 'cd src-tauri && cargo test --locked'
    step "pnpm test" pnpm test
    step "bindings freshness" test "$(tree_sha src/types/bindings)" = "$before"
    # CI's script self-tests, so a pass here means CI passes on the same head (#191).
    for t in scripts/check.test.sh scripts/release-check.test.sh; do [[ -e $t ]] && step "$t" "$t"; done
    [[ -n $evidence ]] && write_evidence "$evidence"
    ;;
  fresh)
    [[ -n ${1:-} ]] || usage
    path=$1
    [[ -f $path ]] || { echo "STALE (no manifest at $path)"; exit 1; }
    ticket=$(sed -n 's/^version: *//p' "$path") mine=$(branch_ticket)
    [[ $ticket == "$mine" ]] || { echo "FAILED (manifest is for $ticket, branch is ${mine:-none})"; exit 1; }
    want=$(sed -n 's/^diff_sha256: *//p' "$path")
    [[ $want == "$(tree_sha)" ]] || { echo STALE; exit 1; }
    outcomes=$(sed -n '/^test_results:/,/^[^ ]/s/^ *outcome: *//p' "$path")
    [[ -n $outcomes && -z $(grep -vx pass <<<"$outcomes") ]] || { echo FAILED; exit 1; }
    # runtime: the verifier's list of runtime criteria, each "- criterion: <n>" then "outcome: pass|fail|open".
    while read -r c o; do
      case $o in
        pass) ;;
        open) echo "OPEN runtime criterion $c" ;;
        *) echo "FAILED runtime criterion $c ($o)"; exit 1 ;;
      esac
    done < <(awk '/^runtime:/ { r = 1; next } /^[^ ]/ { r = 0 } r && /criterion:/ { c = $NF } r && /outcome:/ { print c, $NF }' "$path")
    echo FRESH
    ;;
  *) usage ;;
esac
exit $failed
