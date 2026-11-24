// Run: node --test tools/factory-board/light.check.js
// Covers every worked example of the light rules in epic #131.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, effective, run, wakeSeconds } from "./light.js";

const H = 3600e3;
const now = Date.parse("2026-11-23T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const usage = (five, fiveResetIn, week, weekResetIn, sessions = []) => ({
  five_hour: { pct: five, resets_at: iso(now + fiveResetIn) },
  weekly: { pct: week, resets_at: iso(now + weekResetIn) },
  sessions,
});

test("weekly 81% with 1 d 9 h to reset: target 77.9, pace 1.04, 2 slots, green", () => {
  const l = decide({ input: usage(10, 2 * H, 81, 33 * H), now });
  assert.deepEqual([l.light, l.pace, l.slots], ["green", 1.04, 2]);
  assert.equal(l.resume_at, null);
});

test("first day after the weekly reset: pace 0, 3 slots; 5-hour still applies", () => {
  const l = decide({ input: usage(10, 2 * H, 4, 166 * H), now }); // 2 h in: pace would be 3.47
  assert.deepEqual([l.light, l.pace, l.slots], ["green", 0, 3]);
  assert.equal(decide({ input: usage(92, 2 * H, 4, 166 * H), now }).light, "red");
});

test("25 hours after the weekly reset: pace is computed", () => {
  const l = decide({ input: usage(10, 2 * H, 16, 143 * H), now }); // target 14.43
  assert.deepEqual([l.light, l.pace, l.slots], ["green", 1.11, 1]);
});

test("slots step down with pace", () => {
  const slots = (week) => decide({ input: usage(10, 2 * H, week, 84 * H), now }).slots; // target 48.5
  assert.deepEqual([slots(48), slots(50), slots(54), slots(59)], [3, 2, 1, 0]);
  // just over a threshold rounds to it but still loses the slot
  assert.deepEqual([slots(48.7), slots(53.37), slots(58.22)], [2, 1, 0]);
});

test("5-hour sets green, yellow, red; red resumes at its reset", () => {
  const word = (five) => decide({ input: usage(five, 2 * H, 10, 100 * H), now }).light;
  assert.deepEqual([word(69), word(70), word(89), word(90)], ["green", "yellow", "yellow", "red"]);
  const red = decide({ input: usage(92, 2 * H, 10, 100 * H), now });
  assert.equal(red.resume_at, iso(now + 2 * H));
  assert.match(red.reason, /5-hour 92%/);
});

test("weekly 97%+ is red until the weekly reset", () => {
  const l = decide({ input: usage(10, 2 * H, 97, 30 * H), now });
  assert.equal(l.light, "red");
  assert.equal(l.resume_at, iso(now + 30 * H));
  assert.match(l.reason, /weekly 97%/);
});

test("last red from 5-hour 92%, now 5-hour 40% and that window has not reset: stays red", () => {
  const last = decide({ input: usage(92, 2 * H, 10, 100 * H), now: now - 0.5 * H });
  const l = decide({ input: usage(40, 2 * H, 10, 100 * H), last, now });
  assert.equal(l.light, "red");
  assert.equal(l.resume_at, iso(now + 2 * H));
  // Once that window resets, it moves toward green.
  const after = decide({ input: usage(5, 5 * H, 10, 98 * H), last: l, now: now + 2 * H + 60e3 });
  assert.equal(after.light, "green");
});

test("a held yellow keeps holding across several wakes", () => {
  let last = decide({ input: usage(75, 2 * H, 10, 100 * H), now });
  for (const t of [0.3, 0.6, 0.9]) last = decide({ input: usage(40, 2 * H, 10, 100 * H), last, now: now + t * H });
  assert.equal(last.light, "yellow");
});

test("a light file over 45 min old reads as yellow", () => {
  const l = decide({ input: usage(10, 2 * H, 10, 100 * H), now });
  assert.equal(effective(l, now + 44 * 60e3), "green");
  assert.equal(effective(l, now + 46 * 60e3), "yellow");
  assert.equal(effective(null, now), "yellow");
});

test("draining is no greener than yellow, then off when no run is in flight", () => {
  const last = { ...decide({ input: usage(10, 2 * H, 10, 100 * H), now }), light: "yellow", draining: true, set_by: "shutdown" };
  const busy = decide({ input: usage(10, 2 * H, 10, 100 * H, [{ name: "t1-build", running: true, context_pct: 40 }]), last, now });
  assert.deepEqual([busy.light, busy.draining], ["yellow", true]);
  const idle = decide({ input: usage(10, 2 * H, 10, 100 * H, [{ name: "watchdog", running: true, context_pct: 9 }, { name: "t1-build", running: false, context_pct: null }]), last, now });
  assert.equal(idle.light, "off");
});

test("off stays off for the watchdog; start turns it back on", () => {
  const last = { ...decide({ input: usage(10, 2 * H, 10, 100 * H), now }), light: "off", set_by: "shutdown" };
  assert.equal(decide({ input: usage(10, 2 * H, 10, 100 * H), last, now }).light, "off");
  const on = decide({ input: usage(10, 2 * H, 10, 100 * H), last: { ...last, draining: true }, now, by: "start" });
  assert.deepEqual([on.light, on.set_by, on.draining], ["green", "start", false]);
});

test("missing or malformed usage writes yellow, usage unavailable", () => {
  for (const input of [{}, { five_hour: { pct: "x" }, weekly: { pct: 1 } }, usage(10, 2 * H, 140, 10 * H)]) {
    const l = decide({ input, now });
    assert.deepEqual([l.light, l.reason], ["yellow", "usage unavailable"]);
  }
});

test("next wake: 20 min green, 10 yellow, at the reset on red (clamped), none when off", () => {
  const at = (five) => decide({ input: usage(five, 30 * 60e3, 10, 100 * H), now });
  assert.equal(wakeSeconds(at(10), now), 1200);
  assert.equal(wakeSeconds(at(75), now), 600);
  assert.equal(wakeSeconds(at(95), now), 1800);
  assert.equal(wakeSeconds({ ...at(95), resume_at: iso(now + 5 * H) }, now), 3600);
  assert.equal(wakeSeconds({ ...at(10), light: "off" }, now), null);
});

test("run writes the light file atomically and appends one light and one sessions event", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "light-"));
  const lightPath = path.join(dir, "f", "light.json");
  const eventsPath = path.join(dir, "f", "events.jsonl");
  const sessions = [{ name: "t1-build", running: true, context_pct: 42 }, { name: "t2-verify", running: false, context_pct: null }];
  const out = run({ input: usage(10, 2 * H, 10, 100 * H, sessions), by: "watchdog", lightPath, eventsPath, now });
  const file = JSON.parse(fs.readFileSync(lightPath, "utf8"));
  assert.deepEqual([file.light, file.set_by, file.sessions], ["green", "watchdog", ["t1-build"]]);
  assert.deepEqual(fs.readdirSync(path.dirname(lightPath)).sort(), ["events.jsonl", "light.json"]); // no temp left behind
  assert.deepEqual(out, { light: "green", reason: file.reason, wake_s: 1200 });
  const events = fs.readFileSync(eventsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.type), ["light", "sessions"]);
  assert.deepEqual(events[1].sessions, sessions);
  // An off light is left as it is: nothing written, no wake.
  fs.writeFileSync(lightPath, JSON.stringify({ ...file, light: "off" }));
  assert.equal(run({ input: usage(10, 2 * H, 10, 100 * H), by: "watchdog", lightPath, eventsPath, now }).wake_s, null);
  assert.equal(fs.readFileSync(eventsPath, "utf8").trim().split("\n").length, 2);
});
