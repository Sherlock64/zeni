import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OllamaCard } from "@/components/ollama-card";
import { cancelJob, jobStatus, ollamaSettings, ollamaStatus, setBaseModel, setOllamaPort, startModelDownload } from "@/lib/commands";
import type { JobStatus } from "@/types/bindings/JobStatus";
import type { OllamaSettings } from "@/types/bindings/OllamaSettings";
import type { OllamaStatus } from "@/types/bindings/OllamaStatus";

// Other tasks own these and test them on their own.
vi.mock("@/components/auto-categorize-switch", () => ({ AutoCategorizeSwitch: () => null }));
vi.mock("@/components/model-builds-section", () => ({ ModelBuildsSection: () => null }));
vi.mock("@/lib/commands", () => ({
  ollamaSettings: vi.fn(),
  ollamaStatus: vi.fn(),
  setOllamaPort: vi.fn(),
  setBaseModel: vi.fn(),
  startModelDownload: vi.fn(),
  cancelJob: vi.fn(),
  jobStatus: vi.fn(),
}));

// Radix Select needs these in jsdom.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

const settings: OllamaSettings = { port: 11434, baseModel: "phi4-mini", autoCategorize: true, examplesPerCategory: 5 };
const recommended = [
  { name: "phi4-mini", sizeBytes: 2491876774, note: "Best pick.", installed: true },
  { name: "qwen2.5:3b", sizeBytes: 1929912432, note: "Smallest download.", installed: false },
];
const reachable: OllamaStatus = {
  reachable: true,
  version: "0.12.6",
  installed: [
    { name: "phi4-mini:latest", sizeBytes: 2491876774 },
    { name: "zeni-2:latest", sizeBytes: 2491877102 },
  ],
  recommended,
};
const unreachable: OllamaStatus = { reachable: false, version: null, installed: [], recommended: recommended.map((m) => ({ ...m, installed: false })) };
const idle: JobStatus = { running: null, last: null };
const downloading: JobStatus = { running: { kind: "download", label: "Download qwen2.5:3b", done: 500_000_000, total: 1929912432 }, last: null };
const finished = (outcome: Partial<NonNullable<JobStatus["last"]>>): JobStatus => ({
  running: null,
  last: { kind: "download", label: "Download qwen2.5:3b", cancelled: false, error: null, summary: null, ...outcome },
});
const ollamaError = { kind: "Ollama", message: "Ollama said: pull model manifest: file does not exist" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ollamaSettings).mockResolvedValue(settings);
  vi.mocked(ollamaStatus).mockResolvedValue(reachable);
  vi.mocked(jobStatus).mockResolvedValue(idle);
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OllamaCard />
    </QueryClientProvider>,
  );
}

const pending = () => new Promise<never>(() => {});

