import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModelBuildsSection } from "@/components/model-builds-section";
import {
  activateBuild,
  deleteBuild,
  jobStatus,
  listBuilds,
  ollamaSettings,
  ollamaStatus,
  setExamplesPerCategory,
  startBuild,
} from "@/lib/commands";
import type { JobStatus } from "@/types/bindings/JobStatus";
import type { ModelBuild } from "@/types/bindings/ModelBuild";
import type { OllamaSettings } from "@/types/bindings/OllamaSettings";
import type { OllamaStatus } from "@/types/bindings/OllamaStatus";

vi.mock("@/lib/commands", () => ({
  listBuilds: vi.fn(),
  startBuild: vi.fn(),
  activateBuild: vi.fn(),
  deleteBuild: vi.fn(),
  ollamaSettings: vi.fn(),
  ollamaStatus: vi.fn(),
  setExamplesPerCategory: vi.fn(),
  jobStatus: vi.fn(),
}));

const settings: OllamaSettings = { port: 11434, baseModel: "phi4-mini", autoCategorize: true, examplesPerCategory: 5 };
const reachable: OllamaStatus = { reachable: true, version: "0.12.6", installed: [{ name: "phi4-mini:latest", sizeBytes: 1 }], recommended: [] };
const builds: ModelBuild[] = [
  { id: 2, name: "zeni-2", baseModel: "phi4-mini", createdAt: "2026-11-10 19:22:04", exampleCount: 41, active: true, outOfDate: false },
  { id: 1, name: "zeni-1", baseModel: "qwen2.5:3b", createdAt: "2026-11-03 08:15:47", exampleCount: 1, active: false, outOfDate: true },
];
const idle: JobStatus = { running: null, last: null };
const building: JobStatus = { running: { kind: "build", label: "Build zeni-3", done: 0, total: 0 }, last: null };
const built = (error: string | null): JobStatus => ({
  running: null,
  last: { kind: "build", label: "Build zeni-3", cancelled: false, error, summary: null },
});
const invokeError = { kind: "Invoke", message: "not running in Tauri" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listBuilds).mockResolvedValue(builds);
  vi.mocked(ollamaSettings).mockResolvedValue(settings);
  vi.mocked(ollamaStatus).mockResolvedValue(reachable);
  vi.mocked(jobStatus).mockResolvedValue(idle);
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ModelBuildsSection />
    </QueryClientProvider>,
  );
}

const pending = () => new Promise<never>(() => {});
const buildButton = () => screen.findByRole("button", { name: /^(Build|Rebuild)$/ });
// Build stays disabled until the settings, the status and the job status have loaded.
async function readyBuildButton() {
  const button = await buildButton();
  await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("false"));
  return button;
}

test("shows a loading state for the builds", () => {
  vi.mocked(listBuilds).mockReturnValue(pending());
  renderSection();
  expect(screen.getByRole("status", { name: "Loading model builds…" })).toBeTruthy();
});

test("lists builds with base model, date, example count and badges", async () => {
  renderSection();
  const items = await screen.findAllByRole("listitem");
  expect(items[0].textContent).toContain("zeni-2");
  expect(within(items[0]).getByText("Active")).toBeTruthy();
  expect(within(items[0]).queryByText("Out of date")).toBeNull();
  expect(within(items[0]).getByText("From phi4-mini on Nov 10, 2026, 41 examples")).toBeTruthy();
  expect(within(items[0]).queryByRole("button", { name: "Make zeni-2 active" })).toBeNull();
  expect(within(items[1]).getByText("Out of date")).toBeTruthy();
  expect(within(items[1]).getByText("From qwen2.5:3b on Nov 3, 2026, 1 example")).toBeTruthy();
  expect(within(items[1]).getByRole("button", { name: "Make zeni-1 active" })).toBeTruthy();
  expect((await buildButton()).textContent).toBe("Build");
});

test("shows the empty state", async () => {
  vi.mocked(listBuilds).mockResolvedValue([]);
  renderSection();
  expect(await screen.findByText("No builds yet")).toBeTruthy();
  expect(screen.getByText("Review some rows, then build a model that learns from them.")).toBeTruthy();
});

test.each([
  ["builds", () => vi.mocked(listBuilds), "Couldn't load model builds"],
  ["job status", () => vi.mocked(jobStatus), "Couldn't check for a running build"],
])("shows a %s load error in an alert", async (_name, command, title) => {
  command().mockRejectedValue(invokeError);
  renderSection();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText(title)).toBeTruthy();
  expect(within(alert).getByText(invokeError.message)).toBeTruthy();
});

