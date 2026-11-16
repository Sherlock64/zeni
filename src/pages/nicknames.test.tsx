import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  countRuleMatches,
  deleteNickname,
  deleteNicknameRule,
  listNicknames,
  saveNicknameRule,
  updateNickname,
  updateNicknameRule,
} from "@/lib/commands";
import { NicknamesPage } from "@/pages/nicknames";
import type { Nickname } from "@/types/bindings/Nickname";

vi.mock("@/lib/commands", () => ({
  listNicknames: vi.fn(),
  saveNicknameRule: vi.fn(),
  countRuleMatches: vi.fn(),
  updateNickname: vi.fn(),
  deleteNickname: vi.fn(),
  updateNicknameRule: vi.fn(),
  deleteNicknameRule: vi.fn(),
}));

// jsdom lacks ResizeObserver, which the radio groups use.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const rule = (id: number, nicknameId: number, pattern: string, matchCount: number, lastMatched: string | null) => ({
  id,
  nicknameId,
  mode: "exact" as const,
  field: "description" as const,
  pattern,
  createdAt: "2026-11-01 10:00:00",
  matchCount,
  lastMatched,
});
const coffee: Nickname = {
  id: 1,
  name: "Coffee",
  enabled: true,
  staleExempt: false,
  createdAt: "2026-11-01 10:00:00",
  matchCount: 9,
  lastMatched: "2026-10-31",
  stale: false,
  rules: [rule(11, 1, "CORNER COFFEE", 9, "2026-10-31")],
};
const gym: Nickname = {
  ...coffee,
  id: 2,
  name: "Gym",
  matchCount: 0,
  lastMatched: null,
  stale: true,
  rules: [rule(21, 2, "IRONWORKS GYM", 0, null), { ...rule(22, 2, "gym", 0, null), mode: "contains", field: "memo" }],
};
const invokeError = { kind: "Invoke", message: "not running in Tauri" } as const;
const never = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listNicknames).mockResolvedValue([coffee, gym]);
  vi.mocked(countRuleMatches).mockResolvedValue(3);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <NicknamesPage />
    </QueryClientProvider>,
  );
  return invalidate;
}

const row = (name: string) => screen.getByText(name, { selector: "span" }).closest("tr")!;
// useMutation passes its context as a second argument.
const firstArg = (fn: (...args: never[]) => unknown) => vi.mocked(fn).mock.calls[0]?.[0];
// Opens a row's actions menu with the keyboard and picks an item; returns the menu's trigger.
async function choose(menu: string, item: string | RegExp) {
  const trigger = screen.getByRole("button", { name: menu });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
  return trigger;
}
const expectRefreshed = (invalidate: ReturnType<typeof renderPage>) => {
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["list_nicknames"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["list_transactions"] });
};

test("shows a loading status, then each nickname with its rules, counts, dates and stale badge", async () => {
  renderPage();
  expect(screen.getByRole("status").textContent).toBe("Loading nicknames…");
  await screen.findByRole("table", { name: "Nicknames" });
  expect(screen.getByRole("status").textContent).toBe("");

  expect(within(row("Coffee")).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(
    expect.arrayContaining(["Coffee", "Oct 31, 20269 matches"]),
  );
  expect(within(row("Coffee")).queryByText("Stale")).toBeNull();
  expect(within(row("Gym")).getByText("Stale")).toBeTruthy();
  expect(within(row("Gym")).getByText("Never matched")).toBeTruthy();
  const memoRule = screen.getByText("gym", { selector: "code" }).closest("tr")!;
  expect(memoRule.textContent).toContain("Contains · Memogym");
  expect(within(memoRule).getByText("Never matched")).toBeTruthy();
  expect(screen.getByText("CORNER COFFEE", { selector: "code" }).closest("tr")!.textContent).toContain("Exact · Description");
});

test("shows a list error, retries once while busy, and announces a repeat failure", async () => {
  vi.mocked(listNicknames).mockRejectedValueOnce(invokeError).mockRejectedValueOnce({ kind: "Database", message: "gone" });
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Couldn't load nicknames");
  expect(alert.textContent).toContain("not running in Tauri");

  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(retry);
  expect(screen.getByRole("status").textContent).toBe("Retrying…");
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("gone"));
  expect(screen.getByRole("alert")).not.toBe(alert);
  expect(listNicknames).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("table", { name: "Nicknames" })).toBeTruthy();
});

