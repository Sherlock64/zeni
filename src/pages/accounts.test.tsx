import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { listAccounts, revealAccountNumbers } from "@/lib/commands";
import { AccountsPage } from "@/pages/accounts";
import type { Account } from "@/types/bindings/Account";

vi.mock("@/lib/commands", () => ({ listAccounts: vi.fn(), revealAccountNumbers: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const account = { id: 7, name: "Checking", owner: "Sam Rivera", bankName: "Example Bank" };
const numbers = { accountNumber: "000123456789", routingNumber: "011000015" };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AccountsPage />
    </QueryClientProvider>,
  );
  return { client, view };
}

const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

test("shows a loading status, then each account with its numbers hidden", async () => {
  vi.mocked(listAccounts).mockResolvedValue([account, { ...account, id: 8, name: "Savings" }]);
  renderPage();
  expect(screen.getByRole("status").textContent).toBe("Loading accounts…");

  expect(await screen.findByRole("heading", { name: "Checking" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Savings" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("");
  const card = within(screen.getByRole("heading", { name: "Checking" }).closest("[data-slot=card]") as HTMLElement);
  expect(card.getByText("Sam Rivera")).toBeTruthy();
  expect(card.getByText("Example Bank")).toBeTruthy();
  expect(card.getAllByText("Hidden")).toHaveLength(2);
  expect(revealAccountNumbers).not.toHaveBeenCalled();
});

test("shows the numbers on request, hides them again, and keeps them out of the query cache", async () => {
  vi.mocked(listAccounts).mockResolvedValue([account]);
  vi.mocked(revealAccountNumbers).mockResolvedValue(numbers);
  const { client } = renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "Show numbers" }));
  const hide = await screen.findByRole("button", { name: "Hide numbers" });
  expect(revealAccountNumbers).toHaveBeenCalledWith({ accountId: 7 }, expect.anything());
  expect(valueOf("Account number")).toBe("000123456789");
  expect(valueOf("Routing number")).toBe("011000015");
  expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("000123456789");

  hide.focus();
  fireEvent.click(hide);
  await vi.waitFor(() => expect(valueOf("Account number")).toBe("••••••••Hidden"));
  expect(screen.queryByText("000123456789")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show numbers" }));
});

test("drops the numbers when the page unmounts", async () => {
  vi.mocked(listAccounts).mockResolvedValue([account]);
  vi.mocked(revealAccountNumbers).mockResolvedValue(numbers);
  const { client, view } = renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Show numbers" }));
  await screen.findByText("000123456789");

  view.unmount();
  await vi.waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
});

test("marks Show numbers busy and ignores repeat presses", async () => {
  vi.mocked(listAccounts).mockResolvedValue([account]);
  vi.mocked(revealAccountNumbers).mockReturnValue(new Promise(() => {}));
  renderPage();
  const button = await screen.findByRole("button", { name: "Show numbers" });
  fireEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(revealAccountNumbers).toHaveBeenCalledTimes(1);
});

test.each(["Locked", "NotFound", "Crypto"] as const)("shows a %s error from revealing the numbers", async (kind) => {
  vi.mocked(listAccounts).mockResolvedValue([account]);
  vi.mocked(revealAccountNumbers).mockRejectedValue({ kind, message: `${kind} message` });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Show numbers" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't show the numbers")).toBeTruthy();
  expect(within(alert).getByText(kind)).toBeTruthy();
  expect(screen.getAllByText("Hidden")).toHaveLength(2);
});

test("shows an empty state when there are no accounts", async () => {
  vi.mocked(listAccounts).mockResolvedValue([]);
  renderPage();
  expect(await screen.findByRole("heading", { name: "No accounts yet" })).toBeTruthy();
});

test("shows a load error, retries, then focuses the loaded list", async () => {
  let resolveRetry: (value: Account[]) => void = () => {};
  vi.mocked(listAccounts)
    .mockRejectedValueOnce({ kind: "Invoke", message: "not running in Tauri" })
    .mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load accounts")).toBeTruthy();

  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Retrying…"));
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(retry);
  expect(listAccounts).toHaveBeenCalledTimes(2);

  resolveRetry([account]);
  expect(await screen.findByRole("heading", { name: "Checking" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your accounts" }));
});
