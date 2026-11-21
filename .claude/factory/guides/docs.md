# Docs guide

Load when a ticket changes what `CLAUDE.md`, `README.md`, `docs/` or the factory files (`.claude/`) describe. The ticket owner updates the docs its change makes wrong, in the same PR.

## Files

- `CLAUDE.md`: rules, layout, commands and database facts for coding agents. Add a rule only when the epic or the user sets one; keep every existing rule unless the user removes it. Pair each enforceable rule with its check in `CONSTRAINTS.md`.
- `README.md`: for a developer on Pop!_OS: prerequisites, install, dev run, tests, release build, where the data lives.
- `docs/`: user guides for features the user operates, for a non-developer; `docs/architecture.md` (Mermaid) when modules, pages, stores or main flows change; `docs/glossary.md` for the epic's new terms; `docs/workflow.md` when the factory's flow changes.
- `.claude/`: agents use YAML frontmatter with `name`, `description`, and `tools` only where restricting matters; no `model:` line (`.claude/factory/models.md`). Skills live at `.claude/skills/<name>/SKILL.md` with a `description` that says when to trigger. Each rule lives in one file.

## Rules

1. Verify everything you write: run each command you document, and read the code behind each path, name and behaviour.
2. Document what exists, never planned behaviour.
3. Short imperative sentences, no marketing language. State each fact in one file and link to it from the others.
4. Don't leave `pnpm tauri dev` or `pnpm tauri build` running.
