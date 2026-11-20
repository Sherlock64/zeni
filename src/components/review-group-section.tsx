import { ChevronDownIcon } from "lucide-react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { ReviewRow } from "@/components/review-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReviewGroupSectionProps } from "@/types/ui";

export function ReviewGroupSection({
  group,
  selected,
  count,
  more,
  changeError,
  reviewError,
  busy,
  saving,
  onSelect,
  onSelectLike,
  onChangeRow,
  onDismissChange,
  onDismissReview,
  onShowMore,
  onLooksGood,
}: ReviewGroupSectionProps) {
  const title = `${group.category} (${group.rows.length})`;
  const ids = group.rows.map((row) => row.id);
  const picked = ids.filter((id) => selected.has(id)).length;
  // The checkbox draws mixed like checked, so the label says how many.
  const selectAll = picked > 0 && picked < ids.length ? `Select all (${picked} of ${ids.length} selected)` : "Select all";
  return (
    <Collapsible defaultOpen asChild>
      <section aria-label={title} className="rounded-lg border">
        <div className="flex items-center gap-4 px-4 py-3">
          <h2>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="group -ml-2 font-semibold" data-review-group={group.categoryId}>
                <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-[state=closed]:-rotate-90" />
                {title}
              </Button>
            </CollapsibleTrigger>
          </h2>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Checkbox
              aria-label={`${selectAll} in ${group.category}`}
              className="border-muted-foreground"
              checked={picked === ids.length ? true : picked > 0 ? "indeterminate" : false}
              onCheckedChange={() => onSelect(ids, picked !== ids.length)}
            />
            {selectAll}
          </label>
        </div>
        <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">
          {changeError && <CommandErrorAlert title="Couldn't change the category" error={changeError} onDismiss={onDismissChange} />}
          {reviewError && <CommandErrorAlert title="Couldn't mark them reviewed" error={reviewError} onDismiss={onDismissReview} />}
          {/* Fixed columns, so every group's columns line up; narrow windows drop Date and let Description wrap. */}
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-10">
                  <span className="sr-only">Selected</span>
                </TableHead>
                <TableHead scope="col" className="hidden w-28 lg:table-cell">
                  Date
                </TableHead>
                <TableHead scope="col">Description</TableHead>
                <TableHead scope="col" className="w-28 text-right">
                  Amount
                </TableHead>
                <TableHead scope="col" className="w-40 xl:w-48">
                  Category
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.slice(0, count).map((row) => (
                <ReviewRow
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  onSelect={(on) => onSelect([row.id], on)}
                  onSelectLike={() => onSelectLike(row)}
                  onChange={(categoryId) => onChangeRow(row, categoryId)}
                />
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-3">
            {more > 0 && (
              <Button variant="outline" className="mr-auto" onClick={onShowMore}>
                Show {more} more
              </Button>
            )}
            <Button variant="outline" aria-disabled={busy} onClick={onLooksGood}>
              {saving ? "Saving…" : more > 0 ? `Looks good (all ${ids.length})` : "Looks good"}
            </Button>
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
