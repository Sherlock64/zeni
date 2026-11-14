import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { listTransactions } from "@/lib/commands";
import { TransactionsPage } from "@/pages/transactions";
import type { Transaction } from "@/types/bindings/Transaction";

vi.mock("@/lib/commands", () => ({ listTransactions: vi.fn() }));
// ImportControls has its own tests; keep this page test about the list.
vi.mock("@/components/import-controls", () => ({ ImportControls: () => null }));
beforeEach(() => vi.resetAllMocks());

const row: Transaction = {
  id: 1,
  importId: 1,
  postedDate: "2026-10-31",
  amountCents: -1850,
  description: "CORNER COFFEE",
  memo: "Card purchase",
  transactionType: null,
  runningBalanceCents: null,
};
const base = { from: null, to: null, search: null, sort: "date", direction: "desc", page: 0, pageSize: 50 };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TransactionsPage />
    </QueryClientProvider>,
  );
  return client;
}

const lastQuery = () => vi.mocked(listTransactions).mock.lastCall?.[0];

test("shows rows newest first with formatted amounts, hiding type and balance when absent", async () => {
  vi.mocked(listTransactions).mockResolvedValue({
    rows: [row, { ...row, id: 2, amountCents: 245000, description: "PAYROLL", memo: null }],
    total: 2,
  });
  renderPage();
  expect(screen.getByRole("status").textContent).toBe("Loading transactions…");
  expect(await screen.findByText("CORNER COFFEE")).toBeTruthy();
  expect(lastQuery()).toEqual(base);
  expect(screen.getByText("-$18.50")).toBeTruthy();
  expect(screen.getByText("$2,450.00")).toBeTruthy();
  expect(screen.getAllByText("Oct 31, 2026")).toHaveLength(2);
  expect(screen.queryByRole("columnheader", { name: "Type" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Balance" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: /Date/ }).getAttribute("aria-sort")).toBe("descending");
  expect(screen.getByText("2 transactions")).toBeTruthy();
  expect(screen.getByText("Page 1 of 1")).toBeTruthy();
});

test("shows type and running balance when a row has them", async () => {
  vi.mocked(listTransactions).mockResolvedValue({
    rows: [row, { ...row, id: 2, transactionType: "POS", runningBalanceCents: 123456 }],
    total: 2,
  });
  renderPage();
  expect(await screen.findByRole("columnheader", { name: "Type" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Balance" })).toBeTruthy();
  expect(screen.getByText("POS")).toBeTruthy();
  expect(screen.getByText("$1,234.56")).toBeTruthy();
});

test("sort headers toggle the query and aria-sort", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 1 });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Date" }));
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, direction: "asc" }));
  expect(screen.getByRole("columnheader", { name: /Date/ }).getAttribute("aria-sort")).toBe("ascending");

  fireEvent.click(screen.getByRole("button", { name: "Amount" }));
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, sort: "amount", direction: "desc" }));
  expect(screen.getByRole("columnheader", { name: /Date/ }).hasAttribute("aria-sort")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Description" }));
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, sort: "description", direction: "asc" }));
});

test("date range and debounced search go into the query", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 1 });
  renderPage();
  await screen.findByText("CORNER COFFEE");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-31" } });
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, from: "2026-10-01", to: "2026-10-31" }));

  vi.useFakeTimers();
  try {
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: " cof" } });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: " coffee " } });
    const calls = vi.mocked(listTransactions).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(vi.mocked(listTransactions).mock.calls.length).toBe(calls);
    await act(() => vi.advanceTimersByTimeAsync(1));
  } finally {
    vi.useRealTimers();
  }
  await vi.waitFor(() =>
    expect(lastQuery()).toEqual({ ...base, from: "2026-10-01", to: "2026-10-31", search: "coffee" }),
  );
});

test("a backwards date range keeps the last good query and flags the To field", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 1 });
  renderPage();
  await screen.findByText("CORNER COFFEE");
  const from = screen.getByLabelText("From") as HTMLInputElement;
  const to = screen.getByLabelText("To") as HTMLInputElement;
  fireEvent.change(to, { target: { value: "2026-10-31" } });
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, to: "2026-10-31" }));
  const calls = vi.mocked(listTransactions).mock.calls.length;

  fireEvent.change(from, { target: { value: "2026-11-05" } });
  const error = screen.getByText("To date must be on or after the From date");
  expect(to.getAttribute("aria-invalid")).toBe("true");
  expect(to.getAttribute("aria-describedby")).toBe(error.id);
  expect(from.value).toBe("2026-11-05");
  expect(screen.getByText("CORNER COFFEE")).toBeTruthy();
  expect(vi.mocked(listTransactions).mock.calls.length).toBe(calls);

  fireEvent.change(to, { target: { value: "2026-11-30" } });
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, from: "2026-11-05", to: "2026-11-30" }));
  expect(screen.queryByText("To date must be on or after the From date")).toBeNull();
  expect(to.hasAttribute("aria-invalid")).toBe(false);
});