test("shows loading states for the settings and the status", async () => {
  vi.mocked(ollamaSettings).mockReturnValueOnce(pending());
  vi.mocked(ollamaStatus).mockReturnValueOnce(pending());
  renderCard();
  expect(screen.getByRole("status", { name: "Loading Ollama settings…" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Checking Ollama…" })).toBeTruthy();
});

test("shows a reachable Ollama with its version, the picked model and the recommended models", async () => {
  renderCard();
  expect(await screen.findByText("Ollama 0.12.6 is running.")).toBeTruthy();
  // "phi4-mini" is saved; Ollama lists it as "phi4-mini:latest".
  expect(screen.getByRole("combobox", { name: "Base model" }).textContent).toBe("phi4-mini:latest");
  const list = within(screen.getByRole("region", { name: "Recommended models" }));
  expect(list.getByText("2.5 GB")).toBeTruthy();
  expect(list.getByText("1.9 GB")).toBeTruthy();
  expect(list.getByText("Best pick.")).toBeTruthy();
  expect(list.getAllByText("Installed")).toHaveLength(1);
  expect(list.getByRole("button", { name: "Download qwen2.5:3b" })).toBeTruthy();
  expect(list.queryByRole("button", { name: "Download phi4-mini" })).toBeNull();
  expect(screen.queryByText(/ollama pull/)).toBeNull();
});

test("explains what to do when Ollama is unreachable and copies the pull command", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.mocked(ollamaStatus).mockResolvedValue(unreachable);
  renderCard();
  expect(await screen.findByText("Ollama isn't reachable on port 11434.")).toBeTruthy();
  expect(screen.getByText(/Install Ollama from ollama.com/)).toBeTruthy();
  expect(screen.getByText("ollama pull phi4-mini")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Base model" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Copied")).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith("ollama pull phi4-mini");
});

test("checks Ollama again once while busy and shows the new status", async () => {
  vi.mocked(ollamaStatus).mockResolvedValueOnce(unreachable);
  renderCard();
  await screen.findByText("Ollama isn't reachable on port 11434.");
  let resolve: (value: OllamaStatus) => void = () => {};
  vi.mocked(ollamaStatus).mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const button = screen.getByRole("button", { name: "Check again" });
  fireEvent.click(button);
  await waitFor(() => expect(button.textContent).toBe("Checking…"));
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(ollamaStatus).toHaveBeenCalledTimes(2);
  resolve(reachable);
  expect(await screen.findByText("Ollama 0.12.6 is running.")).toBeTruthy();
  expect(button.textContent).toBe("Check again");
});

test("checks again from the status error alert, announces a repeat failure, then moves focus to the heading", async () => {
  const error = { kind: "Invoke", message: "not running in Tauri" } as const;
  vi.mocked(ollamaStatus).mockRejectedValue(error);
  renderCard();
  const firstAlert = await screen.findByRole("alert");
  expect(within(firstAlert).getByText("Couldn't check Ollama")).toBeTruthy();

  const button = screen.getByRole("button", { name: "Check again" });
  button.focus();
  fireEvent.click(button);
  await waitFor(() => expect(ollamaStatus).toHaveBeenCalledTimes(2));
  // The failed retry remounts the alert so it is announced again.
  await waitFor(() => expect(screen.getByRole("alert")).not.toBe(firstAlert));
  expect(screen.getByRole("button", { name: "Check again" })).toBe(button);

  vi.mocked(ollamaStatus).mockResolvedValue(reachable);
  fireEvent.click(button);
  expect(await screen.findByText("Ollama 0.12.6 is running.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Ollama" }));
});

test("announces the status again when a repeat check has the same result", async () => {
  renderCard();
  const status = await screen.findByText("Ollama 0.12.6 is running.");
  expect(status.getAttribute("role")).toBe("status");
  let resolve: (value: OllamaStatus) => void = () => {};
  vi.mocked(ollamaStatus).mockReturnValueOnce(new Promise((r) => (resolve = r)));
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  // The live region's text changes and comes back, so the same result is read out again.
  await waitFor(() => expect(status.textContent).toBe("Checking Ollama…"));
  resolve(reachable);
  await waitFor(() => expect(status.textContent).toBe("Ollama 0.12.6 is running."));
});

test("moves focus to Check again under the error alert when a check from a success card fails", async () => {
  renderCard();
  await screen.findByText("Ollama 0.12.6 is running.");
  vi.mocked(ollamaStatus).mockRejectedValue({ kind: "Invoke", message: "not running in Tauri" });
  const button = screen.getByRole("button", { name: "Check again" });
  button.focus();
  fireEvent.click(button);
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't check Ollama")).toBeTruthy();
  const retry = screen.getByRole("button", { name: "Check again" });
  await waitFor(() => expect(document.activeElement).toBe(retry));
  expect(retry).not.toBe(button);
});

test("says how to copy by hand when the clipboard fails", async () => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
  vi.mocked(ollamaStatus).mockResolvedValue(unreachable);
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Couldn't copy. Select the command and copy it by hand.")).toBeTruthy();
});

