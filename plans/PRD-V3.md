# Personal Finance App — V3 PRD: Import and Transaction List

V3 imports OFX and QFX files for the checking account and shows the transactions, completing the first fully working app. CSV import follows in V3.1. Builds on PRD-V1.md and PRD-V2.md; see ROADMAP.md.

## Requirements

- **V3-R1:** Manual file import of OFX and QFX for the single checking account, picked with the native file dialog (`tauri-plugin-dialog`). Parse both OFX 1.x (SGML, the usual QFX form) and OFX 2.x (XML) with a small hand-written parser; no OFX crate.
- **V3-R2:** (Moved to V3.1: CSV import and column mapping.)
- **V3-R3:** Imports table: ID, file name, format, import date, target account, ledger balance and its as-of date (both optional, from `LEDGERBAL`), and the balance-check result.
- **V3-R4:** Raw transactions table, never edited after import: ID, import ID, account ID, FITID (optional), posted date, amount (integer cents), raw description (`NAME`), memo (optional), transaction type (optional, `TRNTYPE`), running balance (optional), original `STMTTRN` block as text.
- **V3-R5:** Posted transactions only; OFX/QFX statement transactions are treated as posted. US dollars only: reject a file whose `CURDEF` is not `USD`.
- **V3-R6:** Duplicate matching on account + FITID, falling back to date + amount + description when a row has no FITID.
- **V3-R7:** Import summary showing rows added and duplicates skipped.
- **V3-R8:** Revert a whole import in one step: a confirm dialog, then a hard delete of the import and its raw rows.
- **V3-R9:** Balance check against the prior import: expected = the previous import's ledger balance + the sum of this account's transactions dated after that balance's as-of date, up to this file's as-of date. Flag the import when it doesn't match this file's `LEDGERBAL`. The first import with a balance is the baseline and is not flagged; a file without `LEDGERBAL` is not checked.
- **V3-R10:** Transaction list on the Transactions page: date, description, memo and amount, newest first; type and running balance shown only when present. Sorting, date-range filtering and search (description + memo) run in SQLite with paging.
- **V3-R11:** Import UI on the Transactions page: an Import button, and the import history (file, format, date, rows, balance flag, Revert) in a sheet or dialog.
- **V3-R12:** Test fixtures: sample OFX 1.x, OFX 2.x and QFX files with entirely fake data, modelled on public OFX spec examples, including a re-import, an overlapping range, a non-USD file and a broken balance.

## Out of Scope

- CSV import, column mapping and the `csv` crate (V3.1).
- Backup and restore (V4).
- Nicknames, categories and dashboards (V5 onward).

## Edge Cases

- **Missing FITID:** falls back to date + amount + description, so identical same-day rows without a FITID may be wrongly treated as duplicates. Known issue, not fixed in V3.
- **Wrong file or account:** fixed by reverting the import.
- **Reverting an import that an earlier balance check depended on:** later imports keep their stored result; no re-check in V3.

## Checkpoint

- Fixtures use only fake data the agent writes from public OFX examples. The agent must not use or read real financial data.

## Acceptance Criteria

1. An OFX 1.x, an OFX 2.x and a QFX fixture each import successfully, and every transaction appears in the list.
2. A non-USD fixture is rejected with a clear error and adds nothing.
3. Re-importing the same OFX or QFX file adds zero rows.
4. Importing an overlapping date range adds only the new transactions.
5. The import summary shows the correct counts of rows added and duplicates skipped.
6. Reverting an import, after confirming, removes exactly that import's rows and nothing else.
7. Raw transaction rows are never modified after import (covered by tests).
8. A consecutive fixture passes the balance check, and a deliberately broken one is flagged.
9. The transaction list sorts, filters by date range, searches and pages, all in SQL.
10. All amounts are stored as integer cents.
11. No real financial data is committed to the GitHub repository.
