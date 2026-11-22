// Run: node --test tools/factory-board/server.check.js  (starts real servers on random loopback ports)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultEvents } from "./paths.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (e) => JSON.stringify({ v: 1, ts: "2026-11-20T10:00:00Z", ...e }) + "\n";

// Starts server.js and resolves with its port once it prints its URL.
function start(t, env, args = []) {
  const child = spawn(process.execPath, [path.join(dir, "server.js"), ...args], {
    env: { ...process.env, PORT: "0", SPEED: "20", ...env },
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
  // Not reachable on IPv6 loopback, nor on any non-loopback address of this machine.
  const others = ["::1", ...Object.values(os.networkInterfaces()).flat().filter((a) => !a.internal).map((a) => a.address)];
  for (const addr of others) {
    await assert.rejects(new Promise((ok, fail) => {
      const s = net.connect({ host: addr, port }, () => { s.destroy(); ok(); });
      s.on("error", fail);
    }), undefined, `reachable on ${addr}`);
  }
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
