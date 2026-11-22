import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { addCategory, deleteCategory, jobStatus, listCategories, reorderCategories, updateCategory } from "@/lib/commands";
import { JOB_STATUS_KEY, LEDGER_KEY } from "@/lib/query-keys";
import { CategoriesPage } from "@/pages/categories";
import type { Category } from "@/types/bindings/Category";

vi.mock("@/lib/commands", () => ({
  listCategories: vi.fn(),
  addCategory: vi.fn(),
  updateCategory: vi.fn(),
  reorderCategories: vi.fn(),
  deleteCategory: vi.fn(),
  jobStatus: vi.fn(),
}));

// jsdom lacks ResizeObserver, which the radio groups use.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom has no layout; give each row a box by its position, so the keyboard sensor can find its neighbours.
Element.prototype.getBoundingClientRect = function () {
  const row = (this as HTMLElement).closest<HTMLElement>("[data-sort-index]");
  const top = row ? Number(row.dataset.sortIndex) * 50 : 0;
  return { x: 0, y: top, top, left: 0, width: 400, height: 40, right: 400, bottom: top + 40, toJSON() {} } as DOMRect;
};

const category = (id: number, name: string, extra: Partial<Category> = {}): Category => ({
  id,
  name,
  description: `${name} things`,
  kind: "spending",
  sortOrder: id,
  rowCount: 0,
  nicknameCount: 0,
  ...extra,
});
const housing = category(1, "Housing", { rowCount: 3, nicknameCount: 1 });
const groceries = category(2, "Groceries");
const paycheck = category(3, "Paycheck", { kind: "income" });
const idle = { running: null, last: null };
const invokeError = { kind: "Invoke", message: "not running in Tauri" } as const;
const never = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCategories).mockResolvedValue([housing, groceries, paycheck]);
  vi.mocked(jobStatus).mockResolvedValue(idle);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <main>
        <CategoriesPage />
      </main>
    </QueryClientProvider>,
  );
  return { invalidate, client };
}

const rows = () => within(screen.getByRole("list", { name: "Categories" })).getAllByRole("listitem");

test("lists each category with its kind and description", async () => {
  renderPage();
  await screen.findByText("Housing");
  expect(rows().map((row) => row.textContent)).toEqual([
    "HousingSpendingHousing things",
    "GroceriesSpendingGroceries things",
    "PaycheckIncomePaycheck things",
  ]);
  expect(screen.getByRole("button", { name: "Move Groceries, position 2 of 3" })).toBeTruthy();
  expect(screen.getByText("A clear description helps the model pick this category.")).toBeTruthy();
});

test("shows a skeleton while loading, then the empty state", async () => {
  let resolve: (value: Category[]) => void = () => {};
  vi.mocked(listCategories).mockReturnValue(new Promise((r) => (resolve = r)));
  renderPage();
  expect(screen.getByText("Loading categories…")).toBeTruthy();
  await act(async () => resolve([]));
  expect(await screen.findByText("No categories yet.")).toBeTruthy();
});

test("a load error offers a retry, which keeps the error if it fails again", async () => {
  vi.mocked(listCategories).mockRejectedValue(invokeError);
  renderPage();
  expect(await screen.findByText("Couldn't load categories")).toBeTruthy();
  vi.mocked(listCategories).mockReturnValueOnce(never());
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  const busy = await screen.findByRole("button", { name: "Trying again…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("Couldn't load categories")).toBeTruthy();
});

test("a retry that fails again still shows the error", async () => {
  vi.mocked(listCategories).mockRejectedValue(invokeError);
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: "Try again" });
  expect(screen.getByText("Couldn't load categories")).toBeTruthy();
  expect(listCategories).toHaveBeenCalledTimes(2);
});

test("a retry that succeeds shows the list and focuses the heading", async () => {
  vi.mocked(listCategories).mockRejectedValueOnce(invokeError);
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await screen.findByText("Housing");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
});

