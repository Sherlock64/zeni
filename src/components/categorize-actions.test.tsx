import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CategorizeActions } from "@/components/categorize-actions";
import { jobStatus, ollamaSettings, ollamaStatus, startCategorize } from "@/lib/commands";
import type { JobStatus } from "@/types/bindings/JobStatus";
import type { OllamaSettings } from "@/types/bindings/OllamaSettings";
import type { OllamaStatus } from "@/types/bindings/OllamaStatus";

vi.mock("@/lib/commands", () => ({
  ollamaSettings: vi.fn(),
  ollamaStatus: vi.fn(),
  jobStatus: vi.fn(),
  startCategorize: vi.fn(),
}));

const settings: OllamaSettings = { port: 11434, baseModel: "phi4-mini", autoCategorize: true, examplesPerCategory: 5 };
const reachable: OllamaStatus = { reachable: true, version: "0.12.6", installed: [{ name: "phi4-mini", sizeBytes: 1 }], recommended: [] };
const idle: JobStatus = { running: null, last: null };
const started: JobStatus = { running: { kind: "categorizeNow", label: "Categorize now", done: 0, total: 42 }, last: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ollamaSettings).mockResolvedValue(settings);
  vi.mocked(ollamaStatus).mockResolvedValue(reachable);
  vi.mocked(jobStatus).mockResolvedValue(idle);
});

function renderActions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CategorizeActions />
    </QueryClientProvider>,
  );
}

const button = (name: string) => screen.getByRole("button", { name });
const disabled = (name: string) => button(name).getAttribute("aria-disabled");
const description = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent;
const ready = () => waitFor(() => expect(disabled("Categorize now")).toBe("false"));

test("Categorize now starts an uncategorized run once while busy", async () => {
  let resolve!: (value: JobStatus) => void;
  vi.mocked(startCategorize).mockReturnValue(new Promise((r) => (resolve = r)));
  renderActions();
  await ready();

  fireEvent.click(button("Categorize now"));
  await waitFor(() => expect(disabled("Categorize now")).toBe("true"));
  fireEvent.click(button("Categorize now"));
  fireEvent.click(button("Recategorize all"));
  expect(startCategorize).toHaveBeenCalledTimes(1);
  expect(vi.mocked(startCategorize).mock.calls[0][0]).toEqual({ scope: "uncategorized" });
  expect(screen.queryByRole("alertdialog")).toBeNull();

  resolve(started);
  // The started job is running, so both buttons stay disabled with its name.
  expect(await screen.findByText("Categorize now is running.")).toBeTruthy();
  expect(description(button("Recategorize all"))).toBe("Categorize now is running.");
});

test("Recategorize all asks first, and Cancel starts nothing and returns focus", async () => {
  vi.mocked(startCategorize).mockResolvedValue(started);
  renderActions();
  await ready();

  fireEvent.click(button("Recategorize all"));
  await screen.findByRole("alertdialog", { name: "Recategorize all?" });
  expect(screen.getByText(/^Rows you set yourself or that a nickname sets stay as they are\./).textContent).toContain(
    "Model answers you already reviewed are replaced and need reviewing again.",
  );
  // Cancel is the safe default.
  expect(document.activeElement).toBe(button("Cancel"));
  fireEvent.click(button("Cancel"));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(startCategorize).not.toHaveBeenCalled();
  expect(button("Recategorize all")).toBe(document.activeElement);

  fireEvent.click(button("Recategorize all"));
  await screen.findByRole("alertdialog");
  fireEvent.click(button("Recategorize all"));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(vi.mocked(startCategorize).mock.calls.map(([request]) => request)).toEqual([{ scope: "notUserSet" }]);
  await waitFor(() => expect(button("Recategorize all")).toBe(document.activeElement));
});

test.each([
  ["Ollama is unreachable", () => vi.mocked(ollamaStatus).mockResolvedValue({ ...reachable, reachable: false }), "Start Ollama to categorize."],
  ["no model is picked", () => vi.mocked(ollamaSettings).mockResolvedValue({ ...settings, baseModel: null }), "Pick a model in Settings to categorize."],
  [
    "another job runs",
    () => vi.mocked(jobStatus).mockResolvedValue({ running: { kind: "download", label: "Download qwen2.5:3b", done: 1, total: 2 }, last: null }),
    "Download qwen2.5:3b is running.",
  ],
])("the buttons are disabled with the reason when %s", async (_, arrange, reason) => {
  arrange();
  renderActions();

  expect(await screen.findByText(reason)).toBeTruthy();
  for (const name of ["Categorize now", "Recategorize all"]) {
    expect(disabled(name)).toBe("true");
    expect(description(button(name))).toBe(reason);
    fireEvent.click(button(name));
  }
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(startCategorize).not.toHaveBeenCalled();
});

test("offers Settings when Ollama is unreachable", async () => {
  vi.mocked(ollamaStatus).mockResolvedValue({ ...reachable, reachable: false });
  renderActions();

  const link = await screen.findByRole("link", { name: "Set it up in Settings." });
  expect(link.getAttribute("href")).toBe("#/settings");
});

test("shows the error when starting fails", async () => {
  vi.mocked(startCategorize).mockRejectedValue({ kind: "Ollama", message: "Pick a model in Settings first." });
  renderActions();
  await ready();

  fireEvent.click(button("Categorize now"));
  expect(await screen.findByText("Couldn't start categorizing")).toBeTruthy();
  expect(screen.getByText("Pick a model in Settings first.")).toBeTruthy();
  expect(screen.getByText("Pick a base model in Settings → Ollama.")).toBeTruthy();
});

test("shows the Busy next step when another job got there first", async () => {
  vi.mocked(startCategorize).mockRejectedValue({ kind: "Busy", message: "Categorize now is running. Wait for it to finish or cancel it." });
  renderActions();
  await ready();

  fireEvent.click(button("Categorize now"));
  expect(await screen.findByText("Wait for it to finish, or cancel it from the banner.")).toBeTruthy();
});

test.each([
  ["Ollama's status", () => vi.mocked(ollamaStatus), "Couldn't check Ollama"],
  ["the Ollama settings", () => vi.mocked(ollamaSettings), "Couldn't load Ollama settings"],
  ["the job status", () => vi.mocked(jobStatus), "Couldn't check for a running job"],
])("shows the error when %s fails to load and keeps the buttons disabled", async (_, mock, title) => {
  mock().mockRejectedValue({ kind: "Sample", message: "Something broke." });
  renderActions();

  expect(await screen.findByText(title)).toBeTruthy();
  expect(disabled("Categorize now")).toBe("true");
  fireEvent.click(button("Categorize now"));
  expect(startCategorize).not.toHaveBeenCalled();
});
