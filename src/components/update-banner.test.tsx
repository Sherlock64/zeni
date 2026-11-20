import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { UpdateBanner } from "@/components/update-banner";
import { dismissUpdate, updateStatus } from "@/lib/commands";
import type { UpdateStatus } from "@/types/bindings/UpdateStatus";

vi.mock("@/lib/commands", () => ({ updateStatus: vi.fn(), dismissUpdate: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const url = "https://github.com/Sherlock64/zeni/releases/tag/v7.1.0";
const none: UpdateStatus = { checksEnabled: true, checking: false, last: { date: "2026-11-18", result: { state: "newer", version: "7.1.0", url } }, banner: null };
const newer: UpdateStatus = { ...none, banner: { version: "7.1.0", url } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updateStatus).mockResolvedValue(newer);
});

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <main>
        <h1 tabIndex={-1}>Transactions</h1>
        <UpdateBanner />
      </main>
    </QueryClientProvider>,
  );
  return client;
}

test("announces the banner in a status region mounted before the status resolves", async () => {
  let resolve!: (value: UpdateStatus) => void;
  vi.mocked(updateStatus).mockReturnValue(new Promise((r) => (resolve = r)));
  renderBanner();
  const region = screen.getByRole("status");
  expect(region.textContent).toBe("");
  expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();

  resolve(newer);
  await waitFor(() => expect(region.textContent).toBe("Zeni 7.1.0 is available"));
  expect(screen.getByRole("button", { name: "Download Zeni 7.1.0 (opens in your browser)" })).toBeTruthy();
});

test("shows nothing without a banner", async () => {
  vi.mocked(updateStatus).mockResolvedValue(none);
  const client = renderBanner();
  await waitFor(() => expect(client.getQueryState(["update_status"])?.status).toBe("success"));
  expect(screen.queryByText(/is available/)).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("");
});

test("shows nothing when the status fails", async () => {
  vi.mocked(updateStatus).mockRejectedValue({ kind: "Invoke", message: "not running in Tauri" });
  const client = renderBanner();
  await waitFor(() => expect(client.getQueryState(["update_status"])?.status).toBe("error"));
  expect(screen.queryByText(/is available/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("Download opens the release page", async () => {
  renderBanner();
  expect(await screen.findByText("Zeni 7.1.0 is available", { selector: "p:not([role])" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Download Zeni 7.1.0 (opens in your browser)" }));
  expect(openUrl).toHaveBeenCalledWith(url);
});

test("Dismiss hides the banner once, ignoring repeat presses, and focuses the page heading", async () => {
  let resolve!: (value: UpdateStatus) => void;
  vi.mocked(dismissUpdate).mockReturnValue(new Promise((r) => (resolve = r)));
  renderBanner();
  const dismiss = await screen.findByRole("button", { name: "Dismiss" });
  fireEvent.click(dismiss);
  await waitFor(() => expect(dismiss.getAttribute("aria-disabled")).toBe("true"));
  fireEvent.click(dismiss);
  expect(dismissUpdate).toHaveBeenCalledTimes(1);

  resolve(none);
  await waitFor(() => expect(screen.queryByText("Zeni 7.1.0 is available")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Transactions" }));
});

test("shows a failed dismiss and keeps the banner", async () => {
  vi.mocked(dismissUpdate).mockRejectedValue({ kind: "Database", message: "database is locked" });
  renderBanner();
  fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't dismiss the update")).toBeTruthy();
  expect(screen.getByText("Zeni 7.1.0 is available", { selector: "p:not([role])" })).toBeTruthy();
});
