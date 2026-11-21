---
name: factory
description: Zeni's dispatcher. Reads the factory state from GitHub and the local factory folder, shows where everything stands, runs Intake on any new input, and starts the next runs (one session and worktree per ticket) within the traffic light and trust dial. Holds no work context itself. Use when the user says "/factory", "factory", "what's next", gives the factory an idea, bug, issue or "release", or asks where work stands.
argument-hint: "[idea, bug, #issue, 'release', or an epic name]"
---

# Factory

Read `.claude/factory/spine.md` first. You dispatch; you don't build, review or decide product questions. Local state is in `F=$(git rev-parse --git-common-dir)/factory/`.

## 1. Read the state

- Tickets and epics by state: `gh issue list --state open --label state:<s> --json number,title,labels,body` for each state; the "Blocked by" line in each body.
- PRs: `gh pr list --json number,title,headRefName,labels,statusCheckRollup,reviewDecision`.
- Since the last tag: `git describe --tags --abbrev=0`, then the merged PRs and their doors.
- `$F/light.json` (word, `slots`, `set_at`), `$F/runs.tsv`, and the count of open items in `$F/private.md` (count only, never content).
- Live runs: `list_sessions` with `linked: true`; a ticket in `building`, `verifying` or `reviewing` whose run is gone is a vanished run (`factory-start` picks it up).

Show the user one short status: needs them, running (of the slot count), the frontier, what the next release holds (version from the doors), private count.

## 2. New input

If the user gave something new, run Intake on it (`stations/intake.md`) before picking work. `release` goes straight to `stations/release.md`. An epic name is a request to shape it (`stations/shape-slice.md`).

## 3. Pick work, in order

1. `state:needs-human` items the user has answered (a reply after the eject brief).
2. Open PRs with failing CI or a "conflicts with main" note: back to their station.
3. Frontier tickets (`state:ready`, every blocker closed), oldest epic first, never two that name the same module, nor one that shares a module with a running ticket.
4. The intake backlog.

## 4. Gate

- Start nothing unless the light is `green` (a stale or missing light counts as `yellow`), and never more runs than `slots` minus those in flight.
- Trust dial: a station at level 0 lists the work with a one-line brief and waits for the user's yes; at level 1 the run goes, and its next station waits for the user's yes. Shape and slice, Merge and Release never start without the user's yes.

## 5. Start runs

For each picked ticket: claim it (`state:building`, comment `claimed by <session name>`), then `start_session` with `initiation: "user_asked"`, `use_worktree: true`, `branch_name: t<issue>-<words>`, the model and effort from `.claude/factory/models.md`, and a prompt of only:

```
Ticket #<n>, station <station>. Read .claude/factory/spine.md, then .claude/factory/stations/<station>.md, then the ticket.
```

The `background` names the epic and nothing from this conversation. Don't wait for runs; report what you started and end.

## Trust dial moves

When `stations/learn.md` proposes a move (10 clean passes up, an escape down), show it; on the user's yes, change the table in `spine.md` through a `door:docs` ticket.
