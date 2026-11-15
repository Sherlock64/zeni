import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ImportControls } from "@/components/import-controls";
import { cancelImport, commitImport, importFile, listImports, previewCsvMapping, revertImport, saveCsvLayout } from "@/lib/commands";
import type { CsvPreviewRow } from "@/types/bindings/CsvPreviewRow";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportStep } from "@/types/bindings/ImportStep";
import type { ImportSummary } from "@/types/bindings/ImportSummary";

vi.mock("@/lib/commands", () => ({
  importFile: vi.fn(),
  listImports: vi.fn(),
  revertImport: vi.fn(),
  previewCsvMapping: vi.fn(),
  saveCsvLayout: vi.fn(),
  commitImport: vi.fn(),
  cancelImport: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
// Radix Select and RadioGroup need these pointer, scroll and resize APIs that jsdom lacks.
Element.prototype.hasPointerCapture = function () {
  return false;
};
Element.prototype.releasePointerCapture = function () {};
Element.prototype.scrollIntoView = function () {};
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const summary: ImportSummary = {
  importId: 3,
  fileName: "checking-2026-10.qfx",
  format: "qfx",
  added: 12,
  duplicates: 1,
  balanceCheck: "passed",
  ledgerBalanceCents: 482317,
  expectedBalanceCents: 482317,
  notPosted: 0,
  reviewSkipped: 0,
  fileBalanceCheck: "notChecked",
};
const imported = (data: ImportSummary): ImportStep => ({ step: "imported", data });

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
  fileBalanceCheck: "notChecked",
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
  vi.mocked(importFile).mockResolvedValue(imported({ ...summary, ...overrides, balanceCheck }));
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
    .mockResolvedValueOnce(imported(summary))
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
  vi.mocked(importFile).mockResolvedValue(imported(summary));
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
  vi.mocked(importFile).mockResolvedValue(imported(summary));
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

const csvSummary: ImportSummary = {
  ...summary,
  fileName: "checking-2026-10.csv",
  format: "csv",
  added: 27,
  duplicates: 0,
  notPosted: 1,
  reviewSkipped: 2,
  fileBalanceCheck: "passed",
};

const headers = ["Transaction ID", "Posting Date", "Effective Date", "Transaction Type", "Amount", "Check Number", "Reference Number", "Description", "Transaction Category", "Type", "Balance", "Memo", "Extended Description", "Posting Status"];
const needsMapping: ImportStep = { step: "needsMapping", data: { fileName: "checking-2026-10.csv", headers, rows: [] } };

const previewRow = (overrides: Partial<CsvPreviewRow>): CsvPreviewRow => ({
  line: 2,
  postedDate: "2026-10-30",
  amountCents: 210000,
  description: "ACME CORP PAYROLL",
  transactionId: null,
  memo: null,
  transactionType: null,
  runningBalanceCents: 1029791,
  postingStatus: "Posted",
  bankCategory: null,
  error: null,
  ...overrides,
});

const review: ImportStep = {
  step: "review",
  data: {
    fileName: "checking-2026-10.csv",
    format: "csv",
    pairs: [
      {
        rowIndex: 4,
        newRow: { postedDate: "2026-10-05", amountCents: -4500, description: "CITY WATER UTILITY" },
        existing: { postedDate: "2026-10-03", amountCents: -4500, description: "CITY WATER" },
        existingFileName: "checking-2026-10.ofx",
        existingFormat: "ofx",
      },
      {
        rowIndex: 9,
        newRow: { postedDate: "2026-10-12", amountCents: -1850, description: "CORNER COFFEE" },
        existing: { postedDate: "2026-10-12", amountCents: -1850, description: "CORNER COFFEE ROASTERS" },
        existingFileName: "checking-2026-10.ofx",
        existingFormat: "ofx",
      },
      {
        rowIndex: 11,
        newRow: { postedDate: "2026-10-20", amountCents: -3275, description: "SHELL FUEL" },
        existing: { postedDate: "2026-10-21", amountCents: -3275, description: "SHELL FUEL 0193" },
        existingFileName: "checking-2026-10.ofx",
        existingFormat: "ofx",
      },
    ],
  },
};

test("shows the CSV additions in the summary", async () => {
  vi.mocked(importFile).mockResolvedValue(imported(csvSummary));
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));

  await screen.findByText("Imported checking-2026-10.csv");
  const status = within(screen.getByRole("status"));
  expect(status.getByText("1 row not posted, skipped.")).toBeTruthy();
  expect(status.getByText("2 possible duplicates skipped in review.")).toBeTruthy();
  expect(status.getByText("Running balance check passed.").parentElement!.className).not.toContain("text-destructive");
});

test("flags a running balance mismatch and hides zero counts", async () => {
  vi.mocked(importFile).mockResolvedValue(imported({ ...csvSummary, notPosted: 0, reviewSkipped: 0, fileBalanceCheck: "mismatch" }));
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));

  await screen.findByText("Imported checking-2026-10.csv");
  const status = within(screen.getByRole("status"));
  expect(status.getByText("Running balances don't add up.").parentElement!.className).toContain("text-destructive");
  expect(status.queryByText(/not posted/)).toBeNull();
  expect(status.queryByText(/in review/)).toBeNull();
});

