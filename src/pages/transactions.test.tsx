import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { countRuleMatches, listCategories, listNicknames, listTransactions, setTransactionCategory } from "@/lib/commands";
import { TransactionsPage } from "@/pages/transactions";
import type { Category } from "@/types/bindings/Category";
import type { Transaction } from "@/types/bindings/Transaction";

vi.mock("@/lib/commands", () => ({
  listTransactions: vi.fn(),
  listNicknames: vi.fn(),
  countRuleMatches: vi.fn(),
  saveNicknameRule: vi.fn(),
  listCategories: vi.fn(),
  setTransactionCategory: vi.fn(),
}));
// ImportControls has its own tests; keep this page test about the list.
vi.mock("@/components/import-controls", () => ({ ImportControls: () => null }));
vi.mock("@/components/categorize-actions", () => ({ CategorizeActions: () => <p>Categorize actions</p> }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCategories).mockResolvedValue(categories);
});
// jsdom lacks ResizeObserver, which the rename dialog's radio groups and the selects use.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// Radix Select scrolls its selected option into view.
Element.prototype.scrollIntoView = function () {};

const row: Transaction = {
  id: 1,
  importId: 1,
  postedDate: "2026-10-31",
  amountCents: -1850,
  description: "CORNER COFFEE",
  memo: "Card purchase",
  transactionType: null,
  runningBalanceCents: null,
  nickname: null,
  categoryId: null,
  category: null,
  setBy: null,
  reviewed: false,
  note: null,
};
const category = (id: number, name: string): Category => ({
  id,
  name,
  description: "",
  kind: "spending",
  sortOrder: id,
  rowCount: 0,
  nicknameCount: 0,
});
const categories = [category(4, "Groceries"), category(5, "Dining out")];
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
  expect(screen.getByText("Import an OFX, QFX or CSV file to get started.")).toBeTruthy();
  expect(screen.queryByLabelText("Search")).toBeNull();
  // Nothing to categorize yet.
  expect(screen.queryByText("Categorize actions")).toBeNull();
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

test("shows the nickname instead of the description, with the raw text in a tooltip", async () => {
  vi.mocked(listTransactions).mockResolvedValue({
    rows: [{ ...row, nickname: "Coffee" }, { ...row, id: 2, description: "PAYROLL", memo: null }],
    total: 2,
  });
  renderPage();
  const nickname = (await screen.findByText("Coffee")).closest("p")!;
  // Unmapped rows show the bank's text as before.
  expect(screen.getByText("PAYROLL")).toBeTruthy();
  expect(screen.queryByText("CORNER COFFEE")).toBeNull();
  expect(screen.queryByText("Card purchase")).toBeNull();
  // A decorative tag marks the nicknamed row only.
  expect(nickname.querySelector("svg.lucide-tag")?.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByText("PAYROLL").closest("tr")!.querySelector("svg.lucide-tag")).toBeNull();
  // Screen readers get the raw text without the tooltip.
  expect(nickname.textContent).toBe("Coffee, description CORNER COFFEE, memo Card purchase");

  // Focusing the row opens its tooltip, so keyboard users reach the raw text too.
  const tableRow = nickname.closest("tr")!;
  fireEvent.focus(tableRow);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toContain("Description: CORNER COFFEE");
  expect(tooltip.textContent).toContain("Memo: Card purchase");
  fireEvent.blur(tableRow);
  await vi.waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

test("a nickname row without a memo leaves Memo out of the tooltip and screen reader text", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [{ ...row, nickname: "Coffee", memo: null }], total: 1 });
  renderPage();
  const nickname = (await screen.findByText("Coffee")).closest("p")!;
  expect(nickname.textContent).toBe("Coffee, description CORNER COFFEE");
  fireEvent.focus(nickname.closest("tr")!);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toBe("Description: CORNER COFFEE");
});

