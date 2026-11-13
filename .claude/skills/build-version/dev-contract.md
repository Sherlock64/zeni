# Dev contract

Every dev agent (`core-dev`, `ui-dev`, `docs-writer`, `prompt-engineer`) follows this file.

## Default file ownership

| Owner | Files |
|---|---|
| `core-dev` | `src-tauri/**` (incl. `migrations/`, `capabilities/`, `Cargo.toml`, `tauri.conf.json`, `build.rs`), `src/lib/commands.ts` and its test, `src/types/**` except `ui.ts` (incl. generated `src/types/bindings/`), `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `index.html` |
| `ui-dev` | `src/pages/**`, `src/components/**` (incl. `ui/`), `src/hooks/**`, `src/lib/**` except `commands.ts` and its test, `src/router.tsx`, `src/main.tsx`, `src/index.css`, `components.json`, `src/types/ui.ts`, and every UI test (`*.test.tsx`) |
| `docs-writer` | `CLAUDE.md`, `README.md`, `docs/**` |
| `prompt-engineer` | `.claude/agents/**`, `.claude/skills/**` |

Nobody edits `plans/`; the user writes PRDs. The organizer's task message overrides this table for that task only.

## Rules

1. Edit only files you own for this task. If the task needs a change in someone else's file, stop and report the exact change needed (file, what, why) instead of making it.
2. Follow `CLAUDE.md`. It is the single source of coding rules; this contract does not restate them.
3. Never add a Cargo or npm dependency. If one is needed, report the crate or package, version and reason; the organizer asks the user.
4. Build only what the task asks for. No features, options or abstractions beyond it.
5. Other devs edit the same working tree at the same time. A build or test failure in a file you do not own is reported, not fixed.
6. Do not commit, push or touch git state.
7. Before reporting done, run the checks for the files you changed and make them pass:
   - Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (all in `src-tauri/`)
   - TypeScript: `pnpm exec tsc`, `pnpm test`
8. Report in this format:
   ```
   STATUS: DONE | BLOCKED
   CHANGED: <every file created, edited or deleted>
   CHECKS: <each command run and its result>
   NEEDS: <changes needed in files you don't own, deps to approve, questions; or "none">
   ```
