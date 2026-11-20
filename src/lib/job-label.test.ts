import { finishedJobName, runningJobLabel } from "@/lib/job-label";

test.each([
  ["build", "Build zeni-3", "Building zeni-3…"],
  ["download", "Download qwen2.5:3b", "Downloading qwen2.5:3b…"],
  ["categorizeNow", "Categorize now", "Categorizing…"],
  ["recategorizeAll", "Recategorize all", "Categorizing…"],
  ["afterImport", "Categorizing new rows", "Categorizing…"],
] as const)("a running %s job reads as what it is doing", (kind, label, text) => {
  expect(runningJobLabel({ kind, label, done: 0, total: 0 })).toBe(text);
});

test.each([
  ["build", "Build zeni-3", "The build of zeni-3"],
  ["download", "Download qwen2.5:3b", "The download of qwen2.5:3b"],
  ["categorizeNow", "Categorize now", "Categorizing"],
  ["afterImport", "Categorizing new rows", "Categorizing"],
] as const)("a finished %s job is named by what it did", (kind, label, text) => {
  expect(finishedJobName({ kind, label })).toBe(text);
});
