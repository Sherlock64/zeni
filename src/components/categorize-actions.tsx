import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useJobStatus } from "@/hooks/use-job-status";
import { ollamaSettings, ollamaStatus, startCategorize } from "@/lib/commands";
import { runningJobLabel } from "@/lib/job-label";
import { JOB_STATUS_KEY, OLLAMA_SETTINGS_KEY, OLLAMA_STATUS_KEY } from "@/lib/query-keys";
import type { CommandError } from "@/types/command";

const settingsLink = "underline underline-offset-4 hover:text-foreground";

export function CategorizeActions() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: OLLAMA_STATUS_KEY, queryFn: ollamaStatus });
  const settings = useQuery({ queryKey: OLLAMA_SETTINGS_KEY, queryFn: ollamaSettings });
  const job = useJobStatus();
  const reasonId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const recategorizeButton = useRef<HTMLButtonElement>(null);
  const categorizeButton = useRef<HTMLButtonElement>(null);
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedStatusError, setRetriedStatusError] = useState<CommandError | null>(null);
  const statusError = status.error ?? retriedStatusError;

  const start = useMutation({
    mutationFn: startCategorize,
    onSuccess: (started) => queryClient.setQueryData(JOB_STATUS_KEY, started),
  });

  const running = job.data?.running;
  const unreachable = status.data?.reachable === false;
  const reason = unreachable
    ? "Start Ollama to categorize."
    : settings.data && !settings.data.baseModel
      ? (
          <>
            Pick a model in{" "}
            <Link to="/settings" className={settingsLink}>
              Settings
            </Link>{" "}
            to categorize.
          </>
        )
      : running
        ? runningJobLabel(running)
        : null;
  // Until all three answer, a start would only fail; the backend still checks.
  const blocked = Boolean(reason) || !status.data || !settings.data || !job.data || start.isPending;

  async function retryStatus() {
    if (status.isFetching || !status.error) return;
    setRetriedStatusError(status.error);
    const result = await status.refetch();
    setRetriedStatusError(null);
    // On success the Try again button goes away, so move focus to the actions it unblocked.
    if (result.isSuccess) categorizeButton.current?.focus();
  }

  function categorizeNow() {
    if (blocked) return;
    start.mutate({ scope: "uncategorized" });
  }

  function askRecategorize() {
    if (blocked) return;
    setConfirmOpen(true);
  }

  function recategorize() {
    if (blocked) return;
    setConfirmOpen(false);
    start.mutate({ scope: "notUserSet" });
  }

  // Hold the actions until Ollama answers once, so they don't flash in and change.
  if (status.isPending && !statusError) return null;

  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {reason && (
          <p className="text-sm text-muted-foreground">
            <span id={reasonId}>{reason}</span>
            {unreachable && (
              <>
                {" "}
                <Link to="/settings" className={settingsLink}>
                  Set it up in Settings.
                </Link>
              </>
            )}
          </p>
        )}
        <Button
          ref={categorizeButton}
          variant="outline"
          aria-disabled={blocked}
          aria-describedby={reason ? reasonId : undefined}
          onClick={categorizeNow}
        >
          <SparklesIcon aria-hidden="true" />
          Categorize now
        </Button>
        <Button
          ref={recategorizeButton}
          variant="outline"
          aria-disabled={blocked}
          aria-describedby={reason ? reasonId : undefined}
          onClick={askRecategorize}
        >
          Recategorize all
        </Button>
      </div>
      {statusError && (
        <div className="flex flex-col items-end gap-3">
          <CommandErrorAlert key={status.errorUpdatedAt} title="Couldn't check Ollama" error={statusError} />
          <Button variant="outline" aria-disabled={status.isFetching} onClick={retryStatus}>
            {status.isFetching ? "Trying again…" : "Try again"}
          </Button>
        </div>
      )}
      {settings.isError && <CommandErrorAlert title="Couldn't load Ollama settings" error={settings.error} />}
      {job.isError && <CommandErrorAlert title="Couldn't check for a running job" error={job.error} />}
      {start.isError && <CommandErrorAlert title="Couldn't start categorizing" error={start.error} />}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            recategorizeButton.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Recategorize all?</AlertDialogTitle>
            <AlertDialogDescription>
              Rows you set yourself or that a nickname sets stay as they are. Model answers you already reviewed are replaced and
              need reviewing again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={recategorize}>Recategorize all</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