test("shows the empty state with an Add nickname button", async () => {
  vi.mocked(listNicknames).mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText("No nicknames yet.")).toBeTruthy();
  expect(screen.getByText("Right-click a transaction and choose Rename it, or add one here.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add nickname" }));
  expect(screen.getByRole("dialog", { name: "Add nickname" })).toBeTruthy();
});

test("Show only stale filters the list and says when none are stale", async () => {
  renderPage();
  await screen.findByRole("table");
  const filter = screen.getByRole("button", { name: "Show only stale" });
  fireEvent.click(filter);
  expect(filter.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByText("Coffee", { selector: "span" })).toBeNull();
  expect(screen.getByText("Gym", { selector: "span" })).toBeTruthy();
  fireEvent.click(filter);
  expect(screen.getByText("Coffee", { selector: "span" })).toBeTruthy();
});

test("says No stale nicknames when the filter leaves nothing", async () => {
  vi.mocked(listNicknames).mockResolvedValue([coffee]);
  renderPage();
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Show only stale" }));
  expect(screen.getByText("No stale nicknames.")).toBeTruthy();
});

test("the on/off switch saves at once and refreshes the lists", async () => {
  vi.mocked(updateNickname).mockResolvedValue({ ...coffee, enabled: false });
  const invalidate = renderPage();
  const toggle = await screen.findByRole("switch", { name: "Coffee on" });
  vi.mocked(listNicknames).mockResolvedValue([{ ...coffee, enabled: false }, gym]);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  await waitFor(() => expect(firstArg(updateNickname)).toEqual({ id: 1, name: "Coffee", enabled: false, staleExempt: false }));
  await waitFor(() => expectRefreshed(invalidate));
});

test("Don't flag as stale saves at once", async () => {
  vi.mocked(updateNickname).mockResolvedValue({ ...gym, staleExempt: true });
  renderPage();
  const box = await screen.findByRole("checkbox", { name: "Don't flag Gym as stale" });
  vi.mocked(listNicknames).mockResolvedValue([coffee, { ...gym, staleExempt: true }]);
  fireEvent.click(box);
  await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
  await waitFor(() => expect(firstArg(updateNickname)).toEqual({ id: 2, name: "Gym", enabled: true, staleExempt: true }));
});

