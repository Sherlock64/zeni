# Dev contract

Every dev agent (`core-dev`, `ui-dev`, `docs-writer`, `prompt-engineer`) follows this file.

## Default file ownership

| Owner | Files |
|---|---|
| `core-dev` | `src-tauri/**` (incl. `migrations/`, `capabilities/`, `Cargo.toml`, `tauri.conf.json`, `build.rs`), `src/lib/commands.ts` and its test, `src/types/**` except `ui.ts` (incl. generated `src/types/bindings/`), `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `index.html`, `snapshot.html`, `scripts/**`, `.gitignore` |
| `ui-dev` | `src/pages/**`, `src/components/**` (incl. `ui/`), `src/hooks/**`, `src/lib/**` except `commands.ts` and its test (incl. `snapshot-fixtures.ts`), `src/router.tsx`, `src/main.tsx`, `src/snapshot.ts`, `src/index.css`, `components.json`, `src/types/ui.ts`, and every UI test (`*.test.tsx`) |
| `docs-writer` | `CLAUDE.md`, `README.md`, `docs/**` |
| `prompt-engineer` | `.claude/agents/**`, `.claude/skills/**` |

Nobody edits `plans/`; the user writes PRDs, or the organizer does with the user through the `write-prd` skill. Several instances of `core-dev` or `ui-dev` may run at once, so your task message names the exact files you may touch. That list overrides this table for the task.

## Rules

1. Edit only the files your task message allows. If the task needs a change in any other file, stop and report the exact change needed (file, what, why) instead of making it.
2. Follow `CLAUDE.md`. It is the single source of coding rules; this contract does not restate them.
3. Never add a Cargo or npm dependency. If one is needed, report the crate or package, version and reason; the organizer asks the user.
4. Build only what the task asks for. No features, options or abstractions beyond it.
5. Other devs edit the same working tree at the same time. A build or test failure in a file you do not own is reported, not fixed. A `cargo` "waiting for file lock" message means another dev is building; wait, don't kill it. If you edit a hub file (`build-version` step 1.2), retake every earlier snapshot of the states it changes.
6. Do not commit, push or touch git state.
7. Before reporting done, run the checks for what you changed and make them pass. Don't run the full suites; the organizer runs them once at integration.
   - Rust: format only your own files with `rustfmt --edition 2024 <file>`, never plain `cargo fmt`.
   - From the repo root, `scripts/check.sh task --rust <cargo test filter> --ts <vitest path>`: one `--rust` per changed Rust module (for example `--rust csv_layouts::`) and one `--ts` per changed or affected test file (for example `--ts src/lib/money.test.ts`), both repeatable. It runs the policy checks, `pnpm exec tsc`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and only those tests. With no tests to name, run `scripts/check.sh fast`.
   - Never set `ZENI_DEPS_APPROVED` or `ZENI_SUPPRESSIONS_APPROVED`. Report a `POLICY FAIL` in `NEEDS`.
   - UI: the snapshots in `ui-dev`'s agent file, viewed and fixed until they look right.
8. Report in this format:
   ```
   STATUS: DONE | BLOCKED
   CHANGED: <every file created, edited or deleted>
   CHECKS: <each command run and its result>
   SNAPSHOTS: <each PNG path - route, state, what you checked; or "none" for non-UI tasks>
   NEEDS: <changes needed in files you don't own, deps to approve, questions; or "none">
   NOTES: <at most five one-line items, or "none">
   ```
   Nothing outside these six fields.
