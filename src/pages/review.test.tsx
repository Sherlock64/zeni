import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listCategories, markReviewed, reviewGroups, setTransactionCategory, setTransactionsCategory } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { ReviewPage } from "@/pages/review";
import type { Category } from "@/types/bindings/Category";
import type { ReviewGroup } from "@/types/bindings/ReviewGroup";
import type { Transaction } from "@/types/bindings/Transaction";
import { CATEGORIES_KEY, REVIEW_GROUPS_KEY, TRANSACTIONS_KEY, UNREVIEWED_COUNT_KEY } from "@/lib/query-keys";

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
// ArrowDown opens both a row's stand-in control (which swaps in the real select) and a real select.
const pickIn = async (name: string, option: string) => {
  fireEvent.keyDown(await screen.findByLabelText(name), { key: "ArrowDown" });
  fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: option }));
};
// The groups come from the cache, not a refetch; only the count and transactions reload.
const expectRefreshed = (invalidate: ReturnType<typeof renderPage>) => {
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([UNREVIEWED_COUNT_KEY, TRANSACTIONS_KEY]);
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
  const control = within(grocery).getByRole("combobox", { name: "Category for GREENLEAF MARKET #42" });
  expect(control.textContent).toBe("Groceries");
  expect(control.getAttribute("aria-haspopup")).toBe("listbox");
  expect(control.getAttribute("aria-expanded")).toBe("false");
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
  await pickIn("Category for GREENLEAF MARKET #42", "Dining out");

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
  await pickIn("Category for GREENLEAF MARKET #42", "Dining out");
  await waitFor(() =>
    expect(within(group("Groceries (2)")).getByRole("button", { name: "Looks good" }).getAttribute("aria-disabled")).toBe("true"),
  );
  await pickIn("Category for Pizza night", "Groceries");
  fireEvent.click(within(group("Groceries (2)")).getByRole("button", { name: "Looks good" }));
  expect(setTransactionCategory).toHaveBeenCalledTimes(1);
  expect(markReviewed).not.toHaveBeenCalled();
});

test("a failed category change shows the error in its group and keeps the row", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  vi.mocked(setTransactionCategory).mockRejectedValue(busyError);
  renderPage();
  await pickIn("Category for Pizza night", "Groceries");
  const alert = await within(group("Dining out (1)")).findByRole("alert");
  expect(within(alert).getByText("Couldn't change the category")).toBeTruthy();
  expect(within(alert).getByText("Wait for categorizing to finish.")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Category for Pizza night" }).textContent).toBe("Dining out");
});

const many = (count: number, start: number, categoryId: number, description = "CORNER STORE") =>
  Array.from({ length: count }, (_, i) => row(start + i, `${description} ${i + 1}`, categoryId));
const BAR_SELECT = "Change selected to…";

test("a group shows 25 rows; Show 25 more keeps focus on the button while rows are left, then focuses the first new row", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([{ categoryId: 4, category: "Groceries", rows: many(60, 1000, 4) }]);
  renderPage();
  const region = await screen.findByRole("region", { name: "Groceries (60)" });
  expect(within(region).getAllByRole("row")).toHaveLength(26);
  expect(within(region).getAllByRole("combobox", { name: /^Category for / })).toHaveLength(25);

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

const twenty = (rows = 60) =>
  Array.from({ length: 20 }, (_, i) => ({ categoryId: 100 + i, category: `Category ${100 + i}`, rows: many(rows, 10000 + i * rows, 100 + i, `SHOP ${i}`) }));

// Queues animation frames so a test runs them one at a time.
function stubFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  return {
    pending: () => frames.size,
    flush: () =>
      act(() => {
        const queued = [...frames.values()];
        frames.clear();
        for (const callback of queued) callback(0);
      }),
  };
}
afterEach(() => vi.unstubAllGlobals());

const groupRegions = () => screen.queryAllByRole("region", { name: /^Category 1/ });
const groupSkeletons = () => document.querySelectorAll('[aria-hidden="true"][data-slot="skeleton"]');

