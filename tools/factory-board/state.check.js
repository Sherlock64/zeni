// Run: node --test tools/factory-board/state.check.js  (not *.test.js, so the app's vitest skips it)
import test from "node:test";
import assert from "node:assert/strict";
import { apply, empty, page2, view } from "./state.js";

const fold = (events) => events.reduce((s, e) => apply(s, { v: 1, ts: "2026-11-20T10:00:00Z", ...e }), empty());

test("folds items, progress, tokens and needs-human into a view", () => {
  const v = view(fold([
    { type: "item.upsert", id: "E1", kind: "epic", title: "Foundations", state: "building" },
    { type: "item.upsert", id: "T1", kind: "ticket", epic: "E1", title: "A", state: "building" },
    { type: "item.upsert", id: "T2", kind: "ticket", epic: "E1", title: "B", state: "ready" },
    { type: "item.state", id: "T1", state: "merged" },
    { type: "run.tokens", run: "r1", session: "t1-build-a", item: "T1", tokens: 500 },
    { type: "run.tokens", run: "r2", session: "t2-build-b", item: "T2", tokens: 900 },
    { type: "run.tokens", run: "r1", session: "t1-build-a", item: "T1", tokens: 1200 },
    { type: "needs_human.open", id: "n1", item: "T2", session: "t2-build-b", question: "Q?" },
    { type: "light", light: "red", reason: "5-hour 91%", resume_at: "2026-11-20T11:00:00Z", set_at: "2026-11-20T10:00:00Z", slots: 2, pace: 1.04,
      five_hour: { pct: 91 }, weekly: { pct: 40 }, sessions: ["t2-build-b"] },
    { type: "factory_run.end", id: "fr-1", retros: [{ title: "Retro", href: "retros/fr-1.html" }] },
  ]));
  assert.deepEqual(v.epics, [{ id: "E1", title: "Foundations", done: 1, total: 2 }]);
  assert.equal(v.totalTokens, 2100);
  assert.deepEqual(v.topRuns.map((r) => r.run), ["r1", "r2"]);
  assert.equal(v.items.find((i) => i.id === "T2").session, "t2-build-b");
  assert.equal(v.needsHuman[0].session, "t2-build-b");
  assert.deepEqual([v.light.light, v.light.slots, v.light.pace, v.light.five_hour.pct, v.light.sessions], ["red", 2, 1.04, 91, ["t2-build-b"]]);
  assert.equal(v.lastEndedRun.retros[0].href, "retros/fr-1.html");
});

test("needs_human.clear and reset empty the state", () => {
  const s = fold([
    { type: "needs_human.open", id: "n1", session: "s", question: "Q?" },
    { type: "needs_human.clear", id: "n1" },
  ]);
  assert.equal(view(s).needsHuman.length, 0);
  assert.equal(view(fold([{ type: "run.tokens", run: "r", session: "s", tokens: 5 }, { type: "reset" }])).totalTokens, 0);
});

test("sessions event replaces the session list with context %", () => {
  const v = view(fold([
    { type: "sessions", sessions: [{ name: "old", running: true, context_pct: 10 }] },
    { type: "sessions", sessions: [{ name: "t1-build", running: true, context_pct: 42 }, { name: "t2-verify", running: false, context_pct: null }] },
  ]));
  assert.deepEqual(v.sessions, [{ name: "t1-build", running: true, context_pct: 42 }, { name: "t2-verify", running: false, context_pct: null }]);
  assert.throws(() => apply(empty(), { v: 1, type: "sessions", sessions: [{ name: "s", running: true, context_pct: 140 }] }), /pct/);
  assert.throws(() => apply(empty(), { v: 1, type: "sessions", sessions: "s" }), /sessions/);
});

test("rejects malformed events", () => {
  assert.throws(() => apply(empty(), { v: 2, type: "reset" }), /version/);
  assert.throws(() => apply(empty(), { v: 1, type: "nope" }), /unknown event/);
  assert.throws(() => apply(empty(), { v: 1, type: "item.upsert", id: "x", kind: "ticket", title: "t", state: "done" }), /bad state/);
  assert.throws(() => apply(empty(), { v: 1, type: "light", light: "blue", reason: "r", set_at: "t" }), /bad light/);
  assert.throws(() => apply(empty(), { v: 1, type: "light", light: "green", reason: "r", set_at: "t", slots: 3, pace: 1, weekly: { pct: 1 } }), /five_hour/);
  assert.throws(() => apply(empty(), { v: 1, type: "light", light: "green", reason: "r", set_at: "t", slots: 4, pace: 1 }), /slots/);
  assert.throws(() => apply(empty(), { v: 1, type: "run.tokens", run: "r", session: "s", tokens: 1.5 }), /integer/);
});

