import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listCategories, markReviewed, reviewGroups, setTransactionCategory, setTransactionsCategory } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { ReviewPage } from "@/pages/review";
import type { Category } from "@/types/bindings/Category";
import type { ReviewGroup } from "@/types/bindings/ReviewGroup";
import type { Transaction } from "@/types/bindings/Transaction";

vi.mock("@/lib/commands", () => ({
  reviewGroups: vi.fn(),
  markReviewed: vi.fn(),
  setTransactionCategory: vi.fn(),
  setTransactionsCategory: vi.fn(),
  listCategories: vi.fn(),
}));

// Radix Select needs these in jsdom.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = function () {};

const category = (id: number, name: string): Category => ({
  id,
  name,
  description: "",
  kind: "spending",
  sortOrder: id,
  rowCount: 0,
  nicknameCount: 0,
});
const row = (id: number, description: string, categoryId: number, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  importId: 1,
  postedDate: "2026-10-29",
  amountCents: -8642,
  description,
  memo: null,
  transactionType: null,
  runningBalanceCents: null,
  nickname: null,
  categoryId,
  category: categoryId === 4 ? "Groceries" : "Dining out",
  setBy: "model",
  reviewed: false,
  note: null,
  ...extra,
});
const greenleaf = row(99, "GREENLEAF MARKET #42", 4, { note: "Weekly shop" });
const freshMart = row(60, "FRESH MART #12", 4, { postedDate: "2026-10-12", amountCents: 1525 });
const pizzeria = row(92, "PIZZERIA NAPOLI", 5, { nickname: "Pizza night" });
const groceries: ReviewGroup = { categoryId: 4, category: "Groceries", rows: [greenleaf, freshMart] };
const dining: ReviewGroup = { categoryId: 5, category: "Dining out", rows: [pizzeria] };
const invokeError = { kind: "Invoke", message: "not running in Tauri" } as const;
const busyError = { kind: "Busy", message: "Wait for categorizing to finish." } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCategories).mockResolvedValue([category(4, "Groceries"), category(5, "Dining out")]);
});

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <main>
        <ReviewPage />
      </main>
    </QueryClientProvider>,
  );
  return client;
}

function renderPage() {
  return vi.spyOn(renderWithClient(), "invalidateQueries");
}

const group = (name: string) => screen.getByRole("region", { name });
// The groups come from the cache, not a refetch; only the count and transactions reload.
const expectRefreshed = (invalidate: ReturnType<typeof renderPage>) => {
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([["unreviewed_count"], ["list_transactions"]]);
  expect(reviewGroups).toHaveBeenCalledTimes(1);
};

test("shows each group open with its rows: date, nickname or description, amount and category", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  renderPage();
  const grocery = await screen.findByRole("region", { name: "Groceries (2)" });
  expect(within(grocery).getByRole("button", { name: "Groceries (2)" }).getAttribute("aria-expanded")).toBe("true");
  const expected = [
    [formatDate("2026-10-29"), "GREENLEAF MARKET #42", formatCents(-8642)],
    [formatDate("2026-10-12"), "FRESH MART #12", formatCents(1525)],
  ];
  const rows = within(grocery).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);
  rows.forEach((tr, i) => {
    // The first cell is the row's checkbox; the description cell also holds Select all like this.
    const [, date, description, amount] = within(tr).getAllByRole("cell");
    expect([date.textContent, amount.textContent]).toEqual([expected[i][0], expected[i][2]]);
    expect(within(description).getByText(expected[i][1])).toBeTruthy();
  });
  expect(within(group("Dining out (1)")).getByText("Pizza night")).toBeTruthy();
  expect(within(group("Dining out (1)")).queryByText("PIZZERIA NAPOLI")).toBeNull();
  const select = await within(grocery).findByRole("combobox", { name: "Category for GREENLEAF MARKET #42" });
  expect(select.textContent).toBe("Groceries");
});

