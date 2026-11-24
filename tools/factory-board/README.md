# Factory board

A live view of Zeni's agent factory: the spine board, epic progress, tokens, the traffic light with its usage windows and resume countdown, needs-human items and retro links. Factory tooling only; it never ships with the app. Without `--simulate` it collects GitHub every 60 s (below); `--simulate` shows fake data instead. No dependencies beyond Node (22+).

## Run

From the repo root:

```bash
node tools/factory-board/server.js --simulate
```

Open <http://127.0.0.1:4317/>. `--simulate` starts the simulator beside the server, and the board then shows the simulator's own file, `tools/factory-board/state/sim-events.jsonl` (gitignored), never the real one. Without it the board reads the real, shared events file:

```bash
node tools/factory-board/server.js
```

Env: `PORT` (default `4317`), `EVENTS` (the real file; default `$(git rev-parse --git-common-dir)/factory/events.jsonl`, beside the other local factory state, so every worktree sees the same file; `tools/factory-board/state/events.jsonl` outside git), `FACTORY` (the local factory folder the runs part reads; default the folder `EVENTS` defaults into), `PROJECTS` (Claude session transcripts; default `~/.claude/projects`), `SIM_EVENTS` (the simulator's file), `SPEED` (simulator only; `2` runs twice as fast), `GH` (the `gh` binary; default `gh`), `COLLECT_MS` (collect interval; default `60000`). `simulate.js` refuses to run when its file is the real one.

`/factory-start` starts the board this way from the main checkout (so it outlives any worktree) when nothing answers on port 4317, records its pid in `$(git rev-parse --git-common-dir)/factory/board.pid` with output in `board.log` beside it, and opens it in the dispatcher's browser pane; a running board is left alone. `/factory-shutdown` (now, or drain once the runs are idle) stops only the process in `board.pid`, and only if it is still the board.

Self-checks: `node --test tools/factory-board/*.check.js`. `scripts/check.sh fast` runs them, so every gate does.

## Board design (#142)

`directions/chosen.html` is the picked design on fixed fake data (`proto.js`, `proto.css`), page 1 and page 2; epic #131 (Decisions: Design) describes it. The live board (`index.html`) is page 1 of it since #143; page 2 comes with #144 and #145. It is static, not served by `server.js`: run `python3 -m http.server 4318 --bind 127.0.0.1` in `directions/` and open `/chosen.html`. Params: `theme=light|dark`, `light=green|yellow|red|off|stale`, `nh=0`; `#p2` opens page 2.

## How data flows

```
writers (collect.js, watchdog, runs) (--simulate: simulate.js writes state/sim-events.jsonl instead)
   │ append one JSON object per line
   ▼
factory/events.jsonl ► server.js (127.0.0.1 only) ──► SSE /api/stream ──► index.html
                        folds events with state.js       full view on       animates the diff
                                                         every change       (FLIP)
```

- **Writers append** events to one JSONL file. The file is the contract: the future watchdog and runs append the same lines. Truncating the file starts over (the server notices it shrank).
- **The collector** (`collect.js`, GitHub part) runs inside the server while it is open, without `--simulate`: once at start, then every `COLLECT_MS`. One `gh api graphql` pass reads every issue (open or closed) and every open PR carrying a `state:` label, then appends only the events that differ from the folded state, so a collect that finds no change appends nothing and a restart does not repeat the file. Cards are `#<number>`: an issue with sub-issues is an `epic`, an issue's sub-issue parent is its `epic`, an open PR is a `pr`. An issue or PR that loses its `state:` label, or a PR that merges or closes, gets `item.remove`. A `state:needs-human` issue also gets `needs_human.open` (`nh-#<number>`) with the session from its latest "claimed by <session>" comment (`unknown` if none), the first line of its latest comment as the question, and that comment's link; it clears when the label goes. When `gh` is missing or fails, nothing is appended, the board keeps its last state and shows "GitHub unavailable".
- **The collector, runs part** (`runs.js`) runs in the same tick, even when `gh` fails, and also appends only changes. Each `runs.tsv` row becomes a `run.tokens` run (`<session_id>@<ended_at>`) with its ticket, station, the session's title and model from its transcript (`$PROJECTS/*/<session_id>.jsonl`), and its weighted tokens from `.claude/factory/tools/tally.py` (subagents included; re-tallied only when a transcript changes). A row whose transcript is missing shows with tokens `null` ("unknown"); a missing run log shows no runs. `run.json` gives the current factory run (`factory_run.start` with its `started_at`); it ends when `light.json` turns `off` (at its `set_at`) or a new `run.json` replaces it (at the new start), and a digest `digests/*-<run id>.html` shows as its link, served at `/digests/<file>`. It touches only `fr-YYYYMMDD-HHMM` runs.
- **The server** folds events into state (`state.js`, `apply`), derives the view (`view`) and pushes the whole view to every open page over server-sent events. Malformed lines are skipped with a warning. It binds `127.0.0.1` only.
- **The page** (`index.html`, its logic in `page.js`, checked by `page.check.js`) is page 1 of the chosen design: the status band, then the board as one kanban or as lanes by epic (the switch is remembered in `localStorage`, key `board.mode`), always all nine spine columns; a needs-human card carries its question, session and latest comment link. It follows the system theme; `?theme=light|dark` forces one. It keeps one DOM node per card and per token row and moves them; a FLIP animation makes cards fly between columns and rows slide. `prefers-reduced-motion` turns animation off.
- It answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>` (403 otherwise).
- Routes: `/` the page, `/page.js` its logic, `/api/stream` (SSE), `/api/snapshot` (the current view as JSON, with every run newest first in `runs`, plus `github: {ok, error, checked_at}`, the collector's last result), `/digests/<file>.html` (a digest from the factory folder; not with `--simulate`). Later pages (epic detail, run history, trust dial) get their own `/api/...` routes that compute from the same state when opened.

## Message format (v1)

One JSON object per line. Every event has `v: 1`, `ts` (ISO 8601 time) and `type`. Values are absolute, not deltas, so replaying or repeating an event is safe.

| `type` | Fields | Meaning |
|---|---|---|
| `reset` | | Forget everything before this line. |
| `item.upsert` | `id`, `kind` (`epic` \| `ticket` \| `pr`), `title`, `state`, `number?`, `epic?` (parent epic `id`) | Create or replace a board card. |
| `item.state` | `id`, `state` | The card moves to that column. |
| `item.remove` | `id` | Drop a card (closed, merged into another). |
| `run.tokens` | `run`, `session` (Claude session name), `tokens` (integer total so far, or `null` when unknown), `item?`, `station?`, `model?` | A run's token total. The newest run of an item is its current session. |
| `light` | `light`, `reason`, `set_at`, `resume_at` (null unless red), `slots` (0-3), `pace`, `five_hour: {pct, resets_at?}`, `weekly: {pct, resets_at?}`, `sessions?` | The watchdog's whole state, the traffic light (below). Each one replaces the last. |
| `sessions` | `sessions: [{name, running, context_pct}]` (`context_pct` 0-100 or null) | The watchdog's linked sessions with each one's context window %. Each one replaces the last; the board shows them beside the run slots. |
| `needs_human.open` | `id`, `session`, `question`, `item?`, `href?` (link to the latest comment) | An eject: which Claude session to open, and the one-line question. |
| `needs_human.clear` | `id` | The human answered. |
| `factory_run.start` | `id`, `started_at?` (default `ts`) | A factory run began. |
| `factory_run.end` | `id`, `retros: [{title, href}]`, `ended_at?` (default `ts`) | It ended, with links to its retros or digest (may be empty). Repeating it with more retros keeps `ended_at`. |

`state` is one of `intake`, `shaping`, `ready`, `building`, `verifying`, `reviewing`, `merged`, `released`, `needs-human`.

### The traffic light

`light.js` computes it. The watchdog (`.claude/factory/watchdog.md`) and factory start each make one call per reading, passing what only the Claude app knows on stdin:

```bash
node tools/factory-board/light.js --by watchdog <<'EOF'
{"five_hour": {"pct": 41, "resets_at": "2026-11-24T05:10:00Z"}, "weekly": {"pct": 22, "resets_at": "2026-11-30T23:00:00Z"},
 "sessions": [{"name": "t141-light-script", "running": true, "context_pct": 34}]}
EOF
```

It reads the last light file, writes `$(git rev-parse --git-common-dir)/factory/light.json` atomically (temp file, then rename), appends one `light` and one `sessions` event, and prints `{"light", "reason", "wake_s"}` (seconds to the next watchdog wake: 1200 green, 600 yellow, the reset on red, clamped to 60-3600; `null` when off). Each window also records its own `light`, which holds until that window resets. Missing or malformed usage writes `yellow`, "usage unavailable". With `--by watchdog` an `off` light is left as it is; `--by start` turns it back on and ends a drain. `light.check.js` covers the worked examples in epic #131. Runs read only `light` at each pivot and decide for themselves what it means for them.

| `light` | Set when | Meaning |
|---|---|---|
| `green` | 5-hour under 70% | new runs may start, up to `slots` at once |
| `yellow` | 5-hour 70-89% | nothing new starts; each run finishes its station or checkpoints |
| `red` | 5-hour 90%+, or weekly 97%+ | everything checkpoints and stops; `resume_at` is that window's reset |
| `off` | you ran the shutdown skill | as red, until you run the start skill; a window reset does not turn it back on |

- Only the 5-hour window sets the light. It moves toward green only at a window reset, so it never flaps, and it leaves red only when both windows allow it. `reason` names the window that set it ("5-hour 82%").
- The weekly window paces run slots instead: `pace` = weekly used ÷ the straight-line target (0% at the week's start to 97% at its reset). Pace up to 1.0 gives 3 slots, over 1.0 gives 2, over 1.1 gives 1, over 1.2 gives 0. In the first 24 hours after the weekly reset pace is 0 (3 slots), since a few percent early reads as a large pace. At weekly 97%+ the light is red until the weekly reset.
- Shutdown: "now" writes off; "drain" writes yellow with `draining: true`, and the script keeps it no greener than yellow until no session other than `watchdog` is running, then writes off.
- Fail safe: a light whose `set_at` is more than 45 minutes old counts as yellow. The board shows it as "yellow (stale)" with the last real word.
- `sessions` in a `light` event lists the running sessions' names; the board shows the `sessions` event's list with context % when it has one.

"Factory run" is not defined yet; it is only `factory_run.start` / `.end` with a retro list, so it is easy to change once the spine settles it. Retro links must be `http(s)` or relative; anything else shows as plain text.

Example:

```json
{"v":1,"ts":"2026-11-20T10:00:00Z","type":"item.upsert","id":"T212","kind":"ticket","number":212,"title":"Debt account type","state":"ready","epic":"E102"}
{"v":1,"ts":"2026-11-20T10:00:05Z","type":"item.state","id":"T212","state":"building"}
{"v":1,"ts":"2026-11-20T10:00:06Z","type":"run.tokens","run":"r212-build-1","session":"t212-build-debt-account","item":"T212","station":"build","tokens":8400}
{"v":1,"ts":"2026-11-20T10:01:00Z","type":"needs_human.open","id":"nh-212","item":"T212","session":"t212-build-debt-account","question":"Basis points or percent string?"}
{"v":1,"ts":"2026-11-20T10:02:00Z","type":"light","light":"red","reason":"5-hour 91%","resume_at":"2026-11-20T10:47:00Z","set_at":"2026-11-20T10:02:00Z","slots":2,"pace":1.04,"five_hour":{"pct":91,"resets_at":"2026-11-20T10:47:00Z"},"weekly":{"pct":44,"resets_at":"2026-11-24T08:00:00Z"},"sessions":["t212-build-debt-account"]}
```

## What the simulator fakes

On start it truncates its own file and emits `reset`; then it loops a fake factory run (about 3 minutes at `SPEED=1`), each cycle putting the same cards back at their start columns:

- Three fake epics, **Foundations** (#201-204), **Accounts and debts** (#211-215) and **Budgets** (#221-222, stays in intake), with tickets moving station by station, at most 3 runs at once. A PR card (#3xx) appears at review and is removed when its ticket merges.
- Each station is a new run with its own session name (`t212-build-debt-account`); active runs burn tokens, so the top-10 list re-sorts.
- Weekly starts a little ahead of its target (pace about 1.06, 2 slots) and drops to 1 slot as the cycle's runs add to it.
- The light walks green → yellow (5-hour 70%) → red (90%, a 30 s countdown to the window reset) → green. Then the watchdog "dies": it writes one light dated 45 minutes ago minus a few seconds and goes quiet for 16 s, so the board shows it go stale. Once five tickets have merged, a shutdown drain sets yellow until no run is in flight, then off; the run ends, and the next cycle starts green. On yellow only reviews may merge; on red and off nothing moves or burns tokens.
- One building ticket ejects to needs-human with a question, and clears about 15 s later.
- When the two live epics are merged they are released, and the run ends with two fake retro links (they 404).
