# Release

The dispatcher starts Release after any merge whose PR carries a door other than `door:docs`, in the same dispatch (except a ticket of an epic that declares `Release: v<x.y.z>`: its merges are held, and Release cuts that version when the epic's last ticket merges), or when the user says `release`. One Release is in flight at a time. Publishing to users is the user's: one yes covers the version, the release PR merge and the tag push, and this station's trust level never rises.

**Outcome:** a new version on GitHub Releases, with notes from `CHANGELOG.md`.

**Done when:** the tag `v<version>` is pushed, the `Release` workflow published the `.deb`, every ticket shipped in it carries `state:released`, and the release issue is closed.

## Picking the version

- **Held epic release.** An epic body with `Release: v<x.y.z>` declares its version. While any of its tickets is open, a merged ticket of that epic does not start Release: hold it, and leave it out of the door count. When the epic's last ticket merges, cut exactly `v<x.y.z>` (the declared version replaces the door rule) with every held merge in it.

- List PRs merged since the last tag: `git log <last tag>..origin/main --merges`, then each PR's `door:` label.
- The largest door wins: any `door:one-way` = next major, else any `door:two-way` = next minor, else any `door:none` = next patch. Only `door:docs` = nothing to release; say so and stop.

## Preparing it

1. On a branch `release-<version>` from `origin/main`: set `version` in `src-tauri/Cargo.toml` and `package.json` (and the lock entry `cargo` updates), rename `## Unreleased` to `## <version>`, and add a fresh empty `## Unreleased` above it. Tidy the bullets into what a user would notice; keep them one line each.
2. `scripts/release-check.test.sh` and `scripts/release-check.sh v<version> /dev/null` pass locally.
3. Open the PR with label `door:docs` (a release PR never releases itself) and wait for CI green on its head.
4. **The ask.** On the open release issue (create one titled `Release v<version>` if none is open; retitle it if the version changed) set `state:needs-human` and comment, first line `Release v<version>? <PRs with their doors>; release PR #<p>, CI green on <sha>.`, then the `## <version>` bullets. End the run.

A non-docs merge before the yes makes the ask stale: the next Release run picks the version again, updates the release PR and asks again on the same issue.

## Cutting it

A fresh Release run reads the yes only from a release issue comment after the ask (the dispatcher quotes a yes given in chat there). Before acting, check the ask still holds: no PR other than `door:docs` merged since the ask, the release PR's head is still `<sha>`, CI is green on it. Any change: ask again (step 4).

1. `gh pr merge <p> --merge`.
2. `git fetch origin && git tag v<version> origin/main && git push origin v<version>`.
3. Watch the `Release` workflow once with `gh run watch`; on failure, eject with the failed step's log.
4. Set `state:released` on the tickets whose PRs shipped and on the release issue, then close it.

## Eject when

- the version the doors give looks wrong to you (a `door:none` PR that removed a feature);
- the `Release` workflow fails.

## Pointers

Release gate: `scripts/release-check.sh`, `.github/workflows/release.yml`.