// Page 2, flow (#144).
const H = 3600e3;
const at = (h) => new Date(Date.parse("2026-11-24T10:00:00Z") + h * H).toISOString();

test("time in state: tickets not yet merged, longest current state first, current state counts up to now", () => {
  const s = fold([
    { type: "item.upsert", id: "#1", kind: "ticket", title: "A", state: "verifying" },
    { type: "item.upsert", id: "#2", kind: "ticket", title: "B", state: "ready" },
    { type: "item.upsert", id: "#3", kind: "ticket", title: "Done", state: "merged" },
    { type: "item.history", id: "#1", history: [{ state: "building", at: at(0) }, { state: "verifying", at: at(1.5) }] },
    { type: "item.history", id: "#2", history: [{ state: "ready", at: at(-1) }] },
    { type: "item.history", id: "#3", history: [{ state: "ready", at: at(-5) }, { state: "merged", at: at(-4) }] },
  ]);
  const p = page2(s, Date.parse(at(2)));
  assert.deepEqual(p.timeInState.map((t) => t.id), ["#2", "#1"]);
  const one = p.timeInState.find((t) => t.id === "#1");
  // building 10:00, verifying 11:30: 1 h 30 m in building; verifying counts to now (12:00)
  assert.deepEqual(one.segs, [{ state: "building", ms: 1.5 * H }, { state: "verifying", ms: 0.5 * H }]);
  assert.equal(one.current_ms, 0.5 * H);
  assert.equal(p.timeInState[0].current_ms, 3 * H);
});

test("time in state: an unmerged ticket with no history shows its state and no time, after those with history (#194)", () => {
  const s = fold([
    { type: "item.upsert", id: "#1", kind: "ticket", title: "A", state: "verifying" },
    { type: "item.upsert", id: "#4", kind: "ticket", title: "New", state: "ready" },
    { type: "item.history", id: "#1", history: [{ state: "verifying", at: at(0) }] },
  ]);
  const p = page2(s, Date.parse(at(2)));
  assert.deepEqual(p.timeInState.map((t) => [t.id, t.state, t.current_ms]), [["#1", "verifying", 2 * H], ["#4", "ready", null]]);
  assert.deepEqual(p.timeInState[1].segs, []);
});

test("time in state: empty only when no ticket is unmerged (#194)", () => {
  const s = fold([{ type: "item.upsert", id: "#3", kind: "ticket", title: "Done", state: "merged" }]);
  assert.deepEqual(page2(s, Date.parse(at(2))).timeInState, []);
});

test("cycle time: open epics only, from the first ticket reaching ready, marked open", () => {
  const s = fold([
    { type: "item.upsert", id: "#10", kind: "epic", title: "Open epic", state: "building" },
    { type: "item.upsert", id: "#11", kind: "ticket", epic: "#10", title: "a", state: "merged" },
    { type: "item.upsert", id: "#12", kind: "ticket", epic: "#10", title: "b", state: "building" },
    { type: "item.upsert", id: "#20", kind: "epic", title: "Done epic", state: "merged" },
    { type: "item.upsert", id: "#21", kind: "ticket", epic: "#20", title: "c", state: "merged" },
    { type: "item.history", id: "#11", history: [{ state: "shaping", at: at(-9) }, { state: "ready", at: at(-6) }, { state: "merged", at: at(-1) }] },
    // skipped ready: reaching building counts as reaching ready
    { type: "item.history", id: "#12", history: [{ state: "shaping", at: at(-9) }, { state: "building", at: at(-8) }] },
    { type: "item.history", id: "#21", history: [{ state: "ready", at: at(-20) }, { state: "merged", at: at(-10) }] },
  ]);
  assert.deepEqual(page2(s, Date.parse(at(0))).cycle, [{ id: "#10", title: "Open epic", ms: 8 * H, open: true }]);
});

