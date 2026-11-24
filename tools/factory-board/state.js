// Folds factory events (format: README.md) into the snapshot the board draws.
// Shared by the server and its test; the page only ever sees view() output.

export const STATES = [
  "intake",
  "shaping",
  "ready",
  "building",
  "verifying",
  "reviewing",
  "merged",
  "released",
  "needs-human",
];
const KINDS = ["epic", "ticket", "pr"];
export const LIGHTS = ["green", "yellow", "red", "off"];

export function empty() {
  return { items: {}, runs: {}, light: null, sessions: [], needsHuman: {}, factoryRuns: {}, updatedAt: null };
}

const str = (v, name) => {
  if (typeof v !== "string" || v === "") throw new Error(`${name} must be a non-empty string`);
  return v;
};
const pct = (v) => {
  if (typeof v !== "number" || v < 0 || v > 100) throw new Error("pct must be 0-100");
  return v;
};

const slotCount = (v) => {
  if (!Number.isInteger(v) || v < 0 || v > 3) throw new Error("slots must be an integer 0-3");
  return v;
};
const paceValue = (v) => {
  if (typeof v !== "number" || !(v >= 0)) throw new Error("pace must be a number >= 0");
  return v;
};

// Throws on a malformed event; the caller skips it and keeps the state as it was.
export function apply(s, e) {
  if (e?.v !== 1) throw new Error(`unsupported event version ${e?.v}`);
  switch (e.type) {
    case "reset":
      return { ...empty(), updatedAt: e.ts };
    case "item.upsert": {
      if (!KINDS.includes(e.kind)) throw new Error(`bad kind ${e.kind}`);
      if (!STATES.includes(e.state)) throw new Error(`bad state ${e.state}`);
      const { id, kind, title, state, epic = null, number = null } = e;
      s.items[str(id, "id")] = { id, kind, title: str(title, "title"), state, epic, number };
      break;
    }
    case "item.state": {
      const item = s.items[e.id];
      if (!item) throw new Error(`unknown item ${e.id}`);
      if (!STATES.includes(e.state)) throw new Error(`bad state ${e.state}`);
      item.state = e.state;
      break;
    }
    case "item.remove":
      delete s.items[e.id];
      break;
    case "run.tokens": {
      if (!Number.isSafeInteger(e.tokens) || e.tokens < 0) throw new Error("tokens must be a non-negative integer");
      const { run, session, item = null, station = null, tokens } = e;
      s.runs[str(run, "run")] = { run, session: str(session, "session"), item, station, tokens };
      break;
    }
    case "light": {
      // The watchdog's whole state: replaces the light file's previous content.
      if (!LIGHTS.includes(e.light)) throw new Error(`bad light ${e.light}`);
      const win = (w, name) => {
        if (!w) throw new Error(`${name} missing`);
        return { pct: pct(w.pct), resets_at: w.resets_at ?? null };
      };
      s.light = {
        light: e.light,
        reason: str(e.reason, "reason"),
        resume_at: e.resume_at ?? null,
        set_at: str(e.set_at, "set_at"),
        slots: slotCount(e.slots),
        pace: paceValue(e.pace),
        five_hour: win(e.five_hour, "five_hour"),
        weekly: win(e.weekly, "weekly"),
        sessions: Array.isArray(e.sessions) ? e.sessions.map((x) => str(x, "session")) : [],
      };
      break;
    }
    case "sessions":
      // The watchdog's session list, each with its context window % (null when unavailable).
      if (!Array.isArray(e.sessions)) throw new Error("sessions must be an array");
      s.sessions = e.sessions.map((x) => ({
        name: str(x?.name, "session name"),
        running: x.running === true,
        context_pct: x.context_pct == null ? null : pct(x.context_pct),
      }));
      break;
    case "needs_human.open":
      s.needsHuman[str(e.id, "id")] = {
        id: e.id,
        item: e.item ?? null,
        session: str(e.session, "session"),
        question: str(e.question, "question"),
        href: e.href ?? null,
        opened_at: e.ts,
      };
      break;
    case "needs_human.clear":
      delete s.needsHuman[e.id];
      break;
    case "factory_run.start":
      s.factoryRuns[str(e.id, "id")] = { id: e.id, started_at: e.ts, ended_at: null, retros: [] };
      break;
    case "factory_run.end": {
      const r = (s.factoryRuns[str(e.id, "id")] ??= { id: e.id, started_at: null, retros: [] });
      r.ended_at = e.ts;
      r.retros = (e.retros ?? []).map((x) => ({ title: str(x.title, "retro title"), href: str(x.href, "retro href") }));
      break;
    }
    default:
      throw new Error(`unknown event type ${e.type}`);
  }
  s.updatedAt = e.ts ?? s.updatedAt;
  return s;
}

export function view(s) {
  const runs = Object.values(s.runs);
  // Runs are kept in insertion order, so the last run of an item is its current session.
  const sessionOf = Object.fromEntries(runs.filter((r) => r.item).map((r) => [r.item, r.session]));
  const items = Object.values(s.items).map((i) => ({ ...i, session: sessionOf[i.id] ?? null }));
  const epics = items
    .filter((i) => i.kind === "epic")
    .map((ep) => {
      const tickets = items.filter((i) => i.epic === ep.id && i.kind === "ticket");
      const done = tickets.filter((t) => t.state === "merged" || t.state === "released").length;
      return { id: ep.id, title: ep.title, done, total: tickets.length };
    });
  const lastEnded = Object.values(s.factoryRuns)
    .filter((r) => r.ended_at)
    .sort((a, b) => a.ended_at.localeCompare(b.ended_at))
    .at(-1);
  return {
    items,
    epics,
    totalTokens: runs.reduce((n, r) => n + r.tokens, 0),
    topRuns: runs.sort((a, b) => b.tokens - a.tokens || a.run.localeCompare(b.run)).slice(0, 10),
    light: s.light,
    sessions: s.sessions,
    needsHuman: Object.values(s.needsHuman),
    factoryRun: Object.values(s.factoryRuns).find((r) => !r.ended_at) ?? null,
    lastEndedRun: lastEnded ?? null,
    updatedAt: s.updatedAt,
  };
}
