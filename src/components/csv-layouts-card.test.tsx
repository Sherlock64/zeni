import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CsvLayoutsCard } from "@/components/csv-layouts-card";
import { deleteCsvLayout, listCsvLayouts, updateCsvLayout } from "@/lib/commands";
import type { CsvLayout } from "@/types/bindings/CsvLayout";

vi.mock("@/lib/commands", () => ({
  listCsvLayouts: vi.fn(),
  updateCsvLayout: vi.fn(),
  deleteCsvLayout: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

// jsdom lacks ResizeObserver, which the mapping form's radio group uses.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// Radix Select calls these, which jsdom lacks.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

// Opens a mapping Select by keyboard and picks an option, as Radix supports in jsdom.
function choose(dialog: HTMLElement, field: string, option: string) {
  fireEvent.keyDown(within(dialog).getByRole("combobox", { name: field }), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("option", { name: option }), { key: "Enter" });
}

const bank: CsvLayout = {
  id: 1,
  name: "Example Bank",
  headers: ["posting date", "amount", "description", "balance", "extended description"],
  mapping: {
    dateFormat: "MM/DD/YYYY",
    postedDate: 0,
    description: 2,
    amount: { kind: "signed", column: 1 },
    transactionId: null,
    memo: null,
    transactionType: null,
    runningBalance: 3,
    postingStatus: null,
    bankCategory: null,
  },
};
const card: CsvLayout = {
  ...bank,
  id: 2,
  name: "Sample card",
  headers: ["date", "description", "debit", "credit"],
  mapping: { ...bank.mapping, dateFormat: "YYYY-MM-DD", description: 1, amount: { kind: "split", debit: 2, credit: 3 }, runningBalance: null },
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CsvLayoutsCard />
    </QueryClientProvider>,
  );
  return vi.spyOn(client, "invalidateQueries");
}

async function openEdit() {
  vi.mocked(listCsvLayouts).mockResolvedValue([bank, card]);
  const invalidate = renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Edit Example Bank" }));
  return { invalidate, dialog: screen.getByRole("dialog", { name: "Edit Example Bank" }) };
}

test("lists each layout with a mapping summary", async () => {
  vi.mocked(listCsvLayouts).mockResolvedValue([bank, card]);
  renderCard();
  expect(screen.getByRole("status").textContent).toBe("Loading saved layouts…");
  expect(await screen.findByText("Example Bank")).toBeTruthy();
  screen.getByText("Date in posting date (MM/DD/YYYY), amount in amount, description in description");
  screen.getByText("Date in date (YYYY-MM-DD), debit in debit, credit in credit, description in description");
  expect(screen.getByRole("status").textContent).toBe("");
});

test("shows the empty state", async () => {
  vi.mocked(listCsvLayouts).mockResolvedValue([]);
  renderCard();
  expect(await screen.findByText("No saved layouts yet")).toBeTruthy();
  screen.getByText("Importing a CSV file saves its layout.");
});

test("shows a load error and retries", async () => {
  let resolve: (layouts: CsvLayout[]) => void = () => {};
  vi.mocked(listCsvLayouts)
    .mockRejectedValueOnce({ kind: "Database", message: "disk gone" })
    .mockReturnValueOnce(new Promise((r) => (resolve = r)));
  renderCard();
  expect(await screen.findByText("Couldn't load saved layouts")).toBeTruthy();
  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  // The error and the button stay while the retry runs, so focus isn't lost.
  await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Retrying…"));
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(retry.isConnected).toBe(true);
  fireEvent.click(retry);
  expect(listCsvLayouts).toHaveBeenCalledTimes(2);
  resolve([bank]);
  expect(await screen.findByText("Example Bank")).toBeTruthy();
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "CSV layouts" })));
});

