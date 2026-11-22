// Simulator: appends fake factory events to the events file, in a loop, so the
// board's animations can be watched. All epics, tickets and numbers are fake.
// Usage: node simulate.js   (env: SIM_EVENTS, SPEED=2 runs twice as fast)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEvents, simEvents } from "./paths.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const EVENTS = path.resolve(process.env.SIM_EVENTS ?? simEvents(dir));
if (EVENTS === path.resolve(process.env.EVENTS ?? defaultEvents(dir))) {
  console.error(`simulate.js: refusing to write the real events file ${EVENTS}`);
  process.exit(1);
}
const SPEED = Number(process.env.SPEED ?? 1);
const sleep = (s) => new Promise((r) => setTimeout(r, (s * 1000) / SPEED));
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const later = (s) => new Date(Date.now() + (s * 1000) / SPEED).toISOString();

function emit(type, fields = {}) {
  fs.appendFileSync(EVENTS, JSON.stringify({ v: 1, ts: new Date().toISOString(), type, ...fields }) + "\n");
}

const EPICS = [
  { id: "E101", number: 101, title: "Foundations", start: "ready", tickets: [
    [201, "Split the schema module", "ready"],
    [202, "Shared money formatter", "ready"],
    [203, "Run log writer", "shaping"],
    [204, "State label check in CI", "shaping"],
  ] },
  { id: "E102", number: 102, title: "Accounts and debts", start: "shaping", tickets: [
    [211, "Owner label on accounts", "shaping"],
    [212, "Debt account type", "intake"],
    [213, "Interest rate field", "intake"],
    [214, "Payoff estimate card", "intake"],
    [215, "Debt list page", "intake"],
  ] },
  // Stays put all cycle, so the early columns never go empty.
  { id: "E103", number: 103, title: "Budgets", start: "intake", frozen: true, tickets: [
    [221, "Monthly budget table", "intake"],
    [222, "Budget vs spending view", "intake"],
  ] },
];
const NEXT = { intake: "shaping", shaping: "ready", ready: "building", building: "verifying", verifying: "reviewing", reviewing: "merged" };
const STATION = { building: "build", verifying: "verify", reviewing: "review" };
const COST = { building: [3000, 14000], verifying: [1000, 5000], reviewing: [2000, 7000] };
const RANK = { green: 0, yellow: 1, red: 2, off: 3 };
// A run leaves its station only after burning this many tokens, so stations take a few ticks.
const BUDGET = { build: 30000, verify: 9000, review: 14000 };

