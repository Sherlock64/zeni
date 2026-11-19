import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AboutCard } from "@/components/about-card";
import { appInfo, checkForUpdates, releaseNotes, setUpdateChecks, updateStatus } from "@/lib/commands";
import type { AppInfo } from "@/types/bindings/AppInfo";
import type { UpdateStatus } from "@/types/bindings/UpdateStatus";

vi.mock("@/lib/commands", () => ({
  appInfo: vi.fn(),
  updateStatus: vi.fn(),
  checkForUpdates: vi.fn(),
  setUpdateChecks: vi.fn(),
  releaseNotes: vi.fn(),
  acknowledgeReleaseNotes: vi.fn(),
}));

const info = { name: "Zeni", version: "7.0.0", dbPath: "/data/zeni.db", migrationsApplied: 1 };
const upToDate: UpdateStatus = { checksEnabled: true, checking: false, last: { date: "2026-11-15", result: { state: "upToDate" } }, banner: null };
const newer = { version: "7.1.0", url: "https://github.com/Sherlock64/zeni/releases/tag/v7.1.0" };
const invokeError = { kind: "Invoke", message: "not running in Tauri" } as const;
const invokeHint = "The request never reached Zeni's backend. Restart Zeni and try again.";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(updateStatus).mockResolvedValue(upToDate);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AboutCard />
    </QueryClientProvider>,
  );
}

const aboutCard = () => within(screen.getByRole("heading", { name: "About" }).closest<HTMLElement>("[data-slot=card]")!);
const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
const lastCheck = async (text: string) => waitFor(() => expect(valueOf("Last check")).toBe(text));
const checkNow = () => screen.getByRole("button", { name: "Check now" });
const toggle = () => screen.getByRole("switch", { name: "Check for updates daily" });

test("shows a loading status, then every app info value", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  renderPage();
  const status = aboutCard().getByRole("status");
  expect(status.textContent).toBe("Loading app info…");

  await screen.findByText("/data/zeni.db");
  expect(valueOf("Name")).toBe("Zeni");
  expect(valueOf("Version")).toBe("7.0.0");
  expect(valueOf("Database")).toBe("/data/zeni.db");
  expect(valueOf("Migrations applied")).toBe("1");
  expect(aboutCard().getByRole("status")).toBe(status);
  expect(status.textContent).toBe("");
});

test("shows a typed Invoke error, retries once while busy, then focuses the loaded section", async () => {
  let resolveRetry: (value: AppInfo) => void = () => {};
  vi.mocked(appInfo)
    .mockRejectedValueOnce(invokeError)
    .mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
  renderPage();
  const status = aboutCard().getByRole("status");
  const alert = await screen.findByRole("alert");
  expect(status.textContent).toBe("");
  expect(within(alert).getByText("Couldn't load app info")).toBeTruthy();
  expect(within(alert).getByText("Invoke")).toBeTruthy();
  expect(within(alert).getByText("not running in Tauri")).toBeTruthy();
  expect(within(alert).getByText(invokeHint)).toBeTruthy();

  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  await vi.waitFor(() => expect(status.textContent).toBe("Retrying…"));
  expect(aboutCard().getByRole("status")).toBe(status);
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

test("shows each last check result with its date", async () => {
  const cases: [UpdateStatus["last"], string][] = [
    [upToDate.last, "Up to date (Nov 15, 2026)"],
    [{ date: "2026-11-16", result: { state: "newer", ...newer } }, "Zeni 7.1.0 is available (Nov 16, 2026)"],
    [{ date: "2026-11-17", result: { state: "failed", reason: "GitHub answered 503" } }, "Check failed: GitHub answered 503 (Nov 17, 2026)"],
    [null, "Not checked yet"],
  ];
  for (const [last, text] of cases) {
    vi.mocked(updateStatus).mockResolvedValue({ ...upToDate, last });
    renderPage();
    await lastCheck(text);
    cleanup();
  }
});

test("describes the switch with the hint about GitHub and personal data", async () => {
  renderPage();
  await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
  const hint = document.getElementById(toggle().getAttribute("aria-describedby")!);
  expect(hint?.textContent).toBe("Once a day, Zeni asks GitHub whether a newer version is out. It sends no personal data.");
});

test("turns daily checks off once while busy", async () => {
  let resolve!: (value: UpdateStatus) => void;
  vi.mocked(setUpdateChecks).mockReturnValue(new Promise((r) => (resolve = r)));
  renderPage();
  await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));

  fireEvent.click(toggle());
  await waitFor(() => expect(toggle().getAttribute("aria-disabled")).toBe("true"));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle());
  expect(vi.mocked(setUpdateChecks).mock.calls.map(([request]) => request)).toEqual([{ enabled: false }]);

  await act(async () => resolve({ ...upToDate, checksEnabled: false }));
  await waitFor(() => expect(toggle().getAttribute("aria-disabled")).toBe("false"));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});

