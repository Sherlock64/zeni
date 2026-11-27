# Verifier

**Outcome:** proof, from someone who didn't write the code, that the ticket works in the real app.

**Done when:** every acceptance criterion has a passing test or captured evidence, each `runtime` criterion is in the evidence manifest as `pass`, `fail` or `open`, `scripts/check.sh fresh` prints `FRESH`, and one PR comment holds the result. Then report pass or fail to the Build owner, who keeps the ticket in Build on a fail.

## Who

A fresh subagent the Build owner spawns (`stations/build.md`, "Before Review") when `scripts/check.sh scope` prints `full` or the ticket has a `runtime` criterion. It gets only the ticket, the branch and this guide, and doesn't read the build run's comments until it has its own result.

## How

- Run `scripts/check.sh integration --evidence snapshots/t<issue>/evidence.yaml` in the ticket's worktree. Every `CHECK ...: fail` is a fail.
- Drive the real app with the `verify-zeni` skill (`.claude/skills/verify-zeni/SKILL.md`): it builds the debug app on a throwaway data folder, completes setup, imports the 1,200-row seed file and screenshots and times every page at 800x600 and 1920x1080. For the ticket's own criteria, drive further with a copy of `scripts/verify/run.ts` kept in `snapshots/t<issue>/`. When the ticket touches categorization or Ollama, use real Ollama. A `runtime` criterion you couldn't drive is `open`, never `pass`.
- Append each `runtime` criterion to the manifest (later `integration` runs keep it):

  ```yaml
  runtime:
    - criterion: 6
      outcome: open
  ```

- `scripts/check.sh fresh snapshots/t<issue>/evidence.yaml` must print `FRESH`. It lists each `OPEN` criterion, and fails on a failed one or on a manifest that names another ticket than the branch's.
- Capture what you saw: screenshots, timings, logs, in `snapshots/t<issue>/` (gitignored). Real-app screenshots stay local; only the Build owner's mocked-fixture snapshots go on the `evidence` branch (`guides/ui.md`).
- Look past the criteria for what a user would hit in the same flow: a dead end, a missing loading, empty or error state, a slow screen. Those are findings for Review, not reasons to fail.
- Post one PR comment, first line `Verifier <pass|fail> for #<issue> on <sha>.` (this ticket, the head you checked), then the driven and the `open` criteria by name, then the summary.

`verify-zeni` uses tauri-driver's port 4444 and the screen's keyboard (xdotool), so only one verifier can drive the app at a time. If it's taken, report that to the owner, who checkpoints.

## Fail, not pass, when

- the app can't be started or seeded on this machine;
- verifying would touch the real database or a real keyring item.

Say which in the report; the owner ejects.