test("stays fast with 1,200 rows in 20 groups: no selects mount until a row's control is used, which opens and focuses it", async () => {
  stubFrames();
  vi.mocked(reviewGroups).mockResolvedValue(twenty());
  renderPage();
  // Frames are held, so only the first batch draws: 75 rows out of 1,200, none with a Radix Select yet.
  await screen.findByRole("region", { name: "Category 100 (60)" });
  expect(groupRegions()).toHaveLength(3);
  expect(screen.getAllByRole("combobox")).toHaveLength(3 * 25);
  for (const control of screen.getAllByRole("combobox")) expect(control.tagName).toBe("BUTTON");
  expect(screen.getAllByRole("row")).toHaveLength(3 * 26);

  const control = screen.getByRole("combobox", { name: "Category for SHOP 0 1" });
  control.focus();
  fireEvent.keyDown(control, { key: "ArrowDown" });
  const listbox = await screen.findByRole("listbox");
  // An open Radix Select hides the rest of the page from the accessibility tree.
  const opened = screen.getByRole("combobox", { hidden: true, name: "Category for SHOP 0 1" });
  expect(opened.tagName).toBe("BUTTON");
  expect(opened.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getAllByRole("combobox", { hidden: true, expanded: true })).toHaveLength(1);
  await waitFor(() => expect(listbox.contains(document.activeElement)).toBe(true));

  // Escape closes the list and returns focus to the row's select.
  fireEvent.keyDown(listbox, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Category for SHOP 0 1" })));
});

test("the first groups paint at once and the rest arrive in later frames, with skeletons and a loading status until then", async () => {
  const frames = stubFrames();
  // Two rows a group keep the draw cheap; the batching doesn't depend on row count.
  vi.mocked(reviewGroups).mockResolvedValue(twenty(2));
  renderPage();
  await screen.findByRole("region", { name: "Category 100 (2)" });
  expect(groupRegions()).toHaveLength(3);
  expect(groupSkeletons()).toHaveLength(17);
  expect(screen.getByRole("status").textContent).toBe("Loading the review…");
  expect(groupRegions()[0].parentElement?.getAttribute("aria-busy")).toBe("true");

  frames.flush();
  expect(groupRegions()).toHaveLength(6);
  expect(groupSkeletons()).toHaveLength(14);

  // Selection works from the data, so rows in groups not drawn yet count; its message takes precedence.
  fireEvent.click(screen.getByRole("button", { name: "Select all like this (SHOP 0 1)" }));
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("1 selected.");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all in Category 103" }));
  expect(screen.getByText("3 selected")).toBeTruthy();

  while (frames.pending() > 0) frames.flush();
  expect(groupRegions()).toHaveLength(20);
  expect(groupSkeletons()).toHaveLength(0);
  expect(groupRegions()[0].parentElement?.getAttribute("aria-busy")).toBe("false");
});

test("a row's control waits for the categories before opening, keeping focus", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([dining]);
  let resolve: (value: Category[]) => void = () => {};
  vi.mocked(listCategories).mockReturnValue(new Promise((r) => (resolve = r)));
  renderPage();
  const control = await screen.findByRole("combobox", { name: "Category for Pizza night" });
  control.focus();
  fireEvent.click(control);
  expect(document.activeElement).toBe(control);
  expect(screen.queryByRole("listbox")).toBeNull();
  resolve([category(4, "Groceries"), category(5, "Dining out")]);
  const listbox = await screen.findByRole("listbox");
  await waitFor(() => expect(listbox.contains(document.activeElement)).toBe(true));
});

