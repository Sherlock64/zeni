import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { appInfo } from "@/lib/commands";
import { routeTree } from "@/router";

vi.mock("@/lib/commands", () => ({ appInfo: vi.fn(), sampleError: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(appInfo).mockReturnValue(new Promise(() => {}));
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
