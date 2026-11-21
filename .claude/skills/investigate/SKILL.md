---
name: investigate
description: Read-only playbook for answering a question about Zeni's code, data model, behaviour or history with evidence and no code change. Use when the user asks how something works, why it behaves a way, where something lives, or whether something is true, and wants an answer rather than a fix.
---

# Investigate

1. **Scope.** Restate the question in one line and name what would answer it (a code path, a schema, a test, a commit). Ask the user only if the question is ambiguous.
2. **Evidence.** Read the code, migrations, tests and docs that bear on it, starting from `CLAUDE.md` Layout and `docs/`. Run read-only commands (`grep`, `git log`, `git show`, a single `cargo test <filter>` or `pnpm test <path>`) when they settle a point. Record each fact with its `file:line`. Spawn an `Explore` agent only when the search spans many files or naming conventions.
3. **Answer.** Give the direct answer first, then the evidence behind it as `file:line` citations. Mark anything you inferred rather than read. If the answer points to a bug or a missing feature, say so and offer to send it to the factory as a request (`/factory <the bug>`, which runs Intake).

Never edit files, touch git state or start runs.
