// The board page's logic, without the DOM: index.html renders what these return; page.check.js tests them.
export const STATES = ["intake", "shaping", "ready", "building", "verifying", "reviewing", "merged", "released", "needs-human"];
export const LABEL = { "needs-human": "needs human" };
export const ACTIVE = ["building", "verifying", "reviewing", "needs-human"]; // states that hold a run slot
export const MODE_KEY = "board.mode";
const MIN = 60e3;
const STALE_MS = 45 * MIN; // fail safe: an older light counts as yellow

export function readMode(storage) {
  try {
    return storage.getItem(MODE_KEY) === "lanes" ? "lanes" : "kanban";
  } catch {
    return "kanban"; // storage blocked
  }
}

export function safeHref(h) {
  try {
    return ["http:", "https:"].includes(new URL(h, "http://127.0.0.1/").protocol) ? h : null;
  } catch {
    return null;
  }
}

// Columns for one kanban (one row) or lanes by epic (a row per epic, then "No epic"); always all nine states.
// A needs-human item carries `ask`; one whose card is missing still shows, as its own card.
export function boardModel(snap, mode) {
  const asks = new Map(snap.needsHuman.map((n) => [n.item, n]));
  const ids = new Set(snap.items.map((i) => i.id));
  const orphans = snap.needsHuman.filter((n) => !ids.has(n.item)).map((n) => ({ id: n.id, kind: "ticket", title: n.item ?? "unknown item", state: "needs-human", number: null }));
  const items = [...snap.items, ...orphans]
    .map((i) => {
      const n = asks.get(i.id) ?? snap.needsHuman.find((x) => x.id === i.id);
      return n ? { ...i, ask: { session: n.session, question: n.question, href: safeHref(n.href) } } : i;
    })
    .sort((a, b) => (b.kind === "epic") - (a.kind === "epic") || (a.number ?? Infinity) - (b.number ?? Infinity));
  const shown = mode === "lanes" ? items.filter((i) => i.kind !== "epic") : items; // in lanes the epic is the lane
  const cells = (list) => STATES.map((state) => ({ state, items: list.filter((i) => i.state === state) }));
  const heads = STATES.map((state) => ({ state, label: LABEL[state] ?? state, count: shown.filter((i) => i.state === state).length }));
  if (mode !== "lanes") return { heads, rows: [{ epic: null, cells: cells(shown) }] };
  const epicIds = new Set(snap.epics.map((e) => e.id));
  return {
    heads,
    rows: [
      ...snap.epics.map((epic) => ({ epic, cells: cells(shown.filter((i) => i.epic === epic.id)) })),
      { epic: null, cells: cells(shown.filter((i) => !epicIds.has(i.epic))) },
    ],
  };
}

export const MEANING = {
  green: "New runs may start.",
  yellow: "Nothing new starts; each run finishes its station or checkpoints.",
  red: "Everything checkpoints and stops.",
  off: "Stopped until you run the start skill.",
};

export const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

// The light as the board shows it, stale rule included.
export function lightView(l, now) {
  if (!l) return { word: "off", stale: false, label: "no light", reason: "", meaning: "The watchdog has not written a light yet.", resume: "", age: "" };
  const age = now - Date.parse(l.set_at);
  const stale = !(age <= STALE_MS); // a bad set_at counts as stale too
  const word = stale ? "yellow" : l.light;
  return {
    word,
    stale,
    label: stale ? "yellow (stale)" : word,
    reason: stale ? `Last light: ${l.light}, ${l.reason}` : l.reason,
    meaning: MEANING[word] ?? "",
    resume: (word === "red" || word === "off") && l.resume_at ? `resumes in ${clock(Date.parse(l.resume_at) - now)}` : "",
    age: stale ? `Not updated for ${Math.floor(age / MIN)} min: the watchdog may be down, so it counts as yellow.` : `Set ${clock(age)} ago`,
  };
}

export function slotsLine(snap) {
  const l = snap.light;
  if (!l) return "";
  const running = snap.items.filter((i) => i.kind === "ticket" && ACTIVE.includes(i.state)).length;
  const live = snap.sessions.filter((x) => x.running).map((x) => (x.context_pct == null ? x.name : `${x.name} ${x.context_pct}%`));
  const names = live.length ? live : snap.sessions.length ? [] : l.sessions ?? [];
  return `${running} of ${l.slots} run slots in use · weekly pace ${l.pace.toFixed(2)}` + (names.length ? ` · sessions: ${names.join(", ")}` : "");
}
