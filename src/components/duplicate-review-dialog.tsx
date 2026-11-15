import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { commitImport } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { focusFirstInvalid } from "@/lib/focus";
import { formatCents } from "@/lib/money";
import type { DuplicateAnswer, DuplicateReviewDialogProps } from "@/types/ui";

export function DuplicateReviewDialog({ review, onStep, onCancel, cancelling, onCloseAutoFocus }: DuplicateReviewDialogProps) {
  const id = useId();
  // No answer by default: either default silently drops a real transaction or double counts one.
  const [answers, setAnswers] = useState<Record<number, DuplicateAnswer>>({});
  // Failed confirm attempts; each one remounts the alert and moves focus to the first unanswered row.
  const [attempts, setAttempts] = useState(0);
  const attempted = attempts > 0;
  const listRef = useRef<HTMLUListElement>(null);
  const commit = useMutation({
    mutationFn: commitImport,
    onSuccess: (summary) => onStep({ step: "imported", data: summary }),
  });
  const busy = commit.isPending || cancelling;
  const unanswered = review.pairs.filter((pair) => !answers[pair.rowIndex]).length;

  function confirm() {
    if (busy) return;
    if (unanswered > 0) return setAttempts((n) => n + 1);
    commit.mutate({ skipRows: review.pairs.filter((pair) => answers[pair.rowIndex] === "yes").map((pair) => pair.rowIndex) });
  }

  useEffect(() => {
    if (attempts) focusFirstInvalid(listRef.current);
  }, [attempts]);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        className="flex max-h-[calc(100%-2rem)] flex-col sm:max-w-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
        // A stray click outside would throw away the answers; Cancel, X and Escape still close it.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Check possible duplicates</DialogTitle>
          <DialogDescription className="break-words">
            {review.pairs.length === 1 ? "1 row" : `${review.pairs.length} rows`} in {review.fileName} look like transactions
            you already imported from a file in another format. Nothing is stored until you confirm.
          </DialogDescription>
        </DialogHeader>
        {/* Only the body scrolls, so the footer's buttons stay in view; px keeps focus rings unclipped. */}
        <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-1">
          <ul ref={listRef} className="flex flex-col gap-3">
            {review.pairs.map((pair) => {
              const pairId = `${id}-${pair.rowIndex}`;
              const invalid = attempted && !answers[pair.rowIndex];
              return (
                <li key={pair.rowIndex} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
                  <Table className="table-fixed" aria-label={`Possible duplicate: ${pair.newRow.description}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col" className="w-[30%]">
                          Source
                        </TableHead>
                        <TableHead scope="col" className="w-28">
                          Date
                        </TableHead>
                        <TableHead scope="col">Description</TableHead>
                        <TableHead scope="col" className="w-24 text-right">
                          Amount
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(
                        [
                          ["This file", pair.newRow, `${pairId}-new`],
                          [`${pair.existingFileName} (${pair.existingFormat.toUpperCase()})`, pair.existing, undefined],
                        ] as const
                      ).map(([source, row, rowId]) => (
                        <TableRow key={source}>
                          <TableHead scope="row" className="font-normal break-words whitespace-normal text-muted-foreground">
                            {source}
                          </TableHead>
                          <TableCell className="tabular-nums">{formatDate(row.postedDate)}</TableCell>
                          <TableCell id={rowId} className="break-words whitespace-normal">
                            {row.description}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(row.amountCents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex flex-col gap-2">
                    <span id={`${pairId}-question`} className="font-medium">
                      Is it the same transaction?
                    </span>
                    <RadioGroup
                      aria-labelledby={`${pairId}-question ${pairId}-new`}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? `${pairId}-error` : undefined}
                      value={answers[pair.rowIndex] ?? ""}
                      onValueChange={(value) => setAnswers((current) => ({ ...current, [pair.rowIndex]: value as DuplicateAnswer }))}
                      className="flex flex-wrap gap-x-4 gap-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          id={`${pairId}-yes`}
                          value="yes"
                          className="border-muted-foreground"
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? `${pairId}-error` : undefined}
                        />
                        <Label htmlFor={`${pairId}-yes`} className="font-normal">
                          Yes, duplicate (skip it)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          id={`${pairId}-no`}
                          value="no"
                          className="border-muted-foreground"
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? `${pairId}-error` : undefined}
                        />
                        <Label htmlFor={`${pairId}-no`} className="font-normal">
                          No (import it)
                        </Label>
                      </div>
                    </RadioGroup>
                    {invalid && (
                      <p id={`${pairId}-error`} className="text-sm text-destructive">
                        Choose an answer.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {attempted && unanswered > 0 && (
            <p key={attempts} role="alert" className="text-sm text-destructive">
              Answer every row first. {unanswered === 1 ? "1 row is" : `${unanswered} rows are`} left.
            </p>
          )}
          {commit.isError && <CommandErrorAlert title="Couldn't import the file" error={commit.error} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => !busy && onCancel()} aria-disabled={busy}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
          <Button onClick={confirm} aria-disabled={busy}>
            {commit.isPending ? "Importing…" : "Confirm and import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
