import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { CsvMappingForm, guessDraft, mappingFromDraft } from "@/components/csv-mapping-form";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { previewCsvMapping, saveCsvLayout } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { focusFirstInvalid } from "@/lib/focus";
import { formatCents } from "@/lib/money";
import type { CsvMapping } from "@/types/bindings/CsvMapping";
import type { CsvPreviewRow } from "@/types/bindings/CsvPreviewRow";
import type { CsvMappingDialogProps } from "@/types/ui";

const fixMapping = "Check the chosen columns and date format, or cancel.";
const cents = (value: number | null) => (value === null ? "" : formatCents(value));
const money = "text-right tabular-nums whitespace-nowrap";
const text = "whitespace-normal break-words";
// Preview columns: the mapping field that turns it on, its heading, its parsed value, its cell style, and whether
// it's a right-aligned number. Text cells wrap so most layouts fit; a narrow window scrolls the table sideways.
const previewColumns: [keyof CsvMapping, string, (row: CsvPreviewRow) => string, string, boolean][] = [
  ["postedDate", "Date", (row) => (row.postedDate ? formatDate(row.postedDate) : ""), "tabular-nums whitespace-nowrap", false],
  ["description", "Description", (row) => row.description ?? "", text, false],
  ["amount", "Amount", (row) => cents(row.amountCents), money, true],
  ["transactionId", "Transaction ID", (row) => row.transactionId ?? "", "whitespace-normal break-all font-mono text-xs", false],
  ["memo", "Memo", (row) => row.memo ?? "", text, false],
  ["transactionType", "Type", (row) => row.transactionType ?? "", text, false],
  ["runningBalance", "Balance", (row) => cents(row.runningBalanceCents), money, true],
  ["postingStatus", "Status", (row) => row.postingStatus ?? "", text, false],
  ["bankCategory", "Category", (row) => row.bankCategory ?? "", text, false],
];

export function CsvMappingDialog({ needed, onStep, onCancel, cancelling, onCloseAutoFocus }: CsvMappingDialogProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => guessDraft(needed.headers));
  const [mapping, setMapping] = useState(() => mappingFromDraft(draft));
  const [name, setName] = useState("");
  // Failed save attempts; each one moves focus to the first invalid field.
  const [attempts, setAttempts] = useState(0);
  const attempted = attempts > 0;
  const formRef = useRef<HTMLFormElement>(null);
  const preview = useQuery({
    queryKey: ["preview_csv_mapping", mapping],
    queryFn: () => previewCsvMapping(mapping!),
    enabled: mapping !== null,
    placeholderData: keepPreviousData,
  });
  const save = useMutation({
    mutationFn: saveCsvLayout,
    onSuccess: (step) => {
      queryClient.invalidateQueries({ queryKey: ["list_csv_layouts"] });
      onStep(step);
    },
  });
  const busy = save.isPending || cancelling;
  const nameError = attempted && !name.trim() ? "Enter a layout name." : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (mapping && name.trim()) save.mutate({ name: name.trim(), mapping });
    else setAttempts((n) => n + 1);
  }

  useEffect(() => {
    if (attempts) focusFirstInvalid(formRef.current);
  }, [attempts]);

  const columns = mapping ? previewColumns.filter(([field]) => mapping[field] !== null) : [];

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        className="flex max-h-[calc(100%-2rem)] flex-col sm:max-w-5xl"
        onCloseAutoFocus={onCloseAutoFocus}
        // A stray click outside would throw away the mapping; Cancel, X and Escape still close it.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <form ref={formRef} onSubmit={submit} className="flex min-h-0 min-w-0 flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="break-all">Map the columns of {needed.fileName}</DialogTitle>
            <DialogDescription>
              Zeni doesn't know this CSV layout yet. Choose which column holds what. Zeni saves the layout and uses it for every
              file with the same header.
            </DialogDescription>
          </DialogHeader>
          {/* Only the body scrolls, so the footer's buttons stay in view; px keeps focus rings unclipped. */}
          <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-1">
            <TextField
              label="Layout name"
              name="layoutName"
              hint="For example, your bank's name."
              value={name}
              onChange={(event) => {
                save.reset();
                setName(event.target.value);
              }}
              maxLength={100}
              error={nameError}
            />
            <CsvMappingForm
              headers={needed.headers}
              value={draft}
              onChange={(next, nextMapping) => {
                save.reset();
                setDraft(next);
                setMapping(nextMapping);
              }}
              showRequired={attempted}
            />
            <section aria-labelledby="csv-preview-heading" aria-busy={mapping !== null && preview.isFetching} className="flex flex-col gap-2">
              <h3 id="csv-preview-heading" className="font-medium">
                Preview
              </h3>
              {!mapping ? (
                <p className="text-muted-foreground">Choose the required columns to see a preview.</p>
              ) : preview.isError ? (
                <CommandErrorAlert title="Couldn't preview the mapping" error={preview.error} nextStep={fixMapping} />
              ) : preview.isPending ? (
                <div aria-hidden="true" className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : preview.data.length === 0 ? (
                <p className="text-muted-foreground">This file has no rows to preview.</p>
              ) : (
                <div
                  role="region"
                  aria-label="Preview rows"
                  tabIndex={0}
                  className="overflow-x-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {/* A plain table in a focusable region: on a narrow window keyboard users can scroll to every column. */}
                  <table aria-label="Preview of the first rows" className="w-full text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Line</TableHead>
                        {columns.map(([field, heading, , , numeric]) => (
                          <TableHead key={field} scope="col" className={numeric ? "text-right" : undefined}>
                            {heading}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.data.map((row) => (
                        <TableRow key={row.line}>
                          <TableCell className="text-muted-foreground tabular-nums">{row.line}</TableCell>
                          {row.error ? (
                            <TableCell colSpan={columns.length} className="whitespace-normal text-destructive">
                              <span className="flex items-start gap-1.5">
                                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                                {row.error}
                              </span>
                            </TableCell>
                          ) : (
                            columns.map(([field, , value, cell]) => (
                              <TableCell key={field} className={cell}>
                                {value(row)}
                              </TableCell>
                            ))
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              )}
            </section>
            {save.isError && (
              // The body scrolls, so bring the error into view next to the buttons.
              <div ref={(node) => node?.scrollIntoView({ block: "nearest" })}>
                <CommandErrorAlert title="Couldn't save the layout" error={save.error} nextStep={fixMapping} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => !busy && onCancel()} aria-disabled={busy}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
            <Button type="submit" aria-disabled={busy}>
              {save.isPending ? "Saving…" : "Save and import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
