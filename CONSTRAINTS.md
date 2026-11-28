# Constraints

Every rule the factory works under, paired with what enforces it. A rule a check can enforce becomes a check; a retro that wants a new rule tries a check first, and a rule whose mistake can no longer happen is deleted. `scripts/check.sh` runs the policy rows (base is `git merge-base HEAD origin/main`; uncommitted and untracked files count). Self-test: `scripts/check.test.sh`.

## Product rules (`CLAUDE.md`)

| Rule | Enforced by | Override |
|---|---|---|
| Applied migrations are never edited | policy: any file under `src-tauri/migrations/` at base that is modified, deleted or renamed | none |
| No dependency added or removed without asking | policy: an added or removed dependency line in `src-tauri/Cargo.toml` or `package.json` (noted in `task`, failed in `fast` and `integration`) | `ZENI_DEPS_APPROVED=1` |
| No new lint or test suppressions | policy: an added `#[allow(`, `#![allow(`, `#[ignore` in Rust, or `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `.skip(`, `.only(`, `it.todo(` in `src/` (`src/components/ui/`, `src/types/bindings/` exempt) | `ZENI_SUPPRESSIONS_APPROVED=1` |
| Money is integer cents, never floats | policy: no `f32`/`f64` in `src-tauri/src/` (a non-money float marks its line `// float-ok: <why>`); judgment (Standards) for UI arithmetic and `formatCents` | the marker |
| Amounts are parsed only by `money::parse_amount` | policy: no `checked_mul(100)` in `src-tauri/src/` outside `money.rs` | none |
| The UI calls the backend only through `src/lib/commands.ts` | policy: no `@tauri-apps/api/core` import elsewhere in `src/` | none |
| Colours come from theme tokens | policy: no Tailwind palette colour or `#rrggbb` in `src/**/*.tsx` outside `src/components/ui/` | none |
| No stray debug output in the UI | policy: no `console.log` in `src/` | none |
| UI queries go stale only through `invalidate(change)` in `src/lib/query-keys.ts` | policy: no `invalidateQueries(` in `src/` outside `src/lib/` | none |
| Formatted, lint-clean, type-checks | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `pnpm exec tsc`; the factory board's self-checks, `node --test tools/factory-board/*.check.js`; the run-start worktree check's self-test, `.claude/factory/tools/worktree-check.test.sh`; the run log's self-test, `.claude/factory/tools/runlog.test.sh` | none |
| Tests pass | `cargo test`, `pnpm test` (filtered in `task`, full in `integration`); `integration` also runs CI's script self-tests, `scripts/check.test.sh` and `scripts/release-check.test.sh` | none |
| ts-rs bindings are committed and fresh | `integration`: `cargo test` must not change `src/types/bindings/` | none |
| Raw imported data is never modified | database triggers abort every `UPDATE` on `raw_transactions` and the file-read columns of `imports` (tested in `db.rs`, `imports.rs`); judgment (Security) for `DELETE` beyond revert | none |
| Types live in type modules, apart from logic | policy: no top-level `type X =`, `interface X` or inline `}: {` parameter type in `src/` outside `src/types/` (`src/components/ui/`, `src/hooks/use-mobile.ts` and tests exempt), and no top-level `pub struct`, `pub enum` or `pub type` in `src-tauri/src/` outside `types/` (`keyring.rs` allowlisted) | none |
| Encrypt only account and routing numbers, only through `crypto.rs` | judgment (Security) | — |
| Never log or expose a key, password, recovery code or account number; such types don't derive `Debug` | judgment (Security) | — |
| Prefer mature, well-documented libraries | judgment (Spec, on any approved dependency) | — |
| Database folder 0700, files 0600 | tests in `db.rs` | none |
| Verification never touches real data: debug build only, throwaway data folder, never the real database or the non-dev keyring item | `scripts/verify/preflight.sh` refuses a real data folder, a non-debug binary or a missing tool; `run.ts` fails if the real database's hash changed; self-test `scripts/verify/preflight.test.sh` (run by `integration`) | none |

## Factory rules (`.claude/factory/spine.md`)

| Rule | Enforced by |
|---|---|
| Every PR has exactly one `door:` label | CI workflow `Door` (`.github/workflows/door.yml`) |
| A release tag matches the app version and has a `CHANGELOG.md` section | `scripts/release-check.sh` in `Release` (self-test `scripts/release-check.test.sh`) |
| CI runs every gate | `CI` by `scripts/check.sh scope`: on `full` (any app path, and every push to `main`) `scripts/check.sh integration` (with the script self-tests) and the `.deb` build; on `light` (only docs, plans, `.claude/`, the factory board, `LICENSE` or root notes other than `CHANGELOG.md`) only the script, board, worktree and run log self-tests; judgment (Pipeline) for new gates |
| The door label fits the change | judgment (Spec) |
| A PR stays inside its ticket's modules plus the hubs | judgment (Spec) |
| One state label per ticket; the dispatcher claims | judgment (dispatcher) |
| Findings block only with proof | judgment (Review station) |
| Security findings never reach GitHub | judgment (Security writes only to the private list) |
| Runs read the traffic light at each pivot | judgment (each run); a stale light counts as yellow |
| The run log is written only through `runlog.py` (UTC time, real session id, known station and outcome) | `.claude/factory/tools/runlog.py` refuses anything else (self-test `runlog.test.sh`); judgment (each run) for using it |
| A verified ticket's evidence is its own, and open runtime criteria are named | `scripts/check.sh fresh` fails on another ticket's manifest and lists each `OPEN` runtime criterion; Merge rule 7 asks the user |
| Branch per ticket, `t<issue>-<words>` (plus the never-merged `evidence` branch) | judgment (dispatcher sets `branch_name`); the run-start worktree check notes a folder not named for the ticket |

Only the user approves an override, and only for the exact dependency or suppression they approved. A green `scripts/check.sh` never replaces security review.
