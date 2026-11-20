import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CategorizeBanner } from "@/components/categorize-banner";
import { invalidateJobStatus } from "@/hooks/use-job-status";
import { cancelJob, clearJobOutcome, jobStatus } from "@/lib/commands";
import { BUILDS_KEY, CATEGORIES_KEY, JOB_STATUS_KEY, REVIEW_GROUPS_KEY, TRANSACTIONS_KEY, UNREVIEWED_COUNT_KEY } from "@/lib/query-keys";
import type { JobOutcome } from "@/types/bindings/JobOutcome";
import type { JobStatus } from "@/types/bindings/JobStatus";

vi.mock("@/lib/commands", () => ({ jobStatus: vi.fn(), cancelJob: vi.fn(), clearJobOutcome: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const running = (done: number, total = 42): JobStatus => ({
  running: { kind: "categorizeNow", label: "Categorize now", done, total },
  last: null,
});
const finished = (outcome: Partial<JobOutcome> = {}): JobStatus => ({
  running: null,
  last: {
    kind: "categorizeNow",
    label: "Categorize now",
    cancelled: false,
    error: null,
    summary: { categorized: 38, couldntCategorize: 3, notReached: 1 },
    ...outcome,
  },
});

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <main>
        <h1 tabIndex={-1}>Transactions</h1>
        <CategorizeBanner />
      </main>
    </QueryClientProvider>,
  );
  return client;
}

const button = (name: string) => screen.getByRole("button", { name });
const status = () => screen.getByRole("status").textContent;
// The sr-only status repeats the visible lines; match the visible ones.
const visibleText = { ignore: "[role=status]" };
// Stands in for the next 500 ms poll, so no test waits on real time.
const poll = (client: QueryClient, next: JobStatus) => {
  vi.mocked(jobStatus).mockResolvedValue(next);
  return act(() => invalidateJobStatus(client));
};

test("shows progress outside the live region, announces it coarsely, then the summary, and refreshes the data", async () => {
  vi.mocked(jobStatus).mockResolvedValue(running(0));
  const client = renderBanner();
  const invalidate = vi.spyOn(client, "invalidateQueries");

  const label = await screen.findByText("Categorizing 0 of 42");
  expect(screen.getByRole("status").contains(label)).toBe(false);
  expect(status()).toBe("Categorizing…");

  await poll(client, running(18));
  // 18 of 42 is 42%.
  expect((await screen.findByRole("progressbar", { name: "Categorizing 18 of 42" })).getAttribute("aria-valuenow")).toBe("42");
  expect(status()).toBe("Categorizing… 25% done.");
  await poll(client, running(20));
  expect(await screen.findByText("Categorizing 20 of 42")).toBeTruthy();
  expect(status()).toBe("Categorizing… 25% done.");

  await poll(client, finished());
  const summary = "Categorized 38. Couldn't categorize 3. Not reached 1.";
  expect(await screen.findByText(summary, visibleText)).toBeTruthy();
  expect(status()).toBe(summary);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("link", { name: "Review them" }).getAttribute("href")).toBe("#/review");
  for (const queryKey of [TRANSACTIONS_KEY, REVIEW_GROUPS_KEY, UNREVIEWED_COUNT_KEY, CATEGORIES_KEY]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: BUILDS_KEY });
});

test("offers no review link when nothing was categorized", async () => {
  vi.mocked(jobStatus).mockResolvedValue(finished({ summary: { categorized: 0, couldntCategorize: 2, notReached: 0 } }));
  renderBanner();

  expect(await screen.findByText("Categorized 0. Couldn't categorize 2. Not reached 0.", visibleText)).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

test("shows a running build with an animated bar and Cancel, then that it was built, and refreshes the builds", async () => {
  const build = { kind: "build", label: "Build zeni-3" } as const;
  vi.mocked(jobStatus).mockResolvedValue({ running: { ...build, done: 0, total: 0 }, last: null });
  const client = renderBanner();
  const invalidate = vi.spyOn(client, "invalidateQueries");

  const bar = await screen.findByRole("progressbar", { name: "Building zeni-3…" });
  expect(bar.className).toContain("animate-pulse");
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  expect(button("Cancel")).toBeTruthy();
  expect(status()).toBe("Building zeni-3…");

  await poll(client, { running: null, last: { ...build, cancelled: false, error: null, summary: null } });
  expect(await screen.findByText("Built zeni-3.", visibleText)).toBeTruthy();
  expect(status()).toBe("Built zeni-3.");
  expect(button("Dismiss")).toBeTruthy();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: BUILDS_KEY });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: TRANSACTIONS_KEY });
});

test("a counted run's bar doesn't pulse", async () => {
  vi.mocked(jobStatus).mockResolvedValue(running(5));
  renderBanner();

  expect((await screen.findByRole("progressbar")).className).not.toContain("animate-pulse");
});

