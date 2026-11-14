---
name: council-review
description: Convene Zeni's review council on a change. Spawns all eight council-* members in parallel, aggregates their severity-rated findings into one table, dedupes them, and decides PASS (no critical, high or blocking medium) or FAIL. Use when a version's dev work is done and needs review, or when the user asks for a council review.
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
   - The UI snapshots from this round: each PNG path with the route and state it shows, or "none" if no UI changed.
   - The dependencies the user approved for this version, or "none".
   - For each member, the findings you rejected in earlier rounds, with reasons.
2. Spawn all eight members in one message so they run in parallel. Give each this prompt, filled in:
   ```
   PRD: plans/PRD-V<n>.md
   Round: <k>
   Scope:
   <changed files>
   Summary: <summary>
   Snapshots:
   <path - route, state; or "none">
   Approved dependencies: <list or "none">
   Previously rejected findings: <list with reasons, or "none">
   Follow .claude/skills/council-review/member-contract.md.
   ```
3. If a reply breaks the output format in `member-contract.md`, send it back to that member once to reformat. A member that still gives no valid verdict counts as `FAIL`.
4. Recompute each member's verdict from its findings with the rule in `member-contract.md`, whatever its verdict line says.
5. Check each severity against the scale in `member-contract.md`. Change a rating only when it plainly contradicts the scale, and record the old rating and the reason. Never lower a rating because fixing it is inconvenient.
6. Dedupe the findings. Merge any that name the same `file:line` and the same fix, keep the highest severity, and credit every member that raised it. When two findings conflict, keep both and mark them `CONFLICT` for the organizer to decide.
7. Reject a finding only if it contradicts the PRD or `CLAUDE.md`, or cites code that doesn't exist. Record the reason. Never reject a finding because fixing it is inconvenient.
8. The council passes when no finding left after steps 5-7 is `CRITICAL`, `HIGH` or blocking `MEDIUM`. Report:
   ```
   COUNCIL: PASS | FAIL (round <k>)
   | Member | Verdict | Critical | High | Medium (blocking) | Medium | Low |
   |---|---|---|---|---|---|---|
   | code-cleanliness | FAIL | 0 | 1 | 0 | 1 | 2 |
   ...
   BLOCKING (deduped, most severe first):
   F1. [HIGH] [code-cleanliness, minimalism] <path>:<line> - Problem: ... Fix: ...
   NON-BLOCKING:
   F4. [LOW] [ui-design] <path>:<line> - Problem: ... Fix: ...
   RE-RATED:
   - F2 [member] MEDIUM non-blocking -> HIGH - <reason>
   REJECTED:
   - [member] <finding> - <reason>
   ```
