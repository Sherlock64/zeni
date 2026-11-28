# Model sheet

The one place that says which model and effort each role runs on. Agent files carry no `model:` line; whoever starts a run or spawns a subagent takes it from here (`start_session` `model` and `effort`, the Agent tool's `model`), always, never a default. Change one row at a time, at the weekly reset, so its effect on cost per ticket and escapes per station shows (`stations/learn.md`).

No row is above medium, so every run starts at medium or lower; only the user raises a run's effort, by hand, and a shaped ticket a medium run can't finish ejects to the user (`spine.md`, Eject).

| Role | Model | Effort | Why |
|---|---|---|---|
| Dispatcher (`/factory`) | Opus (`claude-opus-5-5`) | medium | starts every run; `start_session` caps a run's model and effort at the caller's, so its row must be at least every row it starts |
| Intake | Sonnet | medium | sorting is cheap to correct |
| Shape and slice | Opus | medium | product decisions and the ticket cut |
| Build owner | Opus | medium | holds the ticket's design |
| Build subagents | Sonnet | medium | narrow briefs from the owner |
| Verifier subagent | Sonnet | medium | drives the app, records evidence (spawned by the Build owner) |
| Review lead | Opus | medium | weighs the seats' findings, checks each blocker |
| Review: Spec | Opus | medium | judges the change against the ticket |
| Review: Security | Opus | medium | misses are the costliest |
| Review: Standards, Experience, Pipeline | Sonnet | medium | rubric checks |
| Merge, Release | Sonnet | medium | mechanical |
| Learn, digest | Sonnet | medium | tallies and summaries |
| Watchdog | Haiku (`claude-haiku-5-5`) | low | reads usage, writes one file |

## Log

| Date | Change | Reason | Effect seen |
|---|---|---|---|
| 2026-11-21 | Starting sheet | spine design | — |
| 2026-11-25 | Review lead row added at Opus, high (what it ran on); Verify becomes the Verifier subagent row | #170, #197 (#208) | — |
| 2026-11-28 | Dispatcher from Sonnet, medium to Opus, medium (user's call) | Opus runs started by the Sonnet dispatcher came up as Sonnet; Sonnet dispatcher misread state (#226) | — |
| 2026-11-28 | Shape and slice, Build owner, Review lead, Review: Spec, Review: Security from high to medium, at once (user's call) | standing rule: every run starts at medium, the user raises effort by hand (#226) | — |
