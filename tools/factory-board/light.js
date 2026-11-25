// The traffic light (rules: epic #131 and README.md). The watchdog and factory start call it once per reading:
//   node tools/factory-board/light.js --by watchdog|start < usage.json
// stdin: {"five_hour": {"pct", "resets_at"}, "weekly": {"pct", "resets_at"}, "sessions": [{"name", "running", "context_pct"}]}
// Factory shutdown calls it once, with no stdin:
//   node tools/factory-board/light.js --by shutdown --mode now|drain
// It writes $F/light.json atomically, appends one `light` and (not for shutdown) one `sessions` event, and prints
// {"light", "reason", "wake_s"}: the seconds until the next wake, null to stop.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEvents } from "./paths.js";

const H = 3600e3;
const WEEK = 168 * H;
const RANK = { green: 0, yellow: 1, red: 2 };
const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);

const window = (w) => {
  const pct = w?.pct;
  const resets = Date.parse(w?.resets_at);
  if (typeof pct !== "number" || !(pct >= 0 && pct <= 100) || Number.isNaN(resets)) return null;
  return { pct, resets_at: new Date(resets).toISOString() };
};

const sessionList = (v) =>
  (Array.isArray(v) ? v : [])
    .filter((x) => typeof x?.name === "string" && x.name !== "")
    .map((x) => ({
      name: x.name,
      running: x.running === true,
      context_pct: typeof x.context_pct === "number" && x.context_pct >= 0 && x.context_pct <= 100 ? x.context_pct : null,
    }));

// A window's own light holds until that window resets, so the light never flaps.
const held = (word, last, now) => (last?.light && now < Date.parse(last.resets_at) ? worse(word, last.light) : word);

export function decide({ input, last = null, now = Date.now(), by = "watchdog" }) {
  if (by !== "start" && last?.light === "off") return last;
  const draining = by !== "start" && last?.draining === true;
  const sessions = sessionList(input?.sessions);
  const base = { set_at: new Date(now).toISOString(), set_by: by, draining, sessions: sessions.filter((s) => s.running).map((s) => s.name) };
  const five = window(input?.five_hour);
  const week = window(input?.weekly);
  if (!five || !week) {
    const keep = (w) => w ?? { pct: 0, resets_at: null };
    return { light: "yellow", slots: 0, pace: 0, reason: "usage unavailable", resume_at: null, ...base, five_hour: keep(last?.five_hour), weekly: keep(last?.weekly) };
  }

  const elapsed = WEEK - (Date.parse(week.resets_at) - now);
  const target = (97 * elapsed) / WEEK;
  const raw = elapsed < 24 * H ? 0 : week.pct / target; // slots from the unrounded pace, so 1.004 is over 1.0
  const pace = Math.round(100 * raw) / 100;
  const slots = raw <= 1.0 ? 3 : raw <= 1.1 ? 2 : raw <= 1.2 ? 1 : 0;

  const fiveNow = five.pct >= 90 ? "red" : five.pct >= 70 ? "yellow" : "green";
  five.light = held(fiveNow, last?.five_hour, now);
  week.light = held(week.pct >= 97 ? "red" : "green", last?.weekly, now);
  let light = worse(five.light, week.light);
  let resume_at = null;
  let reason = `weekly pace ${pace.toFixed(2)}, ${slots} slots; 5-hour ${five.pct}%`;
  if (week.light === "red") {
    resume_at = week.resets_at;
    reason = `weekly ${week.pct}%, resumes ${week.resets_at}`;
  } else if (five.light !== "green") {
    if (light === "red") resume_at = five.resets_at;
    reason = `5-hour ${five.pct}%` + (five.light !== fiveNow ? `, ${five.light} held until its reset` : "");
  }
  if (draining && light === "green") {
    light = "yellow";
    reason = "draining: waiting for runs to finish their station";
  }
  if (draining && !sessions.some((s) => s.running && s.name !== "watchdog")) {
    light = "off";
    reason = "shut down (drain)";
  }
  return { light, slots, pace, reason, resume_at, ...base, five_hour: five, weekly: week };
}

// Shutdown changes only the light word and draining; the held windows stay, so a drain can't drop a held red (#175).
export function shutdown({ last, mode, now = Date.now() }) {
  const keep = { slots: 0, pace: 0, resume_at: null, sessions: [], five_hour: { pct: 0, resets_at: null }, weekly: { pct: 0, resets_at: null }, ...last };
  const base = { ...keep, set_at: new Date(now).toISOString(), set_by: "shutdown" };
  if (mode === "now" || last?.light === "off") return { ...base, light: "off", draining: false, reason: last?.light === "off" ? last.reason : "shutdown now" };
  return { ...base, light: last?.light === "red" ? "red" : "yellow", draining: true, reason: "draining" };
}

// What runs act on: a missing light, or one over 45 minutes old, counts as yellow.
export function effective(file, now = Date.now()) {
  if (!file?.light || !(now - Date.parse(file.set_at) <= 45 * 60e3)) return "yellow";
  return file.light;
}

export function wakeSeconds(file, now = Date.now()) {
  if (file.light === "off") return null;
  if (file.light !== "red") return file.light === "green" ? 1200 : 600;
  return Math.min(3600, Math.max(60, Math.round((Date.parse(file.resume_at) - now) / 1000)));
}

export function run({ input, by, mode, lightPath, eventsPath, now = Date.now() }) {
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(lightPath, "utf8"));
  } catch {} // no light yet, or unreadable: computed fresh
  const file = by === "shutdown" ? shutdown({ last, mode, now }) : decide({ input, last, now, by });
  if (file === last) return { light: "off", reason: last.reason, wake_s: null };
  fs.mkdirSync(path.dirname(lightPath), { recursive: true, mode: 0o700 });
  const tmp = `${lightPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file) + "\n");
  fs.renameSync(tmp, lightPath);
  const ts = file.set_at;
  const { set_by, draining, ...light } = file;
  const lines = [{ v: 1, ts, type: "light", ...light }];
  if (by !== "shutdown") lines.push({ v: 1, ts, type: "sessions", sessions: sessionList(input?.sessions) });
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(eventsPath, lines.map((l) => JSON.stringify(l) + "\n").join(""));
  return { light: file.light, reason: file.reason, wake_s: wakeSeconds(file, now) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const by = arg("--by");
  const mode = arg("--mode");
  if (!["watchdog", "start", "shutdown"].includes(by) || (by === "shutdown") !== ["now", "drain"].includes(mode)) {
    console.error("usage: node light.js --by watchdog|start < usage.json\n       node light.js --by shutdown --mode now|drain");
    process.exit(2);
  }
  let input = null;
  if (by !== "shutdown") {
    try {
      input = JSON.parse(fs.readFileSync(0, "utf8"));
    } catch {} // unreadable usage: the light says "usage unavailable"
  }
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const events = defaultEvents(dir);
  const out = run({ input, by, mode, lightPath: path.join(path.dirname(events), "light.json"), eventsPath: process.env.EVENTS ?? events });
  console.log(JSON.stringify(out));
}
