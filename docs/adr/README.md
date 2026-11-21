# Architecture decision records

An ADR records one technical choice that is surprising or hard to reverse, so later work does not undo it by accident. Routine choices need none.

## When to write one

- Write one when the design check in Shape and slice (`.claude/factory/stations/shape-slice.md`) picks between structurally different designs; it becomes its own ticket.
- Write one for a choice a later reader would question or could not cheaply undo, for example key handling, a schema shape that migrations lock in, or an external interface.
- Do not write one for a choice the code or `CLAUDE.md` already makes obvious.

## File name

`docs/adr/NNNN-<slug>.md`: a four-digit number, one higher than the latest ADR (the first is `0001`), and a short lowercase hyphenated slug, for example `0001-data-key-in-keyring.md`. Never renumber or delete an ADR; supersede it with a new one.

## Template

```markdown
# NNNN: <decision in a few words>

## Context
What forced a choice: the requirement, constraint or problem, with the PRD or version.

## Decision
What was chosen, stated as a fact.

## Alternatives
Each option considered and why it lost.

## Consequences
What this makes easier, harder or impossible, and what would make it worth revisiting.

## Status
Accepted (V<n>), or Superseded by NNNN.
```

- [0001: Derived effective category and polled single job slot](0001-derived-effective-category-and-polled-job-slot.md)
