import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RenameDialog } from "@/components/rename-dialog";
import { countRuleMatches, listCategories, listNicknames, saveNicknameRule, updateNickname } from "@/lib/commands";
import type { Category } from "@/types/bindings/Category";
import type { Nickname } from "@/types/bindings/Nickname";
import type { Transaction } from "@/types/bindings/Transaction";
import { LEDGER_KEY } from "@/lib/query-keys";

vi.mock("@/lib/commands", () => ({
  listNicknames: vi.fn(),
  listCategories: vi.fn(),
  saveNicknameRule: vi.fn(),
  updateNickname: vi.fn(),
  countRuleMatches: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listCategories).mockResolvedValue(categories);
  vi.mocked(listNicknames).mockResolvedValue([]);
  vi.mocked(countRuleMatches).mockResolvedValue(12);
});

// jsdom lacks ResizeObserver, which the radio groups use.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
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
const categories = [category(1, "Housing"), category(4, "Groceries")];
const row: Transaction = {
  id: 7,
  importId: 1,
  postedDate: "2026-10-31",
  amountCents: -1850,
  description: "  CORNER COFFEE  ",
  memo: null,
  transactionType: null,
  runningBalanceCents: null,
  nickname: null,
  categoryId: null,
  category: null,
  setBy: null,
  reviewed: false,
  note: null,
};
const coffee: Nickname = {
  id: 3,
  name: "Coffee",
  enabled: true,
  staleExempt: false,
  matchCount: 2,
  lastMatched: "2026-10-30",
  stale: false,
  rules: [],
  defaultCategoryId: null,
};

function renderDialog(transaction: Transaction = row) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RenameDialog transaction={transaction} open onOpenChange={onOpenChange} onCloseAutoFocus={() => {}} />
    </QueryClientProvider>,
  );
  return { onOpenChange, invalidate, dialog: screen.getByRole("dialog", { name: "What's its nickname?" }) };
}

// Save waits for the nickname list, which holds the default category to keep.
Element.prototype.scrollIntoView = function () {};
const listLoaded = () =>
  waitFor(() => expect(screen.getByRole("button", { name: "Save nickname" }).getAttribute("aria-disabled")).toBe("false"));
// Radix Select opens on ArrowDown; returns the named option of the Default category picker.
function defaultOption(name: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Default category" }), { key: "ArrowDown" });
  return within(screen.getByRole("listbox")).getByRole("option", { name });
}
const expand = () => fireEvent.click(screen.getByRole("button", { name: "Match options" }));
const typeName = (value: string) => fireEvent.change(screen.getByLabelText("Nickname"), { target: { value } });
const typePattern = (value: string) => fireEvent.change(screen.getByLabelText("Pattern"), { target: { value } });
const exact = { mode: "exact", field: "description", pattern: "CORNER COFFEE" };

test("prefills an exact description rule behind a collapsed expander", async () => {
  renderDialog();
  expect((screen.getByLabelText("Nickname") as HTMLInputElement).value).toBe("");
  const toggle = screen.getByRole("button", { name: "Match options" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByLabelText("Pattern")).toBeNull();
  // The prefilled rule's count shows while the expander is collapsed.
  expect(screen.getByText("Counting matches…")).toBeTruthy();
  expect(await screen.findByText("Matches 12 transactions")).toBeTruthy();
  expect(countRuleMatches).toHaveBeenCalledWith(exact);

  expand();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("radio", { name: "Exact" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "Description" }).getAttribute("aria-checked")).toBe("true");
  expect((screen.getByLabelText("Pattern") as HTMLInputElement).value).toBe("CORNER COFFEE");
  expect(screen.getByText("Matches 12 transactions")).toBeTruthy();
});

