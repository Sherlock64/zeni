import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { appInfo, sampleError } from "@/lib/commands";
import { SettingsPage } from "@/pages/settings";
import type { AppInfo } from "@/types/bindings/AppInfo";

vi.mock("@/lib/commands", () => ({ appInfo: vi.fn(), sampleError: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const info = { name: "Zeni", version: "0.1.0", dbPath: "/data/zeni.db", migrationsApplied: 1 };
const invokeError = { kind: "Invoke", message: "not running in Tauri" } as const;
const invokeHint = "The request never reached Zeni's backend. Restart Zeni and try again.";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

test("shows a loading status, then every app info value", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  renderPage();
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Loading app info…");

  await screen.findByText("/data/zeni.db");
  expect(valueOf("Name")).toBe("Zeni");
  expect(valueOf("Version")).toBe("0.1.0");
  expect(valueOf("Database")).toBe("/data/zeni.db");
  expect(valueOf("Migrations applied")).toBe("1");
  expect(screen.getByRole("status")).toBe(status);
  expect(status.textContent).toBe("");
});

test("shows a typed Invoke error, retries once while busy, then focuses the loaded section", async () => {
  let resolveRetry: (value: AppInfo) => void = () => {};
  vi.mocked(appInfo)
    .mockRejectedValueOnce(invokeError)
    .mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
  renderPage();
  const status = screen.getByRole("status");
  const alert = await screen.findByRole("alert");
  expect(status.textContent).toBe("");
  expect(within(alert).getByText("Couldn't load app info")).toBeTruthy();
  expect(within(alert).getByText("Invoke")).toBeTruthy();
  expect(within(alert).getByText("not running in Tauri")).toBeTruthy();
  expect(within(alert).getByText(invokeHint)).toBeTruthy();

  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  await vi.waitFor(() => expect(status.textContent).toBe("Retrying…"));
  expect(screen.getByRole("status")).toBe(status);
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(retry.hasAttribute("disabled")).toBe(false);
  fireEvent.click(retry);
  expect(appInfo).toHaveBeenCalledTimes(2);

  resolveRetry(info);
  expect(await screen.findByText("/data/zeni.db")).toBeTruthy();
  expect(status.textContent).toBe("");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "About" }));
});

test("remounts the alert when a retry fails again, so it is announced again", async () => {
  vi.mocked(appInfo).mockRejectedValue(invokeError);
  renderPage();
  const firstAlert = await screen.findByRole("alert");

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await vi.waitFor(() => expect(screen.getByRole("alert")).not.toBe(firstAlert));
  expect(appInfo).toHaveBeenCalledTimes(2);
});

test("shows the kind and message of the sample error from Rust", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(sampleError).mockRejectedValue({ kind: "Sample", message: "Sample error: triggered from Settings" });
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Trigger sample error" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Sample")).toBeTruthy();
  expect(within(alert).getByText("Sample error: triggered from Settings")).toBeTruthy();
  expect(within(alert).queryByText(invokeHint)).toBeNull();
  expect(sampleError).toHaveBeenCalledWith({ reason: "triggered from Settings" });
});

test("marks the sample error button busy without disabling it", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(sampleError).mockReturnValue(new Promise(() => {}));
  renderPage();

  const button = screen.getByRole("button", { name: "Trigger sample error" });
  fireEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
  expect(button.hasAttribute("disabled")).toBe(false);

  fireEvent.click(button);
  expect(sampleError).toHaveBeenCalledTimes(1);
});
