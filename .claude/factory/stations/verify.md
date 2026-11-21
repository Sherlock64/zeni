# Verify

**Outcome:** proof, from someone who didn't write the code, that the ticket works in the real app.

**Done when:** every acceptance criterion has a passing test or captured evidence, and the evidence is linked from a PR comment. Then set `state:reviewing`. A criterion that fails sends the ticket back to `state:building` with the failing step and its evidence.

## Who

A fresh verifier subagent with no shared context. Give it only the ticket, the branch and this guide. It doesn't read the build run's comments until it has its own result.

## How

- Run `scripts/check.sh integration --evidence snapshots/t<issue>/evidence.yaml` in the ticket's worktree. Every `CHECK ...: fail` sends the ticket back.
- Drive the real dev build (`pnpm tauri dev`, dev database only, never the real one) through each criterion as a user would, at 800x600 and 1920x1080. Use a seeded dev database with 1,000+ transactions so slowness shows. When the ticket touches categorization or Ollama, use real Ollama.
- Until tauri-driver and the seeding step exist (a filed request), drive what you can with `scripts/snapshot.sh` against the mocked-IPC build, and list each `runtime` criterion you couldn't drive as a manual check in the PR comment. Say plainly which criteria were driven and which weren't.
- Capture what you saw: screenshots, timings, logs. Keep files in `snapshots/t<issue>/` (gitignored) and summarize them in the PR comment.
- Look past the criteria for what a user would hit in the same flow: a dead end, a missing loading, empty or error state, a slow screen. Those are findings for Review, not reasons to fail Verify.

`pnpm tauri dev` needs port 1420, so only one run can drive the real app at a time. If it's taken, checkpoint and say so; the dispatcher retries later.

## Eject when

- the app can't be started or seeded on this machine;
- verifying would touch the real database or a real keyring item.

## Pointers

Snapshots: `guides/ui.md`. Next: `stations/review.md`.