test("the live count follows rule changes, singular for one and allowing zero", async () => {
  renderDialog();
  expand();
  expect(await screen.findByText("Matches 12 transactions")).toBeTruthy();

  vi.mocked(countRuleMatches).mockResolvedValue(1);
  fireEvent.click(screen.getByRole("radio", { name: "Contains" }));
  expect(await screen.findByText("Matches 1 transaction")).toBeTruthy();
  expect(countRuleMatches).toHaveBeenLastCalledWith({ ...exact, mode: "contains" });

  vi.mocked(countRuleMatches).mockResolvedValue(0);
  fireEvent.click(screen.getByRole("radio", { name: "Memo" }));
  expect(await screen.findByText("Matches 0 transactions")).toBeTruthy();
  expect(countRuleMatches).toHaveBeenLastCalledWith({ ...exact, mode: "contains", field: "memo" });
});

test("an invalid regex shows inline on the pattern field and hides the count", async () => {
  renderDialog();
  expand();
  expect(await screen.findByText("Matches 12 transactions")).toBeTruthy();
  vi.mocked(countRuleMatches).mockRejectedValue({ kind: "Validation", message: "That regex isn't valid: unclosed group" });
  fireEvent.click(screen.getByRole("radio", { name: "Regex" }));
  typePattern("(coffee");

  expect(await screen.findByText("That regex isn't valid: unclosed group")).toBeTruthy();
  expect(screen.getByLabelText("Pattern").getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText(/^Matches/)).toBeNull();
  // Save stays available; the backend rejects the rule.
  expect(screen.getByRole("button", { name: "Save nickname" }).getAttribute("aria-disabled")).toBe("false");
});

test("a count failure other than validation shows an error alert", async () => {
  vi.mocked(countRuleMatches).mockRejectedValue({ kind: "Locked", message: "Unlock Zeni first." });
  renderDialog();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't count matches")).toBeTruthy();
  expect(within(alert).getByText("Unlock Zeni first.")).toBeTruthy();
  expect(screen.queryByText(/^Matches/)).toBeNull();
  expand();
  expect(screen.getByLabelText("Pattern").hasAttribute("aria-invalid")).toBe(false);
});

test("hints that typing an existing nickname's name adds the rule to it", async () => {
  vi.mocked(listNicknames).mockResolvedValue([coffee]);
  renderDialog();
  typeName("coffee ");
  const hint = await screen.findByText("Adds this rule to Coffee.");
  expect(hint.getAttribute("aria-live")).toBe("polite");
  typeName("Coffee shop");
  expect(screen.queryByText(/Adds this rule/)).toBeNull();
});

test("saves the rule, refreshes the lists and closes", async () => {
  vi.mocked(saveNicknameRule).mockResolvedValue(coffee);
  const { onOpenChange, invalidate } = renderDialog();
  typeName("Coffee");
  await listLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(vi.mocked(saveNicknameRule).mock.calls[0][0]).toEqual({ name: "Coffee", rule: exact });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: LEDGER_KEY });
});

