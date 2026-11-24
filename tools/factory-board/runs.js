// Collector, runs part: turns the run log, the run file, digests and session
// transcripts into board events, appending only what changed (format: README.md).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const TALLY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude", "factory", "tools", "tally.py");
export const defaultProjects = () => path.join(os.homedir(), ".claude", "projects");
const FACTORY_RUN = /^fr-\d{8}-\d{4}$/; // the run file's ids; other writers' (the simulator's) are left alone

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
};

// <projects>/<any project>/<session id>.jsonl, or null. An id that is not a plain name is never a path.
function findTranscript(projects, id) {
  if (!/^[\w-]+$/.test(id)) return null;
  let dirs;
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return null;
  }
  return dirs.map((d) => path.join(projects, d, `${id}.jsonl`)).find((f) => fs.existsSync(f)) ?? null;
}

const tally = (file) =>
  new Promise((resolve, reject) => {
    execFile("python3", ["-I", TALLY, file], { timeout: 60000, maxBuffer: 64 << 20 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(JSON.parse(stdout).total.weighted);
    });
  });

// The last model and session title the transcript records.
function scan(file) {
  let model = null;
  let title = null;
  for (const line of read(file).split("\n")) {
    if (!line.includes('"assistant"') && !line.includes('"custom-title"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "custom-title" && e.customTitle) title = e.customTitle;
      if (e.type === "assistant" && e.message?.model && e.message.model !== "<synthetic>") model = e.message.model;
    } catch {} // a half-written last line
  }
  return { model, title };
}

// Tallying is the slow part: redo it only when the transcript or a subagent's changed.
const cache = new Map();
async function transcript(file) {
  const sub = path.join(file.slice(0, -".jsonl".length), "subagents");
  let subs = [];
  try {
    subs = fs.readdirSync(sub).map((f) => path.join(sub, f));
  } catch {}
  const key = [file, ...subs].map((f) => `${f}:${fs.statSync(f).mtimeMs}:${fs.statSync(f).size}`).join("|");
  if (cache.get(file)?.key !== key) cache.set(file, { key, info: { ...scan(file), tokens: await tally(file) } });
  return cache.get(file).info;
}

// What the board should show for the runs: runs by id, the run file, the light word and digest names.
export async function readRuns(factory, projects = defaultProjects()) {
  const runs = {};
  for (const line of (read(path.join(factory, "runs.tsv")) ?? "").split("\n")) {
    const [ended_at, sessionId, ticket, station] = line.split("\t");
    if (!station || !sessionId) continue;
    const file = findTranscript(projects, sessionId);
    let info = { model: null, title: null, tokens: null };
    if (file) {
      try {
        info = await transcript(file);
      } catch (err) {
        console.warn(`runs: ${sessionId}: ${err.message.split("\n")[0]}`); // shown as unknown
      }
    }
    // shortcut: rows that share a session each show its whole transcript, so the total counts it twice; split by ended_at if that misleads.
    const run = `${sessionId}@${ended_at}`;
    runs[run] = { run, session: info.title ?? sessionId, item: ticket || null, station, tokens: info.tokens, model: info.model };
  }
  const current = readJson(path.join(factory, "run.json"));
  const light = readJson(path.join(factory, "light.json"));
  let digests = [];
  try {
    digests = fs.readdirSync(path.join(factory, "digests"));
  } catch {}
  return {
    runs,
    current: FACTORY_RUN.test(current?.id) && current.started_at ? { id: current.id, started_at: current.started_at } : null,
    offAt: light?.light === "off" ? light.set_at ?? null : null,
    digests,
  };
}

// Events that turn the folded state into the board; empty when nothing changed.
export function diffRuns(s, board, ts) {
  const ev = (type, fields) => ({ v: 1, ts, type, ...fields });
  const out = [];
  for (const r of Object.values(board.runs)) {
    const cur = s.runs[r.run];
    if (!cur || Object.keys(r).some((k) => cur[k] !== r[k])) out.push(ev("run.tokens", r));
  }
  const { current, offAt } = board;
  const known = { ...s.factoryRuns };
  if (current && !known[current.id]) {
    out.push(ev("factory_run.start", current));
    known[current.id] = { ...current, ended_at: null, retros: [] };
  }
  for (const r of Object.values(known)) {
    if (!FACTORY_RUN.test(r.id)) continue;
    // A run ends when shutdown turns the light off, or when factory start writes a new run file.
    const ended_at = r.ended_at ?? (r.id === current?.id ? offAt : current?.started_at ?? null);
    if (!ended_at) continue;
    const retros = board.digests.filter((f) => f.endsWith(`-${r.id}.html`)).sort().map((f) => ({ title: "Digest", href: `/digests/${f}` }));
    if (r.ended_at !== ended_at || JSON.stringify(r.retros) !== JSON.stringify(retros)) {
      out.push(ev("factory_run.end", { id: r.id, ended_at, retros }));
    }
  }
  return out;
}
