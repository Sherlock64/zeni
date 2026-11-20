import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CategorizeDialog } from "@/components/categorize-dialog";
import { listCategories, setTransactionCategory } from "@/lib/commands";
import type { Category } from "@/types/bindings/Category";
import type { Transaction } from "@/types/bindings/Transaction";

vi.mock("@/lib/commands", () => ({ listCategories: vi.fn(), setTransactionCategory: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCategories).mockResolvedValue(categories);
});
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
const categories = [category(4, "Groceries"), category(5, "Dining out")];
const row: Transaction = {
  id: 7,
  importId: 1,
  postedDate: "2026-10-31",
  amountCents: -1850,
  description: "CORNER COFFEE",
  memo: null,
  transactionType: null,
  runningBalanceCents: null,
  nickname: "Coffee",
  categoryId: 5,
  category: "Dining out",
  setBy: "user",
  reviewed: true,
  note: "Team breakfast",
};

function renderDialog(transaction = row) {
  const onOpenChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CategorizeDialog transaction={transaction} open onOpenChange={onOpenChange} onCloseAutoFocus={() => {}} />
    </QueryClientProvider>,
  );
  return { onOpenChange, dialog: screen.getByRole("dialog", { name: "Categorize" }) };
}

async function pick(dialog: HTMLElement, name: string) {
  fireEvent.click(await within(dialog).findByRole("combobox", { name: "Category" }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

test("starts from the row's category and note and saves a new category", async () => {
  vi.mocked(setTransactionCategory).mockResolvedValue(null);
  const { dialog, onOpenChange } = renderDialog();
  expect(within(dialog).getByText(/^Coffee\./)).toBeTruthy();
  expect((within(dialog).getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Team breakfast");
  await pick(dialog, "Groceries");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(setTransactionCategory).toHaveBeenCalledWith({ transactionId: 7, categoryId: 4, note: "Team breakfast" });
});

test("clearing to Uncategorized keeps the note", async () => {
  vi.mocked(setTransactionCategory).mockResolvedValue(null);
  const { dialog, onOpenChange } = renderDialog();
  await pick(dialog, "Uncategorized");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(setTransactionCategory).toHaveBeenCalledWith({ transactionId: 7, categoryId: null, note: "Team breakfast" });
});

test("an uncategorized row starts on Uncategorized with an empty note", async () => {
  const { dialog } = renderDialog({ ...row, categoryId: null, category: null, setBy: null, note: null });
  expect((await within(dialog).findByRole("combobox", { name: "Category" })).textContent).toBe("Uncategorized");
  expect((within(dialog).getByLabelText("Note") as HTMLTextAreaElement).value).toBe("");
});

test("a note that's too long shows the error under the note, and editing clears it", async () => {
  vi.mocked(setTransactionCategory).mockRejectedValue({ kind: "Validation", message: "Use at most 500 characters." });
  const { dialog, onOpenChange } = renderDialog();
  const note = within(dialog).getByLabelText("Note");
  fireEvent.change(note, { target: { value: "x".repeat(501) } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  const error = await within(dialog).findByText("Use at most 500 characters.");
  expect(note.getAttribute("aria-invalid")).toBe("true");
  expect(note.getAttribute("aria-describedby")).toBe(error.id);
  expect(within(dialog).queryByText("Couldn't save the category")).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();

  fireEvent.change(note, { target: { value: "Short" } });
  expect(within(dialog).queryByText("Use at most 500 characters.")).toBeNull();
  expect(note.hasAttribute("aria-invalid")).toBe(false);
});

test("other save errors show in an alert in the dialog, which stays open", async () => {
  vi.mocked(setTransactionCategory).mockRejectedValue({ kind: "NotFound", message: "That category no longer exists." });
  const { dialog, onOpenChange } = renderDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  const alert = await within(dialog).findByRole("alert");
  expect(within(alert).getByText("Couldn't save the category")).toBeTruthy();
  expect(within(alert).getByText("That category no longer exists.")).toBeTruthy();
  expect(within(alert).getByText("Close this dialog and try again.")).toBeTruthy();
  expect(within(alert).queryByText(/Reload the page/)).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
});

test("a save that fails again shows the new error", async () => {
  vi.mocked(setTransactionCategory)
    .mockRejectedValueOnce({ kind: "NotFound", message: "That transaction no longer exists." })
    .mockRejectedValueOnce({ kind: "Locked", message: "Unlock Zeni first." });
  const { dialog } = renderDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByText("That transaction no longer exists.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByText("Unlock Zeni first.")).toBeTruthy();
  expect(within(dialog).queryByText("That transaction no longer exists.")).toBeNull();
  expect(within(dialog).queryByText("Close this dialog and try again.")).toBeNull();
});

test("while saving, Save and Cancel are busy, repeat presses are ignored and the dialog won't close", async () => {
  let resolve: (value: null) => void = () => {};
  vi.mocked(setTransactionCategory).mockReturnValue(new Promise((r) => (resolve = r)));
  const { dialog, onOpenChange } = renderDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  const saving = await within(dialog).findByRole("button", { name: "Saving…" });
  expect(saving.getAttribute("aria-disabled")).toBe("true");
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(saving);
  fireEvent.click(cancel);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(setTransactionCategory).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();

  resolve(null);
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("Cancel closes without saving", async () => {
  const { dialog, onOpenChange } = renderDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(setTransactionCategory).not.toHaveBeenCalled();
});

test("shows the category list's load error in the dialog", async () => {
  vi.mocked(listCategories).mockRejectedValue({ kind: "Locked", message: "Unlock Zeni first." });
  const { dialog } = renderDialog();
  const alert = await within(dialog).findByRole("alert");
  expect(within(alert).getByText("Couldn't load categories")).toBeTruthy();
});
