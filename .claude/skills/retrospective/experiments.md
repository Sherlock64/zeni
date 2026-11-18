# Workflow experiments

Rules on trial. The next retrospective checks each one against its metric and recommends keep, adjust or back out; the user decides. Move a decided rule to "Decided" with the outcome and date.

Baseline: V6 (2026-11-18), organizer 9.1M weighted of 34.3M total; 258 organizer requests; 108 agent wake-ups; ~95k tokens of agent reports in the organizer's context. Source: #96.

## Open

| ID | Rule (where) | Expected effect | Metric to check | Watch for |
|---|---|---|---|---|
| E1 | Devs write the full report to `snapshots/V<n>/reports/<task>.md` and reply with one line (`dev-contract.md` rules 10-11) | Organizer context grows ~1.4k tokens less per report | Organizer weighted tokens; size of agent replies in the transcript | Missed `NEEDS` or `BLOCKED` because the organizer didn't open a file |
| E2 | Council members write `council-<member>-r<k>.md` and reply with one line; members gain `Write` for that file only (`member-contract.md`, council agents' `tools`) | Same as E1 for council rounds | As E1, per council round | A member writing any file other than its report; aggregation errors |
| E3 | `council-review` step 4 reads only verdict lines and blocking findings via one grep; non-blocking findings appended by shell | Non-blocking findings never enter the organizer's context | Organizer tokens per council round | Surprising findings not verified; mis-rated severities slipping through |
| E4 | One-line acknowledgements with no tool calls while a wave or round runs (`build-version` 2.2, `council-review` 3) | Cheaper wake-ups | Organizer output tokens and tool calls per wave | The user losing track of progress |
| E5 | Fixed reply formats to the user (`build-version` "Replies to the user") | Readability; fewer long replies | User corrections or questions about status | Missing detail the user wanted |
| E6 | Post-PR work starts in a fresh session from `snapshots/V<n>/state.md` (`build-version` 6.7) | Post-PR phase starts at ~30k context instead of ~250k | Organizer tokens for post-PR work (V6: ~3.3M) | Lost context, re-reading, decisions re-asked |
| E7 | Non-blocking findings are never folded into fix tasks (`build-version` 5.4) | Smaller fix waves and re-reviews | Fix-wave and re-review tokens; findings left open | Cheap fixes deferred that cost more later |

Open question for E4: can waves run as synchronous parallel subagents (one result per wave) in the CLI? Not available in the desktop app's Agent tool as of 2026-11-18.

## Decided

None yet.
