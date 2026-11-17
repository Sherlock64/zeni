import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listCategories, markReviewed, reviewGroups, setTransactionCategory } from "@/lib/commands";
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <main>
        <ReviewPage />
      </main>
    </QueryClientProvider>,
  );
  return invalidate;
}

const group = (name: string) => screen.getByRole("region", { name });
const expectRefreshed = (invalidate: ReturnType<typeof renderPage>) =>
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
    ["review_groups"],
    ["unreviewed_count"],
    ["list_transactions"],
  ]);

test("shows each group open with its rows: date, nickname or description, amount and category", async () => {
  vi.mocked(reviewGroups).mockResolvedValue([groceries, dining]);
  renderPage();
  const grocery = await screen.findByRole("region", { name: "Groceries (2)" });
  expect(within(grocery).getByRole("button", { name: "Groceries (2)" }).getAttribute("aria-expanded")).toBe("true");
  const cells = within(grocery)
    .getAllByRole("row")
    .slice(1)
    .map((tr) => within(tr).getAllByRole("cell").slice(0, 3).map((cell) => cell.textContent));
  expect(cells).toEqual([
    [formatDate("2026-10-29"), "GREENLEAF MARKET #42", formatCents(-8642)],
    [formatDate("2026-10-12"), "FRESH MART #12", formatCents(1525)],
  ]);
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
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review" }));
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
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dining out (1)" }));
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
