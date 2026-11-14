import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ImportControls } from "@/components/import-controls";
import { importFile, listImports, revertImport } from "@/lib/commands";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportSummary } from "@/types/bindings/ImportSummary";

vi.mock("@/lib/commands", () => ({ importFile: vi.fn(), listImports: vi.fn(), revertImport: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const summary: ImportSummary = {
  importId: 3,
  fileName: "checking-2026-10.qfx",
  format: "qfx",
  added: 12,
  duplicates: 1,
  balanceCheck: "passed",
  ledgerBalanceCents: 482317,
  expectedBalanceCents: 482317,
};

const record = (overrides: Partial<ImportRecord>): ImportRecord => ({
  id: 3,
  fileName: "checking-2026-10.qfx",
  format: "qfx",
  importedAt: "2026-11-02 18:04:11",
  accountId: 1,
  rowCount: 12,
  ledgerBalanceCents: 482317,
  balanceAsOf: "2026-10-31",
  expectedBalanceCents: 482317,
  balanceCheck: "passed",
  ...overrides,
});

function renderControls() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ImportControls />
    </QueryClientProvider>,
  );
  return invalidate;
}

const invalidatedKeys = (invalidate: ReturnType<typeof renderControls>) =>
  invalidate.mock.calls.map(([filters]) => filters?.queryKey);

test.each([
  ["passed", {}, "Balance check passed. The bank's balance of $4,823.17 matches your previous import."],
  [
    "mismatch",
    { expectedBalanceCents: 402150 },
    "Balance doesn't match. Your previous import says it should be $4,021.50, but the bank reports $4,823.17.",
  ],
  ["baseline", { expectedBalanceCents: null }, "First balance recorded. The bank reports $4,823.17."],
  ["notChecked", { ledgerBalanceCents: null, expectedBalanceCents: null }, "Balance not checked."],
] as const)("shows the import summary with a %s balance check", async (balanceCheck, overrides, text) => {
  vi.mocked(importFile).mockResolvedValue({ ...summary, ...overrides, balanceCheck });
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));

  await screen.findByText("Imported checking-2026-10.qfx");
  const status = screen.getByRole("status");
  expect(within(status).getByText("12 transactions added, 1 duplicate skipped.")).toBeTruthy();
  expect(status.textContent).toContain(text);
  expect(invalidatedKeys(invalidate)).toEqual([["list_transactions"], ["list_imports"]]);

  fireEvent.click(screen.getByRole("button", { name: "Dismiss import summary" }));
  expect(screen.queryByText("Imported checking-2026-10.qfx")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import file" }));
});

test("does nothing when the file picker is cancelled", async () => {
  let resolve!: (value: null) => void;
  vi.mocked(importFile).mockReturnValue(new Promise((r) => (resolve = r)));
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const pending = await screen.findByRole("button", { name: "Importing…" });
  expect(pending.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(pending);
  expect(importFile).toHaveBeenCalledTimes(1);

  resolve(null);
  await screen.findByRole("button", { name: "Import file" });
  expect(screen.queryByText(/Imported/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(invalidate).not.toHaveBeenCalled();
});

test("shows an import error with a next step", async () => {
  vi.mocked(importFile).mockRejectedValue({ kind: "Import", message: "Zeni only imports US dollar statements; this file is in EUR." });
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));

  const alert = within(await screen.findByRole("alert"));
  expect(alert.getByText("Couldn't import the file")).toBeTruthy();
  expect(alert.getByText("Zeni only imports US dollar statements; this file is in EUR.")).toBeTruthy();
  expect(alert.getByText("Nothing was imported. Check the file, or download it from your bank again, then retry.")).toBeTruthy();
  expect(invalidate).not.toHaveBeenCalled();

  fireEvent.click(alert.getByRole("button", { name: "Dismiss error" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import file" }));
});

test("a failed import clears the previous import's summary", async () => {
  vi.mocked(importFile)
    .mockResolvedValueOnce(summary)
    .mockRejectedValueOnce({ kind: "Import", message: "Zeni only imports US dollar statements; this file is in EUR." });
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  await screen.findByText("Imported checking-2026-10.qfx");

  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const alert = within(await screen.findByRole("alert"));
  expect(screen.queryByText("Imported checking-2026-10.qfx")).toBeNull();
  fireEvent.click(alert.getByRole("button", { name: "Dismiss error" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.queryByText("Imported checking-2026-10.qfx")).toBeNull();
});

test("lists the import history with balance flags", async () => {
  vi.mocked(listImports).mockResolvedValue([
    record({}),
    record({ id: 2, fileName: "checking-2026-09.ofx", format: "ofx", rowCount: 1, ledgerBalanceCents: 397150, expectedBalanceCents: 402150, balanceCheck: "mismatch" }),
    record({ id: 1, fileName: "checking-2026-08.qfx", balanceCheck: "baseline" }),
    record({ id: 0, fileName: "checking-2026-07.qfx", ledgerBalanceCents: null, expectedBalanceCents: null, balanceCheck: "notChecked" }),
  ]);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));

  const sheet = within(await screen.findByRole("dialog", { name: "Import history" }));
  const items = await sheet.findAllByRole("listitem");
  expect(items.map((item) => within(item).getByRole("button").getAttribute("aria-label"))).toEqual([
    "Revert checking-2026-10.qfx",
    "Revert checking-2026-09.ofx",
    "Revert checking-2026-08.qfx",
    "Revert checking-2026-07.qfx",
  ]);
  expect(within(items[0]).getByText("Balance check passed")).toBeTruthy();
  expect(within(items[0]).getByText(/QFX ·/).textContent).toMatch(/· 12 transactions$/);
  expect(within(items[1]).getByText(/OFX ·/).textContent).toMatch(/· 1 transaction$/);
  expect(within(items[1]).getByText("Balance doesn't match:").parentElement!.textContent).toBe(
    "Balance doesn't match: expected $4,021.50, bank reports $3,971.50",
  );
  expect(within(items[2]).getByText("First balance recorded")).toBeTruthy();
  expect(within(items[3]).getByText("Balance not checked")).toBeTruthy();
});

test("shows the import history loading state", async () => {
  let resolve!: (value: ImportRecord[]) => void;
  vi.mocked(listImports).mockReturnValue(new Promise((r) => (resolve = r)));
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));

  const sheet = within(await screen.findByRole("dialog", { name: "Import history" }));
  expect(sheet.getByRole("status").textContent).toBe("Loading import history…");
  expect(sheet.queryByRole("list")).toBeNull();

  resolve([record({})]);
  expect(await sheet.findAllByRole("listitem")).toHaveLength(1);
  expect(sheet.getByRole("status").textContent).toBe("");
});

test("shows an empty import history", async () => {
  vi.mocked(listImports).mockResolvedValue([]);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));
  expect(await screen.findByRole("heading", { name: "No imports yet" })).toBeTruthy();
});