test("a failed toggle goes back and shows the error", async () => {
  vi.mocked(updateNickname).mockRejectedValue({ kind: "NotFound", message: "That nickname no longer exists." });
  renderPage();
  const toggle = await screen.findByRole("switch", { name: "Coffee on" });
  fireEvent.click(toggle);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Couldn't change Coffee");
  expect(alert.textContent).toContain("The change was undone.");
  expect(screen.getByRole("switch", { name: "Coffee on" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("toggles change at once, are busy while the change saves and ignore repeat presses", async () => {
  vi.mocked(updateNickname).mockImplementation(never);
  renderPage();
  const toggle = await screen.findByRole("switch", { name: "Coffee on" });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  expect(toggle.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("checkbox", { name: "Don't flag Gym as stale" }));
  expect(updateNickname).toHaveBeenCalledTimes(1);
});

test("adds a nickname with the live count, refreshes, closes and returns focus", async () => {
  vi.mocked(saveNicknameRule).mockResolvedValue(coffee);
  const invalidate = renderPage();
  await screen.findByRole("table");
  const add = screen.getByRole("button", { name: "Add nickname" });
  fireEvent.click(add);
  const dialog = screen.getByRole("dialog", { name: "Add nickname" });
  fireEvent.change(within(dialog).getByLabelText("Nickname"), { target: { value: "coffee" } });
  expect(within(dialog).getByText("Adds this rule to Coffee.")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Pattern"), { target: { value: "roasters" } });
  expect(await within(dialog).findByText("Matches 3 transactions")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save nickname" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(saveNicknameRule).toHaveBeenCalledWith({
    name: "coffee",
    rule: { mode: "exact", field: "description", pattern: "roasters" },
  });
  expectRefreshed(invalidate);
  await waitFor(() => expect(document.activeElement).toBe(add));
});

test("a name error shows on the Nickname field; Cancel closes without saving", async () => {
  vi.mocked(saveNicknameRule).mockRejectedValue({ kind: "Validation", message: "Enter a nickname." });
  renderPage();
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Add nickname" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save nickname" }));
  const name = within(dialog).getByLabelText("Nickname");
  await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
  expect(within(dialog).getByText("Enter a nickname.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(saveNicknameRule).toHaveBeenCalledTimes(1);
});

test("a pattern error shows on the Pattern field and other errors in an alert", async () => {
  vi.mocked(saveNicknameRule)
    .mockRejectedValueOnce({ kind: "Validation", message: "Enter a pattern." })
    .mockRejectedValueOnce({ kind: "Validation", message: "That nickname already has this rule." });
  renderPage();
  await screen.findByRole("table");
  await choose("Actions for Coffee", "Add rule");
  const dialog = screen.getByRole("dialog", { name: "Add a rule to Coffee" });
  expect(within(dialog).queryByLabelText("Nickname")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }));
  await waitFor(() => expect(within(dialog).getByLabelText("Pattern").getAttribute("aria-invalid")).toBe("true"));
  expect(saveNicknameRule).toHaveBeenLastCalledWith({ name: "Coffee", rule: { mode: "exact", field: "description", pattern: "" } });

  fireEvent.change(within(dialog).getByLabelText("Pattern"), { target: { value: "CORNER COFFEE" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }));
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toContain("That nickname already has this rule.");
});

test("Save is busy while saving and ignores repeat presses and closing", async () => {
  vi.mocked(saveNicknameRule).mockImplementation(never);
  renderPage();
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Add nickname" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save nickname" }));
  const saving = await within(dialog).findByRole("button", { name: "Saving…" });
  expect(saving.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(saving);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(saveNicknameRule).toHaveBeenCalledTimes(1);
});

