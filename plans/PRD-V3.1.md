# Personal Finance App — V3.1 PRD: CSV Import

V3.1 adds CSV import for the checking account, with a column mapping saved per file layout, alongside the OFX/QFX import from V3. Builds on PRD-V1.md to PRD-V3.md; see ROADMAP.md.

## Requirements

- **V3.1-R1:** CSV import through the same Import button and file dialog as OFX/QFX, parsed with the `csv` crate (approved dependency). The file must have a header row; comma-delimited, quoted fields allowed. Same 10 MiB limit as V3.
- **V3.1-R2:** CSV layouts table: ID, name, header fingerprint (the normalised header row), and the column mapping. A file whose header matches a saved layout imports straight away; an unknown header opens the mapping dialog.
- **V3.1-R3:** Column mapping. Required: posted date, description, and either one signed amount column or separate debit and credit columns. Optional: transaction ID, memo, transaction type, running balance, posting status, bank category. Date format is one of `MM/DD/YYYY`, `M/D/YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`. Amounts accept up to 5 decimal places and a leading `-` or `$`; any amount not a whole number of cents rejects the file.
- **V3.1-R4:** Mapping dialog: a preview of the first rows with each mapped column's parsed value, a layout name, and Save. Settings lists saved layouts to edit or delete. Deleting a layout never touches imported data.
- **V3.1-R5:** When a posting status column is mapped, only rows whose status is `Posted` (case-insensitive) import; the others are skipped and counted in the summary as "not posted".
- **V3.1-R6:** Imports and raw transactions reuse the V3 tables, through one new migration. SQLite can't widen a CHECK, so the migration rebuilds `imports` (copy, drop, rename, recreate `imports_raw_no_update`) to allow format `csv` and add `csv_layout_id` (nullable, `ON DELETE SET NULL`), keeping `raw_transactions`' foreign key and cascade working. `raw_transactions` gains a nullable `bank_category` via `ADD COLUMN` (for V6 prompts). The original CSV line is stored as `original_row`.
- **V3.1-R7:** Duplicate matching: a mapped transaction ID works like FITID (account + ID, the existing unique index); rows without one fall back to date + amount + description, exactly as V3.
- **V3.1-R8:** Import becomes two steps for every format: preview (parse, dedupe, find suspected duplicates; the parsed file is held in `AppState`) and commit (with the rows to skip). A preview with no suspected duplicates commits straight away, so OFX/QFX imports look as before. Cross-format overlap review, before anything is saved: rows whose same account and exact amount, posted within 2 days, match a row from an import in a different format (CSV vs OFX/QFX) are suspected duplicates. The review dialog lists each pair (new row vs existing row); "Yes, duplicate" skips the new row, "No" keeps it. Confirm saves; Cancel stores nothing. Applies in both directions (an OFX import after a CSV one too).
- **V3.1-R9:** Running-balance check when a balance column is mapped: within the file, each posted row's balance must equal the previous posted row's balance plus its amount, in file order (newest-first or oldest-first, detected from the dates), before dedupe; a mismatch flags the import. The newest row's balance and date become the import's ledger balance and as-of date for the existing V3 import-to-import check.
- **V3.1-R10:** Import summary adds: not-posted rows skipped, suspected duplicates skipped by review, and the within-file balance result.
- **V3.1-R11:** Test fixtures: fake CSV files modelled on the bank layout's header names only (Transaction ID, Posting Date, Effective Date, Transaction Type, Posting Status, Amount, Check Number, Reference Number, Description, Transaction Category, Type, Balance, Memo, Extended Description), plus a debit/credit-split layout, a re-import, an overlap with an OFX fixture, a pending row, a broken running balance and a sub-cent amount. The fixtures README lists expected results.

## Out of Scope

- Header-less files, other delimiters, custom date format strings.
- Pending transactions.
- Editing or splitting single raw rows; non-checking accounts (V9).

## Edge Cases

- **Description vs Extended Description:** for the bank layout, Description maps to description and Extended Description to memo; nicknames (V5) can match either.
- **Unstable bank transaction IDs:** if the bank changes IDs between downloads, rows duplicate; revert the import and remap without the ID column.
- **Same header, different meaning:** the saved layout is used; edit it in Settings.

## Checkpoint

- The agent must not open or read `plans/ExportedTransactions.csv` or any real export. Fixtures use only the header names above and invented values. That file must never be committed.

## Acceptance Criteria

1. A CSV fixture with an unknown header opens the mapping dialog; after saving, a second file with the same header imports without it.
2. Signed-amount and debit/credit layouts both import every posted row with correct integer cents.
3. Re-importing the same CSV adds zero rows, with and without a mapped ID column.
4. A pending row is skipped and counted.
5. A CSV overlapping an imported OFX fixture shows the review dialog; "Yes" rows are not stored, "No" rows are, and Cancel stores nothing.
6. A consistent running balance passes; a broken one is flagged; the newest balance feeds the V3 import-to-import check.
7. A sub-cent amount or unparsable date rejects the file and stores nothing.
8. Saved layouts can be edited and deleted in Settings without changing imported rows.
9. The V3 import acceptance tests still pass through the preview/commit flow.
10. Raw rows stay unmodified (existing trigger) and no real financial data is committed.
