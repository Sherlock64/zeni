#!/usr/bin/env bash
# Self-test for scripts/check.sh in a throwaway git repo, with stub pnpm and cargo (no network).
set -euo pipefail
check=$(cd "$(dirname "$0")" && pwd)/check.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Stubs: succeed unless STUB_FAIL=1.
mkdir "$tmp/bin"
for tool in pnpm cargo; do printf '#!/bin/sh\n[ "${STUB_FAIL:-}" != 1 ]\n' >"$tmp/bin/$tool"; done
chmod +x "$tmp/bin"/*
export PATH="$tmp/bin:$PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset ZENI_DEPS_APPROVED ZENI_SUPPRESSIONS_APPROVED

repo=$tmp/repo
mkdir -p "$repo/src-tauri/migrations" "$repo/src-tauri/src"
cd "$repo"
git init -q -b main
git config user.email t@example.test
git config user.name test
echo 'snapshots/' >.gitignore
echo 'CREATE TABLE a (id INTEGER);' >src-tauri/migrations/0001_a.sql
printf '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n' >src-tauri/Cargo.toml
printf '{\n  "name": "x",\n  "dependencies": {\n    "react": "^19"\n  }\n}\n' >package.json
echo 'fn main() {}' >src-tauri/src/main.rs
git add -A && git commit -qm base
git update-ref refs/remotes/origin/main HEAD

pass=0
out=
run() { set +e; out=$("$check" "$@" 2>&1); code=$?; set -e; }
expect() { # expect <exit code> <grep pattern or ""> <description>
  if [[ $code == "$1" ]] && { [[ -z $2 ]] || grep -qF -- "$2" <<<"$out"; }; then
    pass=$((pass + 1))
  else
    printf 'FAIL: %s (exit %s, wanted %s)\n%s\n' "$3" "$code" "$1" "$out"; exit 1
  fi
}
reset() { git checkout -q -- . && git clean -qfd; }

run fast; expect 0 "CHECK policy: pass" "clean tree passes"
grep -qF "CHECK cargo clippy --locked --all-targets -- -D warnings: pass" <<<"$out" || { echo "FAIL: clippy label"; exit 1; }

echo 'CREATE TABLE b (id INTEGER);' >src-tauri/migrations/0002_b.sql
run fast; expect 0 "CHECK policy: pass" "new untracked migration is fine"
reset

echo '-- edit' >>src-tauri/migrations/0001_a.sql
run fast; expect 1 "POLICY FAIL: applied migration changed src-tauri/migrations/0001_a.sql" "edited migration"
reset

git mv src-tauri/migrations/0001_a.sql src-tauri/migrations/0001_renamed.sql
run fast; expect 1 "POLICY FAIL: applied migration changed src-tauri/migrations/0001_a.sql" "renamed migration"
git reset -q --hard

rm src-tauri/migrations/0001_a.sql
run fast; expect 1 "POLICY FAIL: applied migration changed" "deleted migration"
reset

echo 'rand = "0.9"' >>src-tauri/Cargo.toml
run fast; expect 1 "POLICY FAIL: dependency change src-tauri/Cargo.toml" "added cargo dep"
ZENI_DEPS_APPROVED=1 run fast; expect 0 "" "cargo dep override"
run task; expect 0 "POLICY NOTE: dependency change src-tauri/Cargo.toml (gated in integration)" "task mode notes a dep change"
grep -qF "POLICY FAIL" <<<"$out" && { echo "FAIL: task mode failed a dep change"; exit 1; }
run integration; expect 1 "POLICY FAIL: dependency change src-tauri/Cargo.toml" "integration fails a dep change"
ZENI_DEPS_APPROVED=1 run integration; expect 0 "" "integration dep override"
reset

printf '\n[target.'"'"'cfg(unix)'"'"'.dependencies]\nlibc = "0.2"\n' >>src-tauri/Cargo.toml
run fast; expect 1 "POLICY FAIL: dependency change src-tauri/Cargo.toml" "added target dep"
reset

sed -i '2a description = "y"' src-tauri/Cargo.toml
run fast; expect 0 "CHECK policy: pass" "non-dependency Cargo.toml edit is fine"
reset

sed -i 's/"react": "^19"/"react": "^19",\n    "lodash": "^4"/' package.json
run fast; expect 1 "POLICY FAIL: dependency change package.json" "added npm dep"
reset

sed -i '2a\  "devDependencies": {},' package.json
run fast; expect 1 "POLICY FAIL: dependency change package.json" "one-line empty section is a change"
reset

sed -i '2a\  "devDependencies": {},' package.json
git commit -qam "empty devDependencies" && git update-ref refs/remotes/origin/main HEAD
sed -i '/"devDependencies"/a\  "version": "1.0.0",' package.json
run fast; expect 0 "CHECK policy: pass" "keys after a one-line empty section are not deps"
git reset -q --hard HEAD~1 && git update-ref refs/remotes/origin/main HEAD

printf '{\n  "name": "x",\n  "dependencies": {\n    "react": "^19"\n  },\n  "devDependencies": {}\n}\n' >package.json
git commit -qam "final empty devDependencies" && git update-ref refs/remotes/origin/main HEAD
sed -i 's/"devDependencies": {}/&,\n  "version": "1.0.0"/' package.json
run fast; expect 0 "CHECK policy: pass" "key added after a final one-line empty section is not a dep change"
git reset -q --hard HEAD~1 && git update-ref refs/remotes/origin/main HEAD

sed -i '/"react"/d' package.json
run fast; expect 1 "POLICY FAIL: dependency change package.json" "removed npm dep"
reset

printf '#[allow(dead_code)]\nfn x() {}\n' >>src-tauri/src/main.rs
run fast; expect 1 "POLICY FAIL: new suppression src-tauri/src/main.rs" "tracked suppression"
ZENI_SUPPRESSIONS_APPROVED=1 run fast; expect 0 "" "suppression override"
reset

echo 'fn w() { let _ = [1, 2].iter().skip(1); }' >>src-tauri/src/main.rs
run fast; expect 0 "CHECK policy: pass" "Iterator::skip in Rust is not a suppression"
reset

mkdir -p src
echo 'it.only("x", () => {});' >src/new.test.ts
run fast; expect 1 "POLICY FAIL: new suppression src/new.test.ts" "untracked suppression"
reset

mkdir -p src/components/ui
echo '// eslint-disable-next-line' >src/components/ui/button.tsx
run fast; expect 0 "CHECK policy: pass" "generated ui/ is exempt"
reset

echo 'fn r() -> f64 { 1.0 }' >>src-tauri/src/main.rs
run fast; expect 1 "POLICY FAIL: float type (money is integer cents) src-tauri/src/main.rs:" "float in Rust"
reset
echo 'fn r() -> f64 { 1.0 } // float-ok: a ratio' >>src-tauri/src/main.rs
run fast; expect 0 "CHECK policy: pass" "marked float is allowed"
reset

mkdir -p src/lib src/pages src/components/ui
echo 'import { invoke } from "@tauri-apps/api/core";' >src/lib/commands.ts
run fast; expect 0 "CHECK policy: pass" "invoke inside commands.ts is fine"
echo 'import { invoke } from "@tauri-apps/api/core";' >src/pages/x.tsx
run fast; expect 1 "POLICY FAIL: backend call outside src/lib/commands.ts src/pages/x.tsx:1" "invoke in a page"
reset

mkdir -p src/pages src/components/ui
echo '<p className="text-red-500" />' >src/pages/x.tsx
run fast; expect 1 "POLICY FAIL: raw colour (use theme tokens) src/pages/x.tsx:1" "palette colour"
echo '<p className="text-destructive" style={{ color: "#ff0000" }} />' >src/pages/x.tsx
run fast; expect 1 "POLICY FAIL: raw colour (use theme tokens) src/pages/x.tsx:1" "hex colour"
echo '<p className="text-muted-foreground gap-2" />' >src/pages/x.tsx
echo '<p className="text-red-500" />' >src/components/ui/y.tsx
run fast; expect 0 "CHECK policy: pass" "theme tokens and generated ui/ are fine"
reset

mkdir -p src
echo 'console.log(1);' >src/x.ts
run fast; expect 1 "POLICY FAIL: console.log src/x.ts:1" "console.log"
reset

mkdir -p tools/factory-board
echo 'import test from "node:test"; test("ok", () => {});' >tools/factory-board/a.check.js
run fast; expect 0 "CHECK factory board self-checks: pass" "board self-checks pass"
echo 'import test from "node:test"; test("bad", () => { throw new Error("x"); });' >tools/factory-board/b.check.js
run fast; expect 1 "CHECK factory board self-checks: fail" "a failing board self-check fails fast"
reset

mkdir -p src/lib src/pages
echo 'client.invalidateQueries({ queryKey });' >src/lib/query-keys.ts
run fast; expect 0 "CHECK policy: pass" "invalidateQueries inside src/lib is fine"
echo 'client.invalidateQueries({ queryKey: ["x"] });' >src/pages/x.tsx
run fast; expect 1 "POLICY FAIL: invalidateQueries outside src/lib (use invalidate(change)) src/pages/x.tsx:1" "invalidateQueries in a page"
reset

run task; expect 0 "ran fast checks only" "task with no filters"
STUB_FAIL=1 run task --rust foo; expect 1 "CHECK cargo test --locked foo: fail" "task reports failing filter"

ev=snapshots/V9.9/evidence.yaml
echo 'fn y() {}' >>src-tauri/src/main.rs
run integration --evidence $ev; expect 0 "CHECK bindings freshness: pass" "integration passes"
grep -qx 'version: V9.9' $ev && grep -qF "src-tauri/src/main.rs" $ev || { echo "FAIL: manifest keys"; cat $ev; exit 1; }
printf 'review:\n  risk: routine\n' >>$ev
run fresh $ev; expect 0 "FRESH" "fresh right after integration"
run integration --evidence $ev; expect 0 "" "integration rewrite"
grep -qx '  risk: routine' $ev || { echo "FAIL: review block not kept"; cat $ev; exit 1; }
echo 'fn z() {}' >>src-tauri/src/main.rs
run fresh $ev; expect 1 "STALE" "tracked edit makes it stale"
run integration --evidence $ev; expect 0 "" "integration refresh"
echo 'x' >untracked.txt
run fresh $ev; expect 1 "STALE" "untracked file makes it stale"
rm untracked.txt
run fresh $ev; expect 0 "FRESH" "fresh again once the untracked file is gone"
STUB_FAIL=1 run integration --evidence $ev; expect 1 "CHECK cargo test --locked: fail" "integration runs on after a failure"
grep -qF "CHECK pnpm test: fail" <<<"$out" || { echo "FAIL: later steps skipped"; exit 1; }
run fresh $ev; expect 1 "FAILED" "failed outcomes are not fresh"

echo "check.test.sh: $pass checks passed"
