import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { appInfo, completeSetup, listAccounts, securityStatus, unlock } from "@/lib/commands";
import { routeTree } from "@/router";

vi.mock("@/lib/commands", () => ({
  appInfo: vi.fn(),
  sampleError: vi.fn(),
  securityStatus: vi.fn(),
  completeSetup: vi.fn(),
  unlock: vi.fn(),
  recover: vi.fn(),
  resetSecurity: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  listAccounts: vi.fn(),
  revealAccountNumbers: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(appInfo).mockReturnValue(new Promise(() => {}));
  vi.mocked(securityStatus).mockResolvedValue({ state: "unlocked", keyringSaved: true, recoveryCodesLeft: 8 });
});

// jsdom lacks matchMedia (the sidebar's mobile check) and scrollTo (the router's scroll reset).
window.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
window.scrollTo = () => {};

function renderApp() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

test("redirects to Transactions and navigates with the sidebar", async () => {
  renderApp();
  expect(await screen.findByRole("heading", { level: 1, name: "Transactions" })).toBeTruthy();
  const nav = within(screen.getByRole("navigation", { name: "Main" }));
  expect(nav.getByRole("link", { name: "Transactions" }).getAttribute("aria-current")).toBe("page");
  expect(document.activeElement).toBe(document.body);

  fireEvent.click(nav.getByRole("link", { name: "Settings" }));
  const settingsHeading = await screen.findByRole("heading", { level: 1, name: "Settings" });
  expect(document.activeElement).toBe(settingsHeading);
  expect(nav.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  expect(nav.getByRole("link", { name: "Transactions" }).getAttribute("aria-current")).toBeNull();
});

test("lists Accounts between Transactions and Settings and opens the page", async () => {
  vi.mocked(listAccounts).mockResolvedValue([]);
  renderApp();
  await screen.findByRole("heading", { level: 1, name: "Transactions" });
  const nav = within(screen.getByRole("navigation", { name: "Main" }));
  expect(nav.getAllByRole("link").map((link) => link.textContent)).toEqual(["Transactions", "Accounts", "Settings"]);

  fireEvent.click(nav.getByRole("link", { name: "Accounts" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Accounts" })).toBeTruthy();
  expect(nav.getByRole("link", { name: "Accounts" }).getAttribute("aria-current")).toBe("page");
});

test("collapsing the sidebar takes its links out of the tab order", async () => {
  renderApp();
  const toggle = await screen.findByRole("button", { name: "Toggle Sidebar" });
  const link = screen.getByRole("link", { name: "Settings" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(link.closest("[inert]")).toBeNull();

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(link.closest("[inert]")).not.toBeNull();
});

test("blocks the app with a full-page screen when the database fails to open", async () => {
  vi.mocked(appInfo).mockRejectedValue({ kind: "Database", message: "unable to open database file" });
  renderApp();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Zeni couldn't open its database")).toBeTruthy();
  expect(within(alert).getByText("unable to open database file")).toBeTruthy();
  expect(within(alert).getByText("Check that the folder exists and is writable, then restart Zeni.")).toBeTruthy();
  expect(screen.queryByRole("navigation")).toBeNull();
});

test("keeps the shell usable when app info fails for another reason", async () => {
  vi.mocked(appInfo).mockRejectedValue({ kind: "Invoke", message: "not running in Tauri" });
  renderApp();
  await vi.waitFor(() => expect(appInfo).toHaveBeenCalled());
  expect(await screen.findByRole("heading", { level: 1, name: "Transactions" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();

  const nav = within(screen.getByRole("navigation", { name: "Main" }));
  fireEvent.click(nav.getByRole("link", { name: "Settings" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load app info")).toBeTruthy();
  expect(within(alert).getByText("Invoke")).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
  expect(screen.queryByText("Zeni couldn't open its database")).toBeNull();
});

test("on a narrow window, picking a page closes the sidebar sheet and focuses the new page", async () => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(500);
  renderApp();
  await screen.findByRole("heading", { level: 1, name: "Transactions" });

  fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(within(sheet).getByRole("link", { name: "Settings" }));

  const settingsHeading = await screen.findByRole("heading", { level: 1, name: "Settings" });
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await vi.waitFor(() => expect(document.activeElement).toBe(settingsHeading));
});

test("shows a loading screen while the security status loads", async () => {
  vi.mocked(securityStatus).mockReturnValue(new Promise(() => {}));
  renderApp();
  expect((await screen.findByRole("status")).textContent).toBe("Loading…");
  expect(screen.queryByRole("navigation")).toBeNull();
});

test("shows first-run setup without the sidebar when setup is needed", async () => {
  vi.mocked(securityStatus).mockResolvedValue({ state: "needsSetup", defaultOwner: "sam" });
  renderApp();
  expect(await screen.findByRole("heading", { level: 1, name: "Set up Zeni" })).toBeTruthy();
  expect((screen.getByLabelText("Owner") as HTMLInputElement).value).toBe("sam");
  expect(screen.queryByRole("navigation")).toBeNull();
});

test("shows the unlock screen when locked, then the app with focus on its heading once unlocked", async () => {
  vi.mocked(securityStatus).mockResolvedValue({ state: "locked", reason: "keyringUnavailable" });
  vi.mocked(unlock).mockResolvedValue(null);
  renderApp();
  expect(await screen.findByRole("heading", { level: 1, name: "Unlock Zeni" })).toBeTruthy();
  expect(screen.getByText(/couldn't reach your system keyring/)).toBeTruthy();
  expect(screen.queryByRole("navigation")).toBeNull();

  vi.mocked(securityStatus).mockResolvedValue({ state: "unlocked", keyringSaved: false, recoveryCodesLeft: 8 });
  fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "correct horse battery" } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  const heading = await screen.findByRole("heading", { level: 1, name: "Transactions" });
  expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
  await vi.waitFor(() => expect(document.activeElement).toBe(heading));
});

test("shows a status error with a retry", async () => {
  vi.mocked(securityStatus).mockRejectedValueOnce({ kind: "Invoke", message: "not running in Tauri" });
  renderApp();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't check Zeni's security status")).toBeTruthy();
  expect(screen.queryByRole("navigation")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Transactions" })).toBeTruthy();
  expect(securityStatus).toHaveBeenCalledTimes(2);
});

test("keeps the recovery codes on screen when the window regains focus", async () => {
  vi.mocked(securityStatus).mockResolvedValue({ state: "needsSetup", defaultOwner: "sam" });
  vi.mocked(completeSetup).mockResolvedValue({ recoveryCodes: Array(8).fill("AAAAA-BBBBB-CCCCC-DDDDD"), keyringSaved: true });
  renderApp();
  await screen.findByRole("heading", { level: 1, name: "Set up Zeni" });
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type("Master password", "correct horse battery");
  type("Confirm master password", "correct horse battery");
  type("Bank name", "Example Bank");
  type("Account number", "000123456789");
  type("Routing number", "011000015");
  fireEvent.click(screen.getByRole("button", { name: "Set up Zeni" }));
  await screen.findByRole("heading", { level: 1, name: "Save your recovery codes" });

  // The backend now reports unlocked; a focus refetch must not swap the codes for the app.
  vi.mocked(securityStatus).mockResolvedValue({ state: "unlocked", keyringSaved: true, recoveryCodesLeft: 8 });
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(securityStatus).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("heading", { level: 1, name: "Save your recovery codes" })).toBeTruthy();
});

test("keeps the app when a background status refetch fails", async () => {
  const client = renderApp();
  await screen.findByRole("heading", { level: 1, name: "Transactions" });
  vi.mocked(securityStatus).mockRejectedValue({ kind: "Invoke", message: "not running in Tauri" });
  await act(() => client.refetchQueries({ queryKey: ["security_status"] }));
  await vi.waitFor(() => expect(client.getQueryState(["security_status"])?.status).toBe("error"));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
  expect(screen.queryByText("Couldn't check Zeni's security status")).toBeNull();
});
