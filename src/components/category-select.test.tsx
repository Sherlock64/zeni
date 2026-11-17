import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CategorySelect } from "@/components/category-select";
import { listCategories } from "@/lib/commands";
import type { Category } from "@/types/bindings/Category";
import type { CategorySelectProps } from "@/types/ui";

vi.mock("@/lib/commands", () => ({ listCategories: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

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
const categories = [category(1, "Housing"), category(4, "Groceries"), category(5, "Dining out")];

function renderSelect(props: Partial<CategorySelectProps> = {}) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CategorySelect value={null} onChange={onChange} aria-label="Category" {...props} />
    </QueryClientProvider>,
  );
  return onChange;
}

function openOptions() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Category" }), { key: "ArrowDown" });
  return within(screen.getByRole("listbox")).getAllByRole("option");
}

test("shows the selected category and lists the others in sort order", async () => {
  vi.mocked(listCategories).mockResolvedValue(categories);
  const onChange = renderSelect({ value: 4 });
  expect((await screen.findByRole("combobox", { name: "Category" })).textContent).toBe("Groceries");

  const options = openOptions();
  expect(options.map((option) => option.textContent)).toEqual(["Housing", "Groceries", "Dining out"]);
  fireEvent.click(options[2]);
  expect(onChange).toHaveBeenCalledWith(5);
});

test("offers the uncategorized option as null and leaves out the excluded category", async () => {
  vi.mocked(listCategories).mockResolvedValue(categories);
  const onChange = renderSelect({ uncategorizedLabel: "Leave uncategorized", excludeId: 1, value: 4 });
  await screen.findByRole("combobox", { name: "Category" });

  const options = openOptions();
  expect(options.map((option) => option.textContent)).toEqual(["Leave uncategorized", "Groceries", "Dining out"]);
  fireEvent.click(options[0]);
  expect(onChange).toHaveBeenCalledWith(null);
});

test("offers all categories first as undefined", async () => {
  vi.mocked(listCategories).mockResolvedValue(categories);
  const onChange = renderSelect({ allLabel: "All categories", uncategorizedLabel: "Uncategorized", value: undefined });
  expect((await screen.findByRole("combobox", { name: "Category" })).textContent).toBe("All categories");

  const options = openOptions();
  expect(options.map((option) => option.textContent)).toEqual(["All categories", "Uncategorized", "Housing", "Groceries", "Dining out"]);
  fireEvent.click(options[1]);
  expect(onChange).toHaveBeenCalledWith(null);
});

test("picking all categories gives undefined", async () => {
  vi.mocked(listCategories).mockResolvedValue(categories);
  const onChange = renderSelect({ allLabel: "All categories", uncategorizedLabel: "Uncategorized", value: null });
  expect((await screen.findByRole("combobox", { name: "Category" })).textContent).toBe("Uncategorized");
  fireEvent.click(openOptions()[0]);
  expect(onChange).toHaveBeenCalledWith(undefined);
});

test("shows the uncategorized label for a null value", async () => {
  vi.mocked(listCategories).mockResolvedValue(categories);
  renderSelect({ uncategorizedLabel: "Uncategorized", id: "category" });
  const trigger = await screen.findByRole("combobox", { name: "Category" });
  expect(trigger.textContent).toBe("Uncategorized");
  expect(trigger.id).toBe("category");
});

test("passes disabled through", async () => {
  vi.mocked(listCategories).mockResolvedValue(categories);
  renderSelect({ disabled: true });
  expect((await screen.findByRole("combobox", { name: "Category" })).hasAttribute("disabled")).toBe(true);
});

test("is disabled with a hint when there are no categories", async () => {
  vi.mocked(listCategories).mockResolvedValue([]);
  renderSelect();
  const trigger = await screen.findByRole("combobox", { name: "Category" });
  expect(trigger.textContent).toBe("No categories yet");
  expect(trigger.hasAttribute("disabled")).toBe(true);
});

test("shows a loading placeholder", () => {
  vi.mocked(listCategories).mockReturnValue(new Promise(() => {}));
  renderSelect();
  expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("shows the error when categories fail to load", async () => {
  vi.mocked(listCategories).mockRejectedValue({ kind: "Locked", message: "Unlock Zeni first." });
  renderSelect();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load categories")).toBeTruthy();
  expect(within(alert).getByText("Unlock Zeni first.")).toBeTruthy();
});
