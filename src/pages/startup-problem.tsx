import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon } from "lucide-react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useStartupStatus } from "@/hooks/use-startup-status";
import { continueStartup } from "@/lib/commands";
import { STARTUP_STATUS_KEY } from "@/lib/query-keys";

const INSTALL_GUIDE = "https://github.com/Sherlock64/zeni/blob/main/docs/install.md";

// The shell shows this page only for a blocked startup, so the status is loaded.
export function StartupProblemPage() {
  const status = useStartupStatus().data;
  if (status?.state === "backupFailed") return <BackupFailed />;
  if (status?.state !== "newerData") return null;

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
        Data from a newer Zeni
      </h1>
      <p className="text-muted-foreground">
        {status.version
          ? `This data was last opened by Zeni ${status.version}. Install Zeni ${status.version} or newer, or restore by hand the before-update backup Zeni made before that update.`
          : "This data was last opened by a newer Zeni. Install a newer Zeni, or restore by hand the before-update backup Zeni made before that update."}
      </p>
      <Button asChild variant="link" className="self-start px-0 underline underline-offset-4">
        <a
          href={INSTALL_GUIDE}
          onClick={(event) => {
            event.preventDefault();
            openUrl(INSTALL_GUIDE);
          }}
        >
          Install or restore guide
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}

function BackupFailed() {
  const status = useStartupStatus().data;
  const reason = status?.state === "backupFailed" ? status.reason : "";
  const queryClient = useQueryClient();
  const attempt = useMutation({
    mutationFn: continueStartup,
    onSuccess: (next) => {
      queryClient.setQueryData(STARTUP_STATUS_KEY, next);
      // Both failed while the database was held back, so load them afresh behind the loading screen.
      if (next.state === "ready") for (const queryKey of [["security_status"], ["app_info"]]) queryClient.resetQueries({ queryKey });
    },
  });
  const run = (withoutBackup: boolean) => !attempt.isPending && attempt.mutate({ withoutBackup });

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
        Backup before update failed
      </h1>
      {/* Live, so a retry that fails again with a new reason is announced. */}
      <p aria-live="polite" className="text-muted-foreground">
        {reason}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button aria-disabled={attempt.isPending} onClick={() => run(false)}>
          {attempt.isPending && !attempt.variables.withoutBackup ? "Retrying…" : "Retry"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" aria-disabled={attempt.isPending} onClick={(event) => attempt.isPending && event.preventDefault()}>
              {attempt.isPending && attempt.variables.withoutBackup ? "Continuing…" : "Continue without backup"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Update your data without a backup?</AlertDialogTitle>
              <AlertDialogDescription>Zeni will update your data with no copy to go back to.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(true)}>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {attempt.isError && (
        <CommandErrorAlert
          key={attempt.submittedAt}
          title="Couldn't continue starting Zeni"
          error={attempt.error}
          nextStep="Try again, or continue without a backup."
        />
      )}
    </div>
  );
}
