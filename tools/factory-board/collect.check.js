// Run: node --test tools/factory-board/collect.check.js
import test from "node:test";
import assert from "node:assert/strict";
import { toBoard, diff } from "./collect.js";
import { apply, empty, view } from "./state.js";

const TS = "2026-11-23T10:00:00Z";
const labels = (...names) => ({ nodes: names.map((name) => ({ name })) });
const issue = (number, title, label, extra = {}) => ({
  number, title, url: `https://github.com/o/r/issues/${number}`, labels: labels("enhancement", label),
  parent: null, subIssues: { totalCount: 0 }, comments: { nodes: [] }, timelineItems: { nodes: [] }, ...extra,
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

test("a claim comment without a valid session name is skipped, not a crash", () => {
  const comments = { nodes: [
    { body: "claimed by t150-build (run 1)", url: "u1" },
    { body: "claimed by `t150-x` and @someone", url: "u2" },
  ] };
  const b = toBoard([issue(150, "Odd claim", "state:needs-human", { comments })], []);
  assert.equal(b.needsHuman["nh-#150"].session, "t150-build");
  const none = toBoard([issue(151, "Only odd", "state:needs-human", { comments: { nodes: [comments.nodes[1]] } })], []);
  assert.equal(none.needsHuman["nh-#151"].session, "unknown");
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

// Page 2, flow (#144): label history, doors since the last tag, CI.
const labeled = (name, createdAt) => ({ createdAt, label: { name } });

test("an issue's state-label history becomes one item.history event, and repeats append nothing", () => {
  const timelineItems = { nodes: [labeled("state:building", "2026-11-24T10:00:00Z"), labeled("enhancement", "2026-11-24T09:00:00Z"), labeled("state:ready", "2026-11-24T09:30:00Z")] };
  const board = toBoard([issue(160, "Hist", "state:building", { timelineItems })], []);
  const events = diff(empty(), board, TS).filter((e) => e.type === "item.history");
  assert.deepEqual(events.map((e) => [e.id, e.history]), [["#160", [{ state: "ready", at: "2026-11-24T09:30:00Z" }, { state: "building", at: "2026-11-24T10:00:00Z" }]]]);
  assert.deepEqual(diff(fold(empty(), diff(empty(), board, TS)), board, TS), []);
});

const commit = (committedDate) => ({ committedDate });
const DOORS = {
  refs: { nodes: [{ name: "nightly", target: commit("2026-11-23T00:00:00Z") }, { name: "v7.2.0", target: { target: commit("2026-11-20T13:00:00Z") } }, { name: "v7.1.0", target: commit("2026-11-19T00:00:00Z") }] },
  pullRequests: { nodes: [
    { number: 190, title: "after, two-way", mergedAt: "2026-11-24T01:00:00Z", labels: labels("door:two-way") },
    { number: 189, title: "after, unlabelled", mergedAt: "2026-11-22T01:00:00Z", labels: labels("enhancement") },
    { number: 150, title: "before the tag", mergedAt: "2026-11-20T12:00:00Z", labels: labels("door:one-way") },
  ] },
};
const CI = [
  { conclusion: "success", startedAt: "2026-11-24T07:00:00Z", updatedAt: "2026-11-24T07:06:00Z" },
  { conclusion: "failure", startedAt: "2026-11-24T06:00:00Z", updatedAt: "2026-11-24T06:01:00Z" },
];

test("doors merged since the last v-tag and the last CI runs become absolute events, and repeats append nothing", () => {
  const board = toBoard([], [], DOORS, CI);
  const events = diff(empty(), board, TS);
  const doors = events.find((e) => e.type === "doors");
  assert.equal(doors.tag, "v7.2.0");
  assert.deepEqual(doors.prs, [{ number: 190, title: "after, two-way", door: "two-way" }, { number: 189, title: "after, unlabelled", door: null }]);
  assert.deepEqual(events.find((e) => e.type === "ci").runs, [
    { conclusion: "success", started_at: "2026-11-24T07:00:00Z", ended_at: "2026-11-24T07:06:00Z" },
    { conclusion: "failure", started_at: "2026-11-24T06:00:00Z", ended_at: "2026-11-24T06:01:00Z" },
  ]);
  assert.deepEqual(diff(fold(empty(), events), board, TS), []);
  // a run with an empty conclusion is skipped, so it is not re-appended on every collect
  const withEmpty = toBoard([], [], null, [...CI, { conclusion: "", startedAt: "2026-11-24T05:00:00Z", updatedAt: "2026-11-24T05:01:00Z" }]);
  assert.equal(withEmpty.ci.length, 2);
  assert.deepEqual(diff(fold(empty(), events), withEmpty, TS), []);
  // without a tag every fetched merge counts
  assert.equal(toBoard([], [], { refs: { nodes: [] }, pullRequests: DOORS.pullRequests }).doors.tag, null);
});

test("a merge ask is in Needs you; a ticket in reviewing or building with an open PR is not", () => {
  const ask = { body: "Merge PR #210? Review passed on abc1234, CI green.", url: "https://github.com/o/r/issues/183#c9" };
  const b = toBoard(
    [
      issue(183, "Merge asks", "state:needs-human", { comments: { nodes: [ask] } }),
      issue(184, "Under review", "state:reviewing"),
      issue(185, "Back to build", "state:building"),
    ],
    [pr(210, "t183: merge asks", "state:needs-human"), pr(211, "t184: under review", "state:reviewing"), pr(212, "t185: back", "state:building")],
  );
  assert.deepEqual(Object.values(b.needsHuman).map((n) => [n.item, n.question, n.href]), [
    ["#183", "Merge PR #210? Review passed on abc1234, CI green.", "https://github.com/o/r/issues/183#c9"],
  ]);
});