test("shows a failed switch save", async () => {
  vi.mocked(setUpdateChecks).mockRejectedValue(invokeError);
  renderPage();
  await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(toggle());
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the setting")).toBeTruthy();
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});

test("Check now shows a spinner while running, ignores repeat presses, then shows the new result", async () => {
  let resolve!: (value: UpdateStatus) => void;
  vi.mocked(checkForUpdates).mockReturnValue(new Promise((r) => (resolve = r)));
  renderPage();
  await lastCheck("Up to date (Nov 15, 2026)");

  fireEvent.click(checkNow());
  await lastCheck("Checking…");
  expect(checkNow().getAttribute("aria-disabled")).toBe("true");
  expect(checkNow().querySelector(".animate-spin")).not.toBeNull();
  fireEvent.click(checkNow());
  expect(checkForUpdates).toHaveBeenCalledTimes(1);

  await act(async () => resolve({ ...upToDate, last: { date: "2026-11-18", result: { state: "newer", ...newer } }, banner: newer }));
  await lastCheck("Zeni 7.1.0 is available (Nov 18, 2026)");
  expect(checkNow().getAttribute("aria-disabled")).toBe("false");
  expect(checkNow().querySelector(".animate-spin")).toBeNull();
});

test("Check now shows a failed check's reason", async () => {
  vi.mocked(checkForUpdates).mockResolvedValue({
    ...upToDate,
    last: { date: "2026-11-18", result: { state: "failed", reason: "Couldn't reach GitHub: timed out" } },
  });
  renderPage();
  await lastCheck("Up to date (Nov 15, 2026)");
  fireEvent.click(checkNow());
  await lastCheck("Check failed: Couldn't reach GitHub: timed out (Nov 18, 2026)");
});

test("Check now shows a command error", async () => {
  vi.mocked(checkForUpdates).mockRejectedValue(invokeError);
  renderPage();
  await lastCheck("Up to date (Nov 15, 2026)");
  fireEvent.click(checkNow());
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't check for updates")).toBeTruthy();
  expect(within(alert).getByText(invokeHint)).toBeTruthy();
  expect(valueOf("Last check")).toBe("Up to date (Nov 15, 2026)");
});

test("shows a spinner while a launch check runs and polls until it ends", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    vi.mocked(updateStatus).mockResolvedValueOnce({ ...upToDate, checking: true }).mockResolvedValue(upToDate);
    renderPage();
    await lastCheck("Checking…");
    expect(checkNow().getAttribute("aria-disabled")).toBe("true");
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await lastCheck("Up to date (Nov 15, 2026)");
    expect(updateStatus).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(updateStatus).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("shows an update status error", async () => {
  vi.mocked(updateStatus).mockRejectedValue(invokeError);
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load the update status")).toBeTruthy();
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.getByRole("button", { name: "Release notes" })).toBeTruthy();
});

test("Release notes opens every section and returns focus to the button", async () => {
  vi.mocked(releaseNotes).mockResolvedValue({
    pending: [],
    all: [
      { version: "7.1.0", lines: ["- Monthly totals."] },
      { version: "7.0.0", lines: ["- Update notice."] },
    ],
  });
  renderPage();
  const button = screen.getByRole("button", { name: "Release notes" });
  fireEvent.click(button);
  const dialog = await screen.findByRole("dialog", { name: "What's new in Zeni" });
  expect((await within(dialog).findAllByRole("heading", { level: 3 })).map((h) => h.textContent)).toEqual(["7.1.0", "7.0.0"]);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(button);
});
