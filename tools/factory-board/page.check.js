// Run: node --test tools/factory-board/page.check.js
// The board page's logic (page.js) and its palette (index.html), ticket #143.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATES, boardModel, dur, lightView, page2Tiles, usageChart, readMode, slotsLine } from "./page.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60e3;
const now = Date.parse("2026-11-24T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

const snap = {
  items: [
    { id: "#10", kind: "epic", number: 10, title: "Epic A", state: "building" },
    { id: "#12", kind: "ticket", number: 12, epic: "#10", title: "Two", state: "building", session: "t12-build" },
    { id: "#11", kind: "ticket", number: 11, epic: "#10", title: "One", state: "merged" },
    { id: "#13", kind: "ticket", number: 13, epic: "#10", title: "Three", state: "needs-human", session: "t13-build" },
    { id: "#20", kind: "ticket", number: 20, title: "Loose", state: "intake" },
  ],
  epics: [{ id: "#10", title: "Epic A", done: 1, total: 3 }],
  needsHuman: [
    { id: "nh-#13", item: "#13", session: "t13-build", question: "Round up or down?", href: "https://github.com/x/y/issues/13#c1" },
    { id: "nh-#99", item: "#99", session: "t99-build", question: "Orphan?", href: null },
  ],
  sessions: [],
  light: null,
};

test("both views show all eight spine columns in order, empty ones included", () => {
  for (const mode of ["kanban", "lanes"]) {
    const m = boardModel(snap, mode);
    assert.deepEqual(m.heads.map((h) => h.state), STATES, mode);
    for (const row of m.rows) assert.deepEqual(row.cells.map((c) => c.state), STATES, mode);
  }
  assert.equal(STATES.length, 8);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(html, new RegExp(`\\.board \\{[^}]*repeat\\(${STATES.length}, minmax`), "grid column count matches STATES");
  assert.ok(!STATES.includes("verifying"), "Verify is not a station (#208)");
});

test("kanban is one row, epics first then by number; lanes are one row per epic plus No epic", () => {
  const k = boardModel(snap, "kanban");
  assert.equal(k.rows.length, 1);
  assert.deepEqual(k.rows[0].cells.find((c) => c.state === "building").items.map((i) => i.id), ["#10", "#12"]);
  assert.equal(k.heads.find((h) => h.state === "building").count, 2);

  const l = boardModel(snap, "lanes");
  assert.deepEqual(l.rows.map((r) => r.epic?.id ?? null), ["#10", null]);
  // the epic is the lane, not a card
  assert.deepEqual(l.rows[0].cells.find((c) => c.state === "building").items.map((i) => i.id), ["#12"]);
  assert.equal(l.heads.find((h) => h.state === "building").count, 1);
  assert.deepEqual(l.rows[1].cells.find((c) => c.state === "intake").items.map((i) => i.id), ["#20"]);
});

test("a needs-human card carries its question, session and latest comment link; nothing is lost without a card", () => {
  for (const mode of ["kanban", "lanes"]) {
    const nh = boardModel(snap, mode).rows.flatMap((r) => r.cells.find((c) => c.state === "needs-human").items);
    const c13 = nh.find((i) => i.id === "#13");
    assert.deepEqual(c13.ask, { session: "t13-build", question: "Round up or down?", href: "https://github.com/x/y/issues/13#c1" });
    const orphan = nh.find((i) => i.id === "nh-#99");
    assert.equal(orphan.ask.question, "Orphan?", mode);
    assert.equal(orphan.ask.href, null);
  }
});

test("a link that is not http(s) is dropped", () => {
  const s = { ...snap, needsHuman: [{ id: "nh-#13", item: "#13", session: "s", question: "q", href: "javascript:alert(1)" }] };
  const c = boardModel(s, "kanban").rows[0].cells.find((x) => x.state === "needs-human").items[0];
  assert.equal(c.ask.href, null);
});

test("the view choice is remembered, kanban by default", () => {
  const store = (v) => ({ getItem: () => v });
  assert.equal(readMode(store("lanes")), "lanes");
  assert.equal(readMode(store("kanban")), "kanban");
  assert.equal(readMode(store(null)), "kanban");
  assert.equal(readMode(store("junk")), "kanban");
  assert.equal(readMode({ getItem: () => { throw new Error("blocked"); } }), "kanban");
});

test("light view: fresh, stale (over 45 min counts as yellow), red with countdown, none", () => {
  const l = { light: "green", reason: "5-hour 41%", set_at: iso(now - 4 * MIN), resume_at: null, slots: 3, pace: 0.5, sessions: [] };
  assert.deepEqual([lightView(l, now).word, lightView(l, now).label, lightView(l, now).stale], ["green", "green", false]);
  const stale = lightView({ ...l, set_at: iso(now - 52 * MIN) }, now);
  assert.deepEqual([stale.word, stale.label, stale.stale], ["yellow", "yellow (stale)", true]);
  assert.match(stale.reason, /Last light: green/);
  assert.match(stale.age, /Not updated for 52 min/);
  assert.equal(lightView({ ...l, set_at: "garbage" }, now).stale, true);
  const red = lightView({ ...l, light: "red", resume_at: iso(now + 38 * MIN) }, now);
  assert.equal(red.resume, "resumes in 38:00");
  assert.equal(lightView(null, now).label, "no light");
});

test("slots and sessions line", () => {
  const light = { slots: 3, pace: 0.96, sessions: ["a", "b"] };
  assert.equal(slotsLine({ ...snap, light }), "2 of 3 run slots in use · weekly pace 0.96 · sessions: a, b");
  const sessions = [{ name: "watchdog", running: true, context_pct: 12 }, { name: "idle", running: false, context_pct: 5 }, { name: "x", running: true, context_pct: null }];
  assert.equal(slotsLine({ ...snap, light, sessions }), "2 of 3 run slots in use · weekly pace 0.96 · sessions: watchdog 12%, x");
  assert.equal(slotsLine({ ...snap, light: null }), "");
});

// WCAG 2.1 contrast over the page's own palette.
function lum(hex) {
  const c = hex.match(/\w\w/g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function vars(css, selector) {
  const body = css.slice(css.indexOf(selector + " {")).match(/\{([^}]*)\}/)[1];
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

test("WCAG 2.1 AA contrast in both themes and in the band", () => {
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const light = vars(html, ":root");
  const themes = { light, dark: { ...light, ...vars(html, '[data-theme="dark"]') } };
  const text = [["ink", "bg"], ["ink", "panel"], ["ink", "sub"], ["muted", "bg"], ["muted", "panel"], ["muted", "sub"], ["link", "panel"], ["link", "bg"], ["warn", "warn-bg"], ["ink", "warn-bg"], ["muted", "warn-bg"], ["warn", "sub"]];
  const ui = [["focus", "bg"], ["focus", "panel"], ["warn-line", "panel"], ["g3", "track"], ["g3", "panel"], ["chart-yellow", "panel"], ["chart-red", "panel"]];
  for (const [name, t] of Object.entries(themes)) {
    for (const [a, b] of text) assert.ok(ratio(t[a], t[b]) >= 4.5, `${name}: --${a} on --${b} is ${ratio(t[a], t[b]).toFixed(2)}`);
    for (const [a, b] of ui) assert.ok(ratio(t[a], t[b]) >= 3, `${name}: --${a} on --${b} is ${ratio(t[a], t[b]).toFixed(2)}`);
  }
  const band = vars(html, ".band");
  for (const k of ["band-ink", "band-muted", "l-green", "l-yellow", "l-red", "l-off"]) assert.ok(ratio(band[k], band["band-bg"]) >= 4.5, `band: --${k} is ${ratio(band[k], band["band-bg"]).toFixed(2)}`);
});

// Page 2, flow (#144).
test("page-2 tiles: next version and CI pass rate, or say there is no data", () => {
  const counts = { "one-way": 0, "two-way": 1, none: 2, docs: 6, unlabelled: 1 };
  const [v, ci] = page2Tiles({ doors: { tag: "v7.2.1", next: "v7.3.0", counts }, ci: { passed: 27, of: 30, median_ms: 400e3 } });
  assert.deepEqual([v.value, v.sub], ["v7.3.0", "from 1 two-way, 2 none since v7.2.1 · 1 unlabelled"]);
  assert.deepEqual([ci.value, ci.sub], ["90%", "27 of the last 30 runs · median 6 m 40 s"]);
  const none = { "one-way": 0, "two-way": 0, none: 0, docs: 0, unlabelled: 0 };
  assert.deepEqual(page2Tiles({ doors: { tag: "v7.2.1", next: null, counts: { ...none, docs: 2 } }, ci: null }).slice(0, 2).map((x) => [x.value, x.sub]), [
    ["no release", "only docs since v7.2.1"], ["–", "No completed CI runs yet."],
  ]);
  assert.deepEqual(page2Tiles({ doors: { tag: "v7.2.1", next: null, counts: none }, ci: null })[0].sub, "Nothing merged since v7.2.1.");
  assert.deepEqual(page2Tiles({ doors: null, ci: null })[0].sub, "No tag or merge data yet.");
});

test("durations read in the two largest units", () => {
  assert.deepEqual([dur(40e3), dur(400e3), dur(5400e3), dur(2 * 86400e3 + 4 * 3600e3)], ["40 s", "6 m 40 s", "1 h 30 m", "2 d 4 h"]);
  assert.equal(dur(null), "—"); // no time yet (#194)
});

test("page 2 opens from page 1 and back, sharing the status band", () => {
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(html, /href="#p2"/);
  assert.match(html, /href="#"/);
  assert.equal((html.match(/id="band"/g) ?? []).length, 1);
  assert.match(html, /fetch\("\/api\/page2"\)/);
});

// Page 2, cost and usage (#145).
test("page-2 tiles: weekly pace and cache hits, or say there is no data", () => {
  const [, , pace, cache] = page2Tiles({ doors: null, ci: null, weekly: { pct: 34, pace: 1.34, slots: 0 }, cache: { overall: 0.876 } });
  assert.deepEqual([pace.title, pace.value, pace.sub], ["Weekly pace", "1.34", "34% used · 0 run slots"]);
  assert.deepEqual([cache.title, cache.value, cache.sub], ["Cache hits", "88%", "of all input tokens, every run in the log"]);
  assert.deepEqual(page2Tiles({ doors: null, ci: null, weekly: null, cache: null }).slice(2).map((x) => [x.value, x.sub]), [
    ["–", "No weekly usage reading yet."], ["–", "No cache counts yet."],
  ]);
});

test("usage chart: points across the window; weekly target to 97% at the reset; 5-hour lines at 70% and 90%", () => {
  const win = { start: "2026-11-24T00:00:00Z", end: "2026-11-24T10:00:00Z", points: [{ at: "2026-11-24T00:00:00Z", pct: 0 }, { at: "2026-11-24T05:00:00Z", pct: 50 }] };
  const wk = usageChart(win, "weekly");
  assert.equal(wk.points, "0.0,120.0 160.0,60.0");
  assert.deepEqual(wk.lines, [{ cls: "target", x1: 0, y1: 120, x2: 320, y2: 3.6 }]);
  assert.deepEqual(usageChart(win, "five").lines.map((l) => [l.cls, l.y1, l.y2]), [["limit", 36, 36], ["limit hot", 12, 12]]);
  assert.equal(usageChart({ ...win, points: [] }, "five").points, "");
});
