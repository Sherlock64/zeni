// Run: node --test tools/factory-board/server.check.js  (starts real servers on random loopback ports)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultEvents } from "./paths.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (e) => JSON.stringify({ v: 1, ts: "2026-11-20T10:00:00Z", ...e }) + "\n";

// Starts server.js and resolves with its port once it prints its URL.
function start(t, env, args = []) {
  const child = spawn(process.execPath, [path.join(dir, "server.js"), ...args], {
    env: { ...process.env, PORT: "0", SPEED: "20", GH: "/nonexistent/gh", FACTORY: "/nonexistent/factory", PROJECTS: "/nonexistent/projects", ...env }, // never the real GitHub or run log
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => child.kill());
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/(127\.0\.0\.1):(\d+)\//);
      if (m) resolve({ host: m[1], port: Number(m[2]) });
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
}

const snapshot = async (port) => (await fetch(`http://127.0.0.1:${port}/api/snapshot`)).json();

function tmpFiles(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "board-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return { real: path.join(tmp, "events.jsonl"), sim: path.join(tmp, "sim-events.jsonl") };
}

test("serves the page on 127.0.0.1 only", async (t) => {
  const { real } = tmpFiles(t);
  const { host, port } = await start(t, { EVENTS: real });
  assert.equal(host, "127.0.0.1");
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<html/i);
  const js = await fetch(`http://127.0.0.1:${port}/page.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /^text\/javascript/);
  // Not reachable on IPv6 loopback, nor on any non-loopback address of this machine.
  const others = ["::1", ...Object.values(os.networkInterfaces()).flat().filter((a) => !a.internal).map((a) => a.address)];
  for (const addr of others) {
    await assert.rejects(new Promise((ok, fail) => {
      const s = net.connect({ host: addr, port }, () => { s.destroy(); ok(); });
      s.on("error", fail);
    }), undefined, `reachable on ${addr}`);
  }
});

test("answers only its own host names", async (t) => {
  const { real } = tmpFiles(t);
  const { port } = await start(t, { EVENTS: real });
  const get = (host) => new Promise((ok, fail) => {
    http.get({ host: "127.0.0.1", port, path: "/api/snapshot", headers: { host } }, (res) => { res.resume(); ok(res.statusCode); }).on("error", fail);
  });
  assert.equal(await get(`127.0.0.1:${port}`), 200);
  assert.equal(await get(`localhost:${port}`), 200);
  assert.equal(await get(`evil.example:${port}`), 403);
  assert.equal(await get("127.0.0.1"), 403);
});

test("without the simulator it reads the real events file", async (t) => {
  const { real } = tmpFiles(t);
  fs.writeFileSync(real, line({ type: "item.upsert", id: "T1", kind: "ticket", title: "Real ticket", state: "building" }));
  const { port } = await start(t, { EVENTS: real });
  assert.deepEqual((await snapshot(port)).items.map((i) => i.title), ["Real ticket"]);
});

test("the default events file is the shared one in the git common dir", () => {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8" }).trim();
  assert.equal(defaultEvents(dir), path.join(common, "factory", "events.jsonl"));
});

test("with the simulator on, the real events file is unchanged", async (t) => {
  const { real, sim } = tmpFiles(t);
  const before = line({ type: "item.upsert", id: "T1", kind: "ticket", title: "Real ticket", state: "building" });
  fs.writeFileSync(real, before);
  const { port } = await start(t, { EVENTS: real, SIM_EVENTS: sim }, ["--simulate"]);
  let items = [];
  for (let i = 0; i < 50 && !items.some((x) => x.kind === "epic"); i++) {
    await sleep(100);
    items = (await snapshot(port)).items;
  }
  assert.ok(items.some((x) => x.kind === "epic"), "board shows simulated cards");
  assert.ok(!items.some((x) => x.title === "Real ticket"), "board does not mix in real events");
  assert.ok(fs.statSync(sim).size > 0, "simulator wrote its own file");
  assert.equal(fs.statSync(real).size, before.length);
  assert.equal(fs.readFileSync(real, "utf8"), before);
});

test("the simulator refuses to write the real events file", (t) => {
  const { real } = tmpFiles(t);
  fs.writeFileSync(real, "keep\n");
  assert.throws(() => execFileSync(process.execPath, [path.join(dir, "simulate.js")], {
    env: { ...process.env, EVENTS: real, SIM_EVENTS: real }, stdio: "pipe", timeout: 3000,
  }));
  assert.equal(fs.readFileSync(real, "utf8"), "keep\n");
});

// A fake gh: answers the issues and PR queries from fixed pages; fails while the file FAIL exists.
function fakeGh(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "board-gh-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const issues = { data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
    { number: 131, title: "Factory board", url: "u131", labels: { nodes: [{ name: "state:building" }] }, parent: null, subIssues: { totalCount: 1 }, comments: { nodes: [] } },
    { number: 139, title: "GitHub part", url: "u139", labels: { nodes: [{ name: "state:ready" }] }, parent: { number: 131 }, subIssues: { totalCount: 0 }, comments: { nodes: [] },
      timelineItems: { nodes: [{ createdAt: "2026-11-24T09:00:00Z", label: { name: "state:ready" } }] } },
  ] } } } };
  const prs = { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
    { number: 170, title: "t139 PR", labels: { nodes: [{ name: "state:reviewing" }] } },
  ] } } } };
  const doors = { data: { repository: {
    refs: { nodes: [{ name: "v7.2.0", target: { committedDate: "2026-11-20T00:00:00Z" } }] },
    pullRequests: { nodes: [{ number: 175, title: "after the tag", mergedAt: "2026-11-21T00:00:00Z", labels: { nodes: [{ name: "door:two-way" }] } }] },
  } } };
  const ci = [{ conclusion: "success", startedAt: "2026-11-24T07:00:00Z", updatedAt: "2026-11-24T07:04:00Z" }];
  const gh = path.join(tmp, "gh");
  fs.writeFileSync(gh, `#!${process.execPath}
const fs = require("node:fs");
if (fs.existsSync(${JSON.stringify(path.join(tmp, "FAIL"))})) { console.error("gh: network down"); process.exit(1); }
if (process.argv[2] === "run") { console.log(JSON.stringify(${JSON.stringify(ci)})); process.exit(0); }
const q = process.argv.find((a) => a.startsWith("query="));
console.log(JSON.stringify(q.includes("refs(") ? ${JSON.stringify(doors)} : q.includes("pullRequests") ? ${JSON.stringify(prs)} : ${JSON.stringify(issues)}));
`, { mode: 0o755 });
  return { gh, fail: () => fs.writeFileSync(path.join(tmp, "FAIL"), "") };
}

async function until(port, ok) {
  let snap;
  for (let i = 0; i < 50; i++) {
    snap = await snapshot(port);
    if (ok(snap)) return snap;
    await sleep(100);
  }
  assert.fail(`never reached: ${JSON.stringify(snap)}`);
}

test("collects state-labelled issues and PRs from gh into the events file", async (t) => {
  const { real } = tmpFiles(t);
  const { gh } = fakeGh(t);
  const { port } = await start(t, { EVENTS: real, GH: gh });
  const snap = await until(port, (s) => s.items.length === 3);
  assert.deepEqual(snap.items.map((i) => `${i.id}:${i.kind}:${i.state}`).sort(), ["#131:epic:building", "#139:ticket:ready", "#170:pr:reviewing"]);
  assert.equal(snap.github.ok, true);
  assert.match(fs.readFileSync(real, "utf8"), /"item.upsert"/);
});

test("gh failing shows GitHub unavailable and keeps the last state", async (t) => {
  const { real } = tmpFiles(t);
  const { gh, fail } = fakeGh(t);
  const { port } = await start(t, { EVENTS: real, GH: gh, COLLECT_MS: "200" });
  await until(port, (s) => s.items.length === 3);
  const size = fs.statSync(real).size;
  fail();
  const snap = await until(port, (s) => s.github.ok === false);
  assert.match(snap.github.error, /network down/);
  assert.equal(snap.items.length, 3);
  await sleep(500); // more failing collects, and no change while it worked: nothing appended
  assert.equal(fs.statSync(real).size, size);
});

test("gh missing shows GitHub unavailable and the board keeps serving", async (t) => {
  const { real } = tmpFiles(t);
  fs.writeFileSync(real, line({ type: "item.upsert", id: "#1", kind: "ticket", title: "Known", state: "ready" }));
  const { port } = await start(t, { EVENTS: real });
  const snap = await until(port, (s) => s.github?.ok === false);
  assert.deepEqual(snap.items.map((i) => i.title), ["Known"]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
});

test("collects the run log and serves the ended run's digest, even with gh missing", async (t) => {
  const { real } = tmpFiles(t);
  const factory = path.join(path.dirname(real), "factory");
  fs.mkdirSync(path.join(factory, "digests"), { recursive: true });
  fs.writeFileSync(path.join(factory, "runs.tsv"), "2026-11-23T09:00:00Z\tno-such-session\t#140\tbuild\tdone\tx\n");
  fs.writeFileSync(path.join(factory, "run.json"), JSON.stringify({ id: "fr-20261123-0800", started_at: "2026-11-23T08:00:00Z" }));
  fs.writeFileSync(path.join(factory, "light.json"), JSON.stringify({ light: "off", set_at: "2026-11-23T12:00:00Z" }));
  fs.writeFileSync(path.join(factory, "digests", "2026-11-23-fr-20261123-0800.html"), "<html>digest</html>");
  const { port } = await start(t, { EVENTS: real, FACTORY: factory });
  const snap = await until(port, (s) => s.lastEndedRun?.retros.length === 1);
  assert.deepEqual(snap.runs.map((r) => [r.item, r.station, r.tokens]), [["#140", "build", null]]);
  const res = await fetch(`http://127.0.0.1:${port}${snap.lastEndedRun.retros[0].href}`);
  assert.deepEqual([res.status, await res.text()], [200, "<html>digest</html>"]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/digests/..%2Frun.json`)).status, 404);
});

test("page 2 has its own route, computed from the folded state", async (t) => {
  const { real } = tmpFiles(t);
  const { gh } = fakeGh(t);
  const { port } = await start(t, { EVENTS: real, GH: gh });
  await until(port, (s) => s.items.length === 3);
  const p = await (await fetch(`http://127.0.0.1:${port}/api/page2`)).json();
  assert.deepEqual([p.doors.tag, p.doors.next], ["v7.2.0", "v7.3.0"]);
  assert.deepEqual(p.ci, { passed: 1, of: 1, median_ms: 4 * 60e3 });
  assert.deepEqual(p.timeInState.map((x) => [x.id, x.state]), [["#139", "ready"]]);
  assert.ok(Array.isArray(p.stations));
  assert.deepEqual(Object.keys(p.tokens), ["ticket", "station", "model"]);
  assert.ok("cache" in p && "weekly" in p && "fiveHour" in p);
});
