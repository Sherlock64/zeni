# Build

**Outcome:** one ticket implemented test-first on its own branch, ready for a fresh verifier.

**Done when:** every acceptance criterion has a test or a named runtime check, `scripts/check.sh task` passes on the ticket's code, the branch is pushed, and a draft PR exists with its `door:` label and a `CHANGELOG.md` bullet under `## Unreleased` (none for `door:docs`). Then set `state:verifying`.

## Shape of the work

- You own the ticket end to end, backend to UI. Load the guides its modules need: `guides/backend.md`, `guides/ui.md`, `guides/pipeline.md`. A new or changed Tauri command follows the `add-command` skill.
- Work in your own worktree on `t<issue>-<words>`, from the latest `origin/main`.
- The first commit is the failing acceptance tests, at a public seam (a module's `pub fn`, the plain function a command calls, the rendered component). Then make them pass with the smallest change.
- Hand independent parts (a separate module, a page) to subagents with a narrow brief: the criterion, the module, the interface. Keep the decisions yourself.
- The ticket names behaviour and modules, not files. Choose the files; stay inside the modules it names plus the shared hubs: `types.rs` (or `types/`), `commands.rs`, `lib.rs`, `src/lib/commands.ts`, `src/router.tsx`, `src/components/app-shell.tsx`, `src/lib/snapshot-fixtures.ts`. Hub conflicts between parallel PRs are settled by the later PR rebasing.
- Done means tested: one test per error branch a new component renders or a new backend operation returns.
- Commit as you go. Each commit message names the ticket (`#<n>`).

## Eject when

- the ticket's criteria contradict each other or the code, and picking one is hard to undo;
- the work needs a dependency, a suppression, a table rebuild, or an edit to an applied migration;
- `scripts/check.sh` fails twice on the same premise;
- the work needs a module the ticket doesn't name, other than a hub.

## Pointers

- Coding rules: `CLAUDE.md`. Which rule a script enforces: `CONSTRAINTS.md`.
- Checks: `scripts/check.sh task --rust <filter> --ts <path>`; `fast` when no tests changed. Never set `ZENI_DEPS_APPROVED` or `ZENI_SUPPRESSIONS_APPROVED`.
- Snapshots of changed UI: `guides/ui.md`.
- Next station: `stations/verify.md`.
