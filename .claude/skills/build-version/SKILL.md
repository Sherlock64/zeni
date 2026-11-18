---
name: build-version
description: Organizer playbook for building one Zeni version (V1..V12) from its PRD. Takes the PRD's S#-T# tasks as the task graph, runs parallel core-dev and ui-dev agents wave by wave with strict file ownership, then docs-writer and prompt-engineer where needed, then loops a risk-selected council until nothing critical, high or blocking medium remains, then opens a PR and runs the app for the user. Use when the user says "build V<n>", "implement PRD-V<n>", "/build-version V<n>", or asks to run the version workflow.
argument-hint: V<n>
---

# Build version

You are the organizer. You plan, delegate, verify and decide. Leave all code and docs edits to the dev agents.

Flow: plan → code waves (`core-dev` + `ui-dev`, parallel) → integration → docs and agents (only where needed) → council (risk-selected) → blocking findings go back to the code waves; otherwise PR, metrics and hand-off.

Usage gate: before every phase (each code wave, integration, docs and agents, each council round, each fix wave, PR), call `mcp__ccd_session_mgmt__get_usage`. If the 5-hour window is at about 80% or more, or the weekly window at about 90% or more, start no new agents: let in-flight ones finish, notify the user with PushNotification and a message naming the window and its reset time so they can reset the limit. In the same turn, unasked, start a cache-warm timer: `sleep 3300` with `run_in_background`. On each wake, call `get_usage` again: restart the timer while a window is still over the gate, and resume the work once it has reset. Resume an agent cut off by a limit with SendMessage; never respawn it.

## 0. Scope

1. Read `CLAUDE.md`, `plans/ROADMAP.md` and `plans/PRD-V<n>.md`. Earlier PRDs are context; read them only when PRD-V<n> builds on something they define.
2. Build only V<n>. Never start V<n+1>, even if time remains, and never pull in a later version's items.
3. If the PRD has open questions, or a decision you can't make from the PRD and `CLAUDE.md`, ask the user before you assign work.
4. Find the checkpoints the PRD marks. Plan to stop at each one and wait for the user's decision.
5. Run `git status`. If the tree isn't clean, ask the user before starting. Then `git fetch origin` and `git switch -c v<n>-<one or two words> origin/main`, following the branch rule in `CLAUDE.md`. All work for V<n> happens on this branch.

## Design check

Run it, also inside `fix-bug` or `investigate`, only when the work involves encryption or key handling, schema architecture or a migration that rebuilds tables, sync or concurrency, a new external interface that is hard to reverse, or a design deadlock. Not for routine changes.

1. Spawn 2-3 `Plan` agents in one message, each told to design a structurally different approach.
2. Compare them against the PRD (or task brief) and `CLAUDE.md`, and pick one.
3. Record the surprising or hard-to-reverse choice as an ADR task for `docs-writer` (`docs/adr/NNNN-<slug>.md`, per `docs/adr/README.md`).
4. For a high-risk claim, demand proof where feasible: a failing test, a reproducer or a concrete code path.

## 1. Plan the task graph

