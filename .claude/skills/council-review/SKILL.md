---
name: council-review
description: Convene Zeni's review council on a change. Spawns all eight council-* members in parallel, aggregates their PASS/FAIL verdicts into one table, and dedupes findings. Use when a version's dev work is done and needs review, or when the user asks for a council review.
---

# Council review

## Members and dimensions

Each member owns one dimension. Every `CLAUDE.md` rule has exactly one owner.

| Member | Dimension | `CLAUDE.md` rules it owns |
|---|---|---|
| `council-code-cleanliness` | Readability, structure, idioms, lint/format/type-check clean, consistency with established patterns | Types separate from logic; integer cents |
| `council-minimalism` | Unneeded code, abstraction, scope creep, duplication, dependencies | No unapproved deps; prefer mature libraries |
| `council-security` | Secrets, crypto, IPC surface, SQL safety, data integrity | Raw imported data never modified; never edit an applied migration |
| `council-ui-design` | Visual consistency: shadcn usage, theme tokens, layout, typography | - |
| `council-ux-design` | Flows, states, feedback, copy | - |
| `council-accessibility` | WCAG 2.1 AA: semantics, keyboard, focus, names, contrast | - |
| `council-test-quality` | Tests run and pass, cover the change, and are meaningful; bindings are fresh | - |
| `council-prd-compliance` | Every PRD requirement and acceptance criterion, one by one | Stop and ask at marked checkpoints |

## Steps

1. Build the scope:
   - The changed files: `git status --porcelain`, plus `git diff --stat <base>` when a base commit exists.
   - A summary of the change in a few lines.
   - The dependencies the user approved for this version, or "none".
   - For each member, the findings you rejected in earlier rounds, with reasons.
2. Spawn all eight members in one message so they run in parallel. Give each this prompt, filled in:
   ```
   PRD: plans/PRD-V<n>.md
   Round: <k>
   Scope:
   <changed files>
   Summary: <summary>
   Approved dependencies: <list or "none">
   Previously rejected findings: <list with reasons, or "none">
   Follow .claude/skills/council-review/member-contract.md.
   ```
3. If a reply breaks the output format in `member-contract.md`, send it back to that member once to reformat. A member that still gives no valid verdict counts as `FAIL`.
4. Apply the rule: any finding is a `FAIL`, whatever the member's verdict line says. The council passes only when all eight members return `PASS` with `FINDINGS: none`.
5. Dedupe the findings. Merge any that name the same `file:line` and the same fix, and credit every member that raised it. When two findings conflict, keep both and mark them `CONFLICT` for the organizer to decide.
6. Reject a finding only if it contradicts the PRD or `CLAUDE.md`, or cites code that doesn't exist. Record the reason. Never reject a finding because fixing it is inconvenient.
7. Report:
   ```
   COUNCIL: PASS | FAIL (round <k>)
   | Member | Verdict | Score | Findings |
   |---|---|---|---|
   | code-cleanliness | FAIL | 7/10 | 2 |
   ...
   FINDINGS (deduped):
   F1. [code-cleanliness, minimalism] <path>:<line> - Problem: ... Fix: ...
   REJECTED:
   - [member] <finding> - <reason>
   ```
