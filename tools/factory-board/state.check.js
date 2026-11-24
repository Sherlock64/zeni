// Run: node --test tools/factory-board/state.check.js  (not *.test.js, so the app's vitest skips it)
import test from "node:test";
import assert from "node:assert/strict";
import { apply, empty, view } from "./state.js";

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
