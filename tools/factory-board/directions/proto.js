// Design-direction prototypes (#142): fixed fake data and shared helpers. Not served by server.js; open the files directly.
// URL params: theme=light|dark, light=green|yellow|red|off|stale, nh=0 (nothing needs you). Hash #p2 shows page 2.
const P = new URLSearchParams(location.search);
document.documentElement.dataset.theme = P.get("theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

const NOW = Date.now(), MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();
const ahead = (ms) => new Date(NOW + ms).toISOString();

const STATES = ["intake", "shaping", "ready", "building", "verifying", "reviewing", "merged", "released", "needs-human"];
const LABEL = { "needs-human": "needs human" };
const GROUPS = [
  { name: "Queue", states: ["intake", "shaping", "ready"] },
  { name: "In flight", states: ["building", "verifying", "reviewing"] },
  { name: "Done", states: ["merged", "released"] },
];
const ACTIVE = ["building", "verifying", "reviewing", "needs-human"];

const LIGHTS = {
  green: { light: "green", reason: "5-hour 41%", five: 41 },
  yellow: { light: "yellow", reason: "5-hour 74%", five: 74 },
  red: { light: "red", reason: "5-hour 92%", five: 92, resume_at: ahead(38 * MIN) },
  off: { light: "off", reason: "shut down", five: 30, resume_at: null },
};
const lp = P.get("light") ?? "yellow";
const L = LIGHTS[lp === "stale" ? "green" : lp] ?? LIGHTS.yellow;

const DATA = {
  light: {
    light: L.light, reason: L.reason, resume_at: L.resume_at ?? null, slots: 3, pace: 0.96,
    set_at: lp === "stale" ? ago(52 * MIN) : ago(4 * MIN),
    five_hour: { pct: L.five, resets_at: ahead(72 * MIN) },
    weekly: { pct: 61, resets_at: ahead(2 * DAY + 3 * HOUR) },
  },
  sessions: [
    { name: "watchdog", running: true, context_pct: 12 },
    { name: "t213-review-interest-rate", running: true, context_pct: 34 },
    { name: "t212-verify-debt-account", running: true, context_pct: 58 },
    { name: "t214-build-payoff-estimate", running: false, context_pct: 71 },
  ],
  items: [
    { id: "E101", kind: "epic", number: 101, title: "Foundations", state: "building" },
    { id: "T201", kind: "ticket", number: 201, epic: "E101", title: "Split the schema module", state: "merged" },
    { id: "T202", kind: "ticket", number: 202, epic: "E101", title: "Shared money formatter", state: "merged" },
    { id: "T203", kind: "ticket", number: 203, epic: "E101", title: "Run log writer", state: "merged" },
    { id: "T204", kind: "ticket", number: 204, epic: "E101", title: "State label check in CI", state: "ready" },
    { id: "E102", kind: "epic", number: 102, title: "Accounts and debts", state: "building" },
    { id: "T211", kind: "ticket", number: 211, epic: "E102", title: "Owner label on accounts", state: "merged" },
    { id: "T212", kind: "ticket", number: 212, epic: "E102", title: "Debt account type", state: "verifying", session: "t212-verify-debt-account", since: ago(21 * MIN) },
    { id: "T213", kind: "ticket", number: 213, epic: "E102", title: "Interest rate field", state: "reviewing", session: "t213-review-interest-rate", since: ago(9 * MIN) },
    { id: "P301", kind: "pr", number: 301, epic: "E102", title: "Interest rate field", state: "reviewing" },
    { id: "T214", kind: "ticket", number: 214, epic: "E102", title: "Payoff estimate card", state: "needs-human", session: "t214-build-payoff-estimate", since: ago(17 * MIN) },
    { id: "T215", kind: "ticket", number: 215, epic: "E102", title: "Debt list page", state: "ready" },
    { id: "E103", kind: "epic", number: 103, title: "Budgets", state: "intake" },
    { id: "T221", kind: "ticket", number: 221, epic: "E103", title: "Monthly budget table", state: "intake" },
    { id: "T222", kind: "ticket", number: 222, epic: "E103", title: "Budget vs spending view", state: "intake" },
  ],
  epics: [
    { id: "E101", number: 101, title: "Foundations", done: 3, total: 4 },
    { id: "E102", number: 102, title: "Accounts and debts", done: 1, total: 5 },
    { id: "E103", number: 103, title: "Budgets", done: 0, total: 2 },
  ],
  needsHuman: P.get("nh") === "0" ? [] : [
    { id: "nh-T214", item: "T214", session: "t214-build-payoff-estimate", question: "Round the payoff month up, or to the nearest month?", href: "#" },
  ],
  topRuns: [
    ["t212-build-debt-account", "opus", 184200], ["t204-build-state-label", "opus", 121900], ["t211-review-owner-label", "sonnet", 88400],
    ["t212-verify-debt-account", "sonnet", 61300], ["t214-build-payoff-estimate", "opus", 54800], ["t203-build-run-log", "opus", 49100],
    ["t213-review-interest-rate", "sonnet", 22700], ["t201-verify-split-the", "haiku", null],
  ].map(([session, model, tokens]) => ({ run: session, session, model, tokens })),
  totalTokens: 1284600,
  factoryRun: { id: "fr-20261124-0540", started_at: ago(3 * HOUR + 10 * MIN) },
  lastEndedRun: { id: "fr-20261123-2339", ended_at: ago(9 * HOUR), retros: [{ title: "Digest fr-20261123-2339", href: "#" }] },
  github: { ok: true },
};

// Page 2 data (epic #131 page 2 content).
const P2 = {
  timeInState: [
    { ticket: "#201", title: "Split the schema module", now: "merged", segs: [["ready", 50], ["building", 95], ["verifying", 30], ["reviewing", 42]] },
    { ticket: "#215", title: "Debt list page", now: "ready", segs: [["ready", 130]] },
    { ticket: "#212", title: "Debt account type", now: "verifying", segs: [["ready", 20], ["building", 110], ["verifying", 21]] },
    { ticket: "#213", title: "Interest rate field", now: "reviewing", segs: [["ready", 35], ["building", 70], ["verifying", 25], ["reviewing", 9]] },
    { ticket: "#214", title: "Payoff estimate card", now: "needs-human", segs: [["ready", 60], ["building", 40], ["needs-human", 17]] },
  ],
  cycle: [
    { epic: "Foundations", ms: 2 * DAY + 4 * HOUR, open: true },
    { epic: "Accounts and debts", ms: 19 * HOUR, open: true },
    { epic: "Text size", ms: 1 * DAY + 2 * HOUR, open: false },
  ],
  stations: [
    // name, done, back, eject, checkpoint, streak, dial level
    ["Intake", 14, 0, 1, 0, 9, 1], ["Shape + slice", 4, 0, 0, 1, 3, 0], ["Build", 22, 3, 1, 2, 6, 2],
    ["Verify", 19, 2, 0, 0, 10, 2], ["Review", 18, 4, 0, 1, 2, 1], ["Merge", 15, 0, 0, 0, 15, 0], ["Learn", 5, 0, 0, 0, 5, 1],
  ],
  doors: { lastTag: "v7.2.1", counts: { "one-way": 0, "two-way": 1, none: 2, docs: 6 }, next: "v7.3.0" },
  ci: { passed: 27, of: 30, median: "6 m 40 s" },
  tokensBy: {
    ticket: [["#212", 245500], ["#204", 121900], ["#211", 88400], ["#214", 54800], ["#203", 49100]],
    station: [["build", 410000], ["verify", 152000], ["review", 131000], ["shape-slice", 64000], ["intake", 18000]],
    model: [["opus", 520000], ["sonnet", 232000], ["haiku", 23000]],
  },
  cache: [["build", 0.91], ["verify", 0.88], ["review", 0.84], ["shape-slice", 0.79], ["overall", 0.88]],
  // Weekly % at each day since the reset (target is the straight line to 97 at day 7); 5-hour % per half hour.
  weekly: [0, 12, 27, 41, 52, 61],
  fiveHour: [0, 8, 15, 22, 31, 40, 52, 63, 70, 74],
};

const $ = (id) => document.getElementById(id);
function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const fmt = (n) => (n == null ? "unknown" : n.toLocaleString("en-US"));
const kfmt = (n) => (n == null ? "unknown" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);
const dur = (ms) => {
  const m = Math.round(ms / MIN), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
  return d ? `${d} d ${h} h` : h ? `${h} h ${r} m` : `${r} m`;
};
const MEANING = {
  green: "New runs may start.",
  yellow: "Nothing new starts; each run finishes its station or checkpoints.",
  red: "Everything checkpoints and stops.",
  off: "Stopped until you run the start skill.",
};
// The light as the board shows it, stale rule included.
function lightView() {
  const l = DATA.light, age = NOW - Date.parse(l.set_at), stale = age > 45 * MIN, word = stale ? "yellow" : l.light;
  return {
    word, stale, label: stale ? "yellow (stale)" : word,
    reason: stale ? `Last light: ${l.light}, ${l.reason}` : l.reason,
    meaning: MEANING[word],
    resume: (word === "red" || word === "off") && l.resume_at ? `resumes in ${dur(Date.parse(l.resume_at) - NOW)}` : "",
    age: stale ? `Not updated for ${Math.floor(age / MIN)} min: the watchdog may be down, so it counts as yellow.` : `Set ${dur(age)} ago`,
    running: DATA.items.filter((i) => i.kind === "ticket" && ACTIVE.includes(i.state)).length,
  };
}
const byState = (s) => DATA.items.filter((i) => i.state === s).sort((a, b) => (b.kind === "epic") - (a.kind === "epic") || a.number - b.number);
const epicOf = (it) => DATA.epics.find((e) => e.id === (it.epic ?? it.id));
function link(text, href) { const a = el("a", null, text); a.href = href; return a; }

// Shows page 1 or 2 from the hash; each direction calls this once with its two render functions.
function route(p1, p2) {
  const go = () => { const two = location.hash === "#p2"; document.body.dataset.page = two ? "2" : "1"; (two ? p2 : p1)(); window.scrollTo(0, 0); };
  addEventListener("hashchange", go);
  go();
}

// Page 2 markup, shared by every direction; each direction styles it.
function svgLine(series, max, target) {
  const W = 320, H = 120, n = series.length, x = (i, len) => (i / (len - 1)) * W, y = (v) => H - (v / max) * H;
  const pts = series.map((v, i) => `${x(i, target ? 8 : n).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const tgt = target ? `<line class="target" x1="0" y1="${H}" x2="${W}" y2="${y(97)}"/>` : `<line class="limit" x1="0" y1="${y(70)}" x2="${W}" y2="${y(70)}"/><line class="limit hot" x1="0" y1="${y(90)}" x2="${W}" y2="${y(90)}"/>`;
  const s = el("div", "chart");
  s.innerHTML = `<svg viewBox="-4 -4 ${W + 8} ${H + 8}" role="img" aria-label="${target ? "Weekly usage against the straight-line target" : "5-hour window use"}">${tgt}<polyline class="series" points="${pts}"/></svg>`;
  return s;
}
function bars(rows, max, f = kfmt) {
  return el("ul", "bars", ...rows.map(([k, v]) => {
    const fill = el("i"); fill.style.width = `${(100 * v) / max}%`;
    return el("li", null, el("span", "k", k), el("span", "v num", f(v)), el("span", "track", fill));
  }));
}
function section(title, ...kids) { return el("section", "p2sec", el("h2", null, title), ...kids); }
function page2() {
  const tis = el("ul", "tis", ...P2.timeInState.map((t) => {
    const total = t.segs.reduce((a, [, m]) => a + m, 0);
    const bar = el("span", "segs", ...t.segs.map(([s, m]) => { const i = el("i", `seg s-${s}`); i.style.flexGrow = m; i.title = `${s} ${dur(m * MIN)}`; return i; }));
    return el("li", null, el("span", "k", `${t.ticket} ${t.title}`), el("span", "v num", `${LABEL[t.now] ?? t.now} ${dur(t.segs.at(-1)[1] * MIN)}`), bar, el("span", "small muted", `total ${dur(total * MIN)}`));
  }));
  const cyc = el("ul", "plain", ...P2.cycle.map((c) => el("li", null, el("span", null, c.epic), " ", el("strong", "num", dur(c.ms)), c.open ? el("span", "tag", "open") : null)));
  const st = el("table", "stations");
  st.innerHTML = `<thead><tr><th>Station</th><th>done</th><th>back</th><th>eject</th><th>checkpoint</th><th>Streak</th></tr></thead>`;
  st.append(el("tbody", null, ...P2.stations.map(([n, d, b, e, c, s, lvl]) => {
    const tr = el("tr");
    const streak = el("span", "streak", ...Array.from({ length: 10 }, (_, i) => el("i", i < s ? "on" : null)));
    tr.innerHTML = `<th>${n} <span class="muted small">level ${lvl}</span></th><td class="num">${d}</td><td class="num${b ? " bad" : ""}">${b}</td><td class="num${e ? " bad" : ""}">${e}</td><td class="num">${c}</td>`;
    const td = el("td", null, streak, el("span", "num small", ` ${s} in a row`));
    tr.append(td);
    return tr;
  })));
  const D = P2.doors;
  const doors = el("div", null,
    el("p", null, `Since ${D.lastTag}: `, ...Object.entries(D.counts).map(([k, v]) => el("span", "door", `door:${k} `, el("strong", "num", v)))),
    el("p", "big", "Next version ", el("strong", null, D.next)));
  const ci = el("div", null, el("p", "big num", `${Math.round((100 * P2.ci.passed) / P2.ci.of)}%`), el("p", "muted", `${P2.ci.passed} of the last ${P2.ci.of} CI runs passed · median ${P2.ci.median}`));
  const tb = P2.tokensBy, mx = (r) => Math.max(...r.map((x) => x[1]));
  const wk = DATA.light.weekly;
  return el("div", "page2",
    el("div", "p2grid flow",
      section("Time in state", tis),
      section("Cycle time per epic", cyc),
      section("Station outcomes and streaks", st, el("p", "small muted", "A streak counts clean passes; 10 in a row moves a station up one trust level.")),
      section("Doors since the last tag", doors),
      section("CI", ci)),
    el("div", "p2grid cost",
      section("Weighted tokens per ticket", bars(tb.ticket, mx(tb.ticket))),
      section("Per station", bars(tb.station, mx(tb.station))),
      section("Per model", bars(tb.model, mx(tb.model))),
      section("Cache-hit ratio", bars(P2.cache, 1, (v) => `${Math.round(v * 100)}%`)),
      section("Weekly usage against target", svgLine(P2.weekly, 100, true), el("p", "small", el("strong", "num", `${wk.pct}%`), ` used · pace ${DATA.light.pace.toFixed(2)} · ${DATA.light.slots} slots`)),
      section("5-hour window", svgLine(P2.fiveHour, 100, false), el("p", "small muted", "Lines at 70% (yellow) and 90% (red)."))),
  );
}

// Page 1 pieces, shared; the directions arrange and style them.
function card(it, withEpic) {
  const meta = el("div", "meta", el("span", "kind", it.kind), el("span", "num", `#${it.number}`), withEpic && it.epic ? el("span", "ep", epicOf(it).title) : null);
  return el("article", `card k-${it.kind}${it.state === "needs-human" ? " nhc" : ""}`, meta, el("div", "t", it.title),
    it.session && ACTIVE.includes(it.state) ? el("div", "session muted", it.session, it.since ? ` · ${dur(NOW - Date.parse(it.since))}` : null) : null);
}
function sessionsLine() {
  return el("span", null, ...DATA.sessions.filter((s) => s.running).flatMap((s, i) => [i ? ", " : "", el("span", "session", s.name), ` ${s.context_pct}%`]));
}
function slotsText(v) { return `${v.running} of ${DATA.light.slots} run slots in use · weekly pace ${DATA.light.pace.toFixed(2)}`; }
function meters() {
  const m = (name, w) => { const i = el("i"); i.style.width = `${w.pct}%`; return el("div", "meter", el("div", "row", el("span", null, name), el("span", "num", `${w.pct}%`)), el("div", "bar", i)); };
  return el("div", "meters", m("5-hour", DATA.light.five_hour), m("Weekly", DATA.light.weekly));
}
function epicsList() {
  return el("div", "epics", ...DATA.epics.map((e) => {
    const i = el("i"); i.style.width = `${(100 * e.done) / e.total}%`;
    return el("div", "meter", el("div", "row", el("span", null, e.title), el("span", "num muted", `${e.done} / ${e.total} merged`)), el("div", "bar", i));
  }));
}
function runsList(n = 10) {
  const max = Math.max(...DATA.topRuns.map((r) => r.tokens ?? 0));
  return el("ol", "runs", ...DATA.topRuns.slice(0, n).map((r, i) => {
    const f = el("i"); f.style.width = `${(100 * (r.tokens ?? 0)) / max}%`;
    return el("li", null, el("span", "muted num", `${i + 1}`), el("span", null, el("span", "session", r.session), " ", el("span", "muted small", r.model)), el("span", "num", kfmt(r.tokens)), el("span", "bar", f));
  }));
}
function nhList() {
  if (!DATA.needsHuman.length) return el("p", "muted", "Nothing needs you.");
  return el("ul", "plain", ...DATA.needsHuman.map((n) => el("li", "nhitem",
    el("div", null, "Open session ", el("strong", "session", n.session), " in the Claude app"),
    el("div", "q", n.question), link("Latest comment", n.href))));
}
function lastRun() {
  const r = DATA.lastEndedRun, f = DATA.factoryRun;
  return el("div", "lastrun",
    el("p", null, `Factory run ${f.id} in progress, started ${dur(NOW - Date.parse(f.started_at))} ago`),
    el("p", "muted", `Last run ${r.id} ended ${dur(NOW - Date.parse(r.ended_at))} ago: `, ...r.retros.map((x) => link(x.title, x.href))));
}
