import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { invalidateJobStatus, useJobStatus } from "@/hooks/use-job-status";
import { jobStatus } from "@/lib/commands";
import type { JobStatus } from "@/types/bindings/JobStatus";

vi.mock("@/lib/commands", () => ({ jobStatus: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const idle: JobStatus = { running: null, last: null };
const running: JobStatus = { running: { kind: "categorizeNow", label: "Categorize now", done: 3, total: 10 }, last: null };

function Probe() {
  const status = useJobStatus();
  return <p>{status.data ? (status.data.running?.label ?? "idle") : "loading"}</p>;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return client;
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

test("polls every 500 ms while a job runs and stops once it ends", async () => {
  vi.mocked(jobStatus).mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValue(idle);
  renderProbe();
  await advance(0);
  expect(screen.getByText("Categorize now")).toBeTruthy();

  await advance(499);
  expect(jobStatus).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(jobStatus).toHaveBeenCalledTimes(2);
  // The second answer is still running, so it polls once more and gets idle.
  await advance(1000);
  expect(screen.getByText("idle")).toBeTruthy();
  const calls = vi.mocked(jobStatus).mock.calls.length;
  await advance(5000);
  expect(jobStatus).toHaveBeenCalledTimes(calls);
});

test("fetches once when idle and again when invalidated", async () => {
  vi.mocked(jobStatus).mockResolvedValueOnce(idle).mockResolvedValue(running);
  const client = renderProbe();
  await advance(5000);
  expect(jobStatus).toHaveBeenCalledTimes(1);

  await act(() => invalidateJobStatus(client));
  await advance(0);
  expect(screen.getByText("Categorize now")).toBeTruthy();
  await advance(500);
  expect(jobStatus).toHaveBeenCalledTimes(3);
});
