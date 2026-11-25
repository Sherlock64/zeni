# Build

**Outcome:** one ticket implemented test-first on its own branch, checked and, when the rule below calls for it, verified by a fresh verifier, ready for Review.

**Done when:** every acceptance criterion has a test or a named runtime check, `scripts/check.sh integration --evidence snapshots/t<issue>/evidence.yaml` passes on the branch head, the verifier passed or the PR says why it was skipped, the branch is pushed, and a draft PR exists with its `door:` label, a `CHANGELOG.md` bullet under `## Unreleased` (none for `door:docs`) and, when it changes UI, its snapshots inline. Then set `state:reviewing`.

## Shape of the work

- You own the ticket end to end, backend to UI. Load the guides its modules need: `guides/backend.md`, `guides/ui.md`, `guides/pipeline.md`. A new or changed Tauri command follows the `add-command` skill.
- Work in your own worktree on `t<issue>-<words>`, from the latest `origin/main`. The app may name the worktree branch `claude/t<issue>-<words>-<suffix>`; rename it with `git branch -m t<issue>-<words>` before the first commit.
- The first commit is the failing acceptance tests, at a public seam (a module's `pub fn`, the plain function a command calls, the rendered component). Then make them pass with the smallest change.
- Hand independent parts (a separate module, a page) to subagents with a narrow brief: the criterion, the module, the interface. Keep the decisions yourself.
- The ticket names behaviour and modules, not files. Choose the files; stay inside the modules it names plus the shared hubs: `types.rs` (or `types/`), `commands.rs`, `lib.rs`, `src/lib/commands.ts`, `src/router.tsx`, `src/components/app-shell.tsx`, `src/lib/snapshot-fixtures.ts`. Hub conflicts between parallel PRs are settled by the later PR rebasing.
- Done means tested: one test per error branch a new component renders or a new backend operation returns.
- Commit as you go. Each commit message names the ticket (`#<n>`).

## Before Review

1. `scripts/check.sh integration --evidence snapshots/t<issue>/evidence.yaml` on the pushed head. It runs the same gate and script self-tests as CI.
2. **The verifier**, when `scripts/check.sh scope` prints `full` or the ticket has a `runtime` criterion: spawn a fresh verifier subagent (model from `models.md`) with only the ticket number, the branch and `guides/verify.md`. Otherwise skip it and say so in the PR body: `Verifier: skipped (scope light, no runtime criterion).`
3. Check the verifier's PR comment names this ticket and the head you pushed. A fail keeps the ticket in `state:building`: fix it, push, and run a fresh verifier again.
4. Draft PR open, door label set, then `state:reviewing`.

A rebase that Merge sends back (its rule 4) goes through the same steps before `state:reviewing` again.

## Eject when

- the ticket's criteria contradict each other or the code, and picking one is hard to undo;
- the work needs a dependency, a suppression, a table rebuild, or an edit to an applied migration;
- `scripts/check.sh` or the verifier fails twice on the same premise;
- the work needs a module the ticket doesn't name, other than a hub.

## Pointers

- Coding rules: `CLAUDE.md`. Which rule a script enforces: `CONSTRAINTS.md`.
- Checks while you work: `scripts/check.sh task --rust <filter> --ts <path>`; `fast` when no tests changed. Never set `ZENI_DEPS_APPROVED` or `ZENI_SUPPRESSIONS_APPROVED`.
- Snapshots of changed UI and how they reach the PR: `guides/ui.md`.
- Next station: `stations/review.md`.
