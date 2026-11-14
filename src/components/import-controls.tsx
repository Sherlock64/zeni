import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, CircleDotIcon, CircleMinusIcon, FileCheckIcon, HistoryIcon, TriangleAlertIcon, UploadIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { importFile, listImports, revertImport } from "@/lib/commands";
import { formatCents } from "@/lib/money";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportSummary } from "@/types/bindings/ImportSummary";
import type { BalanceFlagProps, ImportListProps, ImportSummaryAlertProps } from "@/types/ui";

const money = (cents: number | null) => (cents === null ? "an unknown amount" : formatCents(cents));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
// imported_at is SQLite CURRENT_TIMESTAMP: UTC "YYYY-MM-DD HH:MM:SS".
const importedDate = (importedAt: string) => dateTime.format(new Date(`${importedAt.replace(" ", "T")}Z`));

function invalidateImports(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["list_transactions"] });
  queryClient.invalidateQueries({ queryKey: ["list_imports"] });
}

export function ImportControls() {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const mutation = useMutation({
    mutationFn: importFile,
    onSuccess: (result) => {
      // null means the picker was cancelled: leave everything as it was.
      if (!result) return;
      setSummary(result);
      invalidateImports(queryClient);
    },
    // A stale summary would reappear once this error is dismissed.
    onError: () => setSummary(null),
  });

  function dismiss() {
    setSummary(null);
    importButton.current?.focus();
  }

  function dismissError() {
    mutation.reset();
    importButton.current?.focus();
  }

  // A reverted import's summary would claim the file is still imported.
  const reverted = (importId: number) => setSummary((current) => (current?.importId === importId ? null : current));

  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap gap-2">
        <ImportHistory onReverted={reverted} />
        <Button ref={importButton} onClick={() => !mutation.isPending && mutation.mutate()} aria-disabled={mutation.isPending}>
          <UploadIcon aria-hidden="true" />
          {mutation.isPending ? "Importing…" : "Import file"}
        </Button>
      </div>
      {/* Always mounted, so screen readers announce the summary when it appears. */}
      <div role="status" className="w-full empty:hidden">
        {summary && <ImportSummaryAlert summary={summary} onDismiss={dismiss} />}
      </div>
      {mutation.isError && <CommandErrorAlert title="Couldn't import the file" error={mutation.error} onDismiss={dismissError} />}
    </div>
  );
}

function ImportSummaryAlert({ summary, onDismiss }: ImportSummaryAlertProps) {
  const ledger = money(summary.ledgerBalanceCents);
  const balance = {
    passed: ["Balance check passed.", `The bank's balance of ${ledger} matches your previous import.`],
    mismatch: [
      "Balance doesn't match.",
      `Your previous import says it should be ${money(summary.expectedBalanceCents)}, but the bank reports ${ledger}. Some transactions may be missing.`,
    ],
    baseline: ["First balance recorded.", `The bank reports ${ledger}. Later imports are checked against it.`],
    notChecked: ["Balance not checked.", "This file has no balance to check against."],
  }[summary.balanceCheck];
  const mismatch = summary.balanceCheck === "mismatch";

  return (
    // role="status" on the wrapper announces it politely; drop the Alert's assertive role.
    <Alert role={undefined}>
      {mismatch ? <TriangleAlertIcon aria-hidden="true" className="text-destructive" /> : <FileCheckIcon aria-hidden="true" />}
      <AlertTitle className="break-all">Imported {summary.fileName}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <div>
          {plural(summary.added, "transaction", "transactions")} added, {plural(summary.duplicates, "duplicate", "duplicates")}{" "}
          skipped.
        </div>
        <div className={mismatch ? "text-destructive" : undefined}>
          <strong className="font-medium">{balance[0]}</strong> {balance[1]}
        </div>
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss import summary">
          <XIcon aria-hidden="true" />
        </Button>
      </AlertAction>
    </Alert>
  );
}

