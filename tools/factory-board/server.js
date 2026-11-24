// Factory board server: tails the events file, folds it into a snapshot and
// pushes every new snapshot to open pages over server-sent events.
// Without --simulate it also runs the collector (collect.js, runs.js) every COLLECT_MS.
// Usage: node server.js [--simulate]   (env: PORT, EVENTS, FACTORY, PROJECTS, GH, COLLECT_MS; SIM_EVENTS with --simulate)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultEvents, factoryDir, simEvents } from "./paths.js";
import { apply, empty, view } from "./state.js";
import { diff, fetchGitHub } from "./collect.js";
import { defaultProjects, diffRuns, readRuns } from "./runs.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4317);
const SIMULATE = process.argv.includes("--simulate");
// With --simulate the board shows the simulator's own file, so the real one is never touched.
const EVENTS = path.resolve(SIMULATE ? process.env.SIM_EVENTS ?? simEvents(dir) : process.env.EVENTS ?? defaultEvents(dir));
const FACTORY = path.resolve(process.env.FACTORY ?? factoryDir(dir));
const PROJECTS = process.env.PROJECTS ?? defaultProjects();

let state = empty();
let offset = 0;
let partial = "";
const clients = new Set();
let github = { ok: null, error: null, checked_at: null }; // the collector's last result; not an event
const snap = () => ({ ...view(state), github });

function readNew() {
  let size;
  try {
    size = fs.statSync(EVENTS).size;
  } catch {
    return; // no file yet
  }
  if (size < offset) {
    // The writer truncated the file: start over.
    state = empty();
    offset = 0;
    partial = "";
  }
  if (size === offset) return;
  const fd = fs.openSync(EVENTS, "r");
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = size;
  const lines = (partial + buf.toString("utf8")).split("\n");
  partial = lines.pop(); // an unfinished last line waits for the next read
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      state = apply(state, JSON.parse(line));
    } catch (err) {
      console.warn(`skipped event: ${err.message}: ${line.slice(0, 200)}`);
    }
  }
  broadcast();
}

function broadcast() {
  const msg = `data: ${JSON.stringify(snap())}\n\n`;
  for (const res of clients) res.write(msg);
}

let collecting = false;
async function collect() {
  if (collecting) return; // a slow gh call must not overlap the next tick
  collecting = true;
  const append = (events) => {
    if (events.length) fs.appendFileSync(EVENTS, events.map((e) => JSON.stringify(e) + "\n").join(""));
  };
  try {
    const board = await fetchGitHub(process.env.GH ?? "gh", dir);
    readNew(); // diff against the file as it is now
    append(diff(state, board, new Date().toISOString()));
    github = { ok: true, error: null, checked_at: new Date().toISOString() };
  } catch (err) {
    github = { ok: false, error: err.message, checked_at: new Date().toISOString() };
  }
  try {
    const runs = await readRuns(FACTORY, PROJECTS);
    readNew();
    append(diffRuns(state, runs, new Date().toISOString()));
  } catch (err) {
    console.warn(`runs collect failed: ${err.message}`);
  } finally {
    collecting = false;
  }
  readNew();
  broadcast();
}

fs.mkdirSync(path.dirname(EVENTS), { recursive: true });
readNew();
// shortcut: 150 ms polling instead of fs.watch, which misses truncation on some filesystems; fine for one local file.
fs.watchFile(EVENTS, { interval: 150 }, readNew);

const server = http.createServer((req, res) => {
  // Only our own origin: a page that points its hostname at 127.0.0.1 must not read the board.
  const port = server.address().port;
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    res.writeHead(403, { "content-type": "text/plain" });
    return res.end("forbidden");
  }
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(path.join(dir, "index.html"))); // read per request so edits show on reload
  }
  if (url.pathname === "/page.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(path.join(dir, "page.js")));
  }
  const digest = url.pathname.match(/^\/digests\/([\w.-]+\.html)$/); // a plain file name only, never a path
  if (digest && !SIMULATE) {
    const html = (() => {
      try {
        return fs.readFileSync(path.join(FACTORY, "digests", digest[1]));
      } catch {
        return null;
      }
    })();
    if (html) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    }
  }
  if (url.pathname === "/api/snapshot") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(snap()));
  }
  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(snap())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`factory board: http://127.0.0.1:${server.address().port}/  (events: ${EVENTS})`);
  if (!SIMULATE) {
    collect();
    setInterval(collect, Number(process.env.COLLECT_MS ?? 60000));
  } else {
    const sim = fork(path.join(dir, "simulate.js"), [], { env: { ...process.env, SIM_EVENTS: EVENTS } });
    process.on("exit", () => sim.kill());
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
  }
});
