import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ListChecksIcon } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCategories, markReviewed, reviewGroups, setTransactionCategory, setTransactionsCategory } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { CATEGORIES_KEY, REVIEW_GROUPS_KEY, TRANSACTIONS_KEY, UNREVIEWED_COUNT_KEY } from "@/lib/query-keys";
import type { Category } from "@/types/bindings/Category";
import type { ReviewGroup } from "@/types/bindings/ReviewGroup";
import type { Transaction } from "@/types/bindings/Transaction";
import type { CommandError } from "@/types/command";
import type { ReviewBulkVariables, ReviewCategoryCellProps, ReviewChangeVariables, ReviewLooksGoodVariables } from "@/types/ui";
import { cn } from "cn";

// Rendering every row (each with its own CategorySelect) made large reviews slow, so groups show this many at a time.
const PAGE_SIZE = 25;
// Groups past the first few render this many per frame, so the page paints and stays responsive while they come in.
const BATCH = 3;
const BULK_SELECT_ID = "review-bulk-category";
const HEADING = "main h1";

const label = (row: Transaction) => row.nickname ?? row.description;
const groupToggle = (categoryId: number | undefined) =>
  categoryId === undefined ? HEADING : `[data-review-group="${categoryId}"]`;

// Looks like the select's trigger; hundreds of Radix Selects mounting at once took seconds, so the real one mounts on use.
const TRIGGER =
  "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50";

function RowCategory({ row, onChange }: ReviewCategoryCellProps) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState(false);
  const name = `Category for ${label(row)}`;
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

