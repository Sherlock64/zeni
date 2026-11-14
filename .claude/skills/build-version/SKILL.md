---
name: build-version
description: Organizer playbook for building one Zeni version (V1..V11) from its PRD. Maps the PRD into a task graph, runs parallel core-dev and ui-dev agents wave by wave with strict file ownership, then docs-writer and prompt-engineer, then loops the council until nothing critical, high or blocking medium remains, then opens a PR and runs the app for the user. Use when the user says "build V<n>", "implement PRD-V<n>", "/build-version V<n>", or asks to run the version workflow.
argument-hint: V<n>
---

# Build version

You are the organizer. You plan, delegate, verify and decide. Leave all code and docs edits to the dev agents.

Flow: plan → code waves (`core-dev` + `ui-dev`, parallel) → verify → docs and agents (`docs-writer` + `prompt-engineer`) → council → blocking findings go back to the code waves; otherwise PR and hand-off.

## 0. Scope

1. Read `CLAUDE.md`, `plans/ROADMAP.md` and `plans/PRD-V<n>.md`. Earlier PRDs are context; read them only when PRD-V<n> builds on something they define.
2. Build only V<n>. Never start V<n+1>, even if time remains, and never pull in a later version's items.
3. If the PRD has open questions, or a decision you can't make from the PRD and `CLAUDE.md`, ask the user before you assign work.
4. Find the checkpoints the PRD marks. Plan to stop at each one and wait for the user's decision.
5. Run `git status`. If the tree isn't clean, ask the user before starting. Then `git fetch origin` and `git switch -c v<n>-<one or two words> origin/main`, following the branch rule in `CLAUDE.md`. All work for V<n> happens on this branch.

## 1. Plan the task graph

1. Break the PRD into small tasks, each doable by one agent. Give each task an ID (`T1`...), its owner role, the requirement IDs and acceptance criteria it covers, the exact files it may create or edit, and `deps`: the task IDs it needs finished first.
2. Give every file exactly one task. Two tasks that must edit the same file either merge into one task or run in sequence (one depends on the other). Watch the hub files every feature touches: `src-tauri/src/types.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (`generate_handler!`), `src/lib/commands.ts`, `src/router.tsx`, `src/components/app-shell.tsx` (`navItems`), `src/lib/snapshot-fixtures.ts`.
3. Split along files, not along layers: put each backend feature in its own domain module (for example `src-tauri/src/imports.rs`) and each page in its own files, so tasks can run side by side.
4. Write the cross-boundary contracts before anyone starts: each new command's name, its request and response types with field names and Rust types, and any new `AppError` variants. Every task on either side of a contract gets the same text.
5. Add a dependency only where a task truly needs another's output. A contract is enough for UI work to proceed against a command that doesn't exist yet, but the UI can't type-check without the generated bindings. So when a version adds commands, the first wave is usually one `core-dev` contract task that adds the types to `types.rs`, regenerates `src/types/bindings/`, and adds the `src/lib/commands.ts` wrappers and their tests; the UI tasks and the backend logic tasks depend on it and run together after it.
6. Group tasks into waves: wave 1 is every task with no deps; each later wave is every task whose deps are all in earlier waves. Run at most five agents in one wave; split a larger wave in two.
7. If the plan needs a dependency the PRD doesn't name, ask the user before you assign it. Record their answer; it becomes the approved-dependencies list.
8. Show the user the graph as one table (ID, owner, covers, files, deps, wave) plus the contracts, then start. Don't wait for approval unless step 0 or 1.7 left a question open.

## 2. Code waves

1. Before the first wave with a `ui-dev` task, start `pnpm dev` in the background and confirm port 1420 answers. ui-devs need it for snapshots; keep it running until step 6.
2. For each wave, spawn all its tasks in one message so they run in parallel, one agent per task. Several `core-dev` or `ui-dev` instances in one wave is normal. Each task message contains: the task ID, the task, the requirement IDs, the allowed files, the contracts, the snapshot folder `snapshots/V<n>/` for UI tasks, and "Follow `.claude/skills/build-version/dev-contract.md`." Paste the contracts as literal text; the Agent tool expands no shell placeholder such as `$(cat contracts)`.
3. Handle each report's `NEEDS`. Route a change in someone else's file to that file's task as a follow-up (or a new task if it has finished), and send dependency requests to the user. Start the next wave only when every task it depends on reports `STATUS: DONE`.
4. Read each UI task's `SNAPSHOTS` PNGs yourself. If one shows something wrong or a state is missing, send it back to that task. Keep the list of PNGs for the council.

## 3. Verify

Run `pnpm exec tsc`, `pnpm test`, and in `src-tauri/` `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`. Route each failure to the task that owns the failing file and repeat until everything is green.

## 4. Docs and agents

Start only after step 3 is green. Spawn `docs-writer` (document the final state, running every command it documents) and `prompt-engineer` (update agents and skills if the stack, conventions or workflow changed) in one message.

## 5. Council loop

1. Run the `council-review` skill with `plans/PRD-V<n>.md`, the round number, the snapshot list, and the approved-dependencies list.
2. If the council passes, go to step 6.
3. If it fails, turn each `BLOCKING` finding into a fix task for the owner of the cited file. Decide every `CONFLICT` yourself first. Keep each finding's severity, `file:line`, Problem and Fix verbatim. Build a small task graph for the fixes with the step 1 rules (one task per file set, parallel where files don't overlap), and run it through steps 2 and 3. UI fixes come with fresh snapshots. Run `docs-writer` or `prompt-engineer` only if a finding targets their files or a fix changes what they describe.
4. Leave `NON-BLOCKING` findings as follow-ups, unless a fix task already edits that exact code; then include them in it. Append every follow-up, with severity, `file:line`, Problem and Fix, to `snapshots/V<n>/council-findings.md`. `snapshots/` is gitignored, so the findings stay on this machine.
5. Reconvene the full council (a fix can regress another dimension). Pass along the rejected findings and their reasons.
6. If the same blocking finding survives three rounds, or two members keep contradicting each other, stop and ask the user.

## 6. Pull request and hand-off

1. Stop the `pnpm dev` server.
2. Stage only the files listed in the dev reports' `CHANGED`. Check `git status` for anything else and ask the user about it. Never stage `snapshots/`. Commit once as `V<n>: <PRD title>`, push with `-u`, and open the PR against `main` with `gh pr create --base main`. The body has:
   - A summary of what V<n> adds, in a few lines.
   - The requirement checklist from `council-prd-compliance`'s last report.
   - The final council table: verdicts and counts only.
   - Every `RUNTIME` acceptance criterion as a manual check.

   The repo is public. Never put council findings (blocking or non-blocking, their `file:line`, or what earlier rounds failed on) in the PR, commit messages, issues or any other GitHub text: a listed weakness is a guide to attacking it.
3. Run `pnpm tauri dev` in the background. Watch its output until the app window is up with no build errors. If it fails, go back to section 2 with the error.
4. Tell the user:
   - The PR link, and that the app is running.
   - The final council table, and the path to `snapshots/V<n>/council-findings.md` with the most important follow-ups.
   - The key snapshots: show one per changed page.
   - Every `RUNTIME` acceptance criterion as a step they can check in the window (for example "Open Settings and press Trigger sample error").
5. Stop here. Don't merge. The next version gets its own chat.
