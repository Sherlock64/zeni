# Constraints

## Checked by software

`scripts/check.sh` runs these. Tiers and commands: `CLAUDE.md` (Commands). Base is `git merge-base HEAD origin/main`; uncommitted and untracked files count.

| Invariant | How it is checked | Override |
|---|---|---|
| Applied migrations are never edited | Policy: fails on any file under `src-tauri/migrations/` that exists at base and is modified, deleted or renamed | none |
| No dependency added or removed without asking | Policy: fails on an added or removed dependency line in `src-tauri/Cargo.toml` or `package.json` | `ZENI_DEPS_APPROVED=1` |
| No new lint or test suppressions | Policy: fails on an added `#[allow(`, `#![allow(` or `#[ignore` in `src-tauri/**/*.rs`, or an added `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `.skip(`, `.only(` or `it.todo(` in `src/**/*.{ts,tsx}`; `src/components/ui/` and `src/types/bindings/` are exempt | `ZENI_SUPPRESSIONS_APPROVED=1` |
| Code is formatted, lint-clean and type-checks | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `pnpm exec tsc` | none |
| Tests pass | `cargo test` and `pnpm test` (filtered in `task`, full in `integration`) | none |
| ts-rs bindings are committed and fresh | `integration`: `cargo test` must not change `src/types/bindings/` | none |

Only the organizer sets an override, and only for the exact dependency or suppression the user approved.

## Judgement only

No script checks the `CLAUDE.md` encryption, secret-logging, raw-data and integer-cents rules; review them by judgement (the raw-data triggers cover only `UPDATE`).

A green `scripts/check.sh` never replaces security review.