test("a group collapses and opens again", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([dining]);
  renderPage();
  const toggle = await screen.findByRole("button", { name: "Dining out (1)" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Pizza night")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByText("Pizza night")).toBeTruthy();
});

test("shows a skeleton while loading, then the empty state with a link to Transactions", async () => {
  let resolve: (value: ReviewGroup[]) => void = () => {};
  vi.mocked(reviewGroups).mockReturnValue(new Promise((r) => (resolve = r)));
  renderPage();
  expect(screen.getByRole("status").textContent).toBe("Loading the review…");
  resolve([]);
  expect(await screen.findByRole("heading", { name: "Nothing to review." })).toBeTruthy();
  expect(screen.getByText("The model's answers show up here after a categorize run.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Go to Transactions" }).getAttribute("href")).toBe("#/transactions");
  expect(screen.getByRole("status").textContent).toBe("");
});

test("a load error offers Try again; a repeat failure stays, a success shows the groups and focuses the heading", async () => {
  vi.mocked(reviewGroups).mockRejectedValue(invokeError);
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load the review")).toBeTruthy();
  expect(within(alert).getByText("not running in Tauri")).toBeTruthy();

  let fail: (error: unknown) => void = () => {};
  vi.mocked(reviewGroups).mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  const busy = await screen.findByRole("button", { name: "Trying again…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(busy);
  expect(reviewGroups).toHaveBeenCalledTimes(2);
  fail(invokeError);
  expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();

  vi.mocked(reviewGroups).mockResolvedValue([dining]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("region", { name: "Dining out (1)" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review" })));
});

test("Looks good marks the group's shown rows reviewed, the group disappears and focus moves to the next group", async () => {
  vi.mocked(reviewGroups).mockResolvedValueOnce([groceries, dining]).mockResolvedValue([dining]);
  vi.mocked(markReviewed).mockResolvedValue(null);
  const invalidate = renderPage();
  fireEvent.click(within(await screen.findByRole("region", { name: "Groceries (2)" })).getByRole("button", { name: "Looks good" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Groceries (2)" })).toBeNull());
  expect(markReviewed).toHaveBeenCalledWith({ transactionIds: [99, 60] });
  expectRefreshed(invalidate);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dining out (1)" })));
});

test("Looks good on the last group shows the empty state and focuses the heading", async () => {
  vi.mocked(reviewGroups).mockResolvedValueOnce([dining]).mockResolvedValue([]);
  vi.mocked(markReviewed).mockResolvedValue(null);
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Looks good" }));
  expect(await screen.findByRole("heading", { name: "Nothing to review." })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
});

test("while Looks good saves, every action is busy and a repeat press does nothing", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(markReviewed).mockReturnValue(new Promise(() => {}));
  renderPage();
  fireEvent.click(within(await screen.findByRole("region", { name: "Dining out (1)" })).getByRole("button", { name: "Looks good" }));
  const saving = await screen.findByRole("button", { name: "Saving…" });
  expect(saving.getAttribute("aria-disabled")).toBe("true");
  const other = within(group("Groceries (2)")).getByRole("button", { name: "Looks good" });
  expect(other.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(saving);
  fireEvent.click(other);
  expect(markReviewed).toHaveBeenCalledTimes(1);
});

test("a failed Looks good shows the error in its group and keeps the group", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(markReviewed).mockRejectedValue(invokeError);
  renderPage();
  fireEvent.click(within(await screen.findByRole("region", { name: "Dining out (1)" })).getByRole("button", { name: "Looks good" }));
  const alert = await within(group("Dining out (1)")).findByRole("alert");
  expect(within(alert).getByText("Couldn't mark them reviewed")).toBeTruthy();
  expect(within(alert).getByText("not running in Tauri")).toBeTruthy();
  expect(within(group("Groceries (2)")).queryByRole("alert")).toBeNull();
  expect(within(group("Dining out (1)")).getByRole("button", { name: "Looks good" }).getAttribute("aria-disabled")).toBe("false");
  fireEvent.click(within(alert).getByRole("button", { name: "Dismiss error" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dining out (1)" })));
});

test("changing a row's category keeps its note, and the row leaves the group", async () => {
  vi.mocked(reviewGroups)
    .mockResolvedValueOnce([groceries, dining])
    .mockResolvedValue([{ ...groceries, rows: [freshMart] }, dining]);
  vi.mocked(setTransactionCategory).mockResolvedValue(null);
  const invalidate = renderPage();
  const select = await screen.findByRole("combobox", { name: "Category for GREENLEAF MARKET #42" });
  fireEvent.keyDown(select, { key: "ArrowDown" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Dining out" }));

  expect(await screen.findByRole("region", { name: "Groceries (1)" })).toBeTruthy();
  expect(screen.queryByText("GREENLEAF MARKET #42")).toBeNull();
  expect(setTransactionCategory).toHaveBeenCalledWith({ transactionId: 99, categoryId: 5, note: "Weekly shop" });
  expectRefreshed(invalidate);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Groceries (1)" })));
});

test("while a category change saves, another change and Looks good do nothing", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(setTransactionCategory).mockReturnValue(new Promise(() => {}));
  renderPage();
  const pick = async (name: string, option: string) => {
    fireEvent.keyDown(await screen.findByRole("combobox", { name }), { key: "ArrowDown" });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
  };
  await pick("Category for GREENLEAF MARKET #42", "Dining out");
  await waitFor(() =>
    expect(within(group("Groceries (2)")).getByRole("button", { name: "Looks good" }).getAttribute("aria-disabled")).toBe("true"),
  );
  await pick("Category for Pizza night", "Groceries");
  fireEvent.click(within(group("Groceries (2)")).getByRole("button", { name: "Looks good" }));
  expect(setTransactionCategory).toHaveBeenCalledTimes(1);
  expect(markReviewed).not.toHaveBeenCalled();
});

test("a failed category change shows the error in its group and keeps the row", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(setTransactionCategory).mockRejectedValue(busyError);
  renderPage();
  fireEvent.keyDown(await screen.findByRole("combobox", { name: "Category for Pizza night" }), { key: "ArrowDown" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Groceries" }));
  const alert = await within(group("Dining out (1)")).findByRole("alert");
  expect(within(alert).getByText("Couldn't change the category")).toBeTruthy();
  expect(within(alert).getByText("Wait for categorizing to finish.")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Category for Pizza night" }).textContent).toBe("Dining out");
});

const many = (count: number, start: number, categoryId: number, description = "CORNER STORE") =>
  Array.from({ length: count }, (_, i) => row(start + i, `${description} ${i + 1}`, categoryId));
const pickIn = async (name: string, option: string) => {
  fireEvent.keyDown(await screen.findByRole("combobox", { name }), { key: "ArrowDown" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
};
const BAR_SELECT = "Change selected to…";

test("a group shows 25 rows; Show 25 more keeps focus on the button while rows are left, then focuses the first new row", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([{ categoryId: 4, category: "Groceries", rows: many(60, 1000, 4) }]);
  renderPage();
  const region = await screen.findByRole("region", { name: "Groceries (60)" });
  expect(within(region).getAllByRole("row")).toHaveLength(26);
  expect(await within(region).findAllByRole("combobox")).toHaveLength(25);

  const more = within(region).getByRole("button", { name: "Show 25 more" });
  more.focus();
  expect(within(region).getByRole("button", { name: "Looks good (all 60)" })).toBeTruthy();
  fireEvent.click(more);
  expect(within(region).getAllByRole("row")).toHaveLength(51);
  expect(document.activeElement).toBe(more);
  expect(more.textContent).toBe("Show 10 more");

  fireEvent.click(more);
  expect(within(region).getAllByRole("row")).toHaveLength(61);
  expect(within(region).queryByRole("button", { name: /^Show/ })).toBeNull();
  expect(within(region).getByRole("button", { name: "Looks good" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole("checkbox", { name: "Select CORNER STORE 51" })));
});

test("stays fast with 1,200 rows: only 25 rows and CategorySelects per group are mounted", async () => {
  vi.mocked(reviewGroups).mockResolvedValue(
    [4, 5, 6, 7].map((id, i) => ({ categoryId: id, category: `Category ${id}`, rows: many(300, 10000 + i * 300, id) })),
  );
  renderPage();
  await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(100));
  expect(screen.getAllByRole("row")).toHaveLength(4 * 26);
});

test("Select all selects the whole group, including rows not shown yet, and the bulk change moves them all", async () => {
  const rows = many(30, 1000, 4);
  vi.mocked(reviewGroups).mockResolvedValue([{ categoryId: 4, category: "Groceries", rows }, dining]);
  // The backend's count, not the selection size, goes in the status.
  vi.mocked(setTransactionsCategory).mockResolvedValue(29);
  const invalidate = renderPage();
  const region = await screen.findByRole("region", { name: "Groceries (30)" });
  expect(screen.queryByText(/selected$/)).toBeNull();
  fireEvent.click(within(region).getByRole("checkbox", { name: "Select all in Groceries" }));
  expect(screen.getByText("30 selected")).toBeTruthy();
  expect(within(region).getByRole("checkbox", { name: "Select CORNER STORE 1" }).getAttribute("aria-checked")).toBe("true");

  await pickIn(BAR_SELECT, "Dining out");
  await waitFor(() => expect(screen.queryByRole("region", { name: "Groceries (30)" })).toBeNull());
  expect(setTransactionsCategory).toHaveBeenCalledWith({ transactionIds: rows.map((r) => r.id), categoryId: 5 });
  expect(screen.getByRole("status").textContent).toBe("Changed 29 rows to Dining out.");
  expect(screen.queryByText("30 selected")).toBeNull();
  expectRefreshed(invalidate);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dining out (1)" })));
});

test("Select all is mixed after picking one row, and unselects the group when everything is selected", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries]);
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select GREENLEAF MARKET #42" }));
  const all = screen.getByRole("checkbox", { name: "Select all (1 of 2 selected) in Groceries" });
  expect(all.getAttribute("aria-checked")).toBe("mixed");
  expect(screen.getByText("Select all (1 of 2 selected)")).toBeTruthy();
  expect(screen.getByText("1 selected")).toBeTruthy();
  fireEvent.click(all);
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.click(all);
  expect(screen.queryByText(/selected$/)).toBeNull();
  expect(all.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("status").textContent).toBe("Selection cleared.");
});

test("Select all like this selects rows with the same nickname or description in every group", async () => {
  const otherFreshMart = row(61, "FRESH MART #12", 5);
  vi.mocked(reviewGroups).mockResolvedValue([groceries, { ...dining, rows: [pizzeria, otherFreshMart] }]);
  renderPage();
  fireEvent.click(within(await screen.findByRole("region", { name: "Groceries (2)" })).getByRole("button", { name: "Select all like this (FRESH MART #12)" }));
  expect(screen.getByText("2 selected")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("2 selected.");
  for (const region of [group("Groceries (2)"), group("Dining out (2)")])
    expect(within(region).getByRole("checkbox", { name: "Select FRESH MART #12" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("checkbox", { name: "Select GREENLEAF MARKET #42" }).getAttribute("aria-checked")).toBe("false");
});

test("Clear unselects everything and moves focus to the first group", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByText("1 selected")).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Select Pizza night" }).getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("status").textContent).toBe("Selection cleared.");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Groceries (2)" })));
});

test("while a bulk change saves, a repeat pick, a row change and Looks good do nothing", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(setTransactionsCategory).mockReturnValue(new Promise(() => {}));
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  await pickIn(BAR_SELECT, "Groceries");
  await pickIn("Changing…", "Dining out");
  await pickIn("Category for GREENLEAF MARKET #42", "Dining out");
  const looksGood = within(group("Groceries (2)")).getByRole("button", { name: "Looks good" });
  expect(looksGood.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(looksGood);
  expect(setTransactionsCategory).toHaveBeenCalledTimes(1);
  expect(setTransactionCategory).not.toHaveBeenCalled();
  expect(markReviewed).not.toHaveBeenCalled();
});

test("a failed bulk change shows the error in the bar, keeps the selection and rows, and dismiss focuses the picker", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(setTransactionsCategory).mockRejectedValue(busyError);
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  await pickIn(BAR_SELECT, "Groceries");
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't change the selected rows")).toBeTruthy();
  expect(within(alert).getByText("Wait for categorizing to finish.")).toBeTruthy();
  expect(within(alert).getByText("Wait for it to finish, or cancel it from the banner.")).toBeTruthy();
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(group("Dining out (1)")).toBeTruthy();
  fireEvent.click(within(alert).getByRole("button", { name: "Dismiss error" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: BAR_SELECT })));
});

test("a changed row leaves the selection and the page links nicknames for default categories", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(setTransactionCategory).mockResolvedValue(null);
  renderPage();
  expect(screen.getByRole("link", { name: "give its nickname a default category" }).getAttribute("href")).toBe("#/nicknames");
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  await pickIn("Category for Pizza night", "Groceries");
  await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Groceries (2)" })));
});

test("a bulk change after Select all like this moves only the matching rows out of every group", async () => {
  const otherFreshMart = row(61, "FRESH MART #12", 5);
  vi.mocked(reviewGroups).mockResolvedValue([groceries, { ...dining, rows: [pizzeria, otherFreshMart] }]);
  vi.mocked(setTransactionsCategory).mockResolvedValue(2);
  renderPage();
  fireEvent.click(within(await screen.findByRole("region", { name: "Groceries (2)" })).getByRole("button", { name: "Select all like this (FRESH MART #12)" }));
  await pickIn(BAR_SELECT, "Groceries");
  expect(await screen.findByRole("region", { name: "Groceries (1)" })).toBeTruthy();
  expect(setTransactionsCategory).toHaveBeenCalledWith({ transactionIds: [60, 61], categoryId: 4 });
  expect(within(group("Groceries (1)")).getByText("GREENLEAF MARKET #42")).toBeTruthy();
  expect(within(group("Dining out (1)")).getByText("Pizza night")).toBeTruthy();
  expect(screen.queryByText("FRESH MART #12")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Changed 2 rows to Groceries.");
});

test("a bulk change that empties every group shows the empty state, says 1 row, and focuses the heading", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([dining]);
  vi.mocked(setTransactionsCategory).mockResolvedValue(1);
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  await pickIn(BAR_SELECT, "Groceries");
  expect(await screen.findByRole("heading", { name: "Nothing to review." })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Changed 1 row to Groceries.");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review" })));
});

test("a later action clears the bulk change's status", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(setTransactionsCategory).mockResolvedValue(1);
  vi.mocked(markReviewed).mockResolvedValue(null);
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  await pickIn(BAR_SELECT, "Groceries");
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Changed 1 row to Groceries."));
  fireEvent.click(screen.getByRole("button", { name: "Looks good" }));
  expect(screen.getByRole("status").textContent).toBe("");
});

test("the status falls back to \"the new category\" when the categories aren't cached", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([dining]);
  let resolve: (count: number) => void = () => {};
  vi.mocked(setTransactionsCategory).mockReturnValue(new Promise((r) => (resolve = r)));
  const client = renderWithClient();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  await pickIn(BAR_SELECT, "Groceries");
  client.removeQueries({ queryKey: ["list_categories"] });
  resolve(1);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Changed 1 row to the new category."));
});

test("a selected row that a refetch drops is no longer counted or sent", async () => {
  vi.mocked(reviewGroups).mockResolvedValueOnce([groceries, dining]).mockResolvedValue([groceries]);
  vi.mocked(setTransactionsCategory).mockResolvedValue(1);
  const client = renderWithClient();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pizza night" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select FRESH MART #12" }));
  expect(screen.getByText("2 selected")).toBeTruthy();
  await client.refetchQueries({ queryKey: ["review_groups"] });
  expect(await screen.findByText("1 selected")).toBeTruthy();
  await pickIn(BAR_SELECT, "Dining out");
  await waitFor(() => expect(setTransactionsCategory).toHaveBeenCalledWith({ transactionIds: [60], categoryId: 5 }));
});
