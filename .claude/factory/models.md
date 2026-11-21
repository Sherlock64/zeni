# Model sheet

The one place that says which model and effort each role runs on. Agent files carry no `model:` line; whoever starts a run or spawns a subagent takes it from here (`start_session` `model` and `effort`, the Agent tool's `model`). Change one row at a time, at the weekly reset, so its effect on cost per ticket and escapes per station shows (`stations/learn.md`).

| Role | Model | Effort | Why |
|---|---|---|---|
| Dispatcher (`/factory`) | Sonnet (`claude-sonnet-5-5`) | medium | reads state, follows rules |
| Intake | Sonnet | medium | sorting is cheap to correct |
| Shape and slice | Opus (`claude-opus-5-5`) | high | product decisions and the ticket cut |
| Build owner | Opus | high | holds the ticket's design |
| Build subagents | Sonnet | medium | narrow briefs from the owner |
| Verify | Sonnet | medium | drives the app, records evidence |
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