export function ReviewPage() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: REVIEW_GROUPS_KEY, queryFn: reviewGroups });
  // Loaded up front, so a row's select has its options the moment it is swapped in.
  const categories = useQuery({ queryKey: CATEGORIES_KEY, queryFn: listCategories });
  const [categoriesRetriedError, setCategoriesRetriedError] = useState<CommandError | null>(null);
  const categoriesError = categories.error ?? categoriesRetriedError;
  const [rendered, setRendered] = useState(BATCH);
  const total = groups.data?.length ?? 0;
  const drawing = rendered < total;
  // Only the first draw counts as loading; groups a later refetch adds just draw in.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!drawing) {
      if (groups.data) setDrawn(true);
      return;
    }
    const frame = requestAnimationFrame(() => startTransition(() => setRendered((count) => count + BATCH)));
    return () => cancelAnimationFrame(frame);
  }, [drawing, rendered, groups.data]);
  const loading = groups.isPending || (drawing && !drawn);
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const listError = groups.error ?? retriedError;
  const [shown, setShown] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  // Selection counts are only announced, since the bar already shows them; a bulk change's result also shows.
  const [message, setMessage] = useState({ text: "", visible: false });
  // A selector for the control to focus once the next render has happened, when an action removes the focused one.
  const [refocus, setRefocus] = useState<string | null>(null);
  useEffect(() => {
    if (refocus === null) return;
    document.querySelector<HTMLElement>(refocus)?.focus();
    setRefocus(null);
  }, [refocus]);

  // Drops the rows from the cached groups instead of refetching every group; returns the groups left.
  function removeRows(ids: number[]) {
    const gone = new Set(ids);
    const left = (queryClient.getQueryData<ReviewGroup[]>(REVIEW_GROUPS_KEY) ?? [])
      .map((group) => ({ ...group, rows: group.rows.filter((row) => !gone.has(row.id)) }))
      .filter((group) => group.rows.length > 0);
    queryClient.setQueryData<ReviewGroup[]>(REVIEW_GROUPS_KEY, left);
    setSelected((current) => new Set([...current].filter((id) => !gone.has(id))));
    for (const queryKey of [UNREVIEWED_COUNT_KEY, TRANSACTIONS_KEY]) void queryClient.invalidateQueries({ queryKey });
    return left;
  }
  // Focus stays in the group while it has rows, else moves to the first group left, else the heading.
  function removeFromGroup(groupId: number, ids: number[]) {
    const left = removeRows(ids);
    setRefocus(groupToggle(left.some((group) => group.categoryId === groupId) ? groupId : left[0]?.categoryId));
  }

  // Each carries its group's id, so the error shows in the group it came from.
  const change = useMutation({
    mutationFn: ({ row, categoryId }: ReviewChangeVariables) =>
      setTransactionCategory({ transactionId: row.id, categoryId, note: row.note }),
    onSuccess: (_result, { groupId, row }) => removeFromGroup(groupId, [row.id]),
  });
  const looksGood = useMutation({
    mutationFn: ({ transactionIds }: ReviewLooksGoodVariables) => markReviewed({ transactionIds }),
    onSuccess: (_result, { groupId, transactionIds }) => removeFromGroup(groupId, transactionIds),
  });
  const bulk = useMutation({
    mutationFn: ({ transactionIds, categoryId }: ReviewBulkVariables) =>
      setTransactionsCategory({ transactionIds, categoryId }),
    onSuccess: (count, { transactionIds, categoryId }) => {
      const name =
        queryClient.getQueryData<Category[]>(CATEGORIES_KEY)?.find((category) => category.id === categoryId)?.name ?? "the new category";
      setMessage({ text: `Changed ${count} ${count === 1 ? "row" : "rows"} to ${name}.`, visible: true });
      const left = removeRows(transactionIds);
      setRefocus(groupToggle(left[0]?.categoryId));
    },
  });
  const busy = change.isPending || looksGood.isPending || bulk.isPending;
  // A refetch (say, when a run ends) can drop selected rows, so only count and send the ones still shown in a group.
  const liveIds = (ids: ReadonlySet<number>) =>
    (groups.data ?? []).flatMap((group) => group.rows.map((row) => row.id)).filter((id) => ids.has(id));
  const selectedIds = liveIds(selected);

  // The dismiss button unmounts with the alert, so focus the group's toggle.
  function dismiss(reset: () => void, groupId: number) {
    reset();
    setRefocus(groupToggle(groupId));
  }

  function select(ids: number[], on: boolean) {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
    const count = liveIds(next).length;
    setMessage({ text: count === 0 ? "Selection cleared." : `${count} selected.`, visible: false });
  }

  function clear() {
    setSelected(new Set());
    setMessage({ text: "Selection cleared.", visible: false });
    bulk.reset();
    // The bar unmounts with the selection.
    setRefocus(groupToggle(groups.data?.[0]?.categoryId));
  }

  function showMore(group: ReviewGroup, count: number) {
    setShown((current) => ({ ...current, [group.categoryId]: count + PAGE_SIZE }));
    // The button stays while rows are left to show; otherwise focus the first new row.
    if (count + PAGE_SIZE >= group.rows.length) setRefocus(`[data-review-row="${group.rows[count].id}"]`);
  }

  async function retryCategories() {
    if (categories.isFetching || !categories.error) return;
    setCategoriesRetriedError(categories.error);
    const result = await categories.refetch();
    setCategoriesRetriedError(null);
    // The retry button unmounts on success, so move focus to the page heading.
    if (result.isSuccess) setRefocus(HEADING);
  }

  async function retry() {
    if (groups.isFetching || !groups.error) return;
    setRetriedError(groups.error);
    const result = await groups.refetch();
    setRetriedError(null);
    // The retry button unmounts on success, so move focus to the page heading.
    if (result.isSuccess) setRefocus(HEADING);
  }

  function selectionBar() {
    if (selectedIds.length === 0) return null;
    return (
      <div className="sticky top-0 z-10 flex flex-col gap-3 rounded-lg border bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm font-medium tabular-nums">{selectedIds.length} selected</p>
          <label htmlFor={BULK_SELECT_ID} className="text-sm">
            {bulk.isPending ? "Changing…" : "Change selected to…"}
          </label>
          <div className="w-56">
            <CategorySelect
              id={BULK_SELECT_ID}
              value={null}
              onChange={(categoryId) => {
                if (busy || categoryId === null) return;
                setMessage({ text: "", visible: false });
                bulk.mutate({ transactionIds: selectedIds, categoryId });
              }}
            />
          </div>
          <Button variant="outline" className="ml-auto" onClick={clear}>
            Clear
          </Button>
        </div>
        {bulk.isError && (
          <CommandErrorAlert
            title="Couldn't change the selected rows"
            error={bulk.error}
            onDismiss={() => {
              bulk.reset();
              setRefocus(`#${BULK_SELECT_ID}`);
            }}
          />
        )}
      </div>
    );
  }

  function content() {
    if (listError) {
      return (
        <div className="flex flex-col items-start gap-3">
          {/* A new key remounts the alert, so a repeat failure is announced again. */}
          <CommandErrorAlert key={groups.errorUpdatedAt} title="Couldn't load the review" error={listError} />
          <Button variant="outline" onClick={retry} aria-disabled={groups.isFetching}>
            {groups.isFetching ? "Trying again…" : "Try again"}
          </Button>
        </div>
      );
    }
    if (!groups.data) {
      return (
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      );
    }
    if (groups.data.length === 0) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecksIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>Nothing to review.</h2>
            </EmptyTitle>
            <EmptyDescription>The model's answers show up here after a categorize run.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <a href="#/transactions">Go to Transactions</a>
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
    const allRows = groups.data.flatMap((group) => group.rows);
    const list = groups.data.map((group, index) => {
      if (index >= rendered) {
        // Roughly the group's drawn height (header, table header and footer, plus its rows), so the page doesn't jump.
        const rows = Math.min(group.rows.length, shown[group.categoryId] ?? PAGE_SIZE);
        return <Skeleton key={group.categoryId} aria-hidden="true" className="w-full rounded-lg" style={{ height: `${9.5 + rows * 3.0625}rem` }} />;
      }
      const title = `${group.category} (${group.rows.length})`;
      const count = shown[group.categoryId] ?? PAGE_SIZE;
      const ids = group.rows.map((row) => row.id);
      const picked = ids.filter((id) => selected.has(id)).length;
      // The checkbox draws mixed like checked, so the label says how many.
      const selectAll = picked > 0 && picked < ids.length ? `Select all (${picked} of ${ids.length} selected)` : "Select all";
      const hidden = group.rows.length > count;
      const changeError = change.isError && change.variables.groupId === group.categoryId ? change.error : null;
      const reviewError = looksGood.isError && looksGood.variables.groupId === group.categoryId ? looksGood.error : null;
      return (
        <Collapsible key={group.categoryId} defaultOpen asChild>
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
                  onCheckedChange={() => select(ids, picked !== ids.length)}
                />
                {selectAll}
              </label>
            </div>
            <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">
              {changeError && (
                <CommandErrorAlert title="Couldn't change the category" error={changeError} onDismiss={() => dismiss(change.reset, group.categoryId)} />
              )}
              {reviewError && (
                <CommandErrorAlert title="Couldn't mark them reviewed" error={reviewError} onDismiss={() => dismiss(looksGood.reset, group.categoryId)} />
              )}
              {/* Fixed columns, so every group's columns line up. */}
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="w-10">
                      <span className="sr-only">Selected</span>
                    </TableHead>
                    <TableHead scope="col" className="w-28">
                      Date
                    </TableHead>
                    <TableHead scope="col">Description</TableHead>
                    <TableHead scope="col" className="w-28 text-right">
                      Amount
                    </TableHead>
                    <TableHead scope="col" className="w-48">
                      Category
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.slice(0, count).map((row) => (
                    <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${label(row)}`}
                          className="border-muted-foreground"
                          data-review-row={row.id}
                          checked={selected.has(row.id)}
                          onCheckedChange={(checked) => select([row.id], checked === true)}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">{formatDate(row.postedDate)}</TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium">{label(row)}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-muted-foreground"
                            aria-label={`Select all like this (${label(row)})`}
                            onClick={() =>
                              select(
                                allRows.filter((other) => label(other) === label(row)).map((other) => other.id),
                                true,
                              )
                            }
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
                        <RowCategory
                          row={row}
                          onChange={(categoryId) => {
                            if (busy) return;
                            setMessage({ text: "", visible: false });
                            change.mutate({ groupId: group.categoryId, row, categoryId });
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-end gap-3">
                {hidden && (
                  <Button variant="outline" className="mr-auto" onClick={() => showMore(group, count)}>
                    Show {Math.min(PAGE_SIZE, group.rows.length - count)} more
                  </Button>
                )}
                <Button
                  variant="outline"
                  aria-disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    setMessage({ text: "", visible: false });
                    looksGood.mutate({ groupId: group.categoryId, transactionIds: ids });
                  }}
                >
                  {looksGood.isPending && looksGood.variables.groupId === group.categoryId ? "Saving…" : hidden ? `Looks good (all ${ids.length})` : "Looks good"}
                </Button>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      );
    });
    return (
      <>
        {categoriesError && (
          <div className="flex flex-col items-start gap-3">
            <CommandErrorAlert key={categories.errorUpdatedAt} title="Couldn't load categories" error={categoriesError} />
            <Button variant="outline" onClick={retryCategories} aria-disabled={categories.isFetching}>
              {categories.isFetching ? "Trying again…" : "Try again"}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-6" aria-busy={drawing}>
          {list}
        </div>
      </>
    );
  }

  return (
    <Page title="Review" description="Check the categories the model picked.">
      <p className="-mt-4 text-sm text-muted-foreground">
        To always categorize a merchant the same way,{" "}
        <a href="#/nicknames" className="underline underline-offset-4 hover:text-foreground">
          give its nickname a default category
        </a>
        .
      </p>
      {/* Always mounted, so screen readers announce each change to its text. */}
      <p role="status" className={message.visible ? "text-sm" : "sr-only"}>
        {listError ? (groups.isFetching ? "Retrying…" : "") : message.text || (loading ? "Loading the review…" : "")}
      </p>
      {selectionBar()}
      {content()}
    </Page>
  );
}
