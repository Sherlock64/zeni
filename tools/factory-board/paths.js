// Default events file: in the git common dir, so every worktree's board and writers share it.
import { execFileSync } from "node:child_process";
import path from "node:path";

export function defaultEvents(dir) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8" }).trim();
    return path.join(common, "factory", "events.jsonl");
  } catch {
    return path.join(dir, "state", "events.jsonl"); // not in a git checkout
  }
}
