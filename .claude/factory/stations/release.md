# Release

Only when the user asks. Publishing to users is theirs; this station's trust level never rises.

**Outcome:** a new version on GitHub Releases, with notes from `CHANGELOG.md`.

**Done when:** the tag `v<version>` is pushed, the `Release` workflow published the `.deb`, and every ticket shipped in it carries `state:released`.

## Picking the version

- List PRs merged since the last tag: `git log <last tag>..origin/main --merges`, then each PR's `door:` label.
- The largest door wins: any `door:one-way` = next major, else any `door:two-way` = next minor, else any `door:none` = next patch. Only `door:docs` = nothing to release; say so and stop.
- Show the user the version, the PRs with their doors, and the `## Unreleased` bullets. Get their yes.

## Cutting it

1. On a branch `release-<version>` from `origin/main`: set `version` in `src-tauri/Cargo.toml` and `package.json` (and the lock entry `cargo` updates), rename `## Unreleased` to `## <version>`, and add a fresh empty `## Unreleased` above it. Tidy the bullets into what a user would notice; keep them one line each.
2. `scripts/release-check.test.sh` and `scripts/release-check.sh v<version> /dev/null` pass locally.
3. Open the PR with label `door:docs` (a release PR never releases itself), get CI green, and merge it as `stations/merge.md` says.
4. With the user's yes: `git fetch origin && git tag v<version> origin/main && git push origin v<version>`.
5. Watch the `Release` workflow once with `gh run watch`; on failure, eject with the failed step's log.
6. Set `state:released` on the tickets whose PRs shipped.

## Eject when

- the version the doors give looks wrong to you (a `door:none` PR that removed a feature);
- the `Release` workflow fails.

## Pointers

Release gate: `scripts/release-check.sh`, `.github/workflows/release.yml`.