test("station outcomes over the whole run log, streak of done newest first, trust level from the spine", () => {
  const run = (n, station, outcome) => ({ type: "run.tokens", run: `r${n}`, session: "s", station, outcome, tokens: 1 });
  const s = fold([
    run(1, "build", "done"), run(2, "build", "back"), run(3, "build", "done"), run(4, "build", "done"),
    run(5, "review", "eject"), run(6, "intake", "checkpoint"),
    { type: "trust", levels: { intake: 1, build: 2, review: 1 } },
  ]);
  const st = page2(s, 0).stations;
  assert.deepEqual(st.map((x) => x.station), ["intake", "build", "review"]); // the spine's order
  assert.deepEqual(st.find((x) => x.station === "build"), { station: "build", done: 3, back: 1, eject: 0, checkpoint: 0, streak: 2, level: 2 });
  assert.equal(st.find((x) => x.station === "review").streak, 0);
  // unreadable table: level hidden, streak kept
  const hidden = page2(apply(s, { v: 1, ts: "t", type: "trust", levels: {} }), 0).stations.find((x) => x.station === "build");
  assert.deepEqual([hidden.level, hidden.streak], [null, 2]);
});

test("next version from the largest door since the last tag; unlabelled and docs change nothing", () => {
  const doors = (tag, ...ds) => ({ type: "doors", tag, prs: ds.map((door, i) => ({ number: i + 1, title: `p${i}`, door })) });
  const next = (...e) => page2(fold(e), 0).doors;
  const d = next(doors("v7.2.1", "none", "two-way", null, "docs"));
  assert.equal(d.next, "v7.3.0");
  assert.deepEqual(d.counts, { "one-way": 0, "two-way": 1, none: 1, docs: 1, unlabelled: 1 });
  assert.equal(next(doors("v7.2.1", "docs", null)).next, null); // no release
  assert.equal(next(doors("v7.2.1", "none")).next, "v7.2.2");
  assert.equal(next(doors("v7.2.1", "one-way", "none")).next, "v8.0.0");
  assert.equal(page2(empty(), 0).doors, null);
});

test("CI pass rate and median duration over the last 30 completed runs", () => {
  const r = (conclusion, min) => ({ conclusion, started_at: at(0), ended_at: new Date(Date.parse(at(0)) + min * 60e3).toISOString() });
  const runs = [r("success", 4), r("failure", 1), r("success", 6), r("cancelled", 10), ...Array.from({ length: 30 }, () => r("success", 2))];
  // cancelled and skipped runs are left out of the pass count, the run count and the median
  assert.deepEqual(page2(fold([{ type: "ci", runs: [...runs.slice(0, 4), r("skipped", 0)] }]), 0).ci, { passed: 2, of: 3, median_ms: 4 * 60e3 });
  assert.equal(page2(fold([{ type: "ci", runs }]), 0).ci.of, 30);
  assert.equal(page2(fold([{ type: "ci", runs: [] }]), 0).ci, null);
  assert.equal(page2(fold([{ type: "ci", runs: [r("cancelled", 3)] }]), 0).ci, null);
  // a run with an unparseable timestamp counts for the rate but not the median
  const bad = [r("success", 4), { ...r("failure", 1), started_at: "nope" }, { ...r("success", 6), ended_at: "" }];
  assert.deepEqual(page2(fold([{ type: "ci", runs: bad }]), 0).ci, { passed: 2, of: 3, median_ms: 4 * 60e3 });
  assert.equal(page2(fold([{ type: "ci", runs: [bad[1]] }]), 0).ci.median_ms, null);
});

test("no data: every page-2 section is empty or null, never zeros", () => {
  assert.deepEqual(page2(empty(), 0), {
    doors: null, ci: null, stations: [], timeInState: [], cycle: [],
    tokens: { ticket: [], station: [], model: [] }, cache: null, weekly: null, fiveHour: null,
  });
});

test("rejects malformed page-2 events", () => {
  assert.throws(() => apply(empty(), { v: 1, type: "item.history", id: "#1", history: [{ state: "done", at: "t" }] }), /bad state/);
  assert.throws(() => apply(empty(), { v: 1, type: "doors", tag: null, prs: [{ number: 1, title: "x", door: "half" }] }), /door/);
  assert.throws(() => apply(empty(), { v: 1, type: "ci", runs: "x" }), /runs/);
  assert.throws(() => apply(empty(), { v: 1, type: "trust", levels: { build: 9 } }), /level/);
  assert.throws(() => apply(empty(), { v: 1, type: "run.tokens", run: "r", session: "s", tokens: 1, outcome: "won" }), /outcome/);
});

