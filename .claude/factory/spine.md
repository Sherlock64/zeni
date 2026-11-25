# The spine

Every run reads this first, then its station guide in `stations/`. `CLAUDE.md` holds the product's coding rules; this page holds how work moves.

## Units

The GitHub issue number ties them together: it is in the branch, the PR's `Closes #n`, the ticket comments and the changelog bullet.

| Unit | What it is | Where it lives |
|---|---|---|
| Request | Anything raw: an idea, a bug, a roadmap line, a review finding, a retro item | issue labelled `state:intake` |
| Epic | One feature, named without a version ("Accounts and debts"). Its body is the spec | parent issue |
| Ticket | One thin end-to-end slice: behaviour, acceptance criteria, the modules it touches, "blocked by" links. No file paths or code | sub-issue of its epic, or standalone |
| Run | One session doing one station on one ticket, then ending | a session, one worktree, one ticket comment |
| PR | One ticket's change to `main`, on branch `t<issue>-<words>`, with one `door:` label | GitHub |
| Release | A tag on `main` the user cuts; its version follows the largest door since the last tag | tag, GitHub Release, `CHANGELOG.md` |

## States

Each ticket has exactly one `state:` label: `intake`, `shaping`, `ready`, `building`, `verifying`, `reviewing`, `merged`, `released`, `needs-human`. A run changes the label when its station's done check passes, and nothing important lives only in a session.

- **Ready** means every "blocked by" ticket is closed and nobody claimed it. The ready set is the frontier.
- **Claim**: the dispatcher sets `state:building` and comments `claimed by <session name>` before it starts the run, so runs never claim for themselves. It never starts two tickets that name the same module.
- **Only the dispatcher starts runs.** A run that finishes sets the next state and ends; it never starts the next station's session, so every report comes back to the dispatcher.
- **Waiting on the user** is always `state:needs-human`, with the question or ask as the first line of the ticket's latest comment, so it shows in the board's Needs you. A merge ask (`Merge PR #n? ...`, `stations/merge.md`) is one.
- **Private work** (security findings, anything a public issue would teach an attacker) keeps the same states in the local list `$(git rev-parse --git-common-dir)/factory/private.md`. Its branches, commits and PRs use neutral wording.

## Run start

Before any station step, from the worktree root:

1. Verify, Review and Merge first put the worktree on the ticket's branch: `git fetch origin`, then `git switch --detach origin/t<n>-<words>` (the branch itself may be checked out in the Build worktree).
2. Run `.claude/factory/tools/worktree-check.sh <n> <station>` (station as its guide's file name, `shape-slice` for Shape and slice; `<n>` is `0` for a run without a ticket, such as Learn, Release or Intake of a new request, which then checks only a clean tree at the latest `origin/main`). It removes another ticket's `snapshots/t<m>/` and fails on tracked or untracked changes, or on a `HEAD` that isn't the latest `origin/main` (Build and the other stations, or the ticket's pushed branch for a resumed run) or the ticket's branch (Verify, Review, Merge).
3. On `WORKTREE FAIL`, change nothing: comment the failing line on the ticket, log a `checkpoint` row (Run log) and stop.

## Eject

Any run may stop and hand a decision to the user. It is a normal outcome. Eject on:

- a decision the ticket and epic don't settle that is hard to undo;
- anything irreversible: data, a migration that rebuilds a table, publishing, a dependency, secrets;
- the same check failing twice on one premise;
- work no station guide fits, where an improvised plan would be risky;
- a security-sensitive finding.

To eject: push the branch, set `state:needs-human`, and comment a brief (what happened, the options, your pick and why, the evidence). The next `/factory` takes answered ejects first, in a fresh run.

Inside reversible work, decide and say what you chose. If no guide fits, write a short plan in the ticket comment and go on.

## Traffic light

Read `$(git rev-parse --git-common-dir)/factory/light.json` at every pivot: before a station step, before spawning a subagent, before a commit or push. Read only its `light` word.

| Light | What you do |
|---|---|
| `green` | go on; hand off to a fresh run when your context nears 150k |
| `yellow` | finish the current station if you can within what is left, else checkpoint and stop; no hand-offs |
| `red`, `off` | checkpoint and stop |

A light whose `set_at` is over 45 minutes old, or a missing file, counts as `yellow`. **Checkpoint** = commit and push the work in progress, comment on the ticket where you stopped. Only the dispatcher reads the slot count; only the watchdog writes the file.

**Idle shutdown.** When the light is `yellow` or `red`, no run is in flight and nothing waits on the user, the factory shuts down instead of idling: the dispatcher proposes `/factory-shutdown` (now), and a fresh `/factory-start`, on the dispatcher model in `models.md`, starts it again after the window that held it back resets. Every watchdog wake also wakes the dispatcher, which re-reads its whole context; a fresh start costs one cold read.

## Blocking

A finding blocks only with proof: a failing run or test, a broken `CLAUDE.md` rule, or a bug a user would hit. Small non-blocking fixes go in the same PR; the rest become requests (`state:intake`); nits are listed and never filed.

## Doors

Every PR carries exactly one door label, with one line of reasoning in its body:

| Label | When | Release impact |
|---|---|---|
| `door:one-way` | irreversible (schema that drops data, removed feature, changed setting) or a major UX shift | major |
| `door:two-way` | a new feature or change another change can back out | minor |
| `door:none` | small, low-weight | patch |
| `door:docs` | docs, plans or factory files only | never releases |

## Trust dial

| Level | Meaning |
|---|---|
| 0 Ask | the run proposes; nothing happens without the user's yes |
| 1 Gate | the run does the work; the next station waits for the user's yes |
| 2 Watch | the work moves on; the user reviews afterwards |
| 3 Sample | the work moves on; the user audits about one in five |

| Station | Now | Ceiling |
|---|---|---|
| Intake | 1 | 3 |
| Shape + slice | 0 | 1 |
| Build | 2 | 3 |
| Verify | 2 | 3 |
| Review | 1 | 3 |
| Merge | 0 | 2 |
| Release | 0 | 0 |
| Learn | 1 | 2 |

Every run reads its station's level from the "Now" column above, never from memory. A station moves up one level after 10 clean passes in a row and down one on any escape (a defect it should have caught). The dispatcher proposes each move; the user confirms it.

## Run log

Every run ends with one comment on its ticket: station, outcome, evidence, what's next. Its final report starts with the outcome, then any question for the user, in the first 400 characters (only those reach the dispatcher); detail comes after. It also appends one tab-separated row to `$(git rev-parse --git-common-dir)/factory/runs.tsv`: `ended_at`, `session_id`, `ticket` (`#n`, or `SB-n` for private work), `station`, `outcome` (`done`, `back`, `eject`, `checkpoint`), `note`. Learn and the digest add cost from the transcripts later. Models and effort per role: `models.md`.
