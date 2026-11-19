import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AutoCategorizeSwitch } from "@/components/auto-categorize-switch";
import { ollamaSettings, setAutoCategorize } from "@/lib/commands";
import type { OllamaSettings } from "@/types/bindings/OllamaSettings";

vi.mock("@/lib/commands", () => ({ ollamaSettings: vi.fn(), setAutoCategorize: vi.fn() }));

const settings: OllamaSettings = { port: 11434, baseModel: "phi4-mini", autoCategorize: true, examplesPerCategory: 5 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ollamaSettings).mockResolvedValue(settings);
});

function renderSwitch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AutoCategorizeSwitch />
    </QueryClientProvider>,
  );
}

const toggle = () => screen.getByRole("switch", { name: "Categorize new rows after each import" });

test("turns auto-categorize off once while busy and keeps the saved value", async () => {
  let resolve!: (value: OllamaSettings) => void;
  vi.mocked(setAutoCategorize).mockReturnValue(new Promise((r) => (resolve = r)));
  renderSwitch();

  await screen.findByRole("switch");
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  fireEvent.click(toggle());
  await waitFor(() => expect(toggle().getAttribute("aria-disabled")).toBe("true"));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(toggle());
  expect(vi.mocked(setAutoCategorize).mock.calls.map(([request]) => request)).toEqual([{ enabled: false }]);

  resolve({ ...settings, autoCategorize: false });
  await waitFor(() => expect(toggle().getAttribute("aria-disabled")).toBe("false"));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});

test("shows the error and the old value when saving fails", async () => {
  vi.mocked(setAutoCategorize).mockRejectedValue({ kind: "NotFound", message: "Broke." });
  renderSwitch();

  fireEvent.click(await screen.findByRole("switch"));
  expect(await screen.findByText("Couldn't save the setting")).toBeTruthy();
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});
