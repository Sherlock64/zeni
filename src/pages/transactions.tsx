import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, NotebookPenIcon, ReceiptTextIcon, SearchXIcon, TagIcon } from "lucide-react";
import { cn } from "cn";
import { useEffect, useId, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { CategorizeActions } from "@/components/categorize-actions";
import { CategorySelect } from "@/components/category-select";
import { CategorizeDialog } from "@/components/categorize-dialog";
import { ImportControls } from "@/components/import-controls";
import { Page } from "@/components/page";
import { RenameDialog } from "@/components/rename-dialog";
import { TextField } from "@/components/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { listTransactions } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TRANSACTIONS_KEY } from "@/lib/query-keys";
import type { SetBy } from "@/types/bindings/SetBy";
import type { Transaction } from "@/types/bindings/Transaction";
import type { TransactionQuery } from "@/types/bindings/TransactionQuery";
import type { TransactionSort } from "@/types/bindings/TransactionSort";
import type { SortHeaderProps } from "@/types/ui";

const PAGE_SIZE = 50;
const initialQuery: TransactionQuery = {
  from: null,
  to: null,
  search: null,
  sort: "date",
  direction: "desc",
  page: 0,
  pageSize: PAGE_SIZE,
};
const setByLabels: Record<SetBy, string> = { model: "Model", nickname: "Nickname", user: "You" };
// The Category button's name: the category, who set it and whether a model answer is unreviewed.
const categoryLabel = (row: Transaction) =>
  [
    row.category ?? "Uncategorized",
    row.setBy && `set by ${setByLabels[row.setBy]}`,
    row.setBy === "model" && !row.reviewed && "Not reviewed",
  ]
    .filter(Boolean)
    .join(", ");

export function TransactionsPage() {
  const [query, setQuery] = useState(initialQuery);
  const [searchText, setSearchText] = useState("");
  // What the user typed; a backwards range stays here with an error and never reaches the query.
  const [range, setRange] = useState({ from: "", to: "" });
  const backwards = Boolean(range.from && range.to && range.from > range.to);
  const transactions = useQuery({
    queryKey: [...TRANSACTIONS_KEY, query],
    queryFn: () => listTransactions(query),
    placeholderData: keepPreviousData,
  });
  // The row being renamed or categorized, and the element to return focus to when its dialog closes.
  const [renaming, setRenaming] = useState<Transaction | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [categorizing, setCategorizing] = useState<Transaction | null>(null);
  const [categorizeOpen, setCategorizeOpen] = useState(false);
  const [opens, setOpens] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const categoryFilterId = useId();
  // The row whose nickname tooltip is open: by hover on the nickname, or while the row has keyboard focus.
  const [tooltipRow, setTooltipRow] = useState<number | null>(null);
  const rowHintId = useId();

  function startRename(row: Transaction) {
    setRenaming(row);
    setOpens((count) => count + 1);
    setRenameOpen(true);
  }

  function startCategorize(row: Transaction) {
    setCategorizing(row);
    setOpens((count) => count + 1);
    setCategorizeOpen(true);
  }

  const returnFocus = (event: Event) => {
    event.preventDefault();
    opener.current?.focus();
  };

  // Every filter change starts again from the first page.
  const filter = (change: Partial<TransactionQuery>) => setQuery((q) => ({ ...q, ...change, page: 0 }));

  useEffect(() => {
    const search = searchText.trim() || null;
    if (search === query.search) return;
    const timer = setTimeout(() => filter({ search }), 300);
    return () => clearTimeout(timer);
  }, [searchText, query.search]);

  function changeRange(change: Partial<typeof range>) {
    const next = { ...range, ...change };
    setRange(next);
    if (next.from && next.to && next.from > next.to) return;
    filter({ from: next.from || null, to: next.to || null });
  }

  function sortBy(column: TransactionSort) {
    if (query.sort === column) {
      filter({ direction: query.direction === "asc" ? "desc" : "asc" });
      return;
    }
    filter({ sort: column, direction: column === "description" ? "asc" : "desc" });
  }

  function clearFilters() {
    setSearchText("");
    setRange({ from: "", to: "" });
    filter({ from: null, to: null, search: null, categoryId: undefined, uncategorized: undefined });
  }

  const filtered = Boolean(
    query.from || query.to || query.search || searchText.trim() || query.categoryId !== undefined || query.uncategorized,
  );
  const data = transactions.data;
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const noData = data?.total === 0 && !filtered;

  // A revert can shrink the total below the current page; step back to the last page that exists.
  useEffect(() => {
    if (data && !transactions.isPlaceholderData && query.page >= pageCount) {
      setQuery((q) => ({ ...q, page: pageCount - 1 }));
    }
  }, [data, transactions.isPlaceholderData, query.page, pageCount]);

  function status() {
    if (transactions.isPending) return "Loading transactions…";
    if (!data || transactions.isFetching || transactions.error) return "";
    if (noData) return "No transactions yet";
    if (data.rows.length === 0) return "No transactions match";
    return `${data.total} ${data.total === 1 ? "transaction" : "transactions"}, page ${query.page + 1} of ${pageCount}`;
  }

  function goTo(page: number) {
    if (transactions.isFetching || page < 0 || page >= pageCount) return;
    setQuery((q) => ({ ...q, page }));
  }

  function retry() {
    if (!transactions.isFetching) transactions.refetch();
  }

  function content() {
    if (transactions.error) {
      return (
        <div className="flex flex-col items-start gap-3">
          <CommandErrorAlert
            key={transactions.errorUpdatedAt}
            title="Couldn't load transactions"
            error={transactions.error}
          />
          <Button variant="outline" onClick={retry} aria-disabled={transactions.isFetching}>
            Try again
          </Button>
        </div>
      );
    }
    if (!data) return <Skeleton aria-hidden="true" className="h-96 w-full rounded-xl" />;
    if (noData) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptTextIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>No transactions yet</h2>
            </EmptyTitle>
            <EmptyDescription>Import an OFX, QFX or CSV file to get started.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    if (data.rows.length === 0) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>No transactions match</h2>
            </EmptyTitle>
            <EmptyDescription>Try a different search, category or date range.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      );
    }

    const showType = data.rows.some((row) => row.transactionType);
    const showBalance = data.rows.some((row) => row.runningBalanceCents !== null);
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border" aria-busy={transactions.isFetching}>
          <TooltipProvider>
            <Table aria-label="Transactions">
              <TableHeader>
                <TableRow>
                  <SortHeader column="date" label="Date" query={query} onSort={sortBy} />
                  <SortHeader column="description" label="Description" query={query} onSort={sortBy} />
                  {/* Type is the bank's code; it gives way to Category on narrow windows. */}
                  {showType && (
                    <TableHead scope="col" className="hidden lg:table-cell">
                      Type
                    </TableHead>
                  )}
                  <TableHead scope="col">Category</TableHead>
                  <SortHeader column="amount" label="Amount" query={query} onSort={sortBy} className="text-right" />
                  {showBalance && (
                    <TableHead scope="col" className="text-right">
                      Balance
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <ContextMenu key={row.id}>
                    {/* Focusable, so the context-menu key or Shift+F10 opens the menu from the keyboard. */}
                    <ContextMenuTrigger asChild>
                      <TableRow
                        tabIndex={0}
                        aria-describedby={rowHintId}
                        className="select-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        onContextMenu={(event) => (opener.current = event.currentTarget)}
                        // Only the row itself, not the Category button inside it, opens the nickname tooltip.
                        onFocus={row.nickname ? (event) => event.target === event.currentTarget && setTooltipRow(row.id) : undefined}
                        onBlur={row.nickname ? () => setTooltipRow(null) : undefined}
                      >
                        <TableCell className="tabular-nums">{formatDate(row.postedDate)}</TableCell>
                        {/* The memo sits under the description so the table fits narrow windows without scrolling. */}
                        <TableCell className="whitespace-normal">
                          {row.nickname ? (
                            <Tooltip
                              open={tooltipRow === row.id}
                              onOpenChange={(open) => setTooltipRow(open ? row.id : null)}
                            >
                              <TooltipTrigger asChild>
                                <p className="flex w-fit items-center gap-1.5 font-medium">
                                  <TagIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                                  {row.nickname}
                                  <span className="sr-only">
                                    , description {row.description}
                                    {row.memo && `, memo ${row.memo}`}
                                  </span>
                                </p>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" align="start" className="flex-col items-start break-words">
                                <p>Description: {row.description}</p>
                                {row.memo && <p>Memo: {row.memo}</p>}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <>
                              <p className="font-medium">{row.description}</p>
                              {row.memo && <p className="text-muted-foreground">{row.memo}</p>}
                            </>
                          )}
                        </TableCell>
                        {showType && (
                          <TableCell className="hidden text-muted-foreground lg:table-cell">{row.transactionType}</TableCell>
                        )}
                        <TableCell>
                          {/* Only the name truncates, so the badge and dot stay on its line; it gives way most on narrow windows. */}
                          <div className="flex max-w-64 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-mx-2.5 h-auto min-h-7 min-w-0 shrink justify-start py-1 text-left text-sm font-normal"
                              aria-haspopup="dialog"
                              aria-label={categoryLabel(row)}
                              onClick={(event) => {
                                opener.current = event.currentTarget;
                                startCategorize(row);
                              }}
                            >
                              <span className={cn("max-w-20 min-w-0 truncate lg:max-w-none", !row.category && "text-muted-foreground")}>
                                {row.category ?? "Uncategorized"}
                              </span>
                              {row.setBy && (
                                <Badge variant="outline" className="shrink-0 text-muted-foreground">
                                  {setByLabels[row.setBy]}
                                </Badge>
                              )}
                              {row.setBy === "model" && !row.reviewed && (
                                // The button's label already says "Not reviewed"; the tooltip explains the dot by sight.
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
                                  </TooltipTrigger>
                                  <TooltipContent aria-hidden="true">Not reviewed</TooltipContent>
                                </Tooltip>
                              )}
                            </Button>
                            {row.note && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="shrink-0 text-muted-foreground">
                                    <NotebookPenIcon aria-hidden="true" className="size-4" />
                                    <span className="sr-only">Note: {row.note}</span>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent aria-hidden="true" className="max-w-xs break-words">
                                  {row.note}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        {/* The minus sign marks money out; the colour only reinforces it. */}
                        <TableCell className={cn("text-right tabular-nums", row.amountCents < 0 && "text-destructive")}>
                          {formatCents(row.amountCents)}
                        </TableCell>
                        {showBalance && (
                          <TableCell className="text-right tabular-nums">
                            {row.runningBalanceCents !== null && formatCents(row.runningBalanceCents)}
                          </TableCell>
                        )}
                      </TableRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => startRename(row)}>Rename it</ContextMenuItem>
                      <ContextMenuItem onSelect={() => startCategorize(row)}>Categorize…</ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>
        <p id={rowHintId} className="sr-only">
          Press Shift+F10 or the menu key for actions.
        </p>
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {data.total} {data.total === 1 ? "transaction" : "transactions"}
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goTo(query.page - 1)}
              aria-disabled={query.page === 0 || transactions.isFetching}
            >
              Previous
            </Button>
            <p>
              Page {query.page + 1} of {pageCount}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goTo(query.page + 1)}
              aria-disabled={query.page >= pageCount - 1 || transactions.isFetching}
            >
              Next
            </Button>
          </div>
        </nav>
      </div>
    );
  }

  return (
    <Page title="Transactions" description="Every payment in and out of your accounts.">
      <ImportControls />
      {!noData && <CategorizeActions />}
      <p role="status" className="sr-only">
        {status()}
      </p>
      {!noData && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-[1fr_1fr_1.5fr_2fr]">
          <TextField
            label="From"
            name="from"
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(event) => changeRange({ from: event.target.value })}
          />
          <TextField
            label="To"
            name="to"
            type="date"
            value={range.to}
            min={range.from || undefined}
            error={backwards ? "To date must be on or after the From date" : undefined}
            announce
            onChange={(event) => changeRange({ to: event.target.value })}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor={categoryFilterId}>Category</Label>
            <CategorySelect
              id={categoryFilterId}
              allLabel="All categories"
              uncategorizedLabel="Uncategorized"
              value={query.uncategorized ? null : query.categoryId}
              onChange={(value) =>
                filter(value === null ? { categoryId: undefined, uncategorized: true } : { categoryId: value, uncategorized: undefined })
              }
            />
          </div>
          <TextField
            label="Search"
            type="search"
            name="search"
            placeholder="Search nickname, description, memo or note"
            maxLength={200}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
      )}
      {content()}
      {renaming && (
        <RenameDialog
          key={opens}
          transaction={renaming}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          onCloseAutoFocus={returnFocus}
        />
      )}
      {categorizing && (
        <CategorizeDialog
          key={opens}
          transaction={categorizing}
          open={categorizeOpen}
          onOpenChange={setCategorizeOpen}
          onCloseAutoFocus={returnFocus}
        />
      )}
    </Page>
  );
}

function SortHeader({ column, label, query, onSort, className }: SortHeaderProps) {
  const active = query.sort === column;
  const Icon = !active ? ArrowUpDownIcon : query.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead
      scope="col"
      aria-sort={active ? (query.direction === "asc" ? "ascending" : "descending") : undefined}
      className={className}
    >
      <Button variant="ghost" size="sm" className="-mx-2.5 text-sm" onClick={() => onSort(column)}>
        {label}
        <Icon aria-hidden="true" className={active ? "" : "text-muted-foreground"} />
      </Button>
    </TableHead>
  );
}
