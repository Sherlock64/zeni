import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, type MouseEvent, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { TextField } from "@/components/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  backupSettings,
  backUpNow,
  chooseBackupFolder,
  listBackups,
  pickRestoreFile,
  restoreBackup,
  setBackupRetention,
} from "@/lib/commands";
import { formatBackupDate, formatSize } from "@/lib/backup-format";
import type { BackupFile } from "@/types/bindings/BackupFile";
import type { BackupKind } from "@/types/bindings/BackupKind";
import type { BackupSettings } from "@/types/bindings/BackupSettings";
import type { CommandError } from "@/types/command";
import type { RestoreTarget } from "@/types/ui";

const kindLabels: Record<BackupKind, string> = {
  manual: "Manual",
  daily: "Daily",
  preRevert: "Before revert",
  safety: "Safety copy",
  other: "Other file",
};

// The kind in a restore button's name: "Restore the safety copy from …".
const kindNouns: Record<BackupKind, string> = {
  manual: "manual backup",
  daily: "daily backup",
  preRevert: "pre-revert backup",
  safety: "safety copy",
  other: "backup",
};

export function BackupCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["backup_settings"], queryFn: backupSettings });
  const backups = useQuery({ queryKey: ["list_backups"], queryFn: listBackups });
  const heading = useRef<HTMLHeadingElement>(null);
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedSettingsError, setRetriedSettingsError] = useState<CommandError | null>(null);
  const settingsError = settings.error ?? retriedSettingsError;
  const [keep, setKeep] = useState<string | null>(null);
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The button that opened the confirm dialog, to return focus to.
  const opener = useRef<HTMLElement | null>(null);

  const settled = (data: BackupSettings) => {
    queryClient.setQueryData(["backup_settings"], data);
    // A new folder or a smaller N changes the list.
    queryClient.invalidateQueries({ queryKey: ["list_backups"] });
  };
  const folder = useMutation({ mutationFn: chooseBackupFolder, onSuccess: (data) => data && settled(data) });
  const retention = useMutation({
    mutationFn: setBackupRetention,
    onSuccess: (data) => {
      settled(data);
      setKeep(null);
    },
  });
  const backUp = useMutation({
    mutationFn: backUpNow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["list_backups"] }),
  });
  const pick = useMutation({
    mutationFn: pickRestoreFile,
    onSuccess: (file) => file && openConfirm({ source: { kind: "pickedFile" }, file }),
  });
  const restore = useMutation({
    mutationFn: restoreBackup,
    // Everything may have changed, including whether Zeni is locked, so the shell re-reads it all.
    onSuccess: async () => {
      setConfirmOpen(false);
      await queryClient.invalidateQueries();
    },
  });

  async function retrySettings() {
    if (settings.isFetching || !settings.error) return;
    setRetriedSettingsError(settings.error);
    const result = await settings.refetch();
    setRetriedSettingsError(null);
    // The retry button unmounts on success, so move focus to the card heading.
    if (result.isSuccess) heading.current?.focus();
  }

  // A finished action's message goes stale once another action in the card starts.
  function clearStatus() {
    for (const mutation of [folder, retention, backUp, restore]) if (mutation.isSuccess) mutation.reset();
  }

  function openConfirm(next: RestoreTarget) {
    clearStatus();
    restore.reset();
    setTarget(next);
    setConfirmOpen(true);
  }

  function restoreRow(file: BackupFile, event: MouseEvent<HTMLButtonElement>) {
    opener.current = event.currentTarget;
    openConfirm({ source: { kind: "backup", fileName: file.fileName }, file });
  }

  function pickFile(event: MouseEvent<HTMLButtonElement>) {
    if (pick.isPending) return;
    clearStatus();
    opener.current = event.currentTarget;
    pick.mutate();
  }

  function saveKeep(event: FormEvent) {
    event.preventDefault();
    // The backend checks the range and answers with a Validation error, shown on the field.
    if (retention.isPending || keep === null) return;
    clearStatus();
    retention.mutate({ keepAutomatic: Number(keep) });
  }

  const keepError = retention.error?.kind === "Validation" ? retention.error.message : undefined;

  const restoredLine =
    restore.isSuccess && target
      ? `Restored the backup from ${formatBackupDate(target.file.createdAt)}. Your previous data is in the newest safety copy below; restore it to undo.`
      : "";

  function status() {
    if (retriedSettingsError) return "Retrying…";
    if (backups.isPending) return "Loading backups…";
    if (restoredLine) return restoredLine;
    if (folder.data) return "Backup folder changed.";
    return "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={heading} tabIndex={-1}>
            Backups
          </h2>
        </CardTitle>
        <CardDescription>
          Copies of your Zeni data. Zeni backs up on the first start of each day and before every import revert.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Always mounted, so screen readers announce each change to its text. */}
        <p role="status" className="sr-only">
          {status()}
        </p>

        {settings.data?.dailyWarning && (
          <Alert>
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Today's automatic backup didn't work</AlertTitle>
            <AlertDescription>
              {settings.data.dailyWarning} Zeni tries again the next time it starts, or you can back up now.
            </AlertDescription>
          </Alert>
        )}

        {settingsError ? (
          <div className="flex flex-col items-start gap-3">
            <CommandErrorAlert key={settings.errorUpdatedAt} title="Couldn't load backup settings" error={settingsError} />
            <Button variant="outline" onClick={retrySettings} aria-disabled={settings.isFetching}>
              Try again
            </Button>
          </div>
        ) : !settings.data ? (
          <div aria-hidden="true" className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-48" />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-start gap-3">
              <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-8 gap-y-3">
                <dt className="text-muted-foreground">Folder</dt>
                <dd>
                  <span className="font-mono text-xs break-all">{settings.data.folder}</span>
                  {settings.data.isDefaultFolder && <span className="text-muted-foreground"> (default)</span>}
                </dd>
              </dl>
              <Button
                variant="outline"
                onClick={() => {
                  if (folder.isPending) return;
                  clearStatus();
                  folder.mutate();
                }}
                aria-disabled={folder.isPending}
              >
                {folder.isPending ? "Choosing…" : "Change folder…"}
              </Button>
              {folder.isError && <CommandErrorAlert title="Couldn't change the backup folder" error={folder.error} />}
            </div>

            <form noValidate onSubmit={saveKeep} className="flex flex-col items-start gap-3">
              <TextField
                name="keepAutomatic"
                label="Automatic backups to keep"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                className="w-32"
                announce
                hint="Between 1 and 365. Older daily and before-revert backups are deleted; manual backups and safety copies are always kept."
                value={keep ?? String(settings.data.keepAutomatic)}
                onChange={(event) => {
                  // An edit makes "Saved." stale; a save in flight keeps its busy state.
                  if (!retention.isPending) retention.reset();
                  setKeep(event.target.value);
                }}
                error={keepError}
              />
              {retention.isError && !keepError && (
                <CommandErrorAlert title="Couldn't save the setting" error={retention.error} />
              )}
              <div className="flex items-center gap-3">
                <Button type="submit" variant="outline" aria-disabled={retention.isPending}>
                  {retention.isPending ? "Saving…" : "Save"}
                </Button>
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {retention.isSuccess ? "Saved." : ""}
                </p>
              </div>
            </form>
          </>
        )}

        <div className="flex flex-col items-start gap-3">
          <Button
            onClick={() => {
              if (backUp.isPending) return;
              clearStatus();
              backUp.mutate();
            }}
            aria-disabled={backUp.isPending}
          >
            {backUp.isPending ? "Backing up…" : "Back up now"}
          </Button>
          {/* A wrapper status announces the result politely; the Alert's own role is assertive. */}
          <div role="status" className="w-full empty:hidden">
            {backUp.isSuccess && (
              <Alert role={undefined}>
                <CircleCheckIcon aria-hidden="true" />
                <AlertTitle>Backup saved</AlertTitle>
                <AlertDescription>
                  <span className="font-mono text-xs break-all">{backUp.data.path}</span>
                </AlertDescription>
              </Alert>
            )}
          </div>
          {backUp.isError && <CommandErrorAlert title="Couldn't back up" error={backUp.error} />}
        </div>

        <div className="flex flex-col items-start gap-3">
          <h3 className="font-medium">Restore</h3>
          {restoredLine && (
            // Announced by the status region above, so drop the Alert's assertive role.
            <Alert role={undefined}>
              <CircleCheckIcon aria-hidden="true" />
              <AlertTitle>Backup restored</AlertTitle>
              <AlertDescription>{restoredLine}</AlertDescription>
            </Alert>
          )}
          {backups.error ? (
            <div className="flex flex-col items-start gap-3">
              <CommandErrorAlert key={backups.errorUpdatedAt} title="Couldn't list backups" error={backups.error} />
              <Button variant="outline" onClick={() => !backups.isFetching && backups.refetch()} aria-disabled={backups.isFetching}>
                Try again
              </Button>
            </div>
          ) : !backups.data ? (
            <div aria-hidden="true" className="flex w-full flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : backups.data.length === 0 ? (
            <Empty className="w-full border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ArchiveIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  <h4>No backups in this folder yet</h4>
                </EmptyTitle>
                <EmptyDescription>Back up now, or restore a file from somewhere else.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="w-full rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Date</TableHead>
                    <TableHead scope="col">Kind</TableHead>
                    <TableHead scope="col" className="text-right">Size</TableHead>
                    <TableHead scope="col">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.data.map((file) => (
                    <TableRow key={file.fileName}>
                      <TableCell className="tabular-nums">{formatBackupDate(file.createdAt)}</TableCell>
                      <TableCell>{kindLabels[file.kind]}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatSize(file.sizeBytes)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(event) => restoreRow(file, event)}
                          aria-label={`Restore the ${kindNouns[file.kind]} from ${formatBackupDate(file.createdAt)}`}
                        >
                          Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Button variant="outline" onClick={pickFile} aria-disabled={pick.isPending}>
            {pick.isPending ? "Choosing…" : "Restore from file…"}
          </Button>
          {pick.isError && <CommandErrorAlert title="Couldn't open the file" error={pick.error} />}
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={(next) => !restore.isPending && setConfirmOpen(next)}>
          <AlertDialogContent
            className="data-[size=default]:sm:max-w-md"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              opener.current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                Restore the backup from {target && formatBackupDate(target.file.createdAt)}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {target?.source.kind === "pickedFile" && `Zeni will restore ${target.file.fileName}. `}
                Your current data will be replaced. A safety copy is kept first.
              </AlertDialogDescription>
              {/* Outside the description, so screen readers don't read the full path as part of the dialog. */}
              {target?.source.kind === "pickedFile" && (
                <p className="font-mono text-xs break-all text-muted-foreground">{target.file.path}</p>
              )}
            </AlertDialogHeader>
            {restore.isError && (
              <CommandErrorAlert
                title="Couldn't restore"
                error={restore.error}
                nextStep="Choose another backup, or check the backup folder."
              />
            )}
            <AlertDialogFooter>
              <AlertDialogCancel aria-disabled={restore.isPending}>Cancel</AlertDialogCancel>
              {/* A plain button, not AlertDialogAction, so the dialog stays open to show a failure. */}
              <Button
                variant="destructive"
                aria-disabled={restore.isPending}
                onClick={() => target && !restore.isPending && restore.mutate({ source: target.source })}
              >
                {restore.isPending ? "Restoring…" : "Replace my data"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
