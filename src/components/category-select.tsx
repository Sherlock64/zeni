import { useQuery } from "@tanstack/react-query";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { listCategories } from "@/lib/commands";
import { CATEGORIES_KEY } from "@/lib/query-keys";
import type { CategorySelectProps } from "@/types/ui";

// Radix Select values are strings and can't be empty, so no category and all categories get their own tokens.
const UNCATEGORIZED = "uncategorized";
const ALL = "all";

export function CategorySelect({ value, onChange, allLabel, uncategorizedLabel, excludeId, id, disabled, defaultOpen, ...aria }: CategorySelectProps) {
  const categories = useQuery({ queryKey: CATEGORIES_KEY, queryFn: listCategories });

  // Silent: the page around it announces its own loading, and a second status region would compete with it.
  if (categories.isPending) return <Skeleton aria-hidden="true" className="h-9 w-full" />;
  if (categories.isError) return <CommandErrorAlert title="Couldn't load categories" error={categories.error} />;

  // The backend returns them in sort order.
  const options = categories.data.filter((category) => category.id !== excludeId);
  const selected =
    value === undefined ? (allLabel ? ALL : "") : value === null ? (uncategorizedLabel ? UNCATEGORIZED : "") : String(value);
  const empty = options.length === 0 && !uncategorizedLabel && !allLabel;

  return (
    <Select
      defaultOpen={defaultOpen}
      value={selected}
      // ALL only renders with an allLabel, whose onChange takes undefined.
      onValueChange={(next) =>
        (onChange as (value: number | null | undefined) => void)(next === ALL ? undefined : next === UNCATEGORIZED ? null : Number(next))
      }
      disabled={disabled || empty}
    >
      <SelectTrigger id={id} className="w-full" {...aria}>
        <SelectValue placeholder={empty ? "No categories yet" : "Pick a category"} />
      </SelectTrigger>
      <SelectContent position="popper">
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {uncategorizedLabel && <SelectItem value={UNCATEGORIZED}>{uncategorizedLabel}</SelectItem>}
        {options.map((category) => (
          <SelectItem key={category.id} value={String(category.id)}>
            {category.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