test("renames a nickname, keeping its switch and stale setting, and shows a duplicate name on the field", async () => {
  vi.mocked(updateNickname)
    .mockRejectedValueOnce({ kind: "Validation", message: 'A nickname named "Gym" already exists.' })
    .mockResolvedValueOnce({ ...coffee, name: "Cafe" });
  renderPage();
  await screen.findByRole("table");
  const rename = await choose("Actions for Coffee", "Rename");
  const dialog = screen.getByRole("dialog", { name: "Rename Coffee" });
  expect(within(dialog).queryByLabelText("Pattern")).toBeNull();
  const name = within(dialog).getByLabelText("Nickname");
  expect((name as HTMLInputElement).value).toBe("Coffee");
  fireEvent.change(name, { target: { value: "Gym" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
  expect(await within(dialog).findByText('A nickname named "Gym" already exists.')).toBeTruthy();

  fireEvent.change(name, { target: { value: "Cafe" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(updateNickname).toHaveBeenLastCalledWith({ id: 1, name: "Cafe", enabled: true, staleExempt: false });
  await waitFor(() => expect(document.activeElement).toBe(rename));
});

test("edits a rule from its current values", async () => {
  vi.mocked(updateNicknameRule).mockResolvedValue(gym);
  const invalidate = renderPage();
  await screen.findByRole("table");
  await choose("Actions for rule gym", "Edit rule");
  const dialog = screen.getByRole("dialog", { name: "Edit a rule of Gym" });
  expect(dialog.textContent).toContain("Every transaction the changed rule matches, past and future, shows this nickname.");
  expect((within(dialog).getByLabelText("Pattern") as HTMLInputElement).value).toBe("gym");
  expect(within(dialog).getByRole("radio", { name: "Contains" }).getAttribute("aria-checked")).toBe("true");
  expect(within(dialog).getByRole("radio", { name: "Memo" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.change(within(dialog).getByLabelText("Pattern"), { target: { value: "gym fee" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(updateNicknameRule).toHaveBeenCalledWith({ id: 22, rule: { mode: "contains", field: "memo", pattern: "gym fee" } });
  expectRefreshed(invalidate);
});

test("the only rule can't be deleted, and the menu says why", async () => {
  renderPage();
  await screen.findByRole("table");
  const item = await (async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Actions for rule CORNER COFFEE" }), { key: "Enter" });
    return screen.findByRole("menuitem", { name: /^Delete rule/ });
  })();
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(item.textContent).toContain("A nickname needs at least one rule. Delete the nickname instead.");
  fireEvent.click(item);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(deleteNicknameRule).not.toHaveBeenCalled();
});

test("deletes one of several rules after confirming, then focuses the nickname's menu", async () => {
  vi.mocked(deleteNicknameRule).mockResolvedValue(null);
  const invalidate = renderPage();
  await screen.findByRole("table");
  await choose("Actions for rule gym", /^Delete rule/);
  const dialog = screen.getByRole("alertdialog", { name: "Delete this rule from Gym?" });
  expect(dialog.textContent).toContain("“gym” (Contains · Memo)");
  expect(dialog.textContent).toContain("show the bank's text again");
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" })));
  vi.mocked(listNicknames).mockResolvedValue([coffee, { ...gym, rules: [gym.rules[0]] }]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete rule" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(firstArg(deleteNicknameRule)).toEqual({ id: 22 });
  expectRefreshed(invalidate);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Gym" })));
});

test("a failed rule delete shows the error in the dialog; Cancel deletes nothing and returns focus", async () => {
  vi.mocked(deleteNicknameRule).mockRejectedValue({ kind: "NotFound", message: "That rule no longer exists." });
  renderPage();
  await screen.findByRole("table");
  const opener = await choose("Actions for rule gym", /^Delete rule/);
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete rule" }));
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toContain("Couldn't delete the rule");
  expect(alert.textContent).toContain("That rule no longer exists.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

test("marks the table busy while the list refetches", async () => {
  vi.mocked(updateNickname).mockResolvedValue(coffee);
  renderPage();
  const table = await screen.findByRole("table");
  vi.mocked(listNicknames).mockImplementation(never);
  fireEvent.click(screen.getByRole("switch", { name: "Coffee on" }));
  await waitFor(() => expect(table.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true"));
});

test("deletes a nickname after confirming, then focuses Add nickname", async () => {
  vi.mocked(deleteNickname).mockResolvedValue(null);
  const invalidate = renderPage();
  await screen.findByRole("table");
  await choose("Actions for Coffee", "Delete nickname");
  const dialog = screen.getByRole("alertdialog", { name: "Delete Coffee?" });
  expect(dialog.textContent).toContain("Its rules are deleted and its transactions show their bank text again.");
  vi.mocked(listNicknames).mockResolvedValue([gym]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete nickname" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(firstArg(deleteNickname)).toEqual({ id: 1 });
  expectRefreshed(invalidate);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add nickname" })));
});

test("a failed nickname delete shows the error in the dialog; Cancel returns focus", async () => {
  vi.mocked(deleteNickname).mockRejectedValue(invokeError);
  renderPage();
  await screen.findByRole("table");
  const opener = await choose("Actions for Coffee", "Delete nickname");
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete nickname" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("Couldn't delete the nickname");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

test("Delete nickname is busy while deleting and ignores repeat presses", async () => {
  vi.mocked(deleteNickname).mockImplementation(never);
  renderPage();
  await screen.findByRole("table");
  await choose("Actions for Coffee", "Delete nickname");
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete nickname" }));
  const busy = await within(dialog).findByRole("button", { name: "Deleting…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(deleteNickname).toHaveBeenCalledTimes(1);
});
