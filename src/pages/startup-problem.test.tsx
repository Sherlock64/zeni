import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { continueStartup, startupStatus } from "@/lib/commands";
import { STARTUP_STATUS_KEY } from "@/lib/query-keys";
import { StartupProblemPage } from "@/pages/startup-problem";
import type { StartupStatus } from "@/types/bindings/StartupStatus";

vi.mock("@/lib/commands", () => ({ startupStatus: vi.fn(), continueStartup: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const backupFailed: StartupStatus = { state: "backupFailed", reason: "The backup folder doesn't exist." };

function renderPage(status: StartupStatus) {
  vi.mocked(startupStatus).mockResolvedValue(status);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StartupProblemPage />
    </QueryClientProvider>,
  );
  return client;
}

const requests = () => vi.mocked(continueStartup).mock.calls.map(([request]) => request);

test("shows the failed backup's reason with Retry and Continue without backup", async () => {
  renderPage(backupFailed);
  expect(await screen.findByRole("heading", { level: 1, name: "Backup before update failed" })).toBeTruthy();
  expect(screen.getByText("The backup folder doesn't exist.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue without backup" })).toBeTruthy();
});

test("Retry asks again with a backup, ignores repeat presses, and stores the new status", async () => {
  let resolve!: (value: StartupStatus) => void;
  vi.mocked(continueStartup).mockReturnValue(new Promise((r) => (resolve = r)));
  const client = renderPage(backupFailed);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  const busy = await screen.findByRole("button", { name: "Retrying…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  fireEvent.click(screen.getByRole("button", { name: "Continue without backup" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(requests()).toEqual([{ withoutBackup: false }]);

  await act(async () => resolve({ state: "ready" }));
  expect(client.getQueryData(STARTUP_STATUS_KEY)).toEqual({ state: "ready" });
});

test("a Retry that fails again shows the new reason and keeps focus on Retry", async () => {
  vi.mocked(continueStartup).mockResolvedValue({ state: "backupFailed", reason: "The disk is full." });
  renderPage(backupFailed);
  const retry = await screen.findByRole("button", { name: "Retry" });
  retry.focus();
  fireEvent.click(retry);
  expect(await screen.findByText("The disk is full.")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" }));
});

test("Continue without backup asks first; Cancel sends nothing and returns focus", async () => {
  renderPage(backupFailed);
  const trigger = await screen.findByRole("button", { name: "Continue without backup" });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("alertdialog", { name: "Update your data without a backup?" });
  expect(within(dialog).getByText("Zeni will update your data with no copy to go back to.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(continueStartup).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});

test("confirming Continue sends the request without a backup", async () => {
  vi.mocked(continueStartup).mockResolvedValue({ state: "ready" });
  renderPage(backupFailed);
  fireEvent.click(await screen.findByRole("button", { name: "Continue without backup" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(requests()).toEqual([{ withoutBackup: true }]));
});

test("shows a failed request with the next step", async () => {
  vi.mocked(continueStartup).mockRejectedValue({ kind: "Database", message: "unable to open database file" });
  renderPage(backupFailed);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't continue starting Zeni")).toBeTruthy();
  expect(within(alert).getByText("unable to open database file")).toBeTruthy();
  expect(within(alert).getByText("Try again, or continue without a backup.")).toBeTruthy();
});

test("names the newer version and links to the install or restore guide", async () => {
  renderPage({ state: "newerData", version: "7.1.0" });
  expect(await screen.findByRole("heading", { level: 1, name: "Data from a newer Zeni" })).toBeTruthy();
  expect(screen.getByText("This data was last opened by Zeni 7.1.0. Install Zeni 7.1.0 or newer, or restore by hand the before-update backup Zeni made before that update.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Install or restore guide (opens in your browser)" }));
  expect(openUrl).toHaveBeenCalledWith("https://github.com/Sherlock64/zeni/blob/main/docs/install.md");
});

test("asks for a newer Zeni when the version is unknown", async () => {
  renderPage({ state: "newerData", version: null });
  expect(await screen.findByText("This data was last opened by a newer Zeni. Install a newer Zeni, or restore by hand the before-update backup Zeni made before that update.")).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "Install or restore guide (opens in your browser)" }));
  expect(openUrl).toHaveBeenCalledWith("https://github.com/Sherlock64/zeni/blob/main/docs/install.md");
});
