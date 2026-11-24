# Pipeline guide

Load when a ticket touches `.github/workflows/`, `scripts/release-check*`, `scripts/check.sh` or `.deb` packaging.

## How the pipeline works

- `.github/workflows/ci.yml` (`CI`) runs on pull requests to `main` and pushes to `main`: `scripts/release-check.test.sh`, the Tauri apt build deps, Rust stable, Node and pnpm, `pnpm install --frozen-lockfile`, `pnpm build` (Tauri's `generate_context!` needs `dist/`), then `ZENI_DEPS_APPROVED=1 ZENI_SUPPRESSIONS_APPROVED=1 scripts/check.sh integration`; on pull requests also `pnpm tauri build`. Checkout uses `fetch-depth: 0` because `check.sh` needs the merge base with `origin/main`. A first `Scope` step runs `scripts/check.sh scope` on pull requests: on `light` every toolchain, integration and `.deb` step is skipped (`if:`) and only the self-tests run; pushes to `main` are always `full`. There is no `paths:` filter, so the required `CI` check always reports. The overrides are set because the user approves dependencies and suppressions locally; every other gate must still fail CI.
- `.github/workflows/release.yml` (`Release`) runs on tags `v*.*.*`. Its first step, `scripts/release-check.sh "$GITHUB_REF_NAME" release-notes.md`, exits 1 (publish nothing) when the tag version differs from `src-tauri/Cargo.toml` or `CHANGELOG.md` has no `## <version>` section, and writes `release=false` for a tag that isn't `v<major>.<minor>.<patch>`. Every later step is gated on `steps.check.outputs.release == 'true'`; `gh release create` runs last, so a failed build publishes nothing. This job alone gets `contents: write`, and it uses no caches.
- `scripts/release-check.test.sh` self-tests the gate; run it after every change to `release-check.sh`.
- `src-tauri/deb/postrm` never deletes user data.

## Hard limits

These are the user's limits. A change that breaks one is wrong even if it works; eject instead.

- Nothing that costs money or needs a subscription or paid plan.
- GitHub Actions only, on GitHub-hosted standard runners (`ubuntu-24.04`). No larger, GPU or self-hosted runners.
- First-party `actions/*` actions only (`actions/checkout`, `actions/setup-node`, `actions/cache`), pinned to a major version. No third-party marketplace actions.
- No external services or build tools: no Turborepo, Nx, Docker Hub, Codecov, release bots or hosted caches. Use what the runner has: `rustup`, `corepack`, `gh`, `apt-get`.
- Least-privilege `permissions`: `contents: read` at workflow level (or `{}`), a wider scope only on the job that needs it, with a comment saying why. Checkout with `persist-credentials: false`.
- No secrets beyond the default `GITHUB_TOKEN`.
- No caches in a job that holds a write token.

## Fixing a failing run

1. Find the run: `gh pr checks <pr>`, or `gh run list --branch <branch> --status failure`.
2. Read only the failed steps: `gh run view <run-id> --log-failed`. Add `--job <job-id>` when a run has several jobs.
3. Reproduce locally with the same command from the repo root (`scripts/check.sh integration`, `scripts/release-check.test.sh`, `pnpm tauri build`) before you edit.
4. Fix the cause where it is, once.
5. Never weaken a gate to get green: no `continue-on-error`, no skipped step beyond the `light` scope, no override beyond the two `check.sh` already documents.

## Checks

Run `scripts/release-check.test.sh` when you touch the release gate, and `scripts/check.sh fast` always. A workflow edit is proven only by a run on GitHub; name the job and step to watch in the PR body.
