// Default events file: in the git common dir, so every worktree's board and writers share it.
import { execFileSync } from "node:child_process";
import path from "node:path";

// The local factory folder (run log, run file, light, digests): shared by every worktree.
export function factoryDir(dir) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8" }).trim();
    return path.join(common, "factory");
  } catch {
    return path.join(dir, "state"); // not in a git checkout
  }
}

export const defaultEvents = (dir) => path.join(factoryDir(dir), "events.jsonl");

// The simulator's own file: worktree-local and gitignored, never the shared real one.
export const simEvents = (dir) => path.join(dir, "state", "sim-events.jsonl");
