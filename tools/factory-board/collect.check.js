// Run: node --test tools/factory-board/collect.check.js
import test from "node:test";
import assert from "node:assert/strict";
import { toBoard, diff } from "./collect.js";
import { apply, empty, view } from "./state.js";

const TS = "2026-11-23T10:00:00Z";
const labels = (...names) => ({ nodes: names.map((name) => ({ name })) });
const issue = (number, title, label, extra = {}) => ({
  number, title, url: `https://github.com/o/r/issues/${number}`, labels: labels("enhancement", label),
  parent: null, subIssues: { totalCount: 0 }, comments: { nodes: [] }, ...extra,
});
const pr = (number, title, label) => ({ number, title, labels: labels(label) });
const fold = (s, events) => events.reduce((st, e) => apply(st, e), s);

const ISSUES = [
  issue(131, "Factory board", "state:building", { subIssues: { totalCount: 3 } }),
  issue(138, "Land the board", "state:merged", { parent: { number: 131 } }),
  issue(139, "Collector, GitHub part", "state:needs-human", {
    parent: { number: 131 },
    comments: { nodes: [
      { body: "claimed by t139-old (run 1)", url: "https://github.com/o/r/issues/139#c1" },
      { body: "Blocker merged; claimed by t139-gh-collector (factory run fr-1, station build)", url: "https://github.com/o/r/issues/139#c2" },
      { body: "\nEject: cursor or page number?\n\nOptions: ...", url: "https://github.com/o/r/issues/139#c3" },
    ] },
  }),
  issue(140, "Collector, runs part", "state:ready", { parent: { number: 131 } }),
];
const PRS = [pr(170, "t138: land the board", "state:reviewing")];

test("state-labelled issues and PRs become cards in their columns, tickets under their epic", () => {
  const v = view(fold(empty(), diff(empty(), toBoard(ISSUES, PRS), TS)));
  const card = (id) => v.items.find((i) => i.id === id);
  assert.deepEqual([card("#131").kind, card("#131").state], ["epic", "building"]);
  assert.deepEqual([card("#139").kind, card("#139").state, card("#139").epic], ["ticket", "needs-human", "#131"]);
  assert.deepEqual([card("#170").kind, card("#170").state, card("#170").number], ["pr", "reviewing", 170]);
  // Progress counts merged and released tickets.
  assert.deepEqual(v.epics, [{ id: "#131", title: "Factory board", done: 1, total: 3 }]);
});

test("a needs-human ticket names the session from its latest claim and links its latest comment", () => {
  const v = view(fold(empty(), diff(empty(), toBoard(ISSUES, PRS), TS)));
  assert.equal(v.needsHuman.length, 1);
  const n = v.needsHuman[0];
  assert.deepEqual([n.item, n.session, n.question, n.href], ["#139", "t139-gh-collector", "Eject: cursor or page number?", "https://github.com/o/r/issues/139#c3"]);
});

test("a needs-human ticket without a claim or comments still shows", () => {
  const b = toBoard([issue(150, "Lonely", "state:needs-human")], []);
  assert.deepEqual(Object.values(b.needsHuman).map((n) => [n.session, n.question, n.href]), [["unknown", "Lonely", "https://github.com/o/r/issues/150"]]);
});

test("a collect that finds no change appends nothing", () => {
  const s = fold(empty(), diff(empty(), toBoard(ISSUES, PRS), TS));
  assert.deepEqual(diff(s, toBoard(ISSUES, PRS), TS), []);
});

test("a label change moves the card; an unlabelled closed issue, a merged PR and an answered eject leave", () => {
  const s = fold(empty(), diff(empty(), toBoard(ISSUES, PRS), TS));
  // #138 closed and lost its label, PR #170 merged (no longer an open PR), #139 answered and back to building, #140 started.
  const next = [ISSUES[0], { ...ISSUES[2], labels: labels("state:building") }, { ...ISSUES[3], labels: labels("state:building") }];
  const events = diff(s, toBoard(next, []), TS);
  assert.deepEqual(events.map((e) => [e.type, e.id]).sort(), [
    ["item.remove", "#138"], ["item.remove", "#170"], ["item.upsert", "#139"], ["item.upsert", "#140"], ["needs_human.clear", "nh-#139"],
  ]);
  for (const e of events) assert.deepEqual([e.v, e.ts], [1, TS]);
  const v = view(fold(s, events));
  assert.deepEqual(v.items.map((i) => `${i.id}:${i.state}`).sort(), ["#131:building", "#139:building", "#140:building"]);
  assert.equal(v.needsHuman.length, 0);
});

test("cards from other writers are left alone", () => {
  const s = fold(empty(), [{ v: 1, ts: TS, type: "item.upsert", id: "T9", kind: "ticket", title: "Other", state: "ready" }]);
  assert.deepEqual(diff(s, toBoard([], []), TS), []);
});
