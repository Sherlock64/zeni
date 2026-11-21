---
name: factory-start
description: Switch Zeni's factory on, beginning a factory run. Picks up runs that vanished without a checkpoint, starts the watchdog session if it isn't running, sets the traffic light from current usage, then hands over to /factory. Only the user calls this; nothing starts the factory for them. Use when the user says "/factory-start", "start the factory", or "switch the factory on".
---

# Factory start

Local state: `F=$(git rev-parse --git-common-dir)/factory/`; create it with mode 0700 if missing.

1. **New factory run.** Write `$F/run.json`: `{"id": "fr-<YYYYMMDD-HHMM>", "started_at": "<ISO time>"}`. The digest covers everything since `started_at`.
2. **Pickup.** For every ticket in `state:building`, `verifying` or `reviewing` with no live run (`list_sessions` with `linked: true`, matched by the `claimed by` comment): if its last comment is a checkpoint, leave it for `/factory` to resume; otherwise look at its branch (`git ls-remote origin t<issue>-*`), comment what is there, and set it back to `state:ready` (keeping the branch) or to the station it reached. List each one for the user.
3. **Light.** Call `get_usage` and compute the light, pace and slots as `.claude/factory/watchdog.md` says. Write `$F/light.json` with `"set_by": "start"`. This is the only way `off` turns back on.
4. **Watchdog.** If no linked session named `watchdog` is running, start one: `start_session`, `initiation: "user_asked"`, `name: "watchdog"`, `use_worktree: false`, model and effort from `.claude/factory/models.md`, prompt `Read .claude/factory/watchdog.md and follow it until the light is off.`
5. **Go.** Run the `factory` skill.
