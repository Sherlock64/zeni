import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { CategorySelect } from "@/components/category-select";
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
import { Label } from "@/components/ui/label";
import { deleteCategory } from "@/lib/commands";
import { CATEGORIES_KEY, NICKNAMES_KEY, TRANSACTIONS_KEY } from "@/lib/query-keys";
import type { CategoryDeleteDialogProps } from "@/types/ui";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Confirms a delete. A used category also asks where its rows and nickname defaults go. Remount it (key) per category.
export function CategoryDeleteDialog({ category, open, onOpenChange, onCloseAutoFocus }: CategoryDeleteDialogProps) {
  const queryClient = useQueryClient();
  const selectId = useId();
  const [replacementId, setReplacementId] = useState<number | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => deleteCategory({ id, replacementId }),
    // Close once the list shows the change, so focus goes to a control that still exists.
    onSuccess: async () => {
      await Promise.all(
        [CATEGORIES_KEY, TRANSACTIONS_KEY, NICKNAMES_KEY].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onOpenChange(false);
    },
  });
  const used = category ? category.rowCount + category.nicknameCount > 0 : false;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !remove.isPending && onOpenChange(next)}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Delete {category?.name}?</AlertDialogTitle>
          <AlertDialogDescription className="wrap-anywhere">
            {used && category
              ? `${category.name} is used by ${count(category.rowCount, "transaction", "transactions")} and ${count(category.nicknameCount, "nickname", "nicknames")}.`
              : "No transactions or nicknames use it."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {used && category && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={selectId}>Move them to</Label>
            <CategorySelect
              id={selectId}
              value={replacementId}
              onChange={setReplacementId}
              excludeId={category.id}
              uncategorizedLabel="Leave uncategorized"
              disabled={remove.isPending}
            />
          </div>
        )}
        {remove.isError && <CommandErrorAlert title="Couldn't delete the category" error={remove.error} />}
        <AlertDialogFooter>
          <AlertDialogCancel aria-disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            aria-disabled={remove.isPending}
            onClick={() => category && !remove.isPending && remove.mutate(category.id)}
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
