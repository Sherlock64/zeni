import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ReceiptTextIcon, SearchXIcon } from "lucide-react";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { ImportControls } from "@/components/import-controls";
import { Page } from "@/components/page";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listTransactions } from "@/lib/commands";
import { formatCents } from "@/lib/money";
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

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const formatDate = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`));

export function TransactionsPage() {
  const [query, setQuery] = useState(initialQuery);
  const [searchText, setSearchText] = useState("");
  // What the user typed; a backwards range stays here with an error and never reaches the query.
  const [range, setRange] = useState({ from: "", to: "" });
  const backwards = Boolean(range.from && range.to && range.from > range.to);
  const transactions = useQuery({
    queryKey: ["list_transactions", query],
    queryFn: () => listTransactions(query),
    placeholderData: keepPreviousData,
  });

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
    filter({ from: null, to: null, search: null });
  }

  const filtered = Boolean(query.from || query.to || query.search || searchText.trim());
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
            <EmptyDescription>Import an OFX or QFX file to get started.</EmptyDescription>
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
            <EmptyDescription>Try a different search or date range.</EmptyDescription>
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
          <Table aria-label="Transactions">
            <TableHeader>
              <TableRow>
                <SortHeader column="date" label="Date" query={query} onSort={sortBy} />
                <SortHeader column="description" label="Description" query={query} onSort={sortBy} />
                {showType && <TableHead scope="col">Type</TableHead>}
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
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums">{formatDate(row.postedDate)}</TableCell>
                  {/* The memo sits under the description so the table fits narrow windows without scrolling. */}
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{row.description}</p>
                    {row.memo && <p className="text-muted-foreground">{row.memo}</p>}
                  </TableCell>
                  {showType && <TableCell className="text-muted-foreground">{row.transactionType}</TableCell>}
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
              ))}
            </TableBody>
          </Table>
        </div>
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
      <p role="status" className="sr-only">
        {status()}
      </p>
      {!noData && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-[1fr_1fr_2fr]">
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
          <div className="col-span-2 lg:col-span-1">
            <TextField
              label="Search"
              type="search"
              name="search"
              placeholder="Description or memo"
              maxLength={200}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
        </div>
      )}
      {content()}
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
