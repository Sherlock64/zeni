# Model sheet

The one place that says which model and effort each role runs on. Agent files carry no `model:` line; whoever starts a run or spawns a subagent takes it from here (`start_session` `model` and `effort`, the Agent tool's `model`), always, never a default. Change one row at a time, at the weekly reset, so its effect on cost per ticket and escapes per station shows (`stations/learn.md`).

| Role | Model | Effort | Why |
|---|---|---|---|
| Dispatcher (`/factory`) | Opus (`claude-opus-5-5`) | high | starts every run; `start_session` caps a run's model and effort at the caller's, so Opus/high rows need an Opus/high dispatcher |
| Intake | Sonnet | medium | sorting is cheap to correct |
| Shape and slice | Opus | high | product decisions and the ticket cut |
| Build owner | Opus | high | holds the ticket's design |
| Build subagents | Sonnet | medium | narrow briefs from the owner |
| Verifier subagent | Sonnet | medium | drives the app, records evidence (spawned by the Build owner) |
| Review lead | Opus | high | weighs the seats' findings, checks each blocker |
| Review: Spec | Opus | high | judges the change against the ticket |
| Review: Security | Opus | high | misses are the costliest |
| Review: Standards, Experience, Pipeline | Sonnet | medium | rubric checks |
| Merge, Release | Sonnet | medium | mechanical |
| Learn, digest | Sonnet | medium | tallies and summaries |
| Watchdog | Haiku (`claude-haiku-5-5`) | low | reads usage, writes one file |

## Log

| Date | Change | Reason | Effect seen |
|---|---|---|---|
| 2026-11-21 | Starting sheet | spine design | — |
| 2026-11-25 | Review lead row added at Opus, high (what it ran on); Verify becomes the Verifier subagent row | #170, #197 (#208) | — |
| 2026-11-28 | Dispatcher from Sonnet, medium to Opus, high | Opus/high runs started by the Sonnet/medium dispatcher came up as Sonnet/medium; Sonnet dispatcher misread state (#226) | — |
