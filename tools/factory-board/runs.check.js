// Run: node --test tools/factory-board/runs.check.js  (calls the real tally tool on fake transcripts)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRuns, diffRuns, parseTrust } from "./runs.js";
import { apply, empty, view } from "./state.js";

const TS = "2026-11-23T10:00:00Z";
const fold = (s, events) => events.reduce((st, e) => apply(st, e), s);
const jsonl = (entries) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
const usage = (input, write, read, output) => ({
  input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output,
});
const reply = (requestId, model, u) => ({ type: "assistant", requestId, timestamp: TS, message: { model, usage: u, content: [] } });

function setup(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runs-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const factory = path.join(tmp, "factory");
  const projects = path.join(tmp, "projects");
  const project = path.join(projects, "-home-x-zeni--claude-worktrees-t140");
  fs.mkdirSync(path.join(project, "s-140", "subagents"), { recursive: true });
  fs.mkdirSync(path.join(factory, "digests"), { recursive: true });
  // Main: 1000 input + 2000 writes ×2 + 10000 reads ×0.1 + 100 output ×5 = 6500. The second block of one request counts once.
  fs.writeFileSync(path.join(project, "s-140.jsonl"), jsonl([
    { type: "custom-title", customTitle: "#140 Build: runs collector" },
    reply("q1", "claude-opus-5-5", usage(1000, 2000, 10000, 100)),
    reply("q1", "claude-opus-5-5", usage(1000, 2000, 10000, 100)),
  ]));
  // Subagent: 500 input + 100 output ×5 = 1000. Total 7500.
  fs.writeFileSync(path.join(project, "s-140", "subagents", "a1.jsonl"), jsonl([reply("q2", "claude-sonnet-5-5", usage(500, 0, 0, 100))]));
  fs.writeFileSync(path.join(factory, "runs.tsv"), [
    `2026-11-23T09:00:00Z\ts-140\t#140\tbuild\tdone\tPR #180`,
    `2026-11-23T09:30:00Z\tbuild-139\t#139\tverify\tback\tno transcript under this id`,
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(factory, "run.json"), JSON.stringify({ id: "fr-20261123-0800", started_at: "2026-11-23T08:00:00-06:00" }));
  return { factory, projects };
}

test("each run-log row is a run with its ticket, station, session, model and weighted tokens (subagents included)", async (t) => {
  const { factory, projects } = setup(t);
  const v = view(fold(empty(), diffRuns(empty(), await readRuns(factory, projects), TS)));
  const run = v.runs.find((r) => r.item === "#140");
  assert.deepEqual(
    [run.session, run.station, run.tokens, run.model],
    ["#140 Build: runs collector", "build", 7500, "claude-opus-5-5"],
  );
  // Cache counts reach the board with the run: 1000 + 500 input, 2000 writes, 10000 reads.
  assert.deepEqual([run.input, run.cache_write, run.cache_read], [1500, 2000, 10000]);
  assert.equal(v.items.length, 0); // runs never make cards; the GitHub part does
});

test("a row whose transcript is missing shows the run with tokens unknown", async (t) => {
  const { factory, projects } = setup(t);
  const v = view(fold(empty(), diffRuns(empty(), await readRuns(factory, projects), TS)));
  const run = v.runs.find((r) => r.item === "#139");
  assert.deepEqual([run.session, run.station, run.tokens, run.model, run.input, run.cache_write, run.cache_read], ["build-139", "verify", null, null, null, null, null]);
  assert.equal(v.totalTokens, 7500);
  assert.deepEqual(v.topRuns.map((r) => r.item), ["#140", "#139"]); // unknown sorts last
});

test("a missing run log shows no runs; a malformed row is skipped", async (t) => {
  const { factory, projects } = setup(t);
  fs.rmSync(path.join(factory, "runs.tsv"));
  fs.rmSync(path.join(factory, "run.json"));
  assert.deepEqual(diffRuns(empty(), await readRuns(factory, projects), TS), []);
  fs.writeFileSync(path.join(factory, "runs.tsv"), "only\ttwo\n\n2026-11-23T09:00:00Z\t../../etc\t#1\tbuild\tdone\tx\n");
  const v = view(fold(empty(), diffRuns(empty(), await readRuns(factory, projects), TS)));
  assert.deepEqual(v.runs.map((r) => [r.session, r.tokens]), [["../../etc", null]]); // an odd id is never a path
});

test("a collect that finds no change appends nothing; a grown transcript updates its run", async (t) => {
  const { factory, projects } = setup(t);
  const s = fold(empty(), diffRuns(empty(), await readRuns(factory, projects), TS));
  assert.deepEqual(diffRuns(s, await readRuns(factory, projects), TS), []);
  const main = path.join(projects, "-home-x-zeni--claude-worktrees-t140", "s-140.jsonl");
  fs.appendFileSync(main, jsonl([reply("q3", "claude-opus-5-5", usage(100, 0, 0, 0))]));
  const events = diffRuns(s, await readRuns(factory, projects), TS);
  assert.deepEqual(events.map((e) => [e.type, e.tokens]), [["run.tokens", 7600]]);
});

test("the current factory run shows with its start; when it ends its digest is a link", async (t) => {
  const { factory, projects } = setup(t);
  let s = fold(empty(), diffRuns(empty(), await readRuns(factory, projects), TS));
  assert.deepEqual(view(s).factoryRun, { id: "fr-20261123-0800", started_at: "2026-11-23T08:00:00-06:00", ended_at: null, retros: [] });
  // Shutdown turns the light off: the run ends then; no digest yet.
  fs.writeFileSync(path.join(factory, "light.json"), JSON.stringify({ light: "off", set_at: "2026-11-23T16:00:00Z" }));
  s = fold(s, diffRuns(s, await readRuns(factory, projects), TS));
  assert.equal(view(s).factoryRun, null);
  assert.deepEqual([view(s).lastEndedRun.ended_at, view(s).lastEndedRun.retros], ["2026-11-23T16:00:00Z", []]);
  // The digest is written later: the end keeps its time and gains the link.
  fs.writeFileSync(path.join(factory, "digests", "2026-11-23-fr-20261123-0800.html"), "<html></html>");
  s = fold(s, diffRuns(s, await readRuns(factory, projects), "2026-11-23T13:00:00Z"));
  assert.deepEqual([view(s).lastEndedRun.ended_at, view(s).lastEndedRun.retros], [
    "2026-11-23T16:00:00Z", [{ title: "Digest", href: "/digests/2026-11-23-fr-20261123-0800.html" }],
  ]);
  assert.deepEqual(diffRuns(s, await readRuns(factory, projects), TS), []);
  // Factory start writes a new run file: the new run shows.
  // The new run file lands while the previous shutdown's off light is still on disk: the new run stays open.
  fs.writeFileSync(path.join(factory, "run.json"), JSON.stringify({ id: "fr-20261124-0900", started_at: "2026-11-24T09:00:00Z" }));
  s = fold(s, diffRuns(s, await readRuns(factory, projects), TS));
  assert.deepEqual([view(s).factoryRun?.id, view(s).factoryRun?.ended_at], ["fr-20261124-0900", null]);
  fs.writeFileSync(path.join(factory, "light.json"), JSON.stringify({ light: "green", set_at: "2026-11-24T09:00:00Z" }));
  s = fold(s, diffRuns(s, await readRuns(factory, projects), TS));
  assert.equal(view(s).factoryRun.id, "fr-20261124-0900");
});

test("a replaced run file ends the old run at the new start; other writers' runs are left alone", async (t) => {
  const { factory, projects } = setup(t);
  const sim = { v: 1, ts: TS, type: "factory_run.start", id: "fr-25" };
  let s = fold(empty(), [sim, ...diffRuns(empty(), await readRuns(factory, projects), TS)]);
  fs.writeFileSync(path.join(factory, "run.json"), JSON.stringify({ id: "fr-20261124-0900", started_at: "2026-11-24T09:00:00Z" }));
  s = fold(s, diffRuns(s, await readRuns(factory, projects), TS));
  assert.equal(s.factoryRuns["fr-20261123-0800"].ended_at, "2026-11-24T09:00:00Z");
  assert.equal(s.factoryRuns["fr-25"].ended_at, null);
});

// Page 2, flow (#144): each run's outcome, and the trust dial from the spine.

test("each run carries its outcome from the run log", async (t) => {
  const { factory, projects } = setup(t);
  const v = view(fold(empty(), diffRuns(empty(), await readRuns(factory, projects), TS)));
  assert.deepEqual(v.runs.map((r) => [r.item, r.outcome]).sort(), [["#139", "back"], ["#140", "done"]]);
});

test("trust levels come from the spine's trust-dial table; an unreadable table gives none", async (t) => {
  const { factory, projects } = setup(t);
  const spine = path.join(factory, "spine.md");
  fs.writeFileSync(spine, "## Trust dial\n\n| Station | Now | Ceiling |\n|---|---|---|\n| Intake | 1 | 3 |\n| Shape + slice | 0 | 1 |\n| Build | 2 | 3 |\n\nAfter.\n");
  const board = await readRuns(factory, projects, spine);
  assert.deepEqual(board.trust, { intake: 1, "shape-slice": 0, build: 2 });
  const events = diffRuns(empty(), board, TS).filter((e) => e.type === "trust");
  assert.deepEqual(events.map((e) => e.levels), [{ intake: 1, "shape-slice": 0, build: 2 }]);
  assert.deepEqual(diffRuns(fold(empty(), diffRuns(empty(), board, TS)), board, TS), []);
  assert.deepEqual(parseTrust("no table here"), {});
  assert.deepEqual(parseTrust(null), {});
  assert.deepEqual((await readRuns(factory, projects, path.join(factory, "missing.md"))).trust, {});
  // the real spine parses
  const real = parseTrust(fs.readFileSync(new URL("../../.claude/factory/spine.md", import.meta.url), "utf8"));
  assert.ok(Number.isInteger(real.build) && Number.isInteger(real["shape-slice"]), JSON.stringify(real));
});
