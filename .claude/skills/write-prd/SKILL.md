---
name: write-prd
description: Write one Zeni PRD (plans/PRD-V<n>.md) with the user through a grilling interview that settles every decision, checked against the code, as user stories with S#-T# build tasks in the house format. Use when the user says "write PRD-V<n>", "plan V<n>", "next PRD", or asks to turn a roadmap item into a PRD. Writes the PRD only; building it is the build-version skill.
argument-hint: V<n>
---

# Write PRD

## 1. Read

1. Read `CLAUDE.md`, `plans/ROADMAP.md`, `docs/glossary.md` and the PRDs this version builds on.
2. Read the code, migrations and fixtures the version touches: schema, triggers, existing commands and pages. Check every environment or file-format fact a question depends on (running services, format limits, what SQLite allows) before you ask it.

## 2. Grill

1. Walk the version's decision tree depth-first: scope, then each story, then each task's behaviour, errors and edges. Each answer can open follow-up branches; walk them before moving on.
2. Ask in rounds of at most four independent questions. Give each your recommended answer and why.
3. Answer from the roadmap, the code and `CLAUDE.md` whatever you can; ask only what they leave open. Stop only when no branch is open.
4. Use `docs/glossary.md` terms exactly. Settle a name for every new domain term in the interview.
5. If an answer moves scope to another version, update `plans/ROADMAP.md` to match.

## 3. Confirm

Write a one-page summary of the decisions and the stories with their tasks to `snapshots/V<n>/prd-summary.html` (plain HTML, readable print styles), render it with the snapshot browser and send the PDF with SendUserFile:

```bash
chrome=$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell | sort -V | tail -1)
"$chrome" --print-to-pdf=snapshots/V<n>/prd-summary.pdf --no-pdf-header-footer snapshots/V<n>/prd-summary.html
```

Get one yes before writing the file. A change goes back to step 2 for the branches it opens.

## 4. Write `plans/PRD-V<n>.md`

About 70-120 lines:

- `# Personal Finance App — V<n> PRD: <title>`, then one paragraph saying what V<n> adds, ending "Builds on PRD-V1.md to PRD-V<prev>.md; see ROADMAP.md."
- `## User Stories`: one `### S<k>: <title>` per story. Each story is a thin vertical slice, testable end to end, and opens with "As a user, I want ..., so that ...". Under it, its tasks:
  `- **S<k>-T<m>** (backend | UI; deps: S<j>-T<i>, or none): <what it delivers>`, then its acceptance criteria as indented bullets.
- `## Decisions`: the choices the user made in the interview, one line each.
- `## New Terms`: each new domain term with its one-line definition, for `docs-writer` to add to `docs/glossary.md` at build time; or "None".
- `## Out of Scope`, `## Checkpoint` (only if the user sets one).

Rules:

- A task is one owner side's piece of its story (backend: `core-dev`; UI: `ui-dev`) that one agent can build. A story that spans both sides has a backend task and a UI task, the UI task depending on the backend one. The tasks become `build-version`'s task graph as written, so name no files.
- Phrase each acceptance criterion as an observable result a test or the running app can check: what the user sees, or what a command returns or stores, never how the code does it. Each edge case is a criterion of the task it belongs to.
- Say when a criterion can only be checked in the running app (`RUNTIME`), so `council-prd-compliance` marks it so.
- Name every dependency the user approved inline, for example "`csv` crate (approved dependency)", so `build-version` doesn't ask again.
- State every formula or rule once, exactly, with one worked example per edge case it has.
- Name the migration shape when SQLite limits it (for example a table rebuild to widen a `CHECK`).
- No implementation detail beyond what the user decided.

## 5. Stop

Work on a branch named by the branch rule in `CLAUDE.md`. Show the user the PRD path and a summary, then stop. Don't build; that is `build-version`, in its own session.
