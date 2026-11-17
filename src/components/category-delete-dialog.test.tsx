import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CategoryDeleteDialog } from "@/components/category-delete-dialog";
import { deleteCategory, listCategories } from "@/lib/commands";
import type { Category } from "@/types/bindings/Category";

vi.mock("@/lib/commands", () => ({ listCategories: vi.fn(), deleteCategory: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

// Radix Select needs these in jsdom.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = function () {};

const category = (id: number, name: string, rowCount = 0, nicknameCount = 0): Category => ({
  id,
  name,
  description: "",
  kind: "spending",
  sortOrder: id,
  rowCount,
  nicknameCount,
});
const housing = category(1, "Housing", 3, 1);
const groceries = category(2, "Groceries", 1, 0);
const dining = category(5, "Dining out");

function renderDialog(target: Category) {
  vi.mocked(listCategories).mockResolvedValue([housing, groceries, dining]);
  const onOpenChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CategoryDeleteDialog category={target} open onOpenChange={onOpenChange} onCloseAutoFocus={() => {}} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

test("a used category shows its counts and moves them to the picked replacement", async () => {
  vi.mocked(deleteCategory).mockResolvedValue(null);
  const onOpenChange = renderDialog(housing);
  const dialog = screen.getByRole("alertdialog", { name: "Delete Housing?" });
  expect(within(dialog).getByText("Housing is used by 3 transactions and 1 nickname.")).toBeTruthy();

  const select = await within(dialog).findByRole("combobox", { name: "Move them to" });
  expect(select.textContent).toBe("Leave uncategorized");
  fireEvent.keyDown(select, { key: "ArrowDown" });
  const options = within(screen.getByRole("listbox")).getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Leave uncategorized", "Groceries", "Dining out"]);
  fireEvent.click(options[2]);

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(deleteCategory).toHaveBeenCalledWith({ id: 1, replacementId: 5 }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("Leave uncategorized deletes with no replacement, and singular counts read right", async () => {
  vi.mocked(deleteCategory).mockResolvedValue(null);
  renderDialog(groceries);
  expect(screen.getByText("Groceries is used by 1 transaction and 0 nicknames.")).toBeTruthy();
  await screen.findByRole("combobox", { name: "Move them to" });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(deleteCategory).toHaveBeenCalledWith({ id: 2, replacementId: null }));
});

test("while deleting, Delete is busy and a repeat press does nothing", async () => {
  vi.mocked(deleteCategory).mockReturnValue(new Promise(() => {}));
  const onOpenChange = renderDialog(dining);
  expect(screen.queryByText("Move them to")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const busy = await screen.findByRole("button", { name: "Deleting…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(deleteCategory).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();
});

test("a failed delete shows the error in the dialog and keeps it open", async () => {
  vi.mocked(deleteCategory).mockRejectedValue({ kind: "Busy", message: "Wait for categorizing to finish." });
  const onOpenChange = renderDialog(dining);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const alert = await within(screen.getByRole("alertdialog")).findByRole("alert");
  expect(within(alert).getByText("Couldn't delete the category")).toBeTruthy();
  expect(within(alert).getByText("Wait for categorizing to finish.")).toBeTruthy();
  expect(onOpenChange).not.toHaveBeenCalled();
});
