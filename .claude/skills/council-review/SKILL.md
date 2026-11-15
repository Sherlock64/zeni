---
name: council-review
description: Convene Zeni's review council on a change. Selects the council-* members the change's risk calls for, records the skipped ones in the evidence manifest, spawns the selected ones in parallel, aggregates their severity-rated findings into one table, dedupes them, and decides PASS (no critical, high or blocking medium) or FAIL. Use when a version's dev work is done and needs review, or when the user asks for a council review.
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
| `council-prd-compliance` | Every PRD requirement and acceptance criterion, one by one | Stop and ask at marked checkpoints; branch from `main` with the version naming rule |

## Steps

1. Build the scope:
   - The changed files: the manifest's `changed_files` (`snapshots/V<n>/evidence.yaml`).
   - A summary of the change in a few lines.
   - The requirements: `plans/PRD-V<n>.md`, or for a hotfix (no PRD) the task brief.
   - The contracts path `snapshots/V<n>/contracts.md`, or "none".
   - The UI snapshots: one PNG per distinct state of the changed components only (in a re-review, only the retaken ones), with the route and state each shows, or "none" if no UI changed. Only `council-ui-design`, `council-ux-design` and `council-accessibility` get them; the other members get "none".
   - The dependencies the user approved for this version, or "none".
   - For each member, the findings you rejected in earlier rounds, with reasons.
2. Select the members. In a re-review round, take the set `build-version` step 5.5 gives. Otherwise classify the change by its changed files and by its behaviour, including the transitive callers of changed code (grep them), and take the union of every row that applies:

   | Risk | Applies when | Members |
   |---|---|---|
   | docs-only (record as `routine`) | Only prose changed: `*.md`, `docs/`, `plans/`, `.claude/` | None required; optionally `council-prd-compliance` as a spot check |
   | `routine` | Backend or script code outside the sensitive paths, no new external interface | `council-prd-compliance`, `council-code-cleanliness`, plus `council-minimalism` when code, files or abstractions were added |
   | `ui` | UI code under `src/` (pages, components, hooks, `src/lib/` except `commands.ts`, styles) | `council-prd-compliance`, `council-ux-design`, `council-accessibility`, plus `council-ui-design` when visuals changed |
   | `sensitive` | Any sensitive path below, a new or changed external interface (Tauri command, file format, IPC permission), or a change to how data is stored, imported, exported or deleted | `council-security`, `council-test-quality`, `council-prd-compliance`, `council-code-cleanliness`, plus the `ui` members when UI changed |
   | `cross-cutting` | A major redesign across layers, or members contradicting each other across rounds | All eight |

   Sensitive paths: `src-tauri/src/crypto.rs`, `security.rs`, `keyring.rs`, `accounts.rs`, `imports.rs`, `ofx.rs`, `csv_import.rs`, `db.rs`, `src-tauri/migrations/**`, `src-tauri/capabilities/**`, `src-tauri/tauri.conf.json` (CSP/permissions), `Cargo.toml`/`package.json` deps, and any change to account/routing-number handling or raw-import immutability in any file.

   Escalate one row (to `sensitive`, or from `sensitive` to all eight) on a critical unknown, a security-sensitive dependency, or a blast radius you can't bound. A risk row only picks reviewers: every `CLAUDE.md` rule still applies, and a change that touches what a `CLAUDE.md` security rule covers is `sensitive` whatever its paths.

   Write the `review:` block at the end of the manifest (`scripts/check.sh` keeps it on rewrite): `requirements` (the PRD path or the task brief's items), `risk`, `snapshots`, `reviewers_required`, and `reviewers_skipped` with one `"<member>: <reason>"` per member not selected (in a re-review: `not affected by round <k> fixes`).
3. Spawn the selected members in one message so they run in parallel. Give each this prompt, filled in:
   ```
   Requirements: <plans/PRD-V<n>.md, or "Task brief:" and the brief>
   Round: <k>
   Evidence: snapshots/V<n>/evidence.yaml
   Scope:
   <changed files>
   Summary: <summary>
   Contracts: <path or "none">
   Snapshots:
   <path - route, state; or "none">
   Approved dependencies: <list or "none">
   Previously rejected findings: <list with reasons, or "none">
   Follow .claude/skills/council-review/member-contract.md.
   ```
4. If a reply breaks the output format in `member-contract.md`, send it back to that member once to reformat. A member that still gives no valid verdict counts as `FAIL`.
5. Recompute each member's verdict from its findings with the rule in `member-contract.md`, whatever its verdict line says.
6. Verify each surprising finding in the cited code before rating it. Check each severity against the scale in `member-contract.md`. Change a rating only when it plainly contradicts the scale, and record the old rating and the reason. Never lower a rating because fixing it is inconvenient.
7. Dedupe the findings. Merge any that name the same `file:line` and the same fix, keep the highest severity, and credit every member that raised it. When two findings conflict, keep both and mark them `CONFLICT` for the organizer to decide.
8. Reject a finding only if it contradicts the requirements or `CLAUDE.md`, or cites code that doesn't exist. Record the reason. Never reject a finding because fixing it is inconvenient.
9. Write this report. The council passes when no finding left after steps 6-8 is `CRITICAL`, `HIGH` or blocking `MEDIUM`. Report:
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
10. Append the report to `snapshots/V<n>/council-findings.md`, and set the manifest's `review.blocking_findings` to the `BLOCKING` IDs only, as `R<k>-F<n>`.