test("adds a category, shows Saved. and refreshes the list", async () => {
  let resolve: (value: Category) => void = () => {};
  vi.mocked(addCategory).mockReturnValue(new Promise((r) => (resolve = r)));
  const { invalidate } = renderPage();
  await screen.findByText("Housing");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pets" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Vet and food" } });
  fireEvent.click(screen.getByRole("radio", { name: "Transfer" }));
  fireEvent.click(screen.getByRole("button", { name: "Add category" }));
  const busy = await screen.findByRole("button", { name: "Saving…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(addCategory).toHaveBeenCalledTimes(1);
  expect(addCategory).toHaveBeenCalledWith({ name: "Pets", description: "Vet and food", kind: "transfer" });
  await act(async () => resolve(category(4, "Pets")));
  expect(await screen.findByText("Saved.")).toBeTruthy();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: LEDGER_KEY });
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
});

test.each([
  ["Enter a category name.", "Name"],
  ["Use at most 40 characters.", "Name"],
  ["A category named Housing already exists.", "Name"],
  ["Use at most 200 characters.", "Description"],
])("shows %s under the %s field", async (message, label) => {
  vi.mocked(addCategory).mockRejectedValue({ kind: "Validation", message });
  renderPage();
  await screen.findByText("Housing");
  fireEvent.click(screen.getByRole("button", { name: "Add category" }));
  const input = screen.getByLabelText(label);
  await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
  expect(screen.getByText(message).id).toBe(input.getAttribute("aria-describedby"));
  expect(document.activeElement).toBe(input);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("other save errors show in an alert", async () => {
  vi.mocked(addCategory).mockRejectedValue({ kind: "Busy", message: "Wait for categorizing to finish." });
  renderPage();
  await screen.findByText("Housing");
  fireEvent.click(screen.getByRole("button", { name: "Add category" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the category")).toBeTruthy();
  expect(within(alert).getByText("Wait for categorizing to finish.")).toBeTruthy();
});

test("a Validation error about no field shows in the alert and keeps the entries", async () => {
  vi.mocked(addCategory).mockRejectedValue({ kind: "Validation", message: "Pick a kind." });
  renderPage();
  await screen.findByText("Housing");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pets" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Vet and food" } });
  fireEvent.click(screen.getByRole("radio", { name: "Income" }));
  fireEvent.click(screen.getByRole("button", { name: "Add category" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the category")).toBeTruthy();
  expect(within(alert).getByText("Pick a kind.")).toBeTruthy();
  expect(within(alert).getByText("Nothing was saved. Check your entries, then save again.")).toBeTruthy();
  expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).not.toBe("true");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Pets");
  expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Vet and food");
  expect(screen.getByRole("radio", { name: "Income" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("button", { name: "Add category" })).toBeTruthy();
});

test("edits a category, then goes back to adding and focuses its Edit button", async () => {
  vi.mocked(updateCategory).mockResolvedValue({ ...groceries, name: "Food" });
  renderPage();
  const edit = await screen.findByRole("button", { name: "Edit Groceries" });
  fireEvent.click(edit);
  expect(screen.getByRole("heading", { name: "Edit Groceries" })).toBeTruthy();
  const name = screen.getByLabelText("Name") as HTMLInputElement;
  expect(name.value).toBe("Groceries");
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: "Food" } });
  fireEvent.click(screen.getByRole("radio", { name: "Income" }));
  fireEvent.click(screen.getByRole("button", { name: "Save category" }));
  await screen.findByText("Saved.");
  expect(updateCategory).toHaveBeenCalledWith({ id: 2, name: "Food", description: "Groceries things", kind: "income" });
  expect(screen.getByRole("heading", { name: "Add a category" })).toBeTruthy();
  expect(name.value).toBe("");
  expect(document.activeElement).toBe(edit);
});

test("Cancel while editing clears the form and returns focus", async () => {
  renderPage();
  const edit = await screen.findByRole("button", { name: "Edit Housing" });
  fireEvent.click(edit);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "Add a category" })).toBeTruthy();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  expect(document.activeElement).toBe(edit);
});

// The keyboard sensor starts listening on a timeout after the pick-up key.
const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function moveFirstDownByKeyboard() {
  const handle = await screen.findByRole("button", { name: "Move Housing, position 1 of 3" });
  handle.focus();
  fireEvent.keyDown(handle, { code: "Space" });
  await tick();
  fireEvent.keyDown(handle, { code: "ArrowDown" });
  await tick();
  fireEvent.keyDown(handle, { code: "Space" });
  await tick();
}

