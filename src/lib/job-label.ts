import type { RunningJob } from "@/types/bindings/RunningJob";

// The backend labels jobs "Build <model>", "Download <model>" or by the categorize button; show what is happening.
export function runningJobLabel({ kind, label }: RunningJob) {
  if (kind === "build") return `${label.replace(/^Build /, "Building ")}…`;
  if (kind === "download") return `${label.replace(/^Download /, "Downloading ")}…`;
  return "Categorizing…";
}

// What a finished job was, to start a sentence: "The build of zeni-3", "Categorizing".
export function finishedJobName({ kind, label }: Pick<RunningJob, "kind" | "label">) {
  if (kind === "build") return label.replace(/^Build /, "The build of ");
  if (kind === "download") return label.replace(/^Download /, "The download of ");
  return "Categorizing";
}