test.each([
  [{ cancelled: true, error: null }, "The build of zeni-3 was cancelled."],
  [{ cancelled: false, error: "Ollama said: model not found" }, "The build of zeni-3 stopped."],
])("shows a build that didn't finish", async (outcome, text) => {
  vi.mocked(jobStatus).mockResolvedValue({ running: null, last: { kind: "build", label: "Build zeni-3", summary: null, ...outcome } });
  renderBanner();

  expect(await screen.findByText(text, visibleText)).toBeTruthy();
  expect(status()).toBe(text);
  expect(screen.queryByText(/^Built/)).toBeNull();
});

test("Cancel cancels the run once while busy, then moves focus to the heading", async () => {
  let resolve!: (value: null) => void;
  vi.mocked(jobStatus).mockResolvedValue(running(5));
  vi.mocked(cancelJob).mockReturnValue(new Promise((r) => (resolve = r)));
  renderBanner();

  const cancel = await screen.findByRole("button", { name: "Cancel" });
  cancel.focus();
  fireEvent.click(cancel);
  const busy = await screen.findByRole("button", { name: "Cancelling…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(cancelJob).toHaveBeenCalledTimes(1);

  vi.mocked(jobStatus).mockResolvedValue(finished({ cancelled: true }));
  resolve(null);
  expect(await screen.findByText("Categorizing was cancelled.", visibleText)).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Transactions" })));
});

test("shows a stopped run's error as an Ollama alert outside the status, with the summary in it", async () => {
  vi.mocked(jobStatus).mockResolvedValue(
    finished({
      error: "Ollama isn't running on port 11434. Start it with `ollama serve`.",
      summary: { categorized: 11, couldntCategorize: 1, notReached: 30 },
    }),
  );
  renderBanner();

  const alert = await screen.findByRole("alert");
  expect(screen.getByRole("status").contains(alert)).toBe(false);
  expect(alert.textContent).toContain("Ollama");
  expect(screen.getByText("ollama serve").tagName).toBe("CODE");
  expect(alert.textContent).toContain("Check that Ollama is running, then try again.");
  expect(screen.getByText("Categorizing stopped after 12 rows.", visibleText)).toBeTruthy();
  expect(status()).toBe("Categorizing stopped after 12 rows. Categorized 11. Couldn't categorize 1. Not reached 30.");
});

test("Dismiss clears the summary once while busy, then moves focus to the heading", async () => {
  let resolve!: (value: null) => void;
  vi.mocked(jobStatus).mockResolvedValue(finished());
  vi.mocked(clearJobOutcome).mockReturnValue(new Promise((r) => (resolve = r)));
  renderBanner();

  const dismiss = await screen.findByRole("button", { name: "Dismiss" });
  dismiss.focus();
  fireEvent.click(dismiss);
  await waitFor(() => expect(button("Dismiss").getAttribute("aria-disabled")).toBe("true"));
  fireEvent.click(button("Dismiss"));
  expect(clearJobOutcome).toHaveBeenCalledTimes(1);

  vi.mocked(jobStatus).mockResolvedValue({ running: null, last: null });
  resolve(null);
  await waitFor(() => expect(screen.queryByText(/Categorized 38/)).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Transactions" }));
  expect(status()).toBe("");
});

test("leaves focus alone when it is elsewhere as the summary goes", async () => {
  vi.mocked(jobStatus).mockResolvedValue(finished());
  const client = renderBanner();
  await screen.findByRole("button", { name: "Dismiss" });
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere);
  elsewhere.focus();

  await poll(client, { running: null, last: null });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull());
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});

test.each([
  [{ running: { kind: "download", label: "Download qwen2.5:3b", done: 1, total: 2 }, last: null }],
  [{ running: null, last: { kind: "download", label: "Download qwen2.5:3b", cancelled: false, error: null, summary: null } }],
] as JobStatus[][])("shows nothing for downloads", async (job) => {
  vi.mocked(jobStatus).mockResolvedValue(job);
  const client = renderBanner();

  await waitFor(() => expect(client.getQueryState(JOB_STATUS_KEY)?.status).toBe("success"));
  expect(screen.queryByRole("button")).toBeNull();
  expect(status()).toBe("");
});

test.each([
  ["checking the job", () => vi.mocked(jobStatus).mockRejectedValue({ kind: "NotFound", message: "Broke." }), null, "Couldn't check the running job"],
  [
    "cancelling",
    () => {
      vi.mocked(jobStatus).mockResolvedValue(running(5));
      vi.mocked(cancelJob).mockRejectedValue({ kind: "NotFound", message: "Broke." });
    },
    "Cancel",
    "Couldn't cancel the job",
  ],
  [
    "dismissing",
    () => {
      vi.mocked(jobStatus).mockResolvedValue(finished());
      vi.mocked(clearJobOutcome).mockRejectedValue({ kind: "NotFound", message: "Broke." });
    },
    "Dismiss",
    "Couldn't dismiss the summary",
  ],
])("shows the error when %s fails", async (_, arrange, press, title) => {
  arrange();
  renderBanner();

  if (press) fireEvent.click(await screen.findByRole("button", { name: press }));
  expect(await screen.findByText(title)).toBeTruthy();
});
