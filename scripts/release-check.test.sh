#!/usr/bin/env bash
# Self-test for scripts/release-check.sh against fixture Cargo.toml and CHANGELOG.md files in a temp dir.
set -euo pipefail
script=$(cd "$(dirname "$0")" && pwd)/release-check.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
mkdir src-tauri
printf '[package]\nname = "zeni"\nversion = "7.0.0"\n\n[dependencies]\nserde = { version = "1" }\n' >src-tauri/Cargo.toml
printf '# Changelog\n\n## 7.0.0\n\n- Zeni now tells you when an update is out.\n- Second line.\n\n## 6.1.0\n\n- Older.\n' >CHANGELOG.md

pass=0
out=
run() { rm -f notes.md gh-out; set +e; out=$(GITHUB_OUTPUT=gh-out "$script" "$1" notes.md 2>&1); code=$?; set -e; }
expect() { # expect <exit code> <grep pattern> <description>
  if [[ $code == "$1" ]] && grep -qF -- "$2" <<<"$out"; then
    pass=$((pass + 1))
  else
    printf 'FAIL: %s (exit %s, wanted %s)\n%s\n' "$3" "$code" "$1" "$out"; exit 1
  fi
}
fail() { printf 'FAIL: %s\n' "$1"; exit 1; }

run v7.0.0; expect 0 "Releasing Zeni 7.0.0" "matching tag releases"
[[ $(cat notes.md) == $'- Zeni now tells you when an update is out.\n- Second line.' ]] || fail "notes are the 7.0.0 section: $(cat notes.md)"
[[ $(cat gh-out) == $'release=true\nversion=7.0.0' ]] || fail "outputs release=true: $(cat gh-out)"

run v7.0.1; expect 1 "Tag v7.0.1 doesn't match app version 7.0.0" "version mismatch names both"
[[ ! -e notes.md && ! -e gh-out ]] || fail "mismatch writes no notes or outputs"

sed -i 's/^version = "7.0.0"/version = "7.0.1"/' src-tauri/Cargo.toml
run v7.0.1; expect 1 "CHANGELOG.md has no ## 7.0.1 section" "missing section"
[[ ! -e notes.md && ! -e gh-out ]] || fail "missing section writes no notes or outputs"

for tag in v7 v7.1 v7.0.0-rc1 7.0.0; do
  run "$tag"; expect 0 "not a release tag" "$tag is no release"
  [[ ! -e notes.md && $(cat gh-out) == release=false ]] || fail "$tag outputs release=false only"
done

echo "release-check.test.sh: $pass passed"
