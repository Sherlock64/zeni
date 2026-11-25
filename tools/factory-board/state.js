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
export const OUTCOMES = ["done", "back", "eject", "checkpoint"];
export const DOORS = ["one-way", "two-way", "none", "docs"];
// The spine's stations, in its order; page 2 lists station outcomes this way.
const STATIONS = ["intake", "shape-slice", "build", "verify", "review", "merge", "release", "learn"];

export function empty() {
  return { items: {}, runs: {}, light: null, sessions: [], needsHuman: {}, factoryRuns: {}, history: {}, lightHistory: [], doors: null, ci: null, trust: null, updatedAt: null };
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
      // null tokens: the run's transcript is missing, so its cost is unknown.
      if (e.tokens !== null && (!Number.isSafeInteger(e.tokens) || e.tokens < 0)) throw new Error("tokens must be a non-negative integer or null");
      if (e.outcome != null && !OUTCOMES.includes(e.outcome)) throw new Error(`bad outcome ${e.outcome}`);
      for (const k of ["input", "cache_write", "cache_read"]) if (e[k] != null && (!Number.isSafeInteger(e[k]) || e[k] < 0)) throw new Error(`${k} must be a non-negative integer or null`);
      const { run, session, item = null, station = null, tokens, model = null, outcome = null, input = null, cache_write = null, cache_read = null } = e;
      s.runs[str(run, "run")] = { run, session: str(session, "session"), item, station, tokens, model, outcome, input, cache_write, cache_read };
      break;
    }
    case "item.history":
      // Every state: label the issue was given, oldest first.
      if (!Array.isArray(e.history)) throw new Error("history must be an array");
      s.history[str(e.id, "id")] = e.history.map((h) => {
        if (!STATES.includes(h?.state)) throw new Error(`bad state ${h?.state}`);
        return { state: h.state, at: str(h.at, "at") };
      });
      break;
    case "doors":
      // The PRs merged to main since the last tag; door null means unlabelled.
      if (!Array.isArray(e.prs)) throw new Error("prs must be an array");
      s.doors = {
        tag: e.tag ?? null,
        prs: e.prs.map((p) => {
          if (p?.door != null && !DOORS.includes(p.door)) throw new Error(`bad door ${p.door}`);
          return { number: p.number, title: str(p.title, "title"), door: p.door ?? null };
        }),
      };
      break;
    case "ci":
      if (!Array.isArray(e.runs)) throw new Error("runs must be an array");
      s.ci = e.runs.map((r) => ({ conclusion: str(r?.conclusion, "conclusion"), started_at: str(r.started_at, "started_at"), ended_at: str(r.ended_at, "ended_at") }));
      break;
    case "trust": {
      // {station: level}; empty when the spine's table could not be read.
      const levels = e.levels ?? {};
      for (const v of Object.values(levels)) if (!Number.isInteger(v) || v < 0 || v > 3) throw new Error(`bad trust level ${v}`);
      s.trust = { ...levels };
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
      // Every reading, for the usage charts; a repeated reading replaces its point.
      const point = { at: s.light.set_at, five: s.light.five_hour.pct, weekly: s.light.weekly.pct };
      if (s.lightHistory.at(-1)?.at === point.at) s.lightHistory[s.lightHistory.length - 1] = point;
      else s.lightHistory.push(point);
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
      s.factoryRuns[str(e.id, "id")] = { id: e.id, started_at: e.started_at ?? e.ts, ended_at: null, retros: [] };
      break;
    case "factory_run.end": {
      const r = (s.factoryRuns[str(e.id, "id")] ??= { id: e.id, started_at: null, retros: [] });
      r.ended_at = e.ended_at ?? e.ts;
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
    totalTokens: runs.reduce((n, r) => n + (r.tokens ?? 0), 0),
    runs: runs.toReversed(), // newest first
    topRuns: runs.sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.run.localeCompare(b.run)).slice(0, 10),
    light: s.light,
    sessions: s.sessions,
    needsHuman: Object.values(s.needsHuman),
    factoryRun: Object.values(s.factoryRuns).find((r) => !r.ended_at) ?? null,
    lastEndedRun: lastEnded ?? null,
    updatedAt: s.updatedAt,
  };
}

const DONE = ["merged", "released"];
const PAST_READY = ["ready", "building", "verifying", "reviewing", "merged", "released"];

function bump(tag, prs) {
  const m = tag?.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  const has = (d) => prs.some((p) => p.door === d);
  if (!m) return null;
  const [maj, min, pat] = m.slice(1).map(Number);
  if (has("one-way")) return `v${maj + 1}.0.0`;
  if (has("two-way")) return `v${maj}.${min + 1}.0`;
  if (has("none")) return `v${maj}.${min}.${pat + 1}`;
  return null; // docs and unlabelled only: no release
}

