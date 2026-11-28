---
name: factory-start
description: Switch Zeni's factory on, beginning a factory run. Picks up runs that vanished without a checkpoint, starts the watchdog session if it isn't running, sets the traffic light from current usage, opens the factory board, then hands over to /factory. Only the user calls this; nothing starts the factory for them. Use when the user says "/factory-start", "start the factory", or "switch the factory on".
---

# Factory start

Local state: `F=$(git rev-parse --git-common-dir)/factory/`; create it with mode 0700 if missing.

0. **Model.** `get_session` with `self`. If its model or effort isn't the dispatcher row in `.claude/factory/models.md` (runs it starts can't exceed either), say so and stop before writing or starting anything: the user switches models or opens a fresh session.

1. **New factory run.** Write `$F/run.json`: `{"id": "fr-<YYYYMMDD-HHMM>", "started_at": "<ISO time>"}`. The digest covers everything since `started_at`.
2. **Pickup.** For every ticket in `state:building` or `reviewing` with no live run (`list_sessions` with `linked: true`, matched by the `claimed by` comment): if its last comment is a checkpoint, leave it for `/factory` to resume; otherwise look at its branch (`git ls-remote origin t<issue>-*`), comment what is there, and set it back to `state:ready` (keeping the branch) or to the station it reached. List each one for the user.
3. **Light.** Read usage and the linked sessions as steps 1-3 of `.claude/factory/watchdog.md` say, then make the same script call with `--by start` instead of `--by watchdog`. The script writes `$F/light.json` with `"set_by": "start"`; this is the only way `off` turns back on.
4. **Watchdog.** If no linked session named `watchdog` is running, start one: `start_session`, `initiation: "user_asked"`, `name: "watchdog"`, `use_worktree: false`, model and effort from `.claude/factory/models.md`, prompt `Read .claude/factory/watchdog.md and follow it until the light is off.`
5. **Board.** Start the factory board (`tools/factory-board/README.md`) from the main checkout, so it outlives any worktree, unless something already answers on its port; a running one is left alone:

   ```bash
   G=$(git rev-parse --path-format=absolute --git-common-dir); F=$G/factory; R=$G/..; U=http://127.0.0.1:4317
   if curl -s -o /dev/null --max-time 2 "$U/api/snapshot"; then echo "board: already running at $U/"
   else
     (cd "$R" || exit; setsid nohup node tools/factory-board/server.js </dev/null >"$F/board.log" 2>&1 & echo $! >"$F/board.pid")
     if curl -s -o /dev/null --max-time 2 --retry 5 --retry-connrefused --retry-delay 1 "$U/api/snapshot"; then echo "board: started at $U/"
     else rm -f "$F/board.pid"; echo "board: failed to start, see $F/board.log"; fi
   fi
   ```

   `board.pid` exists only when this step started the server; shutdown stops that one and no other. Unless the output says failed, open `http://127.0.0.1:4317/` in your browser pane (`preview_start` with `url`). A failure is that one line to the user; go on.
6. **Go.** Run the `factory` skill.