test("hides the running balance line when it wasn't checked", async () => {
  vi.mocked(importFile).mockResolvedValue(imported(summary));
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  await screen.findByText("Imported checking-2026-10.qfx");
  expect(screen.queryByText(/Running balance/)).toBeNull();
});

test("maps a new CSV layout with guessed columns, previews it and imports", async () => {
  vi.mocked(importFile).mockResolvedValue(needsMapping);
  vi.mocked(previewCsvMapping).mockResolvedValue([previewRow({}), previewRow({ line: 3, error: "Amount: 0.00500 isn't a whole number of cents." })]);
  let resolve!: (step: ImportStep) => void;
  vi.mocked(saveCsvLayout).mockReturnValue(new Promise((r) => (resolve = r)));
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));

  const dialog = within(await screen.findByRole("dialog", { name: "Map the columns of checking-2026-10.csv" }));
  const mapping = {
    dateFormat: "MM/DD/YYYY",
    postedDate: 1,
    description: 7,
    amount: { kind: "signed", column: 4 },
    transactionId: 0,
    memo: 12,
    transactionType: 3,
    runningBalance: 10,
    postingStatus: 13,
    bankCategory: 8,
  };
  expect(vi.mocked(previewCsvMapping).mock.calls[0][0]).toEqual(mapping);
  const table = within(await dialog.findByRole("table", { name: "Preview of the first rows" }));
  const rows = table.getAllByRole("row");
  expect(within(rows[1]).getByText("$2,100.00")).toBeTruthy();
  expect(within(rows[1]).getByText("$10,297.91")).toBeTruthy();
  expect(within(rows[2]).getByText("Amount: 0.00500 isn't a whole number of cents.")).toBeTruthy();

  // The name is required.
  fireEvent.click(dialog.getByRole("button", { name: "Save and import" }));
  expect(dialog.getByText("Enter a layout name.")).toBeTruthy();
  expect(saveCsvLayout).not.toHaveBeenCalled();

  fireEvent.change(dialog.getByRole("textbox", { name: "Layout name" }), { target: { value: "  Example Bank  " } });
  fireEvent.click(dialog.getByRole("button", { name: "Save and import" }));
  const saving = await dialog.findByRole("button", { name: "Saving…" });
  expect(saving.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(saving);
  expect(vi.mocked(saveCsvLayout).mock.calls.map(([request]) => request)).toEqual([{ name: "Example Bank", mapping }]);

  resolve(imported(csvSummary));
  await screen.findByText("Imported checking-2026-10.csv");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(invalidatedKeys(invalidate)).toEqual([["list_csv_layouts"], ["list_transactions"], ["list_imports"]]);
});