test("when the categories fail to load, a row's control stays put and focused, and Try again recovers", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([dining]);
  vi.mocked(listCategories).mockRejectedValue(invokeError);
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load categories")).toBeTruthy();
  const control = screen.getByRole("combobox", { name: "Category for Pizza night" });
  control.focus();
  fireEvent.click(control);
  await waitFor(() => expect(listCategories).toHaveBeenCalledTimes(2));
  // Let the second load fail and its error show before checking that no list opened.
  await expect(vi.mocked(listCategories).mock.results[1].value).rejects.toBe(invokeError);
  expect(within(await screen.findByRole("alert")).getByText("Couldn't load categories")).toBeTruthy();
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(control.isConnected).toBe(true);
  expect(document.activeElement).toBe(control);

  vi.mocked(listCategories).mockResolvedValue([category(4, "Groceries"), category(5, "Dining out")]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review" })));
  await pickIn("Category for Pizza night", "Groceries");
  expect(setTransactionCategory).toHaveBeenCalledWith({ transactionId: 92, categoryId: 4, note: null });
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

test("Select all like this is hidden at rest, reachable by keyboard and shown when focused", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  renderPage();
  const button = await screen.findByRole("button", { name: "Select all like this (Pizza night)" });
  // Visibility comes from CSS that jsdom doesn't apply, so check the reveal classes.
  expect(button.className.split(" ")).toEqual(
    expect.arrayContaining(["opacity-0", "group-hover/row:opacity-100", "group-focus-within/row:opacity-100", "focus-visible:opacity-100"]),
  );
  expect(button.closest("tr")?.classList.contains("group/row")).toBe(true);
  expect(button.tabIndex).toBe(0);
  expect(button.getAttribute("aria-hidden")).toBeNull();
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Select Pizza night" }).getAttribute("aria-checked")).toBe("true");
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
  client.removeQueries({ queryKey: CATEGORIES_KEY });
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
  await client.refetchQueries({ queryKey: REVIEW_GROUPS_KEY });
  expect(await screen.findByText("1 selected")).toBeTruthy();
  await pickIn(BAR_SELECT, "Dining out");
  await waitFor(() => expect(setTransactionsCategory).toHaveBeenCalledWith({ transactionIds: [60], categoryId: 5 }));
});

test("the loading status clears once the last group draws, and a refetch that adds groups leaves it clear", async () => {
  const frames = stubFrames();
  const more = Array.from({ length: 4 }, (_, i) => ({ categoryId: 200 + i, category: `Category ${200 + i}`, rows: many(2, 20000 + i * 2, 200 + i) }));
  vi.mocked(reviewGroups).mockResolvedValueOnce(twenty(2)).mockResolvedValue([...twenty(2), ...more]);
  const client = renderWithClient();
  await screen.findByRole("region", { name: "Category 100 (2)" });
  expect(screen.getByRole("status").textContent).toBe("Loading the review…");
  while (frames.pending() > 0) frames.flush();
  expect(groupRegions()).toHaveLength(20);
  expect(screen.getByRole("status").textContent).toBe("");

  await client.refetchQueries({ queryKey: REVIEW_GROUPS_KEY });
  // The new groups still draw in a later frame, but the status stays clear.
  await waitFor(() => expect(groupSkeletons().length).toBeGreaterThan(0));
  expect(screen.getByRole("status").textContent).toBe("");
  while (frames.pending() > 0) frames.flush();
  expect(screen.getByRole("region", { name: "Category 203 (2)" })).toBeTruthy();
  expect(groupSkeletons()).toHaveLength(0);
  expect(screen.getByRole("status").textContent).toBe("");
});

test("the categories Try again: a repeat failure shows the error again, and while retrying it is busy and a second press fetches once", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([dining]);
  vi.mocked(listCategories).mockRejectedValue(invokeError);
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load categories")).toBeTruthy();

  let fail: (error: unknown) => void = () => {};
  vi.mocked(listCategories).mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  const busy = await screen.findByRole("button", { name: "Trying again…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(busy);
  expect(listCategories).toHaveBeenCalledTimes(2);
  fail(invokeError);
  const again = await screen.findByRole("button", { name: "Try again" });
  expect(again.getAttribute("aria-disabled")).toBe("false");
  expect(within(screen.getByRole("alert")).getByText("Couldn't load categories")).toBeTruthy();
  expect(listCategories).toHaveBeenCalledTimes(2);
});

test("Looks good (all N) before Show more marks every row in the group reviewed, hidden rows included", async () => {
  const rows = many(60, 1000, 4);
  vi.mocked(reviewGroups).mockResolvedValue([{ categoryId: 4, category: "Groceries", rows }]);
  vi.mocked(markReviewed).mockResolvedValue(null);
  renderPage();
  const region = await screen.findByRole("region", { name: "Groceries (60)" });
  expect(within(region).getAllByRole("row")).toHaveLength(26);
  fireEvent.click(within(region).getByRole("button", { name: "Looks good (all 60)" }));
  await waitFor(() => expect(markReviewed).toHaveBeenCalledWith({ transactionIds: rows.map((r) => r.id) }));
  expect(markReviewed).toHaveBeenCalledTimes(1);
});
