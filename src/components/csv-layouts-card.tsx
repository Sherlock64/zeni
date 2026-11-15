import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SheetIcon } from "lucide-react";
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { CsvMappingForm, draftFromMapping, mappingFromDraft } from "@/components/csv-mapping-form";
import { TextField } from "@/components/text-field";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteCsvLayout, listCsvLayouts, updateCsvLayout } from "@/lib/commands";
import { focusFirstInvalid } from "@/lib/focus";
import type { CsvLayout } from "@/types/bindings/CsvLayout";
import type { CommandError } from "@/types/command";
import type { CsvMappingDraft } from "@/types/ui";

function summary({ headers, mapping }: CsvLayout) {
  const column = (index: number) => headers[index] || `column ${index + 1}`;
  const amount =
    mapping.amount.kind === "signed"
      ? `amount in ${column(mapping.amount.column)}`
      : `debit in ${column(mapping.amount.debit)}, credit in ${column(mapping.amount.credit)}`;
  return `Date in ${column(mapping.postedDate)} (${mapping.dateFormat}), ${amount}, description in ${column(mapping.description)}`;
}

export function CsvLayoutsCard() {
  const queryClient = useQueryClient();
  const layouts = useQuery({ queryKey: ["list_csv_layouts"], queryFn: listCsvLayouts });
  const heading = useRef<HTMLHeadingElement>(null);
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const layoutsError = layouts.error ?? retriedError;
  // The button that opened a dialog, to return focus to; the heading when it's gone after a delete.
  const opener = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<CsvLayout | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<CsvMappingDraft | null>(null);
  // Failed save attempts; each one moves focus to the first invalid field.
  const [attempts, setAttempts] = useState(0);
  const attempted = attempts > 0;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (attempts) focusFirstInvalid(form.current);
  }, [attempts]);

  const update = useMutation({
    mutationFn: updateCsvLayout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list_csv_layouts"] });
      setEditOpen(false);
    },
  });
  const remove = useMutation({
    mutationFn: deleteCsvLayout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list_csv_layouts"] });
      setDeleteOpen(false);
    },
  });

  function startEdit(layout: CsvLayout, event: MouseEvent<HTMLButtonElement>) {
    opener.current = event.currentTarget;
    update.reset();
    remove.reset();
    setTarget(layout);
    setName(layout.name);
    setDraft(draftFromMapping(layout.mapping));
    setAttempts(0);
    setEditOpen(true);
  }

  function startDelete(layout: CsvLayout, event: MouseEvent<HTMLButtonElement>) {
    opener.current = event.currentTarget;
    remove.reset();
    update.reset();
    setTarget(layout);
    setDeleteOpen(true);
  }

  function returnFocus(event: Event) {
    event.preventDefault();
    opener.current?.focus();
  }

  const mapping = draft && mappingFromDraft(draft);
  const nameError = attempted && !name.trim() ? "Enter a layout name." : undefined;

  function save(event: FormEvent) {
    event.preventDefault();
    if (update.isPending || !target) return;
    if (mapping && name.trim()) update.mutate({ layoutId: target.id, name: name.trim(), mapping });
    else setAttempts((count) => count + 1);
  }

  async function retryLayouts() {
    if (layouts.isFetching || !layouts.error) return;
    setRetriedError(layouts.error);
    const result = await layouts.refetch();
    setRetriedError(null);
    // The retry button unmounts on success, so move focus to the card heading.
    if (result.isSuccess) heading.current?.focus();
  }

  function status() {
    if (layoutsError) return layouts.isFetching ? "Retrying…" : "";
    if (layouts.isPending) return "Loading saved layouts…";
    if (remove.isSuccess && target) return `Deleted layout ${target.name}.`;
    if (update.isSuccess) return `Saved layout ${update.variables.name}.`;
    return "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={heading} tabIndex={-1}>
            CSV layouts
          </h2>
        </CardTitle>
        <CardDescription>
          Column mappings Zeni saved for your CSV files. Editing or deleting a layout never changes transactions you already
          imported.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Always mounted, so screen readers announce each change to its text. */}
        <p role="status" className="sr-only">
          {status()}
        </p>
        {layoutsError ? (
          <div className="flex flex-col items-start gap-3">
            {/* A new key remounts the alert, so a repeat failure is announced again. */}
            <CommandErrorAlert key={layouts.errorUpdatedAt} title="Couldn't load saved layouts" error={layoutsError} />
            <Button variant="outline" onClick={retryLayouts} aria-disabled={layouts.isFetching}>
              Try again
            </Button>
          </div>
        ) : !layouts.data ? (
          <div aria-hidden="true" className="flex flex-col gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : layouts.data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SheetIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>No saved layouts yet</h3>
              </EmptyTitle>
              <EmptyDescription>Importing a CSV file saves its layout.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {layouts.data.map((layout) => (
              <li key={layout.id} className="flex items-start justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium break-words">{layout.name}</span>
                  <span className="text-xs text-muted-foreground">{summary(layout)}</span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={(event) => startEdit(layout, event)} aria-label={`Edit ${layout.name}`}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => startDelete(layout, event)}
                    aria-label={`Delete ${layout.name}`}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Dialog open={editOpen} onOpenChange={(next) => !update.isPending && setEditOpen(next)}>
          {/* Only the fields scroll, so the header and the Save button stay visible in a small window. */}
          <DialogContent
            className="flex max-h-[calc(100%-2rem)] flex-col sm:max-w-3xl"
            onCloseAutoFocus={returnFocus}
            // An outside click would throw away the edits; Cancel, Escape and the close button still close it.
            onInteractOutside={(event) => event.preventDefault()}
          >
            {target && draft && (
              <form ref={form} onSubmit={save} className="flex min-h-0 min-w-0 flex-col gap-4" noValidate>
                <DialogHeader>
                  <DialogTitle className="break-words">Edit {target.name}</DialogTitle>
                  <DialogDescription>
                    Changes apply to the next file you import with this header. Transactions you already imported stay as
                    they are.
                  </DialogDescription>
                </DialogHeader>
                <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-1">
                  <TextField
                    label="Layout name"
                    name="layoutName"
                    aria-required="true"
                    value={name}
                    onChange={(event) => {
                      update.reset();
                      setName(event.target.value);
                    }}
                    maxLength={100}
                    error={nameError}
                  />
                  <CsvMappingForm
                    headers={target.headers}
                    value={draft}
                    onChange={(next) => {
                      update.reset();
                      setDraft(next);
                    }}
                    showRequired={attempted}
                  />
                  {update.isError && (
                    // The fields scroll, so bring the error into view on a short window.
                    <div ref={(node) => node?.scrollIntoView({ block: "nearest" })}>
                      <CommandErrorAlert
                        title="Couldn't save the layout"
                        error={update.error}
                        nextStep="Nothing was saved. Check the name and the chosen columns, then try again."
                      />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => !update.isPending && setEditOpen(false)} aria-disabled={update.isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" aria-disabled={update.isPending}>
                    {update.isPending ? "Saving…" : "Save layout"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteOpen} onOpenChange={(next) => !remove.isPending && setDeleteOpen(next)}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              // The deleted row's buttons go away once the list refetches, so focus the heading instead.
              event.preventDefault();
              (remove.isSuccess ? heading.current : opener.current)?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this layout?</AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                Zeni forgets the column mapping named {target?.name}. Transactions you imported with it stay as they are. The next
                file with this header asks you to map its columns again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {remove.isError && <CommandErrorAlert title="Couldn't delete the layout" error={remove.error} />}
            <AlertDialogFooter>
              <AlertDialogCancel aria-disabled={remove.isPending}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() => target && !remove.isPending && remove.mutate({ layoutId: target.id })}
                aria-disabled={remove.isPending}
              >
                {remove.isPending ? "Deleting…" : "Delete layout"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
