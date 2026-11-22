// Factory board server: tails the events file, folds it into a snapshot and
// pushes every new snapshot to open pages over server-sent events.
// Usage: node server.js [--simulate]   (env: PORT, EVENTS; SIM_EVENTS with --simulate)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultEvents, simEvents } from "./paths.js";
import { apply, empty, view } from "./state.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4317);
const SIMULATE = process.argv.includes("--simulate");
// With --simulate the board shows the simulator's own file, so the real one is never touched.
const EVENTS = path.resolve(SIMULATE ? process.env.SIM_EVENTS ?? simEvents(dir) : process.env.EVENTS ?? defaultEvents(dir));

let state = empty();
let offset = 0;
let partial = "";
const clients = new Set();

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
  const msg = `data: ${JSON.stringify(view(state))}\n\n`;
  for (const res of clients) res.write(msg);
}

fs.mkdirSync(path.dirname(EVENTS), { recursive: true });
readNew();
// shortcut: 150 ms polling instead of fs.watch, which misses truncation on some filesystems; fine for one local file.
fs.watchFile(EVENTS, { interval: 150 }, readNew);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(path.join(dir, "index.html"))); // read per request so edits show on reload
  }
  if (url.pathname === "/api/snapshot") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(view(state)));
  }
  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(view(state))}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`factory board: http://127.0.0.1:${server.address().port}/  (events: ${EVENTS})`);
  if (SIMULATE) {
    const sim = fork(path.join(dir, "simulate.js"), [], { env: { ...process.env, SIM_EVENTS: EVENTS } });
    process.on("exit", () => sim.kill());
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
  }
});
