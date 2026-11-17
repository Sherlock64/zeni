import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ListChecksIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { markReviewed, reviewGroups, setTransactionCategory } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { REVIEW_GROUPS_KEY, TRANSACTIONS_KEY, UNREVIEWED_COUNT_KEY } from "@/lib/query-keys";
import type { Transaction } from "@/types/bindings/Transaction";
import type { CommandError } from "@/types/command";
import { cn } from "cn";

// After an action removes the focused control, focus the group's toggle, else the first group's, else the heading.
function focusAfter(categoryId: number) {
  const toggle =
    document.querySelector<HTMLElement>(`[data-review-group="${categoryId}"]`) ??
    document.querySelector<HTMLElement>("[data-review-group]");
  (toggle ?? document.querySelector<HTMLElement>("main h1"))?.focus();
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: REVIEW_GROUPS_KEY, queryFn: reviewGroups });
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const listError = groups.error ?? retriedError;

  const refresh = () =>
    Promise.all(
      [REVIEW_GROUPS_KEY, UNREVIEWED_COUNT_KEY, TRANSACTIONS_KEY].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  // Each carries its group's id, so the error shows in the group it came from.
  const change = useMutation({
    mutationFn: ({ row, categoryId }: { groupId: number; row: Transaction; categoryId: number | null }) =>
      setTransactionCategory({ transactionId: row.id, categoryId, note: row.note }),
    onSuccess: async (_result, { groupId }) => {
      await refresh();
      setRefocus(groupId);
    },
  });
  const looksGood = useMutation({
    mutationFn: ({ transactionIds }: { groupId: number; transactionIds: number[] }) => markReviewed({ transactionIds }),
    onSuccess: async (_result, { groupId }) => {
      await refresh();
      setRefocus(groupId);
    },
  });
  // The group whose control an action removed; focused once the refetched groups have rendered.
  const [refocus, setRefocus] = useState<number | null>(null);
  useEffect(() => {
    if (refocus === null) return;
    focusAfter(refocus);
    setRefocus(null);
  }, [refocus]);
  const busy = change.isPending || looksGood.isPending;

  // The dismiss button unmounts with the alert, so focus the group's toggle.
  function dismiss(reset: () => void, groupId: number) {
    reset();
    focusAfter(groupId);
  }

  async function retry() {
    if (groups.isFetching || !groups.error) return;
    setRetriedError(groups.error);
    const result = await groups.refetch();
    setRetriedError(null);
    // The retry button unmounts on success, so move focus to the page heading.
    if (result.isSuccess) document.querySelector<HTMLElement>("main h1")?.focus();
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
    return groups.data.map((group) => {
      const title = `${group.category} (${group.rows.length})`;
      const changeError = change.isError && change.variables.groupId === group.categoryId ? change.error : null;
      const reviewError = looksGood.isError && looksGood.variables.groupId === group.categoryId ? looksGood.error : null;
      return (
        <Collapsible key={group.categoryId} defaultOpen asChild>
          <section aria-label={title} className="rounded-lg border">
            <h2 className="flex items-center gap-2 px-4 py-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="group -ml-2 font-semibold" data-review-group={group.categoryId}>
                  <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-[state=closed]:-rotate-90" />
                  {title}
                </Button>
              </CollapsibleTrigger>
            </h2>
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
                    <TableHead scope="col" className="w-28">
                      Date
                    </TableHead>
                    <TableHead scope="col">Description</TableHead>
                    <TableHead scope="col" className="w-24 text-right">
                      Amount
                    </TableHead>
                    <TableHead scope="col" className="w-40">
                      Category
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular-nums">{formatDate(row.postedDate)}</TableCell>
                      <TableCell className="whitespace-normal font-medium">{row.nickname ?? row.description}</TableCell>
                      {/* The minus sign marks money out; the colour only reinforces it. */}
                      <TableCell className={cn("text-right tabular-nums", row.amountCents < 0 && "text-destructive")}>
                        {formatCents(row.amountCents)}
                      </TableCell>
                      <TableCell>
                        <CategorySelect
                          value={row.categoryId}
                          aria-label={`Category for ${row.nickname ?? row.description}`}
                          onChange={(categoryId) => {
                            if (busy) return;
                            change.mutate({ groupId: group.categoryId, row, categoryId });
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                variant="outline"
                className="self-end"
                aria-disabled={busy}
                onClick={() => {
                  if (busy) return;
                  looksGood.mutate({ groupId: group.categoryId, transactionIds: group.rows.map((row) => row.id) });
                }}
              >
                {looksGood.isPending && looksGood.variables.groupId === group.categoryId ? "Saving…" : "Looks good"}
              </Button>
            </CollapsibleContent>
          </section>
        </Collapsible>
      );
    });
  }

  return (
    <Page title="Review" description="Check the categories the model picked.">
      {/* Always mounted, so screen readers announce each change to its text. */}
      <p role="status" className="sr-only">
        {listError ? (groups.isFetching ? "Retrying…" : "") : groups.isPending ? "Loading the review…" : ""}
      </p>
      {content()}
    </Page>
  );
}