test("starts a build once while busy, shows it running, then refreshes the list when it ends", async () => {
  let resolve: (value: JobStatus) => void = () => {};
  vi.mocked(startBuild).mockReturnValue(new Promise((r) => (resolve = r)));
  renderSection();
  fireEvent.click(await readyBuildButton());
  const starting = await screen.findByRole("button", { name: "Starting…" });
  expect(starting.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(starting);
  expect(startBuild).toHaveBeenCalledTimes(1);

  vi.mocked(jobStatus).mockResolvedValue(built(null));
  resolve(building);
  const running = await screen.findByRole("button", { name: "Building zeni-3…" });
  expect(running.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(running);
  expect(startBuild).toHaveBeenCalledTimes(1);

  // The next poll, about 500 ms later, finds the build finished.
  expect(await screen.findByRole("button", { name: "Build" }, { timeout: 2000 })).toBeTruthy();
  await waitFor(() => expect(listBuilds).toHaveBeenCalledTimes(2));
  expect(ollamaStatus).toHaveBeenCalledTimes(2);
});

test("shows a build start error, such as no examples, in an alert", async () => {
  const message = "Review some rows first: a build needs at least one example.";
  vi.mocked(startBuild).mockRejectedValue({ kind: "Validation", message });
  renderSection();
  fireEvent.click(await readyBuildButton());
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't start the build")).toBeTruthy();
  expect(within(alert).getByText(message)).toBeTruthy();
  expect(within(alert).queryByText("Check your entries, then try again.")).toBeNull();
});

test("shows a failed build's Ollama message in an alert", async () => {
  vi.mocked(jobStatus).mockResolvedValueOnce(building).mockResolvedValue(built("Ollama said: model not found"));
  renderSection();
  const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
  expect(within(alert).getByText("Couldn't build zeni-3")).toBeTruthy();
  expect(within(alert).getByText("Ollama said: model not found")).toBeTruthy();
});

test("doesn't show an old build outcome it didn't see running", async () => {
  vi.mocked(jobStatus).mockResolvedValue(built("Ollama said: model not found"));
  renderSection();
  await screen.findAllByRole("listitem");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("makes a build active once while busy, then refreshes the list", async () => {
  let resolve: (value: null) => void = () => {};
  vi.mocked(activateBuild).mockReturnValue(new Promise((r) => (resolve = r)));
  renderSection();
  fireEvent.click(await screen.findByRole("button", { name: "Make zeni-1 active" }));
  const busy = await screen.findByRole("button", { name: "Make zeni-1 active" });
  await waitFor(() => expect(busy.getAttribute("aria-disabled")).toBe("true"));
  expect(busy.textContent).toBe("Saving…");
  fireEvent.click(busy);
  expect(activateBuild).toHaveBeenCalledTimes(1);
  expect(vi.mocked(activateBuild).mock.calls[0]?.[0]).toEqual({ id: 1 });
  resolve(null);
  await waitFor(() => expect(listBuilds).toHaveBeenCalledTimes(2));
});

test("moves focus to the heading once the made-active build's button is gone", async () => {
  vi.mocked(activateBuild).mockResolvedValue(null);
  renderSection();
  const button = await screen.findByRole("button", { name: "Make zeni-1 active" });
  button.focus();
  vi.mocked(listBuilds).mockResolvedValue(builds.map((build) => ({ ...build, active: build.id === 1 })));
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Make zeni-1 active" })).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Model builds" }));
});

test("shows a make active error in an alert", async () => {
  vi.mocked(activateBuild).mockRejectedValue({ kind: "NotFound", message: "That build no longer exists." });
  renderSection();
  fireEvent.click(await screen.findByRole("button", { name: "Make zeni-1 active" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't make the build active")).toBeTruthy();
});

test("asks before deleting and returns focus to Delete when cancelled", async () => {
  renderSection();
  const button = await screen.findByRole("button", { name: "Delete zeni-2" });
  fireEvent.click(button);
  const dialog = await screen.findByRole("alertdialog", { name: "Delete zeni-2?" });
  expect(within(dialog).getByText(/It's removed from Ollama too\./)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(button);
  expect(deleteBuild).not.toHaveBeenCalled();
});

test("deletes once while busy, closes the confirm, refreshes and focuses the heading", async () => {
  let resolve: (value: null) => void = () => {};
  vi.mocked(deleteBuild).mockReturnValue(new Promise((r) => (resolve = r)));
  renderSection();
  fireEvent.click(await screen.findByRole("button", { name: "Delete zeni-1" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete zeni-1?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete build" }));
  const busy = await within(dialog).findByRole("button", { name: "Deleting…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(deleteBuild).toHaveBeenCalledTimes(1);
  expect(vi.mocked(deleteBuild).mock.calls[0]?.[0]).toEqual({ id: 1 });
  resolve(null);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(listBuilds).toHaveBeenCalledTimes(2));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Model builds" }));
});

test("shows a delete error in the confirm", async () => {
  vi.mocked(deleteBuild).mockRejectedValue({ kind: "Ollama", message: "Ollama isn't running on port 11434. Start it with `ollama serve`." });
  renderSection();
  fireEvent.click(await screen.findByRole("button", { name: "Delete zeni-1" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete build" }));
  const alert = await within(dialog).findByRole("alert");
  expect(within(alert).getByText("Couldn't delete the build")).toBeTruthy();
});

test("rejects examples out of range without calling the backend", async () => {
  renderSection();
  const field = await screen.findByLabelText("Examples per category");
  expect((field as HTMLInputElement).value).toBe("5");
  fireEvent.change(field, { target: { value: "21" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a number from 1 to 20.");
  expect(setExamplesPerCategory).not.toHaveBeenCalled();
});

test("saves examples once while busy, then says Saved", async () => {
  let resolve: (value: OllamaSettings) => void = () => {};
  vi.mocked(setExamplesPerCategory).mockReturnValue(new Promise((r) => (resolve = r)));
  renderSection();
  fireEvent.change(await screen.findByLabelText("Examples per category"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const busy = await screen.findByRole("button", { name: "Saving…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(setExamplesPerCategory).toHaveBeenCalledTimes(1);
  expect(vi.mocked(setExamplesPerCategory).mock.calls[0]?.[0]).toEqual({ count: 8 });
  resolve({ ...settings, examplesPerCategory: 8 });
  expect(await screen.findByText("Saved.")).toBeTruthy();
});

test("shows a backend examples Validation error under the field", async () => {
  vi.mocked(setExamplesPerCategory).mockRejectedValue({ kind: "Validation", message: "Enter a number from 1 to 20." });
  renderSection();
  await screen.findByLabelText("Examples per category");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a number from 1 to 20.");
  expect(screen.getByLabelText("Examples per category").getAttribute("aria-invalid")).toBe("true");
});

test("shows any other examples save error in an alert", async () => {
  vi.mocked(setExamplesPerCategory).mockRejectedValue({ kind: "Locked", message: "Zeni is locked." });
  renderSection();
  await screen.findByLabelText("Examples per category");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the examples per category")).toBeTruthy();
});

test("suggests Rebuild when the active build is out of date", async () => {
  vi.mocked(listBuilds).mockResolvedValue([{ ...builds[0], outOfDate: true }, builds[1]]);
  vi.mocked(startBuild).mockResolvedValue(building);
  renderSection();
  expect(await screen.findByText(/zeni-2 is out of date/)).toBeTruthy();
  fireEvent.click(await readyBuildButton());
  await waitFor(() => expect(startBuild).toHaveBeenCalledTimes(1));
});

test("doesn't suggest Rebuild when only an inactive build is out of date", async () => {
  renderSection();
  await screen.findAllByRole("listitem");
  expect(screen.queryByText(/is out of date/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Rebuild" })).toBeNull();
});

test.each([
  ["Ollama is unreachable", () => vi.mocked(ollamaStatus).mockResolvedValue({ ...reachable, reachable: false }), "Start Ollama to build a model."],
  ["no base model is picked", () => vi.mocked(ollamaSettings).mockResolvedValue({ ...settings, baseModel: null }), "Pick a base model to build."],
  [
    "another job runs",
    () => vi.mocked(jobStatus).mockResolvedValue({ running: { kind: "categorizeNow", label: "Categorize now", done: 3, total: 40 }, last: null }),
    "Categorizing…",
  ],
])("disables Build with the reason when %s", async (_name, arrange, reason) => {
  arrange();
  renderSection();
  const text = await screen.findByText(reason);
  const button = await buildButton();
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.getAttribute("aria-describedby")).toBe(text.id);
  fireEvent.click(button);
  expect(startBuild).not.toHaveBeenCalled();
});