test("pages forward and back, keeping the previous page shown while loading", async () => {
  let resolveNext: (value: { rows: Transaction[]; total: number }) => void = () => {};
  vi.mocked(listTransactions)
    .mockResolvedValueOnce({ rows: [row], total: 120 })
    .mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)))
    .mockResolvedValue({ rows: [row], total: 120 });
  renderPage();
  expect(await screen.findByText("Page 1 of 3")).toBeTruthy();
  expect(screen.getByText("120 transactions")).toBeTruthy();
  const previous = screen.getByRole("button", { name: "Previous" });
  expect(previous.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(previous);
  expect(listTransactions).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, page: 1 }));
  expect(screen.getByText("CORNER COFFEE")).toBeTruthy();
  resolveNext({ rows: [{ ...row, id: 9, description: "PAGE TWO" }], total: 120 });
  expect(await screen.findByText("PAGE TWO")).toBeTruthy();
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Page 3 of 3")).toBeTruthy();
  const next = screen.getByRole("button", { name: "Next" });
  // Wait for the page-3 fetch to settle so only the last-page rule disables Next.
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Previous" }).getAttribute("aria-disabled")).toBe("false"));
  expect(next.getAttribute("aria-disabled")).toBe("true");
  const calls = vi.mocked(listTransactions).mock.calls.length;
  fireEvent.click(next);
  expect(listTransactions).toHaveBeenCalledTimes(calls);

  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, page: 1 }));
});

test("steps back to the last page when a refetch shrinks the total", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 57 });
  const client = renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(await screen.findByText("Page 2 of 2")).toBeTruthy();

  // As after reverting an import: page 2 no longer exists.
  vi.mocked(listTransactions).mockImplementation(async (query) => ({
    rows: query.page === 0 ? [{ ...row, description: "STILL HERE" }] : [],
    total: 45,
  }));
  await act(() => client.invalidateQueries({ queryKey: ["list_transactions"] }));
  expect(await screen.findByText("STILL HERE")).toBeTruthy();
  expect(lastQuery()).toEqual(base);
  expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "No transactions match" })).toBeNull();
});

test("announces the result once the fetch settles", async () => {
  vi.mocked(listTransactions).mockResolvedValueOnce({ rows: [row], total: 57 }).mockResolvedValue({ rows: [], total: 0 });
  renderPage();
  const status = screen.getByRole("status");
  await vi.waitFor(() => expect(status.textContent).toBe("57 transactions, page 1 of 2"));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2027-01-01" } });
  await vi.waitFor(() => expect(status.textContent).toBe("No transactions match"));
  expect(screen.getByRole("status")).toBe(status);
});

test("shows the empty state with no transactions at all", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [], total: 0 });
  renderPage();
  expect(await screen.findByRole("heading", { level: 2, name: "No transactions yet" })).toBeTruthy();
  expect(screen.getByText("Import an OFX or QFX file to get started.")).toBeTruthy();
  expect(screen.queryByLabelText("Search")).toBeNull();
});

test("shows a filtered empty state that clears the filters", async () => {
  vi.mocked(listTransactions).mockResolvedValueOnce({ rows: [row], total: 1 }).mockResolvedValue({ rows: [], total: 0 });
  renderPage();
  await screen.findByText("CORNER COFFEE");
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2027-01-01" } });
  expect(await screen.findByRole("heading", { name: "No transactions match" })).toBeTruthy();

  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(await screen.findByText("CORNER COFFEE")).toBeTruthy();
  expect(lastQuery()).toEqual(base);
  expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("");
});

test("shows a load error and retries", async () => {
  vi.mocked(listTransactions)
    .mockRejectedValueOnce({ kind: "Locked", message: "Zeni is locked" })
    .mockResolvedValue({ rows: [row], total: 1 });
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load transactions")).toBeTruthy();
  expect(within(alert).getByText("Locked")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("CORNER COFFEE")).toBeTruthy();
});