test("a long description truncates to one line, with its full text and memo in a tooltip on focus", async () => {
  const description = "ATM WITHDRAWAL 5TH AVE AND MAIN STREET BRANCH 0042";
  vi.mocked(listTransactions).mockResolvedValue({ rows: [{ ...row, description }], total: 1 });
  renderPage();
  const text = await screen.findByText(description);
  expect(text.className).toContain("truncate");
  // Below lg the memo is hidden from sight only; screen readers still get it without the tooltip.
  const memo = screen.getByText("Card purchase");
  expect(memo.className).toContain("sr-only");
  expect(memo.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  const tableRow = text.closest("tr")!;
  fireEvent.focus(tableRow);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toBe(`Description: ${description}Memo: Card purchase`);
  fireEvent.blur(tableRow);
  await vi.waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

test("the search placeholder mentions nicknames and notes", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 1 });
  renderPage();
  expect((await screen.findByLabelText("Search")).getAttribute("placeholder")).toBe(
    "Search nickname, description, memo or note",
  );
});

test("right-clicking a row offers Rename it, which opens the rename dialog and returns focus to the row", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row, { ...row, id: 2, description: "PAYROLL", memo: null }], total: 2 });
  vi.mocked(listNicknames).mockResolvedValue([]);
  vi.mocked(countRuleMatches).mockResolvedValue(3);
  renderPage();
  const tableRow = (await screen.findByText("CORNER COFFEE")).closest("tr")!;
  // Focusable, so the keyboard's context-menu key reaches it, and described by the shared hint saying so.
  expect(tableRow.tabIndex).toBe(0);
  const hint = document.getElementById(tableRow.getAttribute("aria-describedby")!);
  expect(hint?.textContent).toBe("Press Shift+F10 or the menu key for actions.");
  expect(screen.getByText("PAYROLL").closest("tr")!.getAttribute("aria-describedby")).toBe(hint!.id);
  expect(screen.getAllByText("Press Shift+F10 or the menu key for actions.")).toHaveLength(1);

  fireEvent.contextMenu(tableRow);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Rename it" }));
  const dialog = await screen.findByRole("dialog", { name: "What's its nickname?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Match options" }));
  expect((within(dialog).getByLabelText("Pattern") as HTMLInputElement).value).toBe("CORNER COFFEE");

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await vi.waitFor(() => expect(document.activeElement).toBe(tableRow));
});

test("the Category column shows the category, who set it, unreviewed model rows and the note", async () => {
  vi.mocked(listTransactions).mockResolvedValue({
    rows: [
      { ...row, categoryId: 5, category: "Dining out", setBy: "model", reviewed: false },
      { ...row, id: 2, description: "FRESH MART", categoryId: 4, category: "Groceries", setBy: "model", reviewed: true },
      { ...row, id: 3, description: "PAYROLL", categoryId: 4, category: "Groceries", setBy: "nickname", reviewed: true },
      { ...row, id: 4, description: "ATM", categoryId: 4, category: "Groceries", setBy: "user", reviewed: true, note: "Market cash" },
      { ...row, id: 5, description: "INTEREST" },
    ],
    total: 5,
  });
  renderPage();
  expect(await screen.findByRole("columnheader", { name: "Category" })).toBeTruthy();
  const cell = (text: string) => within(screen.getByText(text).closest("tr")!);
  expect(screen.getByText("Categorize actions")).toBeTruthy();
  const unreviewed = cell("CORNER COFFEE").getByRole("button", { name: "Dining out, set by Model, Not reviewed" });
  // The label already says it, so the dot stays out of the accessible name; hovering it explains it by sight.
  const dot = unreviewed.querySelector(".rounded-full")!;
  expect(dot.getAttribute("aria-hidden")).toBe("true");
  fireEvent.pointerMove(dot);
  expect((await screen.findAllByText("Not reviewed")).length).toBeGreaterThan(0);
  expect(cell("FRESH MART").getByRole("button").querySelector(".rounded-full")).toBeNull();
  expect(cell("FRESH MART").getByRole("button", { name: "Groceries, set by Model" })).toBeTruthy();
  expect(cell("PAYROLL").getByRole("button", { name: "Groceries, set by Nickname" })).toBeTruthy();
  expect(cell("ATM").getByRole("button", { name: "Groceries, set by You" })).toBeTruthy();
  const uncategorized = cell("INTEREST").getByRole("button", { name: "Uncategorized" });
  expect(uncategorized.querySelector(".text-muted-foreground")?.textContent).toBe("Uncategorized");
  // Screen readers get the note in the cell; the tooltip repeats it for the eye.
  expect(cell("ATM").getByText("Note: Market cash")).toBeTruthy();
  expect(cell("INTEREST").queryByText(/^Note:/)).toBeNull();
});