test("explains what to do when Ollama has no models", async () => {
  vi.mocked(ollamaStatus).mockResolvedValue({ ...unreachable, reachable: true, version: "0.12.6" });
  renderCard();
  expect(await screen.findByText(/Ollama has no models yet/)).toBeTruthy();
  expect(screen.getByText("ollama pull phi4-mini")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download phi4-mini" })).toBeTruthy();
});

test("rejects a port out of range without calling the backend", async () => {
  renderCard();
  const field = await screen.findByLabelText("Port");
  fireEvent.change(field, { target: { value: "70000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a port from 1 to 65535.");
  expect(setOllamaPort).not.toHaveBeenCalled();
});

test("saves the port once while busy, then says Saved and refreshes the status", async () => {
  let resolve: (value: OllamaSettings) => void = () => {};
  vi.mocked(setOllamaPort).mockReturnValue(new Promise((r) => (resolve = r)));
  renderCard();
  fireEvent.change(await screen.findByLabelText("Port"), { target: { value: "11500" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const busy = await screen.findByRole("button", { name: "Saving…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(setOllamaPort).toHaveBeenCalledTimes(1);
  expect(vi.mocked(setOllamaPort).mock.calls[0][0]).toEqual({ port: 11500 });

  resolve({ ...settings, port: 11500 });
  expect(await screen.findByText("Saved.")).toBeTruthy();
  await waitFor(() => expect(ollamaStatus).toHaveBeenCalledTimes(2));
});

test("shows a backend port Validation error under the field", async () => {
  vi.mocked(setOllamaPort).mockRejectedValue({ kind: "Validation", message: "Enter a port from 1 to 65535." });
  renderCard();
  fireEvent.change(await screen.findByLabelText("Port"), { target: { value: "11500" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a port from 1 to 65535.");
});

test("shows any other port save error in an alert", async () => {
  vi.mocked(setOllamaPort).mockRejectedValue({ kind: "Database", message: "database is locked" });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the port")).toBeTruthy();
  expect(within(alert).getByText("database is locked")).toBeTruthy();
});

function pickModel(name: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Base model" }), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("option", { name }), { key: "Enter" });
}

test("saves a picked base model and says Saved", async () => {
  vi.mocked(setBaseModel).mockResolvedValue({ ...settings, baseModel: "zeni-2:latest" });
  renderCard();
  await screen.findByText("Ollama 0.12.6 is running.");
  pickModel("zeni-2:latest");
  expect(await screen.findByText("Saved.")).toBeTruthy();
  expect(vi.mocked(setBaseModel).mock.calls[0][0]).toEqual({ name: "zeni-2:latest" });
  expect(screen.getByRole("combobox", { name: "Base model" }).textContent).toBe("zeni-2:latest");
});

test("shows a base model save error in an alert", async () => {
  vi.mocked(setBaseModel).mockRejectedValue({ kind: "Validation", message: "That model isn't installed." });
  renderCard();
  await screen.findByText("Ollama 0.12.6 is running.");
  pickModel("zeni-2:latest");
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the base model")).toBeTruthy();
  expect(within(alert).getByText("That model isn't installed.")).toBeTruthy();
});

test("asks before downloading, then shows progress, cancels once while busy and reports the outcome", async () => {
  vi.mocked(startModelDownload).mockResolvedValue(downloading);
  let resolveCancel: (value: null) => void = () => {};
  vi.mocked(cancelJob).mockReturnValue(new Promise((r) => (resolveCancel = r)));
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Download qwen2.5:3b" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Download qwen2.5:3b (1.9 GB)?" });
  vi.mocked(jobStatus).mockResolvedValue(downloading);
  fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));
  await waitFor(() => expect(vi.mocked(startModelDownload).mock.calls[0]?.[0]).toEqual({ name: "qwen2.5:3b" }));

  const bar = await screen.findByRole("progressbar", { name: "Downloading qwen2.5:3b (0.5 GB of 1.9 GB)" });
  // 0.5 of 1.93 GB is 25%.
  expect(bar.getAttribute("aria-valuenow")).toBe("25");
  // The progress line already names the download.
  expect(screen.queryByText("Downloading qwen2.5:3b…")).toBeNull();
  expect(screen.getByRole("button", { name: "Download qwen2.5:3b" }).getAttribute("aria-describedby")).toBe(
    screen.getByText(/^Downloading qwen2.5:3b/).id,
  );

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const busy = await screen.findByRole("button", { name: "Cancelling…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(cancelJob).toHaveBeenCalledTimes(1);

  vi.mocked(jobStatus).mockResolvedValue(finished({ cancelled: true }));
  resolveCancel(null);
  expect(await screen.findByText("Cancelled the download of qwen2.5:3b.")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  await waitFor(() => expect(ollamaStatus).toHaveBeenCalledTimes(2));
  expect(ollamaSettings).toHaveBeenCalledTimes(2);
});

test("returns focus to the Download button when the confirm is cancelled", async () => {
  renderCard();
  const button = await screen.findByRole("button", { name: "Download qwen2.5:3b" });
  fireEvent.click(button);
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(button);
  expect(startModelDownload).not.toHaveBeenCalled();
});

test("shows the progress again when mounted mid-download, then the finished message", async () => {
  vi.mocked(jobStatus).mockResolvedValueOnce(downloading).mockResolvedValue(finished({}));
  renderCard();
  expect(await screen.findByRole("progressbar")).toBeTruthy();
  // The next poll, about 500 ms later, finds the download finished.
  expect(await screen.findByText("Downloaded qwen2.5:3b. It's now your base model.", {}, { timeout: 2000 })).toBeTruthy();
  await waitFor(() => expect(ollamaSettings).toHaveBeenCalledTimes(2));
});

test("doesn't show an old download outcome it didn't see running", async () => {
  vi.mocked(jobStatus).mockResolvedValue(finished({}));
  renderCard();
  await screen.findByText("Ollama 0.12.6 is running.");
  expect(screen.queryByText(/Downloaded/)).toBeNull();
});

test("shows a failed download's Ollama message in an alert", async () => {
  vi.mocked(jobStatus).mockResolvedValueOnce(downloading).mockResolvedValue(finished({ error: ollamaError.message }));
  renderCard();
  const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
  expect(within(alert).getByText("Couldn't download qwen2.5:3b")).toBeTruthy();
  expect(within(alert).getByText(ollamaError.message)).toBeTruthy();
});

test("shows a download start error in an alert", async () => {
  vi.mocked(startModelDownload).mockRejectedValue(ollamaError);
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Download qwen2.5:3b" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Download" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't start the download")).toBeTruthy();
  expect(within(alert).getByText(ollamaError.message)).toBeTruthy();
});

test("shows a cancel error in an alert", async () => {
  vi.mocked(jobStatus).mockResolvedValue(downloading);
  vi.mocked(cancelJob).mockRejectedValue({ kind: "Invoke", message: "not running in Tauri" });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't cancel the download")).toBeTruthy();
});

test("disables Download while another job runs and names it", async () => {
  vi.mocked(jobStatus).mockResolvedValue({ running: { kind: "categorizeNow", label: "Categorize now", done: 3, total: 40 }, last: null });
  renderCard();
  expect(await screen.findByText("Categorizing…")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Download qwen2.5:3b" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.getAttribute("aria-describedby")).toBeTruthy();
  fireEvent.click(button);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test.each([
  ["settings", () => vi.mocked(ollamaSettings), "Couldn't load Ollama settings"],
  ["status", () => vi.mocked(ollamaStatus), "Couldn't check Ollama"],
  ["job status", () => vi.mocked(jobStatus), "Couldn't check for a running download"],
])("shows a %s load error in an alert", async (_name, command, title) => {
  command().mockRejectedValue({ kind: "Invoke", message: "not running in Tauri" });
  renderCard();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText(title)).toBeTruthy();
  expect(within(alert).getByText("not running in Tauri")).toBeTruthy();
});