test("edit saves the name and existing mapping, once while busy, then closes and refetches", async () => {
  let resolve: (layout: CsvLayout) => void = () => {};
  vi.mocked(updateCsvLayout).mockReturnValue(new Promise((r) => (resolve = r)));
  const { invalidate, dialog } = await openEdit();
  const name = within(dialog).getByRole("textbox", { name: "Layout name" }) as HTMLInputElement;
  expect(name.value).toBe("Example Bank");
  expect(name.getAttribute("aria-required")).toBe("true");
  fireEvent.change(name, { target: { value: "  My bank  " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save layout" }));
  const busy = await within(dialog).findByRole("button", { name: "Saving…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(updateCsvLayout).toHaveBeenCalledTimes(1);
  expect(vi.mocked(updateCsvLayout).mock.calls[0][0]).toEqual({ layoutId: 1, name: "My bank", mapping: bank.mapping });
  resolve({ ...bank, name: "My bank" });
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["list_csv_layouts"] });  expect(screen.getByRole("status").textContent).toBe("Saved layout My bank.");
});

test("edit saves changed columns, a cleared optional column and a new date format", async () => {
  vi.mocked(updateCsvLayout).mockResolvedValue(bank);
  const { dialog } = await openEdit();
  choose(dialog, "Description", "extended description");
  choose(dialog, "Running balance", "Not mapped");
  choose(dialog, "Date format", "YYYY-MM-DD");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save layout" }));
  await vi.waitFor(() => expect(updateCsvLayout).toHaveBeenCalledTimes(1));
  expect(vi.mocked(updateCsvLayout).mock.calls[0][0]).toEqual({
    layoutId: 1,
    name: "Example Bank",
    mapping: { ...bank.mapping, dateFormat: "YYYY-MM-DD", description: 4, runningBalance: null },
  });
});

test("a failed submit focuses the first invalid field in form order", async () => {
  const { dialog } = await openEdit();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Debit and credit columns" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save layout" }));
  await vi.waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("combobox", { name: "Debit column" })));

  fireEvent.change(within(dialog).getByRole("textbox", { name: "Layout name" }), { target: { value: "" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save layout" }));
  await vi.waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: "Layout name" })));
  expect(updateCsvLayout).not.toHaveBeenCalled();
});

test("edit with an empty name shows a field error and calls nothing", async () => {
  const { dialog } = await openEdit();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Layout name" }), { target: { value: " " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save layout" }));
  expect(await within(dialog).findByText("Enter a layout name.")).toBeTruthy();
  expect(updateCsvLayout).not.toHaveBeenCalled();
});

test("an update error stays in the edit dialog", async () => {
  vi.mocked(updateCsvLayout).mockRejectedValue({ kind: "Validation", message: "Choose a different column for each role." });
  const { dialog } = await openEdit();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save layout" }));
  expect(await within(dialog).findByText("Couldn't save the layout")).toBeTruthy();
  within(dialog).getByText("Nothing was saved. Check the name and the chosen columns, then try again.");
  expect(screen.getByRole("dialog")).toBe(dialog);

  // Editing a field clears the stale error.
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Layout name" }), { target: { value: "Renamed" } });
  expect(within(dialog).queryByText("Couldn't save the layout")).toBeNull();
});

test("cancelling edit saves nothing and returns focus to its Edit button", async () => {
  const { invalidate, dialog } = await openEdit();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Layout name" }), { target: { value: "Changed" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(updateCsvLayout).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  screen.getByText("Example Bank");
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Example Bank" })));
});

test("delete confirms that imported transactions stay, deletes once while busy, then refetches", async () => {
  let resolve: (value: null) => void = () => {};
  vi.mocked(deleteCsvLayout).mockReturnValue(new Promise((r) => (resolve = r)));
  vi.mocked(listCsvLayouts).mockResolvedValue([bank, card]);
  const invalidate = renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Delete Sample card" }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete this layout?" });
  within(dialog).getByText(/Transactions you imported with it stay as they are/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete layout" }));
  const busy = await within(dialog).findByRole("button", { name: "Deleting…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(deleteCsvLayout).toHaveBeenCalledTimes(1);
  expect(vi.mocked(deleteCsvLayout).mock.calls[0][0]).toEqual({ layoutId: 2 });
  resolve(null);
  await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["list_csv_layouts"] });
  expect(screen.getByRole("status").textContent).toBe("Deleted layout Sample card.");
  // The deleted row's buttons are going away, so focus lands on the card heading.
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "CSV layouts" })));
});

test("a failed delete keeps the dialog open with the error and changes nothing", async () => {
  vi.mocked(deleteCsvLayout).mockRejectedValue({ kind: "NotFound", message: "No layout with that id." });
  vi.mocked(listCsvLayouts).mockResolvedValue([bank]);
  const invalidate = renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Delete Example Bank" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete layout" }));
  expect(await within(dialog).findByText("Couldn't delete the layout")).toBeTruthy();
  expect(screen.getByRole("alertdialog")).toBe(dialog);
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.queryByText(/Deleted layout/)).toBeNull();
});

test("cancelling delete calls nothing", async () => {
  vi.mocked(listCsvLayouts).mockResolvedValue([bank]);
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Delete Example Bank" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
  await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(deleteCsvLayout).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Example Bank" })));
});
