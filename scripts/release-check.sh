#!/usr/bin/env bash
# Release gate for a pushed tag. Spec: snapshots/V7/contracts.md (Pipeline > Release).
# Usage (from the repo root): scripts/release-check.sh <tag> [notes file, default release-notes.md]
# Exit 0 + release=true: tag v<major>.<minor>.<patch> matches src-tauri/Cargo.toml and the notes file holds
#   that version's CHANGELOG.md section. Exit 0 + release=false: not a release tag. Exit 1: publish nothing.
# Writes release=<true|false> and version=<x.y.z> to $GITHUB_OUTPUT when it is set.
set -euo pipefail
tag=${1:?usage: scripts/release-check.sh <tag> [notes file]}
notes=${2:-release-notes.md}

output() { [[ -n ${GITHUB_OUTPUT:-} ]] && printf '%s\n' "$@" >>"$GITHUB_OUTPUT"; return 0; }

if [[ ! $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "$tag is not a release tag (v<major>.<minor>.<patch>); nothing to release."
  output release=false
  exit 0
fi
version=${tag#v}

# The first version line of the [package] section.
app=$(awk '/^\[/ { pkg = ($0 == "[package]"); next }
           pkg && /^version[[:space:]]*=/ { gsub(/^version[[:space:]]*=[[:space:]]*"|".*$/, ""); print; exit }' \
  src-tauri/Cargo.toml)
if [[ $app != "$version" ]]; then
  echo "Tag $tag doesn't match app version ${app:-<none>}" >&2
  exit 1
fi

# The lines under "## <version>" up to the next "## " heading, without leading or trailing blank lines.
if ! grep -qxF "## $version" CHANGELOG.md; then
  echo "CHANGELOG.md has no ## $version section" >&2
  exit 1
fi
awk -v h="## $version" '$0 == h { on = 1; next } on && /^## / { exit } on' CHANGELOG.md |
  sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}' >"$notes"

echo "Releasing Zeni $version"
output release=true "version=$version"
