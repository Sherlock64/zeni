import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { PAGE_WIDTH } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { invalidateJobStatus, useJobStatus } from "@/hooks/use-job-status";
import { cancelJob, clearJobOutcome } from "@/lib/commands";
import { finishedJobName, runningJobLabel } from "@/lib/job-label";
import { BUILDS_KEY, CATEGORIES_KEY, REVIEW_GROUPS_KEY, TRANSACTIONS_KEY, UNREVIEWED_COUNT_KEY } from "@/lib/query-keys";
import type { JobKind } from "@/types/bindings/JobKind";
import type { JobOutcome } from "@/types/bindings/JobOutcome";

// Download progress belongs to the Ollama card; builds have no other place to show progress or cancel.
const isShown = (kind: JobKind) => kind !== "download";
// The backend labels a build job "Build <model>".
const builtModel = (label: string) => label.replace(/^Build /, "");
const percent = (done: number, total: number) => Math.floor((done * 100) / total);

export function CategorizeBanner() {
  const queryClient = useQueryClient();
  const job = useJobStatus();
  const labelId = useId();
  const cancel = useMutation({ mutationFn: cancelJob, onSuccess: () => invalidateJobStatus(queryClient) });
  const dismiss = useMutation({ mutationFn: clearJobOutcome, onSuccess: () => invalidateJobStatus(queryClient) });

  const running = job.data?.running && isShown(job.data.running.kind) ? job.data.running : null;
  const last = !job.data?.running && job.data?.last && isShown(job.data.last.kind) ? job.data.last : null;

  // A finished run changed categories on many rows; a finished build changed the builds list.
  const runningKind = running?.kind ?? null;
  const endedKind = useRef<JobKind | null>(null);
  useEffect(() => {
    if (runningKind) {
      endedKind.current = runningKind;
    } else if (endedKind.current) {
      const keys =
        endedKind.current === "build"
          ? [BUILDS_KEY]
          : [TRANSACTIONS_KEY, REVIEW_GROUPS_KEY, UNREVIEWED_COUNT_KEY, CATEGORIES_KEY];
      endedKind.current = null;
      for (const queryKey of keys) queryClient.invalidateQueries({ queryKey });
    }
  }, [runningKind, queryClient]);

  // The progress block or the summary is gone, so don't leave a keyboard user's focus on nothing.
  const hasRunning = Boolean(running);
  const hasLast = Boolean(last);
  const shown = useRef({ running: false, last: false });
  useEffect(() => {
    const before = shown.current;
    shown.current = { running: hasRunning, last: hasLast };
    if (((before.running && !hasRunning) || (before.last && !hasLast)) && document.activeElement === document.body) {
      document.querySelector<HTMLElement>("main h1")?.focus();
    }
  }, [hasRunning, hasLast]);

  const visible = running || last || job.isError || cancel.isError || dismiss.isError;
  const lines = last ? outcomeLines(last) : [];
  const announcement = running ? progressAnnouncement(runningJobLabel(running), running.done, running.total) : lines.join(" ");

  return (
    <div className={`${PAGE_WIDTH} flex flex-col gap-3 ${visible ? "pt-6" : ""}`}>
      {/* Always mounted and coarse, so screen readers hear the start, every quarter and the end, not every poll. */}
      <div role="status" className="sr-only">
        {announcement}
      </div>
      {running && (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <p id={labelId} className="text-sm font-medium">
            {running.kind === "build" ? runningJobLabel(running) : `Categorizing ${running.done} of ${running.total}`}
          </p>
          <div className="flex items-center gap-3">
            {/* A total of 0 is unknown, so the bar stays indeterminate and pulses to show it is working. */}
            <Progress
              aria-labelledby={labelId}
              className={`flex-1 ${running.total ? "" : "animate-pulse bg-primary/40"}`}
              value={running.total ? percent(running.done, running.total) : null}
            />
            <Button
              variant="outline"
              size="sm"
              aria-disabled={cancel.isPending}
              onClick={() => !cancel.isPending && cancel.mutate()}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        </div>
      )}
      {last && (
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4 text-sm">
          <div className="flex flex-col gap-1">
            {lines.map((line, i) => (
              <p key={line} className={i === 0 && (last.cancelled || last.error) ? "font-medium" : undefined}>
                {line}
              </p>
            ))}
          </div>
          <div className="flex shrink-0 gap-2">
            {(last.summary?.categorized ?? 0) > 0 && (
              <Button asChild variant="outline" size="sm">
                <a href="#/review">Review them</a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              aria-disabled={dismiss.isPending}
              onClick={() => !dismiss.isPending && dismiss.mutate()}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {last?.error && <CommandErrorAlert title="Ollama reported a problem" error={{ kind: "Ollama", message: last.error }} />}
      {job.isError && <CommandErrorAlert title="Couldn't check the running job" error={job.error} />}
      {cancel.isError && <CommandErrorAlert title="Couldn't cancel the job" error={cancel.error} />}
      {dismiss.isError && <CommandErrorAlert title="Couldn't dismiss the summary" error={dismiss.error} />}
    </div>
  );
}

function progressAnnouncement(label: string, done: number, total: number) {
  const quarter = total ? Math.floor((done * 4) / total) * 25 : 0;
  return quarter ? `${label} ${quarter}% done.` : label;
}

function outcomeLines(last: JobOutcome) {
  const lines: string[] = [];
  const name = finishedJobName(last);
  if (last.cancelled) lines.push(`${name} was cancelled.`);
  if (last.error) {
    const done = last.summary ? last.summary.categorized + last.summary.couldntCategorize : null;
    lines.push(done === null ? `${name} stopped.` : `${name} stopped after ${done} ${done === 1 ? "row" : "rows"}.`);
  }
  if (last.summary) {
    const { categorized, couldntCategorize, notReached } = last.summary;
    lines.push(`Categorized ${categorized}. Couldn't categorize ${couldntCategorize}. Not reached ${notReached}.`);
  }
  if (last.kind === "build" && !last.cancelled && !last.error) lines.push(`Built ${builtModel(last.label)}.`);
  return lines;
}