// Page 2's flow data (epic #131, Rules). Empty lists and nulls mean no data, never zeros.
export function page2(s, now) {
  const tickets = Object.values(s.items).filter((i) => i.kind === "ticket");
  const timeInState = tickets
    .filter((t) => !DONE.includes(t.state) && s.history[t.id]?.length)
    .map((t) => {
      const h = s.history[t.id];
      const segs = h.map((x, i) => ({ state: x.state, ms: Math.max(0, (i + 1 < h.length ? Date.parse(h[i + 1].at) : now) - Date.parse(x.at)) }));
      return { id: t.id, number: t.number, title: t.title, state: t.state, segs, current_ms: segs.at(-1).ms };
    })
    .sort((a, b) => b.current_ms - a.current_ms);

  // Reaching any state past ready counts as reaching ready: the dispatcher's claim can skip it.
  const cycle = Object.values(s.items)
    .filter((ep) => ep.kind === "epic")
    .map((ep) => {
      const mine = tickets.filter((t) => t.epic === ep.id);
      if (!mine.some((t) => !DONE.includes(t.state))) return null;
      const starts = mine.flatMap((t) => (s.history[t.id] ?? []).filter((x) => PAST_READY.includes(x.state)).map((x) => Date.parse(x.at)));
      return starts.length ? { id: ep.id, title: ep.title, ms: now - Math.min(...starts), open: true } : null;
    })
    .filter(Boolean);

  const by = {};
  for (const r of Object.values(s.runs)) {
    if (!r.station || !r.outcome) continue;
    const st = (by[r.station] ??= { station: r.station, done: 0, back: 0, eject: 0, checkpoint: 0, streak: 0, level: null });
    st[r.outcome]++;
    st.streak = r.outcome === "done" ? st.streak + 1 : 0; // runs are in log order, so this ends on the newest
  }
  const rank = (x) => (STATIONS.includes(x) ? STATIONS.indexOf(x) : STATIONS.length);
  const stations = Object.values(by)
    .map((x) => ({ ...x, level: s.trust?.[x.station] ?? null }))
    .sort((a, b) => rank(a.station) - rank(b.station));

  let doors = null;
  if (s.doors) {
    const counts = Object.fromEntries([...DOORS, "unlabelled"].map((d) => [d, 0]));
    for (const p of s.doors.prs) counts[p.door ?? "unlabelled"]++;
    doors = { tag: s.doors.tag, next: bump(s.doors.tag, s.doors.prs), counts, prs: s.doors.prs };
  }

  const last = (s.ci ?? []).slice(0, 30); // newest first, as gh lists them
  const ms = last.map((r) => Date.parse(r.ended_at) - Date.parse(r.started_at)).sort((a, b) => a - b);
  const mid = ms.length >> 1;
  const ci = last.length
    ? { passed: last.filter((r) => r.conclusion === "success").length, of: last.length, median_ms: ms.length % 2 ? ms[mid] : Math.round((ms[mid - 1] + ms[mid]) / 2) }
    : null;

  return { doors, ci, stations, timeInState, cycle, tokens: tokensBy(s), cache: cacheHits(s, rank), ...usage(s) };
}

// Weighted tokens summed by a run's field, largest first; runs with unknown tokens add nothing.
function sumBy(runs, key) {
  const m = new Map();
  for (const r of runs) if (r.tokens != null) m.set(key(r), (m.get(key(r)) ?? 0) + r.tokens);
  return [...m].map(([k, tokens]) => ({ key: k, tokens })).sort((a, b) => b.tokens - a.tokens || String(a.key).localeCompare(String(b.key)));
}
function tokensBy(s) {
  const runs = Object.values(s.runs);
  return {
    ticket: sumBy(runs.filter((r) => r.item), (r) => r.item).slice(0, 10).map((x) => ({ key: x.key, title: s.items[x.key]?.title ?? null, tokens: x.tokens })),
    station: sumBy(runs.filter((r) => r.station), (r) => r.station),
    model: sumBy(runs, (r) => r.model ?? "unknown"),
  };
}

// Cache reads / (input + writes + reads), per station and overall; null when no run has counts.
function cacheHits(s, rank) {
  const runs = Object.values(s.runs).filter((r) => r.input != null && r.cache_write != null && r.cache_read != null);
  const ratio = (rs) => {
    const all = rs.reduce((n, r) => n + r.input + r.cache_write + r.cache_read, 0);
    return all ? rs.reduce((n, r) => n + r.cache_read, 0) / all : null;
  };
  const overall = ratio(runs);
  if (overall == null) return null;
  const stations = [...new Set(runs.map((r) => r.station).filter(Boolean))]
    .map((station) => ({ station, ratio: ratio(runs.filter((r) => r.station === station)) }))
    .filter((x) => x.ratio != null)
    .sort((a, b) => rank(a.station) - rank(b.station));
  return { overall, stations };
}

// The current weekly and 5-hour windows, each from its reset time back one window length.
function usage(s) {
  const l = s.light;
  const win = (w, len, field) => {
    if (!w?.resets_at || Number.isNaN(Date.parse(w.resets_at))) return null;
    const end = Date.parse(w.resets_at), start = end - len;
    const points = s.lightHistory
      .filter((p) => Date.parse(p.at) >= start && Date.parse(p.at) <= end)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((p) => ({ at: p.at, pct: p[field] }));
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), pct: w.pct, points };
  };
  const weekly = win(l?.weekly, 7 * 86400e3, "weekly");
  return { weekly: weekly && { ...weekly, pace: l.pace, slots: l.slots }, fiveHour: win(l?.five_hour, 5 * 3600e3, "five") };
}
