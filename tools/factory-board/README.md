# Factory board

A live view of Zeni's agent factory: the spine board, epic progress, tokens, the traffic light with its usage windows and resume countdown, needs-human items and retro links. Factory tooling only; it never ships with the app. Until the collector lands it shows only what writers append; `--simulate` shows fake data. No dependencies beyond Node (22+).

## Run

From the repo root:

```bash
node tools/factory-board/server.js --simulate
```

Open <http://127.0.0.1:4317/>. `--simulate` starts the simulator beside the server, and the board then shows the simulator's own file, `tools/factory-board/state/sim-events.jsonl` (gitignored), never the real one. Without it the board reads the real, shared events file:

```bash
node tools/factory-board/server.js
```

Env: `PORT` (default `4317`), `EVENTS` (the real file; default `$(git rev-parse --git-common-dir)/factory/events.jsonl`, beside the other local factory state, so every worktree sees the same file; `tools/factory-board/state/events.jsonl` outside git), `SIM_EVENTS` (the simulator's file), `SPEED` (simulator only; `2` runs twice as fast). `simulate.js` refuses to run when its file is the real one.

Self-checks: `node --test tools/factory-board/*.check.js`. `scripts/check.sh fast` runs them, so every gate does.

## How data flows

```
writers (watchdog, runs)            (--simulate: simulate.js writes state/sim-events.jsonl instead)
   │ append one JSON object per line
   ▼
factory/events.jsonl ► server.js (127.0.0.1 only) ──► SSE /api/stream ──► index.html
                        folds events with state.js       full view on       animates the diff
                                                         every change       (FLIP)
```

- **Writers append** events to one JSONL file. The file is the contract: the future watchdog and runs append the same lines. Truncating the file starts over (the server notices it shrank).
- **The server** folds events into state (`state.js`, `apply`), derives the view (`view`) and pushes the whole view to every open page over server-sent events. Malformed lines are skipped with a warning. It binds `127.0.0.1` only.
- **The page** keeps one DOM node per card and per token row and moves them; a FLIP animation makes cards fly between columns and rows slide. `prefers-reduced-motion` turns animation off.
- It answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>` (403 otherwise).
- Routes: `/` the page, `/api/stream` (SSE), `/api/snapshot` (the current view as JSON). Later pages (epic detail, run history, trust dial) get their own `/api/...` routes that compute from the same state when opened.

## Message format (v1)

One JSON object per line. Every event has `v: 1`, `ts` (ISO 8601 time) and `type`. Values are absolute, not deltas, so replaying or repeating an event is safe.

| `type` | Fields | Meaning |
|---|---|---|
| `reset` | | Forget everything before this line. |
| `item.upsert` | `id`, `kind` (`epic` \| `ticket` \| `pr`), `title`, `state`, `number?`, `epic?` (parent epic `id`) | Create or replace a board card. |
| `item.state` | `id`, `state` | The card moves to that column. |
| `item.remove` | `id` | Drop a card (closed, merged into another). |
| `run.tokens` | `run`, `session` (Claude session name), `tokens` (integer total so far), `item?`, `station?` | A run's token total. The newest run of an item is its current session. |
| `light` | `light`, `reason`, `set_at`, `resume_at` (null unless red), `slots` (0-3), `pace`, `five_hour: {pct, resets_at?}`, `weekly: {pct, resets_at?}`, `sessions?` | The watchdog's whole state, the traffic light (below). Each one replaces the last. |
| `needs_human.open` | `id`, `session`, `question`, `item?` | An eject: which Claude session to open, and the one-line question. |
| `needs_human.clear` | `id` | The human answered. |
| `factory_run.start` | `id` | A factory run began. |
| `factory_run.end` | `id`, `retros: [{title, href}]` | It ended, with links to its retros (may be empty). |

`state` is one of `intake`, `shaping`, `ready`, `building`, `verifying`, `reviewing`, `merged`, `released`, `needs-human`.

### The traffic light

The watchdog is stateless: each check it writes one `light` event, the word plus what the board shows beside it. Runs read only `light` at each pivot and decide for themselves what it means for them. The real watchdog may keep it as a small light file too; the event's fields are that file's content.

| `light` | Set when | Meaning |
|---|---|---|
| `green` | 5-hour under 70% | new runs may start, up to `slots` at once |
| `yellow` | 5-hour 70-89% | nothing new starts; each run finishes its station or checkpoints |
| `red` | 5-hour 90%+, or weekly 97%+ | everything checkpoints and stops; `resume_at` is that window's reset |
| `off` | you ran the shutdown skill | as red, until you run the start skill; a window reset does not turn it back on |

- Only the 5-hour window sets the light. It moves toward green only at a window reset, so it never flaps, and it leaves red only when both windows allow it. `reason` names the window that set it ("5-hour 82%").
- The weekly window paces run slots instead: `pace` = weekly used ÷ the straight-line target (0% at the week's start to 97% at its reset). Pace up to 1.0 gives 3 slots, over 1.0 gives 2, over 1.1 gives 1, over 1.2 gives 0. At weekly 97%+ the light is red until the weekly reset.
- Shutdown: "now" writes red, then off; "drain" writes yellow until no run is in flight, then off.
- Fail safe: a light whose `set_at` is more than 45 minutes old counts as yellow. The board shows it as "yellow (stale)" with the last real word.
- `sessions` lists the Claude session names the watchdog sees; the board shows them beside the run slots.

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
