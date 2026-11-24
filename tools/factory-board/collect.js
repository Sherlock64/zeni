// Collector, GitHub part: reads state-labelled issues and open PRs with gh and
// turns them into board events, appending only what changed (format: README.md).
import { execFile } from "node:child_process";
import { STATES } from "./state.js";

const LABELS = JSON.stringify(STATES.map((s) => `state:${s}`));
// shortcut: the last 50 comments per issue; an older "claimed by" is missed, raise it if ejects say "unknown".
const ISSUES = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
  issues(first:50,after:$cursor,labels:${LABELS},states:[OPEN,CLOSED]){pageInfo{hasNextPage endCursor}
    nodes{number title url labels(first:30){nodes{name}} parent{number} subIssues{totalCount} comments(last:50){nodes{body url}}}}}}`;
const PRS = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
  pullRequests(first:50,after:$cursor,labels:${LABELS},states:[OPEN]){pageInfo{hasNextPage endCursor}
    nodes{number title labels(first:30){nodes{name}}}}}}`;

function gh(bin, cwd, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, timeout: 30000, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split("\n")[0]));
      else resolve(stdout);
    });
  });
}

async function all(bin, cwd, query, conn) {
  const nodes = [];
  let cursor = null;
  do {
    const args = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${query}`];
    if (cursor) args.push("-f", `cursor=${cursor}`);
    const page = JSON.parse(await gh(bin, cwd, args)).data.repository[conn];
    nodes.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

// Throws when gh is missing or fails; the caller keeps the last state.
export async function fetchGitHub(bin, cwd) {
  const [issues, prs] = await Promise.all([all(bin, cwd, ISSUES, "issues"), all(bin, cwd, PRS, "pullRequests")]);
  return toBoard(issues, prs);
}

const stateOf = (n) => n.labels.nodes.map((l) => l.name.replace(/^state:/, "")).find((s) => STATES.includes(s));

// What the board should show for GitHub: cards by id, and needs-human items by id.
export function toBoard(issues, prs) {
  const items = {};
  const needsHuman = {};
  for (const n of issues) {
    const state = stateOf(n);
    if (!state) continue;
    const id = `#${n.number}`;
    const kind = n.subIssues.totalCount > 0 ? "epic" : "ticket";
    items[id] = { id, kind, title: n.title, state, epic: n.parent ? `#${n.parent.number}` : null, number: n.number };
    if (state === "needs-human") {
      const comments = n.comments.nodes;
      // One regex for search and capture, so a claim without a valid name is skipped, not a crash.
      const claim = comments.map((c) => c.body.match(/claimed by ([\w.-]+)/)).findLast(Boolean);
      const last = comments.at(-1);
      needsHuman[`nh-${id}`] = {
        id: `nh-${id}`,
        item: id,
        session: claim?.[1] ?? "unknown",
        question: last?.body.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? n.title,
        href: last?.url ?? n.url,
      };
    }
  }
  for (const n of prs) {
    const state = stateOf(n);
    if (state) items[`#${n.number}`] = { id: `#${n.number}`, kind: "pr", title: n.title, state, epic: null, number: n.number };
  }
  return { items, needsHuman };
}

// Events that turn the folded state into the board; empty when nothing changed.
// Only "#n" cards and "nh-#n" items are the collector's; other writers' entries are left alone.
export function diff(s, board, ts) {
  const ev = (type, fields) => ({ v: 1, ts, type, ...fields });
  const out = [];
  for (const it of Object.values(board.items)) {
    const cur = s.items[it.id];
    if (!cur || Object.keys(it).some((k) => cur[k] !== it[k])) out.push(ev("item.upsert", it));
  }
  for (const id of Object.keys(s.items)) if (id.startsWith("#") && !board.items[id]) out.push(ev("item.remove", { id }));
  for (const n of Object.values(board.needsHuman)) {
    const cur = s.needsHuman[n.id];
    if (!cur || Object.keys(n).some((k) => cur[k] !== n[k])) out.push(ev("needs_human.open", n));
  }
  for (const id of Object.keys(s.needsHuman)) if (id.startsWith("nh-#") && !board.needsHuman[id]) out.push(ev("needs_human.clear", { id }));
  return out;
}
