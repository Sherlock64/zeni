// Collector, GitHub part: reads state-labelled issues and open PRs with gh and
// turns them into board events, appending only what changed (format: README.md).
import { execFile } from "node:child_process";
import { DOORS, STATES } from "./state.js";

const LABELS = JSON.stringify(STATES.map((s) => `state:${s}`));
// shortcut: the last 50 comments per issue; an older "claimed by" is missed, raise it if ejects say "unknown".
// shortcut: the last 100 label events per issue; raise it if histories start late.
const ISSUES = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
  issues(first:50,after:$cursor,labels:${LABELS},states:[OPEN,CLOSED]){pageInfo{hasNextPage endCursor}
    nodes{number title url labels(first:30){nodes{name}} parent{number} subIssues{totalCount} comments(last:50){nodes{body url}}
    timelineItems(itemTypes:[LABELED_EVENT],last:100){nodes{... on LabeledEvent{createdAt label{name}}}}}}}}`;
const PRS = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
  pullRequests(first:50,after:$cursor,labels:${LABELS},states:[OPEN]){pageInfo{hasNextPage endCursor}
    nodes{number title labels(first:30){nodes{name}}}}}}`;

// shortcut: the 100 most recently updated merged PRs; enough between two tags, raise it if a release cycle merges more.
const DOORS_Q = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
  refs(refPrefix:"refs/tags/",first:20,orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){nodes{name target{... on Commit{committedDate} ... on Tag{target{... on Commit{committedDate}}}}}}
  pullRequests(states:MERGED,baseRefName:"main",first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title mergedAt labels(first:30){nodes{name}}}}}}`;
const CI_ARGS = ["run", "list", "--workflow", "CI", "--status", "completed", "--limit", "30", "--json", "conclusion,startedAt,updatedAt"];

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
  const [issues, prs, doors, ci] = await Promise.all([
    all(bin, cwd, ISSUES, "issues"),
    all(bin, cwd, PRS, "pullRequests"),
    gh(bin, cwd, ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${DOORS_Q}`]).then((o) => JSON.parse(o).data.repository),
    gh(bin, cwd, CI_ARGS).then(JSON.parse),
  ]);
  return toBoard(issues, prs, doors, ci);
}

const stateOf = (n) => n.labels.nodes.map((l) => l.name.replace(/^state:/, "")).find((s) => STATES.includes(s));

// The last v<major>.<minor>.<patch> tag and the PRs merged after its commit.
function toDoors(raw) {
  const tag = raw.refs.nodes.find((r) => /^v\d+\.\d+\.\d+$/.test(r.name));
  const since = tag ? Date.parse(tag.target.committedDate ?? tag.target.target?.committedDate) : -Infinity;
  const prs = raw.pullRequests.nodes
    .filter((p) => p.mergedAt && Date.parse(p.mergedAt) > since)
    .map((p) => ({ number: p.number, title: p.title, door: p.labels.nodes.map((l) => l.name.replace(/^door:/, "")).find((d) => DOORS.includes(d)) ?? null }));
  return { tag: tag?.name ?? null, prs };
}

// What the board should show for GitHub: cards, needs-human items and label history by id,
// plus the doors since the last tag and the last CI runs (null when not fetched).
export function toBoard(issues, prs, doorsRaw = null, ciRaw = null) {
  const items = {};
  const needsHuman = {};
  const history = {};
  for (const n of issues) {
    const state = stateOf(n);
    if (!state) continue;
    const id = `#${n.number}`;
    const kind = n.subIssues.totalCount > 0 ? "epic" : "ticket";
    items[id] = { id, kind, title: n.title, state, epic: n.parent ? `#${n.parent.number}` : null, number: n.number };
    history[id] = (n.timelineItems?.nodes ?? [])
      .filter((t) => t.label?.name.startsWith("state:") && STATES.includes(t.label.name.slice(6)))
      .map((t) => ({ state: t.label.name.slice(6), at: t.createdAt }))
      .sort((a, b) => a.at.localeCompare(b.at));
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
  const ci = ciRaw?.filter((r) => r.conclusion).map((r) => ({ conclusion: r.conclusion, started_at: r.startedAt, ended_at: r.updatedAt })) ?? null;
  return { items, needsHuman, history, doors: doorsRaw ? toDoors(doorsRaw) : null, ci };
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
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [id, history] of Object.entries(board.history ?? {})) if (!same(s.history[id], history)) out.push(ev("item.history", { id, history }));
  if (board.doors && !same(s.doors, board.doors)) out.push(ev("doors", board.doors));
  if (board.ci && !same(s.ci, board.ci)) out.push(ev("ci", { runs: board.ci }));
  return out;
}
