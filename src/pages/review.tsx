import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecksIcon } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Page } from "@/components/page";
import { ReviewGroupSection } from "@/components/review-group-section";
import { rowLabel } from "@/components/review-row";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { listCategories, markReviewed, reviewGroups, setTransactionCategory, setTransactionsCategory } from "@/lib/commands";
import { CATEGORIES_KEY, invalidate, REVIEW_GROUPS_KEY } from "@/lib/query-keys";
import type { Category } from "@/types/bindings/Category";
import type { ReviewGroup } from "@/types/bindings/ReviewGroup";
import type { CommandError } from "@/types/command";
import type { ReviewBulkVariables, ReviewChangeVariables, ReviewLooksGoodVariables } from "@/types/ui";

// Rendering every row (each with its own CategorySelect) made large reviews slow, so groups show this many at a time.
const PAGE_SIZE = 25;
// Groups past the first few render this many per frame, so the page paints and stays responsive while they come in.
const BATCH = 3;
const BULK_SELECT_ID = "review-bulk-category";
const HEADING = "main h1";

const groupToggle = (categoryId: number | undefined) =>
  categoryId === undefined ? HEADING : `[data-review-group="${categoryId}"]`;

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
    void invalidate(queryClient, "review");
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
      const count = shown[group.categoryId] ?? PAGE_SIZE;
      return (
        <ReviewGroupSection
          key={group.categoryId}
          group={group}
          selected={selected}
          count={count}
          more={Math.min(PAGE_SIZE, Math.max(0, group.rows.length - count))}
          changeError={change.isError && change.variables.groupId === group.categoryId ? change.error : null}
          reviewError={looksGood.isError && looksGood.variables.groupId === group.categoryId ? looksGood.error : null}
          busy={busy}
          saving={looksGood.isPending && looksGood.variables.groupId === group.categoryId}
          onSelect={select}
          onSelectLike={(row) =>
            select(
              allRows.filter((other) => rowLabel(other) === rowLabel(row)).map((other) => other.id),
              true,
            )
          }
          onChangeRow={(row, categoryId) => {
            if (busy) return;
            setMessage({ text: "", visible: false });
            change.mutate({ groupId: group.categoryId, row, categoryId });
          }}
          onDismissChange={() => dismiss(change.reset, group.categoryId)}
          onDismissReview={() => dismiss(looksGood.reset, group.categoryId)}
          onShowMore={() => showMore(group, count)}
          onLooksGood={() => {
            if (busy) return;
            setMessage({ text: "", visible: false });
            looksGood.mutate({ groupId: group.categoryId, transactionIds: group.rows.map((row) => row.id) });
          }}
        />
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