test("reorders by keyboard, saves the order and announces the move", async () => {
  vi.mocked(reorderCategories).mockResolvedValue([groceries, housing, paycheck]);
  renderPage();
  await screen.findByText("Housing");
  vi.mocked(listCategories).mockResolvedValue([groceries, housing, paycheck]);
  await moveFirstDownByKeyboard();
  expect(reorderCategories).toHaveBeenCalledWith({ ids: [2, 1, 3] });
  await waitFor(() => expect(rows()[0].textContent).toContain("Groceries"));
  expect(screen.getAllByText("Moved Housing to position 2 of 3.").length).toBeGreaterThan(0);
});

test("a failed reorder puts the order back and says so", async () => {
  vi.mocked(reorderCategories).mockRejectedValue(invokeError);
  renderPage();
  await moveFirstDownByKeyboard();
  expect(await screen.findByText("Couldn't save the order. Try again.")).toBeTruthy();
  await waitFor(() => expect(rows()[0].textContent).toContain("Housing"));
});

test("dismissing the reorder error moves focus to the list", async () => {
  vi.mocked(reorderCategories).mockRejectedValue(invokeError);
  renderPage();
  await moveFirstDownByKeyboard();
  await screen.findByText("Couldn't save the order. Try again.");
  const dismiss = screen.getByRole("button", { name: "Dismiss error" });
  dismiss.focus();
  fireEvent.click(dismiss);
  await waitFor(() => expect(screen.queryByText("Couldn't save the order. Try again.")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("list", { name: "Categories" }));
});

test("deleting an unused category asks to confirm, then deletes it", async () => {
  vi.mocked(deleteCategory).mockResolvedValue(null);
  const { invalidate } = renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Delete Groceries" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete Groceries?" });
  expect(within(dialog).queryByText("Move them to")).toBeNull();
  vi.mocked(listCategories).mockResolvedValue([housing, paycheck]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(deleteCategory).toHaveBeenCalledWith({ id: 2, replacementId: null });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: LEDGER_KEY });
  await waitFor(() => expect(screen.queryByText("Groceries")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
});

test("cancelling a delete returns focus to its button", async () => {
  renderPage();
  const remove = await screen.findByRole("button", { name: "Delete Groceries" });
  fireEvent.click(remove);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(remove);
  expect(deleteCategory).not.toHaveBeenCalled();
});

test("during a categorize run every edit control is disabled and says why", async () => {
  vi.mocked(jobStatus).mockResolvedValue({
    running: { kind: "categorizeNow", label: "Categorize now", done: 1, total: 9 },
    last: null,
  });
  renderPage();
  const notice = await screen.findByText(/^Wait for categorizing to finish\./);
  await screen.findByText("Housing");
  const controls = [
    screen.getByRole("button", { name: "Add category" }),
    screen.getByRole("button", { name: "Edit Housing" }),
    screen.getByRole("button", { name: "Delete Housing" }),
    screen.getByRole("button", { name: "Move Housing, position 1 of 3" }),
  ];
  for (const control of controls) {
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.getAttribute("aria-describedby")).toContain(notice.id);
  }
  expect((screen.getByLabelText("Name") as HTMLInputElement).readOnly).toBe(true);
  expect(screen.getByRole("radio", { name: "Income" }).hasAttribute("disabled")).toBe(true);

  for (const control of controls.slice(0, 3)) fireEvent.click(control);
  expect(addCategory).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByRole("heading", { name: "Add a category" })).toBeTruthy();
  await moveFirstDownByKeyboard();
  expect(reorderCategories).not.toHaveBeenCalled();
});

test("a download does not lock the categories", async () => {
  vi.mocked(jobStatus).mockResolvedValue({
    running: { kind: "download", label: "Download phi4-mini", done: 1, total: 9 },
    last: null,
  });
  const { client } = renderPage();
  await screen.findByText("Housing");
  // A running download shows nothing here, so wait for the job status itself to settle.
  await waitFor(() => expect(client.getQueryState(JOB_STATUS_KEY)?.status).toBe("success"));
  expect(screen.queryByText(/^Wait for categorizing to finish\./)).toBeNull();
  expect(screen.getByRole("button", { name: "Edit Housing" }).getAttribute("aria-disabled")).toBe("false");
});
