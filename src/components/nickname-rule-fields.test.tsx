import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { NicknameRuleFields, RuleMatchCount } from "@/components/nickname-rule-fields";
import { countRuleMatches } from "@/lib/commands";
import type { RuleInput } from "@/types/bindings/RuleInput";

vi.mock("@/lib/commands", () => ({ countRuleMatches: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function Harness({ error }: { error?: string }) {
  const [rule, setRule] = useState<RuleInput>({ mode: "contains", field: "description", pattern: "" });
  return <NicknameRuleFields value={rule} onChange={setRule} error={error} />;
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const renderFields = (error?: string) => renderWithClient(<Harness error={error} />);

test("counts only once typing pauses, and not for a blank pattern", async () => {
  vi.useFakeTimers();
  vi.mocked(countRuleMatches).mockResolvedValue(4);
  renderFields();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(countRuleMatches).not.toHaveBeenCalled();
  expect(screen.queryByText(/Matches/)).toBeNull();

  fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "cof" } });
  await act(() => vi.advanceTimersByTimeAsync(100));
  fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "coffee" } });
  await act(() => vi.advanceTimersByTimeAsync(299));
  expect(countRuleMatches).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(countRuleMatches).toHaveBeenCalledTimes(1);
  expect(countRuleMatches).toHaveBeenCalledWith({ mode: "contains", field: "description", pattern: "coffee" });
  expect(screen.getByText("Matches 4 transactions")).toBeTruthy();
});

test("an error from the caller shows on the pattern field", () => {
  renderFields("That nickname already has this rule.");
  expect(screen.getByText("That nickname already has this rule.")).toBeTruthy();
  expect(screen.getByLabelText("Pattern").getAttribute("aria-invalid")).toBe("true");
});

test("an invalid regex shows on the pattern field and hides the count", async () => {
  vi.mocked(countRuleMatches).mockRejectedValue({ kind: "Validation", message: "That regex isn't valid: unclosed group" });
  renderFields();
  fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "(a" } });
  expect(await screen.findByText("That regex isn't valid: unclosed group", {}, { timeout: 2000 })).toBeTruthy();
  expect(screen.queryByText(/Matches|Counting/)).toBeNull();
});

test("RuleMatchCount alone shows the count for a rule", async () => {
  vi.mocked(countRuleMatches).mockResolvedValue(1);
  renderWithClient(<RuleMatchCount rule={{ mode: "exact", field: "memo", pattern: "rent" }} />);
  expect(await screen.findByText("Matches 1 transaction")).toBeTruthy();
});
