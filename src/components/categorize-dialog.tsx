import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setTransactionCategory } from "@/lib/commands";
import { CATEGORIES_KEY, REVIEW_GROUPS_KEY, TRANSACTIONS_KEY, UNREVIEWED_COUNT_KEY } from "@/lib/query-keys";
import type { CategorizeDialogProps } from "@/types/ui";

// Sets or clears the user's category of one row and its note. "Uncategorized" keeps the note.
export function CategorizeDialog({ transaction, open, onOpenChange, onCloseAutoFocus }: CategorizeDialogProps) {
  const queryClient = useQueryClient();
  const id = useId();
  const [categoryId, setCategoryId] = useState(transaction.categoryId);
  const [note, setNote] = useState(transaction.note ?? "");
  const save = useMutation({
    mutationFn: () => setTransactionCategory({ transactionId: transaction.id, categoryId, note }),
    onSuccess: () => {
      for (const queryKey of [TRANSACTIONS_KEY, REVIEW_GROUPS_KEY, UNREVIEWED_COUNT_KEY, CATEGORIES_KEY]) {
        queryClient.invalidateQueries({ queryKey });
      }
      onOpenChange(false);
    },
  });
  // The note's length is the only field error, by the wording of src-tauri/src/overlay.rs.
  const noteError = save.error?.kind === "Validation" && save.error.message.startsWith("Use at most") ? save.error.message : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!save.isPending) save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Categorize</DialogTitle>
            <DialogDescription className="break-words">
              {transaction.nickname ?? transaction.description}. A category you pick here stays until you change it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-category`}>Category</Label>
            <CategorySelect
              id={`${id}-category`}
              value={categoryId}
              uncategorizedLabel="Uncategorized"
              onChange={(next) => {
                save.reset();
                setCategoryId(next);
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-note`}>Note</Label>
            <Textarea
              id={`${id}-note`}
              name="note"
              rows={3}
              value={note}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? `${id}-note-error` : `${id}-note-hint`}
              onChange={(event) => {
                save.reset();
                setNote(event.target.value);
              }}
            />
            {noteError ? (
              <p id={`${id}-note-error`} role="alert" className="text-sm text-destructive">
                {noteError}
              </p>
            ) : (
              <p id={`${id}-note-hint`} className="text-sm text-muted-foreground">
                Optional, up to 500 characters. Search finds it too.
              </p>
            )}
          </div>
          {save.error && !noteError && (
            <CommandErrorAlert
              title="Couldn't save the category"
              error={save.error}
              nextStep={save.error.kind === "NotFound" ? "Close this dialog and try again." : undefined}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => !save.isPending && onOpenChange(false)}
              aria-disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" aria-disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