1. The PRD's tasks (`S<k>-T<m>`) are the task graph: each is one complete behaviour slice for one owner (backend: `core-dev`; UI: `ui-dev`), with its criteria and deps already set. Keep their IDs. To each task add the exact files it may create or edit, its acceptance proof (the tests or snapshots that show each criterion holds), and the exact interfaces it provides or consumes (contract sections). Split a task (`S1-T2a`, `S1-T2b`) or add a dep only when step 1.2's file ownership forces it. A task that edits any `.tsx` under `src/pages/` or `src/components/` lists at least one snapshot, copy-only edits included.
2. Give every file exactly one task. Two tasks that must edit the same file either merge into one task or run in sequence (one depends on the other). Watch the hub files every feature touches: `src-tauri/src/types.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (`generate_handler!`), `src/lib/commands.ts`, `src/router.tsx`, `src/components/app-shell.tsx` (`navItems`), `src/lib/snapshot-fixtures.ts`. A task that adds a field to a struct tests build as literals (such as `AppState`) also owns every file with a literal of it (`grep -rln 'AppState {' src-tauri/src`).
3. Split along files, not along layers: put each backend feature in its own domain module (for example `src-tauri/src/imports.rs`) and each page in its own files, so tasks can run side by side.
4. Run the Design check above if it applies. Then write the cross-boundary contracts to `snapshots/V<n>/contracts.md` before anyone starts: each new command's name, its request and response types with field names and Rust types, and any new `AppError` variants. For every UI mutation, state the success message, the error next step and any credential prompt. Quote every PRD formula or rule verbatim and add one worked example per edge it names (same date, re-import, empty). Every task on either side of a contract reads the same file. Before wave 1, re-read the contracts once for self-contradictions.
5. Add a dependency only where a task truly needs another's output. A contract is enough for UI work to proceed against a command that doesn't exist yet, but the UI can't type-check without the generated bindings. So when a version adds commands, the first wave is usually one `core-dev` contract task that adds the types to `types.rs`, regenerates `src/types/bindings/`, and adds the `src/lib/commands.ts` wrappers and their tests; the UI tasks and the backend logic tasks depend on it and run together after it.
6. Group tasks into waves: wave 1 is every task with no deps; each later wave is every task whose deps are all in earlier waves. Run at most five agents in one wave; split a larger wave in two.
7. If the plan needs a dependency the PRD doesn't name, ask the user before you assign it. Record their answer; it becomes the approved-dependencies list.
8. Show the user the graph as one table (ID, owner, covers, files, deps, wave) plus the contracts, then start. Don't wait for approval unless step 0 or 1.7 left a question open.

## 2. Code waves

1. Before the first wave with a `ui-dev` task, start `pnpm dev` in the background and confirm port 1420 answers. ui-devs need it for snapshots; keep it running until step 6.
2. For each wave, spawn all its tasks in one message so they run in parallel, one agent per task. Several `core-dev` or `ui-dev` instances in one wave is normal. Each task message contains: the task ID, the story and the task with its acceptance criteria, the allowed files, the contracts, the snapshot folder `snapshots/V<n>/` for UI tasks, a note when `dead_code` clippy errors are expected until a named dependent task lands, and "Follow `.claude/skills/build-version/dev-contract.md`." Pass the contracts path `snapshots/V<n>/contracts.md`; the Agent tool expands no shell placeholder such as `$(cat contracts)`. Never call code "untested" or "thin, no tests" in a task message.
   Send a follow-up to the file's idle owner with SendMessage; spawn fresh with a narrow brief naming earlier decisions only when its context is large or the files span owners.
3. Handle each report's `NEEDS`. Route a change in someone else's file to that file's task as a follow-up (or a new task if it has finished), and send dependency requests to the user. Start the next wave only when every task it depends on reports `STATUS: DONE`. Append each report's `COVERS` under its task ID to `snapshots/V<n>/coverage.md`; a criterion with no test and no `RUNTIME` note goes back to the task.
4. Open one `SNAPSHOTS` PNG per changed page yourself; leave the rest to the UI council members. If one shows something wrong or a state is missing, send it back to that task. Keep the list of PNGs for the council.

## 3. Integration

Run `scripts/check.sh integration --evidence snapshots/V<n>/evidence.yaml` once per unchanged tree; it writes the evidence manifest. Prefix `ZENI_DEPS_APPROVED=1` only when every dependency change is one the user approved, and `ZENI_SUPPRESSIONS_APPROVED=1` only for suppressions the user approved. Route each `CHECK ...: fail` and `POLICY FAIL` to the task that owns the file, and rerun only after a fix changed the tree. Never rerun while `scripts/check.sh fresh snapshots/V<n>/evidence.yaml` prints `FRESH`.

## 4. Docs and agents

Start only after step 3 is green. Spawn `docs-writer` only if user-facing behaviour, commands, layout or facts `CLAUDE.md` describes changed (it documents the final state, running every command it documents, and adds the PRD's `New Terms` to `docs/glossary.md`), and `prompt-engineer` only if the stack, conventions or workflow changed (it updates agents and skills). Spawn the needed ones in one message. Record each skipped one and why in `snapshots/V<n>/metrics.md`.

## 5. Council loop

1. Run the `council-review` skill yourself; don't delegate it to a coordinator agent. Give it `plans/PRD-V<n>.md` (or, for a hotfix, the task brief), the round number, the contracts path, the coverage map `snapshots/V<n>/coverage.md`, the evidence manifest `snapshots/V<n>/evidence.yaml`, the snapshot list, and the approved-dependencies list. First `scripts/check.sh fresh snapshots/V<n>/evidence.yaml` must print `FRESH`; otherwise rerun step 3.
2. If the council passes, go to step 6.
3. If it fails, turn each `BLOCKING` finding into a fix task for the owner of the cited file. Decide every `CONFLICT` yourself first. Keep each finding's severity, `file:line`, Problem and Fix verbatim. Send each fix task by the reuse rule in step 2.2, or spawn fresh when the original agent is gone. Build a small task graph for the fixes with the step 1 rules (one task per file set, parallel where files don't overlap), and run it through steps 2 and 3, updating `coverage.md` from the fix reports. Each UI fix task names the exact snapshots to retake (path, route, state); the next round gets only those PNGs. Run `docs-writer` or `prompt-engineer` only if a finding targets their files or a fix changes what they describe.
4. Leave `NON-BLOCKING` findings as follow-ups, unless a fix task already edits that exact code; then include them in it. They are already in `snapshots/V<n>/council-findings.md` (`council-review` step 10). `snapshots/` is gitignored, so the findings stay on this machine. The `retrospective` skill triages them into `factory-bug` issues or `SB-<n>` entries (step 6.2). While the round is already failing, also fold a non-blocking `MEDIUM` from `council-security` or `council-prd-compliance` on a sensitive path (`council-review` step 2) into a small fix task for that file's owner.
5. Re-review only what the fixes can affect. If a fix changed a contract, a migration, auth or secrets handling, a sensitive path (`council-review` step 2) or semantics other code shares, rerun step 3 and let `council-review` select members from scratch. Otherwise rerun step 3, then convene only the members with a blocking finding, plus each member whose dimension the fixes' files touch, plus `council-prd-compliance` in every round. Pass along the rejected findings and their reasons.
6. If the same blocking finding survives three rounds, or two members still contradict each other after a full-eight round, stop and ask the user.

## 6. Pull request and hand-off

1. Stop the `pnpm dev` server with TaskStop on its background task, never `pkill -f`.
2. Stage only the files listed in the dev reports' `CHANGED`. Check `git status` for anything else and ask the user about it. Never stage `snapshots/`. Commit once as `V<n>: <PRD title>`, push with `-u`, and open the PR against `main` with `gh pr create --base main`. The body has:
   - A summary of what V<n> adds, in a few lines.
   - The task checklist from `council-prd-compliance`'s last report.
   - The final council table: verdicts and counts only.
   - Every `RUNTIME` acceptance criterion as a manual check.

   For an `SB-<n>` fix, replace the task checklist with one neutral line ("Hardening fix; reviewed privately") and show the council table with verdicts only; the manual check is only "verify the app works as before" (any SB-specific check goes to the user in step 6.4, never into the PR).

   The repo is public, and a listed weakness is a guide to attacking it. Council findings reach GitHub text (PR, commit messages, issues) only as `factory-bug` issues, and only after triage:
   - Floor, whatever the triage says: blocking findings, what earlier rounds failed on, and every `council-security` finding are always private.
   - Triage: `council-security` sorts every other non-blocking finding, and each retrospective item that is a concrete code, copy, test or docs defect, into `public` or `private` by its judgement (`retrospective` step 4). When unsure: private.
   - `public` becomes a `factory-bug` issue, with the user's yes. `private` goes only to `snapshots/security-bugs.md` (gitignored) as `SB-<n>`. Everything committed or pushed for an `SB-<n>` fix (branch, test names, code comments, docs, commit message, PR body) uses neutral wording ("Harden restore validation", `v4.0.4-hardening`) and never names the weakness or the SB number.
   - Process ideas are never filed; they stay retro recommendations.
3. Run `pnpm tauri dev` in the background. Watch its output until the app window is up with no build errors. If it fails, go back to section 2 with the error.
4. Tell the user:
   - The PR link, and that the app is running.
   - The final council table, and the path to `snapshots/V<n>/council-findings.md` with the most important follow-ups.
   - The key snapshots: show one per changed page.
   - Every `RUNTIME` acceptance criterion as a step they can check in the window (for example "Open Settings and press Trigger sample error").
5. Always run the retrospective tally (`retrospective` skill, steps 1.1 and 1.2); only the HTML write-up is optional. Append to `snapshots/V<n>/metrics.md`: weighted tokens per phase (plan, code waves, integration, docs and agents, each council round, each fix wave), agent launches, council member launches, full integration runs, and fix and review rounds, each beside the V3.1 baseline in `retros/2026-11-15-v3.1-csv-import.html`.
6. Stop here. Don't merge. The next version gets its own chat.
