---
name: factory-shutdown
description: Switch Zeni's factory off, ending the factory run, either now (start nothing, in-flight runs checkpoint at their next pivot) or drain (start nothing, in-flight runs finish their current station first). Use when the user says "/factory-shutdown", "stop the factory", "shut down now", or "drain".
argument-hint: "now | drain"
---

# Factory shutdown

Local state: `F=$(git rev-parse --git-common-dir)/factory/`. Ask "now or drain?" only if the user didn't say.

## Now

1. Write `$F/light.json` with `"light": "off"`, `"set_by": "shutdown"`, `"reason": "shutdown now"`. Every run checkpoints and stops at its next pivot.
2. Wait for in-flight runs once: `SendMessage` each live linked run with `notify_when_idle: true` and no message, then end your turn. When they're idle, list each ticket and the last comment it left (where it stopped).
3. Stop the watchdog session (`stop_session`) once the runs are idle.

## Drain

1. Write `$F/light.json` with `"light": "yellow"`, `"set_by": "shutdown"`, `"draining": true`, `"reason": "draining"`. Runs finish their station or checkpoint; the watchdog keeps it no greener than yellow.
2. The watchdog writes `off` once no run is in flight, then stops itself. Tell the user that, and that `/factory-start` switches it back on.

## Then

Offer the `factory-digest` skill for this factory run.
