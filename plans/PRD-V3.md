# Personal Finance App — V3 PRD: Import and Transaction List

V3 imports checking-account files and shows the transactions, completing the first fully working app. After V3 the app is pushed to GitHub. Builds on PRD-V1.md and PRD-V2.md; see ROADMAP.md.

## Requirements

- **V3-R1:** Manual file import of CSV, OFX and QFX for the single checking account.
- **V3-R2:** CSV column mapping: the user maps date, amount, description and other columns once per layout; the mapping is saved for later imports.
- **V3-R3:** Imports table: ID, file name, format, import date, target account.
- **V3-R4:** Raw transactions table, never edited after import: ID, import ID, account ID, FITID (optional), posted date, amount (integer cents), raw description, memo (optional), transaction type (optional), running balance (optional), original row as text.
- **V3-R5:** Posted transactions only (pending skipped); US dollars only.
- **V3-R6:** Duplicate matching: OFX/QFX on account + FITID, falling back to date + amount + description; CSV on date + amount + description.
- **V3-R7:** Import summary showing rows added and duplicates skipped.
- **V3-R8:** Revert a whole import in one step.
- **V3-R9:** Running-balance check: when the file includes balances, flag imports whose totals don't match the bank's balance.
- **V3-R10:** Transaction list: shows all transactions, with sorting, date-range filtering and search.
- **V3-R11:** Test fixtures: sample CSV, OFX and QFX files with fake data, in the user's bank's exact layouts.

## Out of Scope

- Backup and restore (V4).
- Nicknames, categories and dashboards (V5 onward).

## Edge Cases

- **Identical same-day transactions in CSV:** may be wrongly treated as duplicates. Known issue, not fixed in V3.
- **Bank layout changes:** CSV layouts may change at any time; a bad import is reverted in one step and the column mapping updated.
- **Wrong file or account:** fixed by reverting the import.

## Checkpoint

- Before building parsers, the user provides sample files from the bank (with fake or scrubbed data). The agent must not use real financial data.

## Acceptance Criteria

1. A CSV, an OFX and a QFX fixture each import successfully, and every posted transaction appears in the list.
2. Pending transactions in a fixture are skipped.
3. Re-importing the same OFX or QFX file adds zero rows.
4. Importing an overlapping date range adds only the new transactions.
5. The import summary shows the correct counts of rows added and duplicates skipped.
6. Reverting an import removes exactly that import's rows and nothing else.
7. Raw transaction rows are never modified after import (covered by tests).
8. A fixture with running balances passes the balance check, and a deliberately broken one is flagged.
9. A saved CSV column mapping is reused on the next import of the same layout.
10. The transaction list sorts, filters by date range and searches.
11. All amounts are stored as integer cents.
12. The project is pushed to a GitHub repository with no real financial data in it.