test("switching to debit and credit columns asks for them before previewing", async () => {
  vi.mocked(importFile).mockResolvedValue({ step: "needsMapping", data: { fileName: "card.csv", headers: ["Date", "Description", "Debit", "Credit"], rows: [] } });
  vi.mocked(previewCsvMapping).mockResolvedValue([previewRow({})]);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));

  const dialog = within(await screen.findByRole("dialog"));
  await waitFor(() => expect(previewCsvMapping).toHaveBeenCalled());
  expect(vi.mocked(previewCsvMapping).mock.calls[0][0].amount).toEqual({ kind: "split", debit: 2, credit: 3 });
  fireEvent.click(dialog.getByRole("radio", { name: "One signed column" }));
  expect(dialog.getByText("Choose the required columns to see a preview.")).toBeTruthy();
  fireEvent.change(dialog.getByRole("textbox", { name: "Layout name" }), { target: { value: "Card" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save and import" }));
  expect(dialog.getByText("Choose a column.")).toBeTruthy();
  expect(saveCsvLayout).not.toHaveBeenCalled();
});

test("keeps the mapping dialog open when saving fails", async () => {
  vi.mocked(importFile).mockResolvedValue(needsMapping);
  vi.mocked(previewCsvMapping).mockResolvedValue([previewRow({})]);
  vi.mocked(saveCsvLayout).mockRejectedValue({ kind: "Import", message: "Line 7: Amount 0.00500 isn't a whole number of cents." });
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));

  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByRole("textbox", { name: "Layout name" }), { target: { value: "Example Bank" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save and import" }));
  const alert = within(await dialog.findByRole("alert"));
  expect(alert.getByText("Couldn't save the layout")).toBeTruthy();
  expect(alert.getByText("Check the chosen columns and date format, or cancel.")).toBeTruthy();
  expect(alert.getByText("Line 7: Amount 0.00500 isn't a whole number of cents.")).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Map the columns of checking-2026-10.csv" })).toBeTruthy();
  expect(invalidate).not.toHaveBeenCalled();
});

test("shows a preview error in the mapping dialog", async () => {
  vi.mocked(importFile).mockResolvedValue(needsMapping);
  vi.mocked(previewCsvMapping).mockRejectedValue({ kind: "Validation", message: "A column can hold only one field." });
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const alert = within(await within(await screen.findByRole("dialog")).findByRole("alert"));
  expect(alert.getByText("Couldn't preview the mapping")).toBeTruthy();
});

test("cancelling the mapping dialog stores nothing", async () => {
  vi.mocked(importFile).mockResolvedValue(needsMapping);
  vi.mocked(previewCsvMapping).mockResolvedValue([]);
  vi.mocked(cancelImport).mockResolvedValue(null);
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const dialog = within(await screen.findByRole("dialog"));
  expect(await dialog.findByText("This file has no rows to preview.")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

  expect(await screen.findByText("Cancelled importing checking-2026-10.csv")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(cancelImport).toHaveBeenCalledTimes(1);
  expect(saveCsvLayout).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

test("maps a layout, then reviews possible duplicates and imports the answers", async () => {
  vi.mocked(importFile).mockResolvedValue(needsMapping);
  vi.mocked(previewCsvMapping).mockResolvedValue([previewRow({})]);
  vi.mocked(saveCsvLayout).mockResolvedValue(review);
  let resolve!: (summary: ImportSummary) => void;
  vi.mocked(commitImport).mockReturnValue(new Promise((r) => (resolve = r)));
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const mappingDialog = within(await screen.findByRole("dialog"));
  fireEvent.change(mappingDialog.getByRole("textbox", { name: "Layout name" }), { target: { value: "Example Bank" } });
  fireEvent.click(mappingDialog.getByRole("button", { name: "Save and import" }));

  const dialog = within(await screen.findByRole("dialog", { name: "Check possible duplicates" }));
  const pairs = dialog.getAllByRole("listitem");
  const rows = within(within(pairs[0]).getByRole("table", { name: "Possible duplicate: CITY WATER UTILITY" })).getAllByRole("row");
  expect(rows.slice(1).map((row) => row.textContent)).toEqual([
    "This fileOct 5, 2026CITY WATER UTILITY-$45.00",
    "checking-2026-10.ofx (OFX)Oct 3, 2026CITY WATER-$45.00",
  ]);
  expect(within(pairs[0]).getByRole("radiogroup", { name: "Is it the same transaction? CITY WATER UTILITY" })).toBeTruthy();

  // Every pair needs an answer.
  fireEvent.click(within(pairs[0]).getByRole("radio", { name: "Yes, duplicate (skip it)" }));
  fireEvent.click(within(pairs[1]).getByRole("radio", { name: "No (import it)" }));
  fireEvent.click(dialog.getByRole("button", { name: "Confirm and import" }));
  expect(dialog.getByRole("alert").textContent).toBe("Answer every row first. 1 row is left.");
  const unansweredGroup = within(pairs[2]).getByRole("radiogroup");
  expect(unansweredGroup.getAttribute("aria-invalid")).toBe("true");
  const message = within(pairs[2]).getByText("Choose an answer.");
  expect(unansweredGroup.getAttribute("aria-describedby")).toBe(message.id);
  for (const radio of within(pairs[2]).getAllByRole("radio")) expect(radio.getAttribute("aria-describedby")).toBe(message.id);
  expect(within(pairs[0]).queryByText("Choose an answer.")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(within(pairs[2]).getByRole("radio", { name: "Yes, duplicate (skip it)" })));
  expect(commitImport).not.toHaveBeenCalled();

  fireEvent.click(within(pairs[2]).getByRole("radio", { name: "Yes, duplicate (skip it)" }));
  fireEvent.click(dialog.getByRole("button", { name: "Confirm and import" }));
  const importing = await dialog.findByRole("button", { name: "Importing…" });
  expect(importing.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(importing);
  expect(vi.mocked(commitImport).mock.calls.map(([request]) => request)).toEqual([{ skipRows: [4, 11] }]);

  resolve(csvSummary);
  await screen.findByText("Imported checking-2026-10.csv");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(invalidatedKeys(invalidate)).toEqual([["list_csv_layouts"], ["list_transactions"], ["list_imports"]]);
});

test("keeps the review dialog open when the commit fails", async () => {
  vi.mocked(importFile).mockResolvedValue({ ...review, data: { ...review.data, pairs: [review.data.pairs[0]] } } as ImportStep);
  vi.mocked(commitImport).mockRejectedValue({ kind: "NotFound", message: "There is no import waiting. Choose the file again." });
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Check possible duplicates" }));
  fireEvent.click(dialog.getByRole("radio", { name: "No (import it)" }));
  fireEvent.click(dialog.getByRole("button", { name: "Confirm and import" }));
  expect(within(await dialog.findByRole("alert")).getByText("There is no import waiting. Choose the file again.")).toBeTruthy();
  expect(vi.mocked(commitImport).mock.calls.map(([request]) => request)).toEqual([{ skipRows: [] }]);
});

test("cancelling the review stores nothing", async () => {
  vi.mocked(importFile).mockResolvedValue(review);
  let resolve!: (value: null) => void;
  vi.mocked(cancelImport).mockReturnValue(new Promise((r) => (resolve = r)));
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Check possible duplicates" }));
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  const cancelling = await dialog.findByRole("button", { name: "Cancelling…" });
  expect(cancelling.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(cancelling);
  expect(cancelImport).toHaveBeenCalledTimes(1);

  resolve(null);
  expect(await screen.findByText("Cancelled importing checking-2026-10.csv")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(commitImport).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

test.each([
  ["saving", needsMapping],
  ["cancelling", needsMapping],
  ["pressing Escape on", review],
] as const)("%s a dialog returns focus to the Import file button", async (action, step) => {
  vi.mocked(importFile).mockResolvedValue(step);
  vi.mocked(previewCsvMapping).mockResolvedValue([previewRow({})]);
  vi.mocked(saveCsvLayout).mockResolvedValue(imported(csvSummary));
  vi.mocked(cancelImport).mockResolvedValue(null);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const dialog = await screen.findByRole("dialog");
  if (action === "saving") {
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Layout name" }), { target: { value: "Example Bank" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and import" }));
  } else if (action === "cancelling") fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  else fireEvent.keyDown(dialog, { key: "Escape" });

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import file" })));
});

test("changing a column previews the new mapping", async () => {
  vi.mocked(importFile).mockResolvedValue(needsMapping);
  vi.mocked(previewCsvMapping).mockResolvedValue([previewRow({})]);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const dialog = within(await screen.findByRole("dialog"));
  await waitFor(() => expect(previewCsvMapping).toHaveBeenCalledTimes(1));

  const memo = dialog.getByRole("combobox", { name: "Memo" });
  expect(memo.textContent).toBe("Extended Description");
  fireEvent.keyDown(memo, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Memo" }));

  await waitFor(() => expect(previewCsvMapping).toHaveBeenCalledTimes(2));
  expect(vi.mocked(previewCsvMapping).mock.calls[1][0]).toMatchObject({ memo: 11 });
  expect(dialog.getByRole("combobox", { name: "Memo" }).textContent).toBe("Memo");
});

test("a failed save moves focus to the first invalid field", async () => {
  vi.mocked(importFile).mockResolvedValue({ step: "needsMapping", data: { fileName: "card.csv", headers: ["Date", "Description", "Debit", "Credit"], rows: [] } });
  vi.mocked(previewCsvMapping).mockResolvedValue([previewRow({})]);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const dialog = within(await screen.findByRole("dialog"));

  fireEvent.click(dialog.getByRole("button", { name: "Save and import" }));
  await waitFor(() => expect(document.activeElement).toBe(dialog.getByRole("textbox", { name: "Layout name" })));

  fireEvent.change(dialog.getByRole("textbox", { name: "Layout name" }), { target: { value: "Card" } });
  fireEvent.click(dialog.getByRole("radio", { name: "One signed column" }));
  fireEvent.click(dialog.getByRole("button", { name: "Save and import" }));
  const amount = dialog.getByRole("combobox", { name: "Amount column" });
  expect(amount.getAttribute("aria-required")).toBe("true");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  expect(saveCsvLayout).not.toHaveBeenCalled();
});

test("shows the preview loading state until the preview arrives", async () => {
  vi.mocked(importFile).mockResolvedValue(needsMapping);
  let resolve!: (rows: CsvPreviewRow[]) => void;
  vi.mocked(previewCsvMapping).mockReturnValue(new Promise((r) => (resolve = r)));
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  const dialog = within(await screen.findByRole("dialog"));
  await waitFor(() => expect(previewCsvMapping).toHaveBeenCalled());

  const section = dialog.getByRole("region", { name: "Preview" });
  expect(section.getAttribute("aria-busy")).toBe("true");
  expect(dialog.queryByRole("table")).toBeNull();
  expect(dialog.queryByText("This file has no rows to preview.")).toBeNull();

  resolve([previewRow({})]);
  expect(await dialog.findByRole("table", { name: "Preview of the first rows" })).toBeTruthy();
  expect(section.getAttribute("aria-busy")).toBe("false");
});

test("a failed cancel closes the dialog and shows the error", async () => {
  vi.mocked(importFile).mockResolvedValue(review);
  vi.mocked(cancelImport).mockRejectedValue({ kind: "Database", message: "disk I/O error" });
  const invalidate = renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

  const alert = within(await screen.findByRole("alert"));
  expect(alert.getByText("Couldn't cancel the import")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import file" })));
  expect(invalidate).not.toHaveBeenCalled();

  fireEvent.click(alert.getByRole("button", { name: "Dismiss error" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import file" }));
});

test("cancelling clears the previous summary and the notice can be dismissed", async () => {
  vi.mocked(importFile).mockResolvedValueOnce(imported(summary)).mockResolvedValueOnce(review);
  vi.mocked(cancelImport).mockResolvedValue(null);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  await screen.findByText("Imported checking-2026-10.qfx");
  fireEvent.click(screen.getByRole("button", { name: "Import file" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

  expect(await screen.findByText("Cancelled importing checking-2026-10.csv")).toBeTruthy();
  expect(screen.getByText("Nothing was stored.")).toBeTruthy();
  expect(screen.queryByText("Imported checking-2026-10.qfx")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
  expect(screen.queryByText("Cancelled importing checking-2026-10.csv")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import file" }));
});

test("flags a CSV import whose running balances don't add up in the history", async () => {
  vi.mocked(listImports).mockResolvedValue([
    record({ id: 5, fileName: "checking-2026-11.csv", format: "csv", fileBalanceCheck: "mismatch" }),
    record({ id: 4, fileName: "checking-2026-10.csv", format: "csv", fileBalanceCheck: "passed" }),
  ]);
  renderControls();
  fireEvent.click(screen.getByRole("button", { name: "Import history" }));

  const items = await within(await screen.findByRole("dialog", { name: "Import history" })).findAllByRole("listitem");
  expect(within(items[0]).getByText(/CSV ·/)).toBeTruthy();
  expect(within(items[0]).getByText("Running balances in this file don't add up")).toBeTruthy();
  expect(within(items[1]).getByText(/CSV ·/)).toBeTruthy();
  expect(within(items[1]).queryByText(/Running balances/)).toBeNull();
});
