---
name: factory-digest
description: Write one digest of the current (or last) Zeni factory run - what shipped, what waits on the user, how the factory did, repeated lessons merged, and at most three proposed changes - as a local HTML page. Use when the user says "/factory-digest", "digest", or asks how the factory run went.
---

# Factory digest

Local state: `F=$(git rev-parse --git-common-dir)/factory/`. The factory run starts at `started_at` in `$F/run.json`.

## Gather, since `started_at`

- Shipped: PRs merged (`gh pr list --state merged --search "merged:>=<date>"`) with doors, and any releases cut.
- Waiting on the user: `state:needs-human` tickets with their eject briefs, PRs at a trust gate.
- How it did: rows of `$F/runs.tsv` (runs per station, outcomes, ejects, sent back), escapes found, and cost per ticket from `.claude/factory/tools/tally.py` on each run's transcript (targeted reads only).
- Lessons: the retros in `$F/retros/` from this factory run. Merge points that repeat; keep the evidence.

## Write

One self-contained HTML page at `$F/digests/<YYYY-MM-DD>-<run id>.html`: no external scripts or fonts, readable at 800px, dark and light. Sections: Summary (three lines), Shipped, Needs you, How the factory did (a table per station), Lessons, Proposed changes (at most three, each preferring a check over more text, with evidence). No secrets, keys, account numbers or recovery codes, even fake ones; private items as a count only.

## Then

Give the user the path and the proposed changes. On their yes, file each change as a request (`state:intake`).
