# Test baseline (Foundations, #216)

Starting point for the Foundations epic (#133), measured on `main` at `9a255b2`, 2026-11-27. Every Foundations ticket compares against this to show its cleanup kept protection.

## Suites

| Suite | Tests | Time |
|---|---|---|
| `cargo test` (415 passed; 106 of them are ts-rs binding exports) | 415 | 8.5 s of test run, ~2 min wall including compile |
| `pnpm test` (vitest, 37 files) | 526 | 14.1 s (15.9 s wall) |

Test lines for Rust are the `#[cfg(test)]` block to end of file (tests live in each module's file); for the UI, the whole `*.test.ts(x)` file. Test counts come from `cargo test -- --list` and, for the UI, `it(`/`test(` calls (`query-keys.test.ts` has none, only a type-level check; it is not counted). The `types` module's 106 tests are generated binding exports, listed separately.

## Rust, per module

| Module | Tests | Test lines |
|---|---|---|
| `accounts` | 4 | 106 |
| `backup` | 26 | 987 |
| `builds` | 19 | 625 |
| `categories` | 13 | 580 |
| `categorize` | 22 | 856 |
| `commands` | 6 | 95 |
| `crypto` | 5 | 114 |
| `csv_import` | 19 | 603 |
| `csv_layouts` | 6 | 367 |
| `db` | 9 | 533 |
| `import_acceptance_tests` | 11 | 934 |
| `imports` | 16 | 854 |
| `jobs` | 6 | 188 |
| `keyring` | 2 | 31 |
| `nicknames` | 23 | 948 |
| `ofx` | 10 | 249 |
| `ollama` | 17 | 825 |
| `overlay` | 13 | 348 |
| `release_notes` | 7 | 131 |
| `review` | 4 | 169 |
| `security` | 14 | 962 |
| `spending` | 10 | 258 |
| `startup` | 15 | 463 |
| `transactions` | 14 | 468 |
| `updates` | 14 | 388 |
| `version` | 4 | 44 |
| `types` (ts-rs binding exports) | 106 | in `types/` |

## UI, per test file

| File (under `src/`) | Tests | Lines |
|---|---|---|
| `components/about-card.test` | 16 | 275 |
| `components/app-shell.test` | 21 | 432 |
| `components/auto-categorize-switch.test` | 2 | 51 |
| `components/backup-card.test` | 25 | 433 |
| `components/categorize-actions.test` | 11 | 217 |
| `components/categorize-banner.test` | 14 | 293 |
| `components/categorize-dialog.test` | 9 | 162 |
| `components/category-delete-dialog.test` | 4 | 91 |
| `components/category-select.test` | 9 | 121 |
| `components/command-error-alert.test` | 5 | 40 |
| `components/csv-layouts-card.test` | 12 | 231 |
| `components/import-controls.test` | 33 | 736 |
| `components/model-builds-section.test` | 39 | 531 |
| `components/nickname-rule-fields.test` | 4 | 67 |
| `components/ollama-card.test` | 24 | 372 |
| `components/recovery-codes.test` | 3 | 42 |
| `components/release-notes-dialog.test` | 9 | 152 |
| `components/rename-dialog.test` | 29 | 530 |
| `components/text-size-card.test` | 3 | 40 |
| `components/update-banner.test` | 6 | 90 |
| `hooks/use-job-status.test` | 2 | 64 |
| `hooks/use-text-size.test` | 7 | 76 |
| `lib/backup-format.test` | 2 | 15 |
| `lib/commands.test` | 11 | 423 |
| `lib/job-label.test` | 2 | 20 |
| `lib/money.test` | 1 | 8 |
| `lib/nickname-errors.test` | 3 | 28 |
| `lib/query-keys.test` | 0 | 45 |
| `pages/accounts.test` | 7 | 118 |
| `pages/categories.test` | 18 | 322 |
| `pages/nicknames.test` | 30 | 600 |
| `pages/review.test` | 32 | 643 |
| `pages/settings.test` | 18 | 283 |
| `pages/setup.test` | 6 | 117 |
| `pages/startup-problem.test` | 8 | 107 |
| `pages/transactions.test` | 25 | 501 |
| `pages/unlock.test` | 15 | 236 |

## Flake rate

The run log (`runs.tsv`) records no flaky-test outcome in any row, so the recorded flake rate is 0 of all logged runs. It does not record test reruns, so this is a floor, not a measurement. Two consecutive full runs of both suites on this head passed.

## Mutation scores (`cargo-mutants`)

**Not yet measured.** Modules to run, one `cargo mutants --file src/<module>.rs` each, outside CI: `ofx`, `csv_import`, `imports`, `nicknames`, `categorize`, `spending`, `transactions`, `review`. `cargo install cargo-mutants` was blocked in the build session (approved for #133 in `build.md`, but the tool permission was denied), so the scores, surviving mutants and the equivalent-mutant classification are pending.
