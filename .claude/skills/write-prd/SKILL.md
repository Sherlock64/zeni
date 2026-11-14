---
name: write-prd
description: Write one Zeni PRD (plans/PRD-V<n>.md) with the user through a short interview, checked against the code, in the house format. Use when the user says "write PRD-V<n>", "plan V<n>", "next PRD", or asks to turn a roadmap item into a PRD. Writes the PRD only; building it is the build-version skill.
argument-hint: V<n>
---

# Write PRD

## 1. Read

1. Read `CLAUDE.md`, `plans/ROADMAP.md` and the PRDs this version builds on.
2. Read the code, migrations and fixtures the version touches: schema, triggers, existing commands and pages. Check every environment or file-format fact a question depends on (running services, format limits, what SQLite allows) before you ask it.

## 2. Interview

1. Ask in batched rounds of at most five questions. Give each question your recommended answer and why.
2. Ask only what the roadmap, the code and `CLAUDE.md` leave open. Stop when nothing is open.
3. If an answer moves scope to another version, update `plans/ROADMAP.md` to match.

## 3. Write `plans/PRD-V<n>.md`

Follow the shape of `plans/PRD-V3.1.md`, about 35-50 lines:

- `# Personal Finance App — V<n> PRD: <title>`, then one paragraph saying what V<n> adds, ending "Builds on PRD-V1.md to PRD-V<prev>.md; see ROADMAP.md."
- `## Requirements`: `- **V<n>-R<k>:** ...`, one testable item each.
- `## Out of Scope`, `## Edge Cases`, `## Checkpoint` (only if the user sets one), `## Acceptance Criteria` (numbered, each testable).

Rules:

- Name every dependency the user approved inline, for example "`csv` crate (approved dependency)", so `build-version` doesn't ask again.
- State every formula or rule once, exactly, with one worked example per edge case it has.
- Say when an acceptance criterion can only be checked in the running app, so `council-prd-compliance` marks it `RUNTIME`.
- Name the migration shape when SQLite limits it (for example a table rebuild to widen a `CHECK`).
- No implementation detail beyond what the user decided.

## 4. Stop

Work on a branch named by the branch rule in `CLAUDE.md`. Show the user the PRD path and a summary, then stop. Don't build; that is `build-version`, in its own session.