function ImportHistory({ onReverted }: ImportListProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <HistoryIcon aria-hidden="true" />
          Import history
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0">
        {/* Mounted only while the sheet is open, so the list is fetched when it's needed. */}
        <ImportList onReverted={onReverted} />
      </SheetContent>
    </Sheet>
  );
}

function ImportList({ onReverted }: ImportListProps) {
  const queryClient = useQueryClient();
  const imports = useQuery({ queryKey: ["list_imports"], queryFn: listImports });
  const [target, setTarget] = useState<ImportRecord | null>(null);
  const [open, setOpen] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const revert = useMutation({
    mutationFn: revertImport,
    onSuccess: (_, { importId }) => {
      setOpen(false);
      onReverted(importId);
      invalidateImports(queryClient);
    },
  });

  function confirm(record: ImportRecord) {
    revert.reset();
    setTarget(record);
    setOpen(true);
  }

  function openChange(next: boolean) {
    if (!revert.isPending) setOpen(next);
  }

  function status() {
    if (imports.isPending) return "Loading import history…";
    if (revert.isSuccess && target) return `Reverted ${target.fileName}.`;
    return "";
  }

  return (
    <>
      <SheetHeader>
        {/* Focus target after a revert, since the reverted row's button is gone. */}
        <SheetTitle ref={title} tabIndex={-1}>
          Import history
        </SheetTitle>
        <SheetDescription>Files you imported, newest first. Revert an import to delete its transactions.</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {/* Always mounted, so screen readers announce each change to its text. */}
        <p role="status" className="sr-only">
          {status()}
        </p>
        {imports.isError ? (
          <div className="flex flex-col items-start gap-3">
            <CommandErrorAlert title="Couldn't load import history" error={imports.error} />
            <Button variant="outline" onClick={() => !imports.isFetching && imports.refetch()} aria-disabled={imports.isFetching}>
              Try again
            </Button>
          </div>
        ) : imports.isPending ? (
          <div aria-hidden="true" className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : imports.data.length === 0 ? (
          <Empty className="flex-none border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>No imports yet</h3>
              </EmptyTitle>
              <EmptyDescription>Files you import show up here, so you can check or revert them.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {imports.data.map((record) => (
              <li key={record.id} className="flex items-start justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium break-all">{record.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {record.format.toUpperCase()} · <time dateTime={record.importedAt}>{importedDate(record.importedAt)}</time> ·{" "}
                    {plural(record.rowCount, "transaction", "transactions")}
                  </span>
                  <BalanceFlag record={record} />
                </div>
                <Button variant="outline" size="sm" onClick={() => confirm(record)} aria-label={`Revert ${record.fileName}`}>
                  Revert
                </Button>
              </li>
            ))}
          </ul>
        )}

        <AlertDialog open={open} onOpenChange={openChange}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              if (!revert.isSuccess) return;
              event.preventDefault();
              title.current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Revert this import?</AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                Zeni permanently deletes {target?.fileName} and its{" "}
                {plural(target?.rowCount ?? 0, "transaction", "transactions")}. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {revert.isError && <CommandErrorAlert title="Couldn't revert the import" error={revert.error} />}
            <AlertDialogFooter>
              <AlertDialogCancel aria-disabled={revert.isPending}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() => target && !revert.isPending && revert.mutate({ importId: target.id })}
                aria-disabled={revert.isPending}
              >
                {revert.isPending ? "Reverting…" : "Revert import"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}

function BalanceFlag({ record }: BalanceFlagProps) {
  if (record.balanceCheck === "mismatch")
    return (
      <span className="flex items-start gap-1.5 text-xs text-destructive">
        <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>
          <strong className="font-medium">Balance doesn't match:</strong> expected {money(record.expectedBalanceCents)}, bank
          reports {money(record.ledgerBalanceCents)}
        </span>
      </span>
    );
  const [Icon, text] = (
    {
      passed: [CircleCheckIcon, "Balance check passed"],
      baseline: [CircleDotIcon, "First balance recorded"],
      notChecked: [CircleMinusIcon, "Balance not checked"],
    } as const
  )[record.balanceCheck];
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {text}
    </span>
  );
}
