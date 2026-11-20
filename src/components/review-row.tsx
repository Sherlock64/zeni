import { useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { listCategories } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { CATEGORIES_KEY } from "@/lib/query-keys";
import type { Transaction } from "@/types/bindings/Transaction";
import type { ReviewCategoryCellProps, ReviewRowProps } from "@/types/ui";
import { cn } from "cn";

export const rowLabel = (row: Transaction) => row.nickname ?? row.description;

// Copies SelectTrigger's classes in src/components/ui/select.tsx; keep them in step. Looks like the select's trigger; hundreds of Radix Selects mounting at once took seconds, so the real one mounts on use.
const TRIGGER =
  "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-input/30 py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-input/50";

function RowCategory({ row, onChange }: ReviewCategoryCellProps) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState(false);
  const name = `Category for ${rowLabel(row)}`;
  // Swaps only once the options are cached, so the button keeps focus meanwhile; a failed load shows above the groups.
  const activate = () =>
    void queryClient.ensureQueryData({ queryKey: CATEGORIES_KEY, queryFn: listCategories }).then(
      () => setActive(true),
      () => {},
    );
  // Mounts open, so the list takes focus from the button it replaces; closing returns focus to its trigger.
  if (active) return <CategorySelect defaultOpen value={row.categoryId} aria-label={name} onChange={onChange} />;
  return (
    <button
      type="button"
      role="combobox"
      aria-label={name}
      aria-expanded={false}
      aria-haspopup="listbox"
      aria-autocomplete="none"
      className={TRIGGER}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        activate();
      }}
    >
      <span className="line-clamp-1">{row.category ?? "Pick a category"}</span>
      <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function ReviewRow({ row, selected, onSelect, onSelectLike, onChange }: ReviewRowProps) {
  const label = rowLabel(row);
  return (
    <TableRow className="group/row" data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`Select ${label}`}
          className="border-muted-foreground"
          data-review-row={row.id}
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
        />
      </TableCell>
      <TableCell className="hidden tabular-nums lg:table-cell">{formatDate(row.postedDate)}</TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{label}</span>
          <Button
            variant="ghost"
            size="sm"
            // Shown on row hover or focus only, to cut noise; it stays in the tab order and shows when focused.
            className="text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100"
            aria-label={`Select all like this (${label})`}
            onClick={onSelectLike}
          >
            Select all like this
          </Button>
        </div>
      </TableCell>
      {/* The minus sign marks money out; the colour only reinforces it. */}
      <TableCell className={cn("text-right tabular-nums", row.amountCents < 0 && "text-destructive")}>
        {formatCents(row.amountCents)}
      </TableCell>
      <TableCell>
        <RowCategory row={row} onChange={onChange} />
      </TableCell>
    </TableRow>
  );
}