test("shows an error when the import history fails to load", async () => {
  vi.mocked(listImports).mockRejectedValue({ kind: "Database", message: "disk I/O error" });
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));
  expect(within(await screen.findByRole("alert")).getByText("Couldn't load import history")).toBeTruthy();

  vi.mocked(listImports).mockResolvedValue([record({})]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Revert checking-2026-10.qfx" })).toBeTruthy();
  expect(listImports).toHaveBeenCalledTimes(2);
});

test("reverts an import after confirming and drops its summary", async () => {
  vi.mocked(importFile).mockResolvedValue(summary);
  vi.mocked(listImports).mockResolvedValue([record({})]);
  vi.mocked(revertImport).mockResolvedValue(null);
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  await screen.findByText("Imported checking-2026-10.qfx");
  invalidate.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revert checking-2026-10.qfx" }));

  const dialog = within(await screen.findByRole("alertdialog", { name: "Revert this import?" }));
  expect(dialog.getByText("Zeni permanently deletes checking-2026-10.qfx and its 12 transactions. This can't be undone.")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Revert import" }));

  expect(await screen.findByText("Reverted checking-2026-10.qfx.")).toBeTruthy();
  expect(vi.mocked(revertImport).mock.calls.map(([request]) => request)).toEqual([{ importId: 3 }]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(invalidatedKeys(invalidate)).toEqual([["list_transactions"], ["list_imports"]]);
  expect(screen.queryByText("Imported checking-2026-10.qfx")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Import history" }));
});

test("keeps the summary when a different import is reverted", async () => {
  vi.mocked(importFile).mockResolvedValue(summary);
  vi.mocked(listImports).mockResolvedValue([record({ id: 2, fileName: "checking-2026-09.ofx" })]);
  vi.mocked(revertImport).mockResolvedValue(null);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  await screen.findByText("Imported checking-2026-10.qfx");
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revert checking-2026-09.ofx" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revert import" }));

  expect(await screen.findByText("Reverted checking-2026-09.ofx.")).toBeTruthy();
  expect(screen.getByText("Imported checking-2026-10.qfx")).toBeTruthy();
});

test("keeps the revert dialog open when the revert fails", async () => {
  vi.mocked(listImports).mockResolvedValue([record({})]);
  vi.mocked(revertImport).mockRejectedValue({ kind: "NotFound", message: "import 3 not found" });
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revert checking-2026-10.qfx" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revert import" }));

  const dialog = within(await screen.findByRole("alertdialog", { name: "Revert this import?" }));
  expect(within(await dialog.findByRole("alert")).getByText("Couldn't revert the import")).toBeTruthy();
  expect(invalidate).not.toHaveBeenCalled();
});

test("cancelling the revert dialog keeps the import", async () => {
  vi.mocked(listImports).mockResolvedValue([record({})]);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revert checking-2026-10.qfx" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(revertImport).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Revert checking-2026-10.qfx" })).toBeTruthy();
});
