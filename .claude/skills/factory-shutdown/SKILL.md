---
name: factory-shutdown
description: Switch Zeni's factory off, ending the factory run, either now (start nothing, in-flight runs checkpoint at their next pivot) or drain (start nothing, in-flight runs finish their current station first). Use when the user says "/factory-shutdown", "stop the factory", "shut down now", or "drain".
argument-hint: "now | drain"
---

# Factory shutdown

Local state: `F=$(git rev-parse --git-common-dir)/factory/`. Ask "now or drain?" only if the user didn't say. Before writing the light file, note its `five_hour` and `weekly` windows (`light`, `resets_at`) for the closing message.

## Now

1. Write `$F/light.json` with `"light": "off"`, `"set_by": "shutdown"`, `"reason": "shutdown now"`. Every run checkpoints and stops at its next pivot.
2. Wait for in-flight runs once: `SendMessage` each live linked run with `notify_when_idle: true` and no message, then end your turn. When they're idle, list each ticket and the last comment it left (where it stopped).
3. Stop the watchdog session (`stop_session`) once the runs are idle.
4. Archive finished runs, then stop the board (both below).

## Drain

1. Write `$F/light.json` with `"light": "yellow"`, `"set_by": "shutdown"`, `"draining": true`, `"reason": "draining"`. Runs finish their station or checkpoint; the watchdog keeps it no greener than yellow.
2. The watchdog writes `off` once no run is in flight, then stops itself. Tell the user that, and that `/factory-start` switches it back on.
3. Wait for in-flight runs once, as in Now step 2. When they're idle, archive finished runs and stop the board (both below).

## Archive finished runs

After the in-flight runs are idle, archive each linked run session whose station is done (its last ticket comment is a run log, not a checkpoint) with `archive_session`, so the next factory run gets fresh worktrees. Leave checkpointed runs, the watchdog (stopped above or by itself) and any run waiting on the user. Archiving keeps a worktree with uncommitted changes; list each one left (`git worktree list`, paths under `.claude/worktrees/`) with its `git status --short` for the user, and never remove it with `--force`.

## Stop the board

Stop only the board server factory start started: the one in `$F/board.pid`, if that process is still the board.

```bash
P=$F/board.pid
if [ -f "$P" ] && [ "$(tr '\0' ' ' <"/proc/$(cat "$P")/cmdline" 2>/dev/null)" = "node tools/factory-board/server.js " ]; then kill "$(cat "$P")" && echo "board: stopped"; else echo "board: none started by factory start"; fi
rm -f "$P"
```

## Then

Offer the `factory-digest` skill for this factory run.

Close by naming the reset time to restart at: the `resets_at` of the window you noted whose light wasn't `green`, in the user's local time, or "any time" if both were `green`. Say to restart with `/factory-start` in a new session on the dispatcher model (`.claude/factory/models.md`), not in this one.
