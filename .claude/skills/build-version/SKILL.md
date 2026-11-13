---
name: build-version
description: Organizer playbook for building one Zeni version (V1..V11) from its PRD. Splits the work across dev agents with strict file ownership, runs them, loops the council-review until every member passes, then runs the app for the user. Use when the user says "build V<n>", "implement PRD-V<n>", or asks to run the version workflow.
---

# Build version

You are the organizer. You plan, delegate, verify and decide. Leave all code and docs edits to the dev agents.

## 0. Scope

1. Read `CLAUDE.md`, `plans/ROADMAP.md` and `plans/PRD-V<n>.md`. Earlier PRDs are context; read them only when PRD-V<n> builds on something they define.
2. Build only V<n>. Never start V<n+1>, even if time remains, and never pull in a later version's items.
3. If the PRD has open questions, or a decision you can't make from the PRD and `CLAUDE.md`, ask the user before you assign work.
4. Find the checkpoints the PRD marks. Plan to stop at each one and wait for the user's decision.

## 1. Plan

1. Break the PRD into tasks. Give each task the requirement IDs it covers, its acceptance criteria, and its owner, using the ownership table in `.claude/skills/build-version/dev-contract.md`.
2. Give every file exactly one owner. Name the files each task may touch.
3. Write the cross-boundary contracts before anyone starts: each new command's name, its request and response types with field names and Rust types, and any new `AppError` variants. Put the same contract in both the `core-dev` and the `ui-dev` task.
4. If the plan needs a dependency the PRD doesn't name, ask the user before you assign it. Record their answer; it becomes the approved-dependencies list.
5. Show the user the plan (tasks, owners, contracts) in a few lines, then start. Don't wait for approval unless step 0 or 1.4 left a question open.

## 2. Build

Run the phases in this order. Within a phase, spawn the agents in one message so they run in parallel.

1. **Code:** `core-dev` and `ui-dev` together, since their files don't overlap. Run a second task for the same agent in parallel only if its files don't overlap either. Each task message contains: the task, the requirement IDs, the allowed files, the contracts, and "Follow `.claude/skills/build-version/dev-contract.md`."
2. Handle each report's `NEEDS`. Route each requested change to the file's owner, and send dependency requests to the user. Repeat phase 1 until both report `STATUS: DONE`.
3. **Docs and agents:** start only after both code devs report done. Run `docs-writer` (document the final state, running every command it documents) and `prompt-engineer` (update agents and skills if the stack, conventions or workflow changed) in parallel.
4. **Verify:** run `pnpm exec tsc`, `pnpm test`, and in `src-tauri/` `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`. Route each failure to the owner of the failing file and repeat until everything is green.

## 3. Council loop

1. Run the `council-review` skill with `plans/PRD-V<n>.md`, the round number, and the approved-dependencies list.
2. If the council fails, turn each deduped finding into a task for the owner of the cited file. Group findings by owner, keep each finding's `file:line`, Problem and Fix verbatim, and decide every `CONFLICT` yourself before sending. Run the code fixes through steps 2.1 and 2.2 for the affected code devs only. Then run `docs-writer` or `prompt-engineer` only if a finding targets their files or a fix changes what they describe. Finish with step 2.4.
3. Reconvene the full council (a fix can regress another dimension). Pass along the rejected findings and their reasons.
4. Repeat until all eight members return `PASS`. If the same finding survives three rounds, or two members keep contradicting each other, stop and ask the user.

## 4. Hand-off

1. Run `pnpm tauri dev` in the background. Watch its output until the app window is up with no build errors. If it fails, go back to step 2 with the error.
2. Tell the user:
   - That the app is running.
   - The council table from the last round.
   - The files that changed.
   - Every `RUNTIME` acceptance criterion as a step they can check in the window (for example "Open Settings and press Trigger sample error").
3. Don't commit or push unless the user asks. Stop here; the next version gets its own chat.
