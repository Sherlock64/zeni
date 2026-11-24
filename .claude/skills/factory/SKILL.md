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

A child's report is a hint, not the state. Take each item's state from its GitHub label and its last ticket comment, and a run's liveness from `list_sessions`; say an item waits on the user only when its ticket is `state:needs-human`, `get_session` shows its run blocked on a question, or no run is live for it and the user hasn't yet given the yes it needs: the station that just finished is at level 1, or the next station is at level 0 or is Shape and slice, Merge or Release. Where a report and GitHub disagree, say GitHub's state and note the report.

Show the user one short status, in this order:

1. **Needs you**, first and alone at the top: each item as one line with the question or yes it waits on and its link. "Nothing" when empty.
2. Running (of the slot count), the frontier, what the next release holds (version from the doors), private count.

## 2. New input

If the user gave something new, run Intake on it (`stations/intake.md`) before picking work. `release` goes straight to `stations/release.md`. An epic name is a request to shape it (`stations/shape-slice.md`).

## 3. Pick work, in order

1. `state:needs-human` items the user has answered (a reply after the eject brief).
2. Open PRs with failing CI or a "conflicts with main" note: back to their station.
3. Frontier tickets (`state:ready`, every blocker closed), oldest epic first, never two that name the same module, nor one that shares a module with a running ticket.
4. The intake backlog.

## 4. Gate

- Start nothing unless the light is `green` (a stale or missing light counts as `yellow`), and never more runs than `slots` minus those in flight.
- Idle shutdown (`spine.md`): on every turn, including one woken by the watchdog or a run, if the light is `yellow` or `red`, no linked run is in flight and Needs you is "Nothing", propose `/factory-shutdown` (now) to the user instead of waiting for the next wake. Name the reset time to restart at (the `resets_at` of the `five_hour` or `weekly` window in `light.json` whose light isn't `green`; "any time" when no window is non-green, as with a stale light or usage unavailable) and what is left to pick up (frontier, open PRs, intake backlog), then end.
- Trust dial: read each station's level from the "Now" column of the table in `spine.md` every time, never from memory. A station at level 0 lists the work with a one-line brief and waits for the user's yes; at level 1 the run goes, and its next station waits for the user's yes; at level 2 or 3 nothing waits (e.g. with Build and Verify at 2, Verify starts after Build, and Review after Verify, without asking). Shape and slice, Merge and Release never start without the user's yes.

## 5. Start runs

You are the only one who starts runs (`spine.md`). For each picked ticket: claim it (`state:building`, comment `claimed by <session name>`), then `start_session` with `initiation: "user_asked"`, `use_worktree: true`, `branch_name: t<issue>-<words>` (the app may add a prefix or suffix; Build renames it), the model and effort from `.claude/factory/models.md`, and a prompt of only:

```
Ticket #<n>, station <station>. Read .claude/factory/spine.md, then .claude/factory/stations/<station>.md, then the ticket.
```

The `background` names the epic and nothing from this conversation. Don't wait for runs; report what you started and end.

## Trust dial moves

When `stations/learn.md` proposes a move (10 clean passes up, an escape down), show it; on the user's yes, change the table in `spine.md` through a `door:docs` ticket.