test("ignores repeat presses and closing while saving", async () => {
  vi.mocked(saveNicknameRule).mockReturnValue(new Promise(() => {}));
  const { onOpenChange, dialog } = renderDialog();
  typeName("Coffee");
  await listLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

  const saving = await screen.findByRole("button", { name: "Saving…" });
  expect(saving.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(saving);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(saveNicknameRule).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();
});

test("Cancel closes without saving", () => {
  const { onOpenChange } = renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(saveNicknameRule).not.toHaveBeenCalled();
});

test("a name error shows on the name field and clears on typing", async () => {
  vi.mocked(saveNicknameRule).mockRejectedValue({ kind: "Validation", message: "Enter a nickname." });
  const { onOpenChange } = renderDialog();
  await listLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

  expect(await screen.findByText("Enter a nickname.")).toBeTruthy();
  const name = screen.getByLabelText("Nickname");
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(name);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();

  typeName("Coffee");
  expect(screen.queryByText("Enter a nickname.")).toBeNull();
});

test("a pattern error from saving opens the expander and shows on the pattern field", async () => {
  vi.mocked(saveNicknameRule).mockRejectedValue({ kind: "Validation", message: "Patterns can be at most 500 characters." });
  renderDialog();
  typeName("Coffee");
  await listLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

  expect(await screen.findByText("Patterns can be at most 500 characters.")).toBeTruthy();
  const pattern = screen.getByLabelText("Pattern");
  expect(pattern.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(pattern);
});

test("any other save error shows an alert and keeps the dialog open", async () => {
  vi.mocked(saveNicknameRule).mockRejectedValue({ kind: "Validation", message: "That nickname already has this rule." });
  const { onOpenChange } = renderDialog();
  typeName("Coffee");
  await listLoaded();
  fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the nickname")).toBeTruthy();
  expect(within(alert).getByText("That nickname already has this rule.")).toBeTruthy();
  expect(screen.getByLabelText("Nickname").hasAttribute("aria-invalid")).toBe(false);
  expect(onOpenChange).not.toHaveBeenCalled();
});

describe("on a row that already has a nickname", () => {
  const named: Transaction = { ...row, nickname: "Coffee" };
  beforeEach(() => {
    vi.mocked(listNicknames).mockResolvedValue([coffee]);
  });

  test("prefills the current name and warns that a new name renames the whole nickname", async () => {
    renderDialog(named);
    expect((screen.getByLabelText("Nickname") as HTMLInputElement).value).toBe("Coffee");
    expect(
      screen.getByText(
        /This row is shown as “Coffee”\. A new name renames Coffee on every transaction its rules match\. To name only transactions like this one, change the match options\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/The rule starts as an exact match/)).toBeNull();
    expect(screen.queryByText(/Adds this rule/)).toBeNull();
    // A changed rule is a new rule again.
    expand();
    fireEvent.click(screen.getByRole("radio", { name: "Contains" }));
    // The description says how the rule starts; only the note says how the row is shown.
    expect(screen.getByText(/the bank's text on every transaction the rule matches\. The rule starts as an exact match on “CORNER COFFEE”\.$/)).toBeTruthy();
    expect(screen.getAllByText(/shown as “Coffee”/)).toHaveLength(1);
    expect(screen.getByText("This row is shown as “Coffee”. Its rule may still win over this one.")).toBeTruthy();
  });

  test("Save waits while the nicknames are loading", async () => {
    vi.mocked(listNicknames).mockReturnValue(new Promise(() => {}));
    renderDialog(named);
    typeName("Tea");
    const save = screen.getByRole("button", { name: "Save nickname" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(updateNickname).not.toHaveBeenCalled();
    expect(saveNicknameRule).not.toHaveBeenCalled();
  });

  test("a nickname list failure blocks Save until a retry loads it, and never adds a rule instead", async () => {
    vi.mocked(listNicknames).mockRejectedValue({ kind: "Locked", message: "Unlock Zeni first." });
    renderDialog(named);
    typeName("Tea");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't load your nicknames")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save nickname" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(saveNicknameRule).not.toHaveBeenCalled();
    expect(updateNickname).not.toHaveBeenCalled();

    // A retry that fails again keeps the alert and the button, which is busy while the retry runs.
    let rejectRetry: (error: unknown) => void = () => {};
    vi.mocked(listNicknames).mockReturnValueOnce(new Promise((_, reject) => (rejectRetry = reject)));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Trying again…" }).getAttribute("aria-disabled")).toBe("true"),
    );
    expect(screen.getByText("Couldn't load your nicknames")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trying again…" }));
    expect(listNicknames).toHaveBeenCalledTimes(2);
    rejectRetry({ kind: "Locked", message: "Unlock Zeni first." });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" }).getAttribute("aria-disabled")).toBe("false"),
    );
    expect(screen.getByText("Couldn't load your nicknames")).toBeTruthy();

    vi.mocked(listNicknames).mockResolvedValue([coffee]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Couldn't load your nicknames")).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText("Nickname"));
    expect(screen.getByRole("button", { name: "Save nickname" }).getAttribute("aria-disabled")).toBe("false");
  });

  test("a changed rule saves when the nickname list failed only once a default category is picked", async () => {
    vi.mocked(listNicknames).mockRejectedValue({ kind: "Locked", message: "Unlock Zeni first." });
    vi.mocked(saveNicknameRule).mockResolvedValue(coffee);
    const { onOpenChange } = renderDialog(named);
    await screen.findByText("Couldn't load your nicknames");
    expand();
    fireEvent.click(screen.getByRole("radio", { name: "Contains" }));
    // Without the list Zeni can't tell which default to keep, so saving would clear it.
    expect(screen.getByText("Zeni needs them to keep the nickname's default category. Try again, or pick a default category.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    expect(saveNicknameRule).not.toHaveBeenCalled();

    fireEvent.click(defaultOption("Groceries"));
    expect(screen.queryByText("Couldn't load your nicknames")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(saveNicknameRule).mock.calls[0][0]).toEqual({
      name: "Coffee",
      rule: { ...exact, mode: "contains" },
      defaultCategoryId: 4,
    });
    expect(updateNickname).not.toHaveBeenCalled();
  });

  test("a new name for a nickname that no longer exists shows NotFound and never adds a rule instead", async () => {
    vi.mocked(listNicknames).mockResolvedValue([{ ...coffee, id: 9, name: "Other" }]);
    const { onOpenChange } = renderDialog(named);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save nickname" }).getAttribute("aria-disabled")).toBe("false"),
    );
    typeName("Tea");
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't save the nickname")).toBeTruthy();
    expect(within(alert).getByText("That nickname no longer exists.")).toBeTruthy();
    expect(updateNickname).not.toHaveBeenCalled();
    expect(saveNicknameRule).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("the current name in another case or with spaces just closes", async () => {
    const { onOpenChange } = renderDialog(named);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save nickname" }).getAttribute("aria-disabled")).toBe("false"),
    );
    typeName(" coffee ");
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saveNicknameRule).not.toHaveBeenCalled();
    expect(updateNickname).not.toHaveBeenCalled();
  });

  test("Save with nothing changed just closes", async () => {
    const { onOpenChange } = renderDialog(named);
    await screen.findByText("Matches 12 transactions");
    await waitFor(() => expect(listNicknames).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saveNicknameRule).not.toHaveBeenCalled();
    expect(updateNickname).not.toHaveBeenCalled();
  });

  test("a new name with the rule untouched renames that nickname", async () => {
    vi.mocked(updateNickname).mockResolvedValue({ ...coffee, name: "Morning coffee" });
    const { onOpenChange, invalidate } = renderDialog(named);
    await screen.findByText("Matches 12 transactions");
    typeName("Morning coffee");
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(updateNickname).toHaveBeenCalledWith({ id: 3, name: "Morning coffee", enabled: true, staleExempt: false });
    expect(saveNicknameRule).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LEDGER_KEY });
  });

  test("ignores repeat presses while renaming", async () => {
    vi.mocked(updateNickname).mockReturnValue(new Promise(() => {}));
    renderDialog(named);
    await waitFor(() => expect(listNicknames).toHaveBeenCalled());
    await screen.findByText("Matches 12 transactions");
    typeName("Tea");
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    const saving = await screen.findByRole("button", { name: "Saving…" });
    expect(saving.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(saving);
    expect(updateNickname).toHaveBeenCalledTimes(1);
  });

  test("typing another nickname's name adds the rule to it instead of renaming", async () => {
    const tea = { ...coffee, id: 4, name: "Tea" };
    vi.mocked(listNicknames).mockResolvedValue([coffee, tea]);
    vi.mocked(saveNicknameRule).mockResolvedValue(tea);
    const { onOpenChange } = renderDialog(named);
    await screen.findByText("Matches 12 transactions");
    typeName("tea");
    expect(await screen.findByText("Adds this rule to Tea.")).toBeTruthy();
    expect(screen.getByText("This row is shown as “Coffee”. Its rule may still win over this one.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(saveNicknameRule).mock.calls[0][0]).toEqual({ name: "tea", rule: exact });
    expect(updateNickname).not.toHaveBeenCalled();
  });

  test("a rename conflict from the backend shows on the name field", async () => {
    vi.mocked(updateNickname).mockRejectedValue({ kind: "Validation", message: 'A nickname named "Tea" already exists.' });
    renderDialog(named);
    await screen.findByText("Matches 12 transactions");
    typeName("Tea");
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    expect(await screen.findByText('A nickname named "Tea" already exists.')).toBeTruthy();
    expect(screen.getByLabelText("Nickname").getAttribute("aria-invalid")).toBe("true");
  });

  test("a changed rule warns that the current nickname may still win, then adds the rule", async () => {
    vi.mocked(saveNicknameRule).mockResolvedValue(coffee);
    const { onOpenChange } = renderDialog(named);
    const note = () => screen.queryByText("This row is shown as “Coffee”. Its rule may still win over this one.");
    expect(note()).toBeNull();
    expand();
    fireEvent.click(screen.getByRole("radio", { name: "Contains" }));
    expect(note()?.getAttribute("aria-live")).toBe("polite");

    typeName("Cafe");
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(saveNicknameRule).mock.calls[0][0]).toEqual({ name: "Cafe", rule: { ...exact, mode: "contains" } });
    expect(updateNickname).not.toHaveBeenCalled();
  });
});

describe("default category", () => {
  const withDefault: Nickname = { ...coffee, defaultCategoryId: 1 };
  const named: Transaction = { ...row, nickname: "Coffee" };

  test("shows the hint and starts at No default for a new nickname", async () => {
    renderDialog();
    const picker = await screen.findByRole("combobox", { name: "Default category" });
    expect(picker.textContent).toBe("No default");
    expect(document.getElementById(picker.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Rows this nickname matches get this category without asking the model.",
    );
  });

  test("preselects the default of the nickname whose name is typed, and keeps it on save", async () => {
    vi.mocked(listNicknames).mockResolvedValue([withDefault]);
    vi.mocked(saveNicknameRule).mockResolvedValue(withDefault);
    const { onOpenChange, invalidate } = renderDialog();
    await listLoaded();
    typeName("coffee");
    expect(screen.getByRole("combobox", { name: "Default category" }).textContent).toBe("Housing");
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(saveNicknameRule).mock.calls[0][0]).toEqual({ name: "coffee", rule: exact, defaultCategoryId: 1 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LEDGER_KEY });
  });

  test("saves the chosen default with a new rule", async () => {
    vi.mocked(saveNicknameRule).mockResolvedValue(coffee);
    const { onOpenChange } = renderDialog();
    await listLoaded();
    typeName("Coffee");
    fireEvent.click(defaultOption("Groceries"));
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(saveNicknameRule).mock.calls[0][0]).toEqual({ name: "Coffee", rule: exact, defaultCategoryId: 4 });
  });

  test("a rename keeps the nickname's default", async () => {
    vi.mocked(listNicknames).mockResolvedValue([withDefault]);
    vi.mocked(updateNickname).mockResolvedValue(withDefault);
    renderDialog(named);
    await listLoaded();
    expect(screen.getByRole("combobox", { name: "Default category" }).textContent).toBe("Housing");
    typeName("Cafe");
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(updateNickname).toHaveBeenCalled());
    expect(vi.mocked(updateNickname).mock.calls[0][0]).toEqual({
      id: 3,
      name: "Cafe",
      enabled: true,
      staleExempt: false,
      defaultCategoryId: 1,
    });
  });

  test("No default with the name unchanged clears the default", async () => {
    vi.mocked(listNicknames).mockResolvedValue([withDefault]);
    vi.mocked(updateNickname).mockResolvedValue(coffee);
    renderDialog(named);
    await listLoaded();
    fireEvent.click(defaultOption("No default"));
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    await waitFor(() => expect(updateNickname).toHaveBeenCalled());
    const request = vi.mocked(updateNickname).mock.calls[0][0];
    expect(request).toEqual({ id: 3, name: "Coffee", enabled: true, staleExempt: false });
    // An omitted default clears it.
    expect(request.defaultCategoryId).toBeUndefined();
  });

  test("a deleted category shows in the error area and keeps the dialog open", async () => {
    vi.mocked(saveNicknameRule).mockRejectedValue({ kind: "NotFound", message: "That category no longer exists." });
    const { onOpenChange } = renderDialog();
    await listLoaded();
    typeName("Coffee");
    fireEvent.click(defaultOption("Groceries"));
    fireEvent.click(screen.getByRole("button", { name: "Save nickname" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't save the nickname")).toBeTruthy();
    expect(within(alert).getByText("That category no longer exists.")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