async function cycle(n) {
  if (n === 1) {
    fs.mkdirSync(path.dirname(EVENTS), { recursive: true });
    fs.writeFileSync(EVENTS, ""); // truncate: the server starts over
    emit("reset");
  }
  // Later cycles re-upsert the same cards back to their start columns; tokens and the last retros carry over.
  const fr = `fr-${n}`;
  emit("factory_run.start", { id: fr });

  const tickets = [];
  for (const ep of EPICS) {
    ep.cur = ep.start;
    emit("item.upsert", { id: ep.id, kind: "epic", number: ep.number, title: ep.title, state: ep.start });
    for (const [num, title, state] of ep.tickets) {
      const t = { id: `T${num}`, num, title, state, epic: ep.id, frozen: ep.frozen, slug: title.toLowerCase().split(" ").slice(0, 2).join("-") };
      tickets.push(t);
      emit("item.upsert", { id: t.id, kind: "ticket", number: num, title, state, epic: ep.id });
    }
  }
  let eject = null, ejectedOnce = false, tick = 0;
  const runs = new Map(); // ticket id -> { run, session, station, tokens }
  const setState = (t, state) => {
    t.state = state;
    emit("item.state", { id: t.id, state });
    if (STATION[state]) {
      const r = { run: `r${t.num}-${STATION[state]}-${n}`, session: `t${t.num}-${STATION[state]}-${t.slug}`, station: STATION[state], tokens: 0 };
      runs.set(t.id, r);
      emit("run.tokens", { run: r.run, session: r.session, item: t.id, station: r.station, tokens: 0 });
    } else runs.delete(t.id);
    if (state === "reviewing") emit("item.upsert", { id: `P${t.num}`, kind: "pr", number: t.num + 100, title: `PR: ${t.title}`, state, epic: t.epic });
    if (state === "merged") emit("item.remove", { id: `P${t.num}` }); // the merged ticket stands for its PR
    for (const ep of EPICS.filter((e) => e.id === t.epic && !e.frozen)) {
      const mine = tickets.filter((x) => x.epic === ep.id);
      const epState = mine.every((x) => x.state === "merged") ? "merged" : mine.some((x) => STATION[x.state]) ? "building" : null;
      if (epState && epState !== ep.cur) emit("item.state", { id: ep.id, state: (ep.cur = epState) });
    }
  };
  const budgetLeft = (t) => STATION[t.state] && runs.get(t.id).tokens < BUDGET[STATION[t.state]];
  // In flight: still working a station, waiting on the human, or about to merge.
  const inFlight = () => tickets.some((t) => t.state === "needs-human" || t.state === "reviewing" || budgetLeft(t));

  // The watchdog: sets the light from the usage windows (thresholds: README).
  // The cycle walks green -> yellow -> red -> (window reset) -> green -> stale -> green -> drain (yellow) -> off.
  let word = "green", why = "", fiveReset = later(4 * 3600), burn = 9000;
  // Weekly starts a little ahead of its straight-line target, so pacing gives 2 slots and drops to 1 as the week's use grows.
  const weeklyReset = Date.now() + 4 * 86400000; // weekly reset is days away, so it is real time, not SPEED time
  let five = 52, weekly = 44, staleUntil = 0, staleDone = false, resetDone = false, drain = false;
  const fromUsage = () => {
    const f = five >= 90 ? "red" : five >= 70 ? "yellow" : "green";
    // Only the 5-hour window sets the light; the weekly one only paces slots, except at 97%+ it is red until its reset.
    return weekly >= 97 ? ["red", `weekly ${Math.round(weekly)}%`] : [f, `5-hour ${Math.round(five)}%`];
  };
  const watch = () => {
    if (word === "off") return; // only the start skill turns it back on
    if (word === "red" && Date.now() >= Date.parse(fiveReset)) {
      five = 3; // the 5-hour window resets: the only way back toward green
      fiveReset = later(5 * 3600);
      burn = 40000; // a quieter window after the reset, so the cycle reaches the drain
      resetDone = true;
      [word, why] = fromUsage();
    } else if (drain) {
      [word, why] = inFlight() ? ["yellow", "shutdown (drain): waiting for runs to finish their station"] : ["off", "shut down by you (drain)"];
    } else {
      const [w, r] = fromUsage();
      if (RANK[w] > RANK[word]) {
        word = w;
        if (w === "red") fiveReset = later(30); // pretend the window resets soon, so the countdown is short
      }
      if (w === word || RANK[w] > RANK[word]) why = r;
      else why = `${r}, held until the window resets`;
    }
    if (staleDone && Date.now() < staleUntil) return; // the watchdog is "down": it writes nothing
    emit("light", {
      light: word,
      reason: why,
      resume_at: word !== "red" ? null : weekly >= 97 ? new Date(weeklyReset).toISOString() : fiveReset,
      // Once per cycle the watchdog writes a light that is 45 minutes old minus a few seconds, then goes quiet, so the page sees it go stale.
      set_at: staleUntil && !staleDone ? ((staleDone = true), new Date(Date.now() - 45 * 60000 + 4000 / SPEED).toISOString()) : new Date().toISOString(),
      five_hour: { pct: Math.min(100, Math.round(five)), resets_at: fiveReset },
      weekly: { pct: Math.min(100, Math.round(weekly)), resets_at: new Date(weeklyReset).toISOString() },
      ...pacing(),
      sessions: [...runs.values()].map((r) => r.session),
    });
  };
  // Pace = weekly used / straight-line target (0 -> 97% across the week); slots follow the pace.
  const pacing = () => {
    const target = 97 * (1 - (weeklyReset - Date.now()) / (7 * 86400000));
    const pace = Math.round((weekly / target) * 100) / 100;
    return { pace, slots: pace <= 1 ? 3 : pace <= 1.1 ? 2 : pace <= 1.2 ? 1 : 0 };
  };
  // What runs act on: a stale light counts as yellow.
  const effective = () => (Date.now() < staleUntil ? "yellow" : word);
  watch();

  while (word !== "off") {
    await sleep(1.5);
    tick++;
    const light = effective();
    if (resetDone && !staleDone && !staleUntil && tick % 4 === 0) staleUntil = Date.now() + 16000 / SPEED;
    if (staleUntil && Date.now() >= staleUntil && staleDone) staleUntil = 0;
    // Runs burn tokens: on green always, on yellow only to finish their station, on red or off never.
    // Other use of the account (your own chats) fills the 5-hour window a little too.
    if (light !== "red" && light !== "off") {
      five += 12000 / burn;
      for (const [id, r] of runs) {
        const t = tickets.find((x) => x.id === id);
        if (t.state === "needs-human" || (light === "yellow" && !budgetLeft(t))) continue;
        const add = rand(...COST[t.state]);
        r.tokens += add;
        five += add / burn;
        weekly += add / 150000;
        emit("run.tokens", { run: r.run, session: r.session, item: id, station: r.station, tokens: r.tokens });
      }
    }
    if (!drain && tickets.filter((t) => t.state === "merged").length >= 5) drain = true;
    watch();
    // One eject per cycle: a building run hands a question to the human, which clears later.
    const building = tickets.filter((t) => t.state === "building");
    if (!ejectedOnce && tick > 6 && building.length) {
      ejectedOnce = true;
      const t = pick(building);
      eject = { t, until: tick + 12, id: `nh-${t.num}-${n}`, session: runs.get(t.id).session };
      t.state = "needs-human";
      emit("item.state", { id: t.id, state: "needs-human" });
      emit("needs_human.open", { id: eject.id, item: t.id, session: eject.session, question: `Should "${t.title}" store the rate as basis points or a percent string?` });
    } else if (eject && tick >= eject.until) {
      emit("needs_human.clear", { id: eject.id });
      eject.t.state = "building";
      emit("item.state", { id: eject.t.id, state: "building" });
      eject = null;
    }
    // Advance one or two cards a station. Green: anything. Yellow: only a review may finish (merge). Red, off: nothing.
    for (let k = Math.random() < 0.3 ? 2 : 1; k > 0; k--) {
      const active = tickets.filter((t) => STATION[t.state] || t.state === "needs-human").length;
      const movable = tickets.filter((t) =>
        !t.frozen && NEXT[t.state] &&
        (light === "green" || (light === "yellow" && t.state === "reviewing")) &&
        (t.state !== "ready" || active < pacing().slots) &&
        !budgetLeft(t));
      if (!movable.length) break;
      const t = pick(movable);
      setState(t, NEXT[t.state]);
    }
  }
  await sleep(3);
  for (const t of tickets.filter((x) => x.state === "merged")) {
    emit("item.state", { id: t.id, state: "released" });
    await sleep(0.3);
  }
  for (const ep of EPICS.filter((e) => e.cur === "merged")) emit("item.state", { id: ep.id, state: "released" });
  emit("factory_run.end", {
    id: fr,
    retros: [
      { title: `Run ${fr} retrospective`, href: `retros/${fr}.html` },
      { title: `Foundations epic retro (${fr})`, href: `retros/${fr}-foundations.html` },
    ],
  });
  await sleep(25);
}

for (let n = 1; ; n++) await cycle(n);