// Page 2, cost and usage (#145).
test("weighted tokens per ticket (top 10), per station and per model (all), over every run", () => {
  const run = (n, item, station, model, tokens) => ({ type: "run.tokens", run: `r${n}`, session: "s", item, station, model, tokens });
  const s = fold([
    { type: "item.upsert", id: "#1", kind: "ticket", title: "One", state: "merged" },
    run(1, "#1", "build", "opus", 300), run(2, "#1", "review", "sonnet", 100), run(3, "#2", "build", "opus", 50),
    run(4, null, "intake", null, 20), run(5, "#3", "verify", "haiku", null), // unknown tokens add nothing
    ...Array.from({ length: 11 }, (_, i) => run(10 + i, `#${100 + i}`, "build", "opus", i + 1)),
  ]);
  const t = page2(s, 0).tokens;
  assert.equal(t.ticket.length, 10);
  assert.deepEqual(t.ticket.slice(0, 3), [{ key: "#1", title: "One", tokens: 400 }, { key: "#2", title: null, tokens: 50 }, { key: "#110", title: null, tokens: 11 }]);
  assert.deepEqual(t.station, [{ key: "build", tokens: 416 }, { key: "review", tokens: 100 }, { key: "intake", tokens: 20 }]);
  assert.deepEqual(t.model, [{ key: "opus", tokens: 416 }, { key: "sonnet", tokens: 100 }, { key: "unknown", tokens: 20 }]);
});

test("cache-hit ratio per station and overall: reads / (input + writes + reads); runs without counts are left out", () => {
  const run = (n, station, input, cache_write, cache_read) => ({ type: "run.tokens", run: `r${n}`, session: "s", station, tokens: 1, input, cache_write, cache_read });
  const s = fold([
    run(1, "build", 10000, 20000, 270000), // 90%
    run(2, "review", 50, 50, 0), run(3, "review", 0, 0, 100), // 50%
    run(4, "verify", null, null, null),
  ]);
  const c = page2(s, 0).cache;
  assert.deepEqual(c.stations, [{ station: "build", ratio: 0.9 }, { station: "review", ratio: 0.5 }]);
  assert.equal(c.overall, 270100 / 300200);
  assert.equal(page2(fold([run(1, "build", null, null, null)]), 0).cache, null);
});

test("weekly usage over the current window from light events, against the straight-line target, with pace", () => {
  const DAY = 24 * H;
  const reset = at(4 * 24), start = at(-3 * 24);
  const light = (set_at, weekly, five, resets5 = at(2)) => ({
    type: "light", light: "green", reason: "r", set_at, slots: 2, pace: 1.04,
    five_hour: { pct: five, resets_at: resets5 }, weekly: { pct: weekly, resets_at: reset },
  });
  const s = fold([
    light(at(-4 * 24), 90, 5), // the last weekly window: left out
    light(at(-2 * 24), 20, 10, at(-1)), // an earlier 5-hour window: left out of the 5-hour chart
    light(at(-1), 40, 30), light(at(-1), 41, 31), // same reading repeated: replaces, never doubles
    light(at(0), 42, 50),
  ]);
  const p = page2(s, Date.parse(at(0)));
  assert.deepEqual(p.weekly, {
    start, end: reset, pct: 42, pace: 1.04, slots: 2,
    points: [{ at: at(-2 * 24), pct: 20 }, { at: at(-1), pct: 41 }, { at: at(0), pct: 42 }],
  });
  assert.equal(Date.parse(p.weekly.end) - Date.parse(p.weekly.start), 7 * DAY);
  assert.deepEqual(p.fiveHour, { start: at(-3), end: at(2), pct: 50, points: [{ at: at(-1), pct: 31 }, { at: at(0), pct: 50 }] });
  assert.equal(fold([light(at(0), 1, 1), { type: "reset" }]).lightHistory.length, 0);
});

test("a window without a reset time has no chart", () => {
  const s = fold([{ type: "light", light: "yellow", reason: "usage unavailable", set_at: at(0), slots: 0, pace: 0, five_hour: { pct: 0 }, weekly: { pct: 0 } }]);
  const p = page2(s, Date.parse(at(0)));
  assert.deepEqual([p.weekly, p.fiveHour], [null, null]);
});

test("rejects malformed cache counts", () => {
  assert.throws(() => apply(empty(), { v: 1, type: "run.tokens", run: "r", session: "s", tokens: 1, cache_read: -1 }), /cache_read/);
});