test("the category filter picks a category, Uncategorized or all, from the first page", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 120 });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, page: 1 }));
  const filter = screen.getByRole("combobox", { name: "Category" });
  expect(filter.textContent).toBe("All categories");

  const pick = async (name: string) => {
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name }));
  };
  await pick("Uncategorized");
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, uncategorized: true }));
  await pick("Groceries");
  await vi.waitFor(() => expect(lastQuery()).toEqual({ ...base, categoryId: 4 }));
  expect(lastQuery()).not.toHaveProperty("uncategorized", true);
  await pick("All categories");
  await vi.waitFor(() => expect(lastQuery()).toEqual(base));
});

test("Clear filters also clears the category filter", async () => {
  vi.mocked(listTransactions).mockImplementation(async (query) =>
    query.uncategorized ? { rows: [], total: 0 } : { rows: [row], total: 1 },
  );
  renderPage();
  fireEvent.click(await screen.findByRole("combobox", { name: "Category" }));
  fireEvent.click(await screen.findByRole("option", { name: "Uncategorized" }));
  fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
  expect(await screen.findByText("CORNER COFFEE")).toBeTruthy();
  expect(lastQuery()).toEqual(base);
  expect(screen.getByRole("combobox", { name: "Category" }).textContent).toBe("All categories");
});

test("shows an error in place of the category filter when categories fail to load", async () => {
  vi.mocked(listCategories).mockRejectedValue({ kind: "Locked", message: "Unlock Zeni first." });
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 1 });
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load categories")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
});

test("the Category cell opens the Categorize dialog; saving shows You and returns focus to the cell", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [{ ...row, categoryId: 5, category: "Dining out", setBy: "model" }], total: 1 });
  vi.mocked(setTransactionCategory).mockResolvedValue(null);
  const client = renderPage();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const button = await screen.findByRole("button", { name: /^Dining out/ });
  fireEvent.click(button);
  const dialog = await screen.findByRole("dialog", { name: "Categorize" });
  expect((await within(dialog).findByRole("combobox", { name: "Category" })).textContent).toBe("Dining out");

  vi.mocked(listTransactions).mockResolvedValue({
    rows: [{ ...row, categoryId: 5, category: "Dining out", setBy: "user", reviewed: true }],
    total: 1,
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(setTransactionCategory).toHaveBeenCalledWith({ transactionId: 1, categoryId: 5, note: "" });
  for (const key of ["list_transactions", "review_groups", "unreviewed_count", "list_categories"]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  }
  expect(await screen.findByRole("button", { name: "Dining out, set by You" })).toBeTruthy();
  await vi.waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Dining out, set by You"));
});

test("right-click Categorize… opens the dialog and Cancel returns focus to the row", async () => {
  vi.mocked(listTransactions).mockResolvedValue({ rows: [row], total: 1 });
  renderPage();
  const tableRow = (await screen.findByText("CORNER COFFEE")).closest("tr")!;
  fireEvent.contextMenu(tableRow);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Categorize…" }));
  const dialog = await screen.findByRole("dialog", { name: "Categorize" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await vi.waitFor(() => expect(document.activeElement).toBe(tableRow));
  expect(setTransactionCategory).not.toHaveBeenCalled();
});
