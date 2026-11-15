# Test fixtures (OFX, QFX, CSV)

All data here is fake. "Example Community Bank", the routing number `000000000`, the account
`0000000000`, every payee and every amount are made up, modelled on the examples in the public
OFX specification. Nothing comes from a real statement.

All files are for the same fake checking account. Amounts below are in cents.

| File | Flavor | Rows | Tests | `LEDGERBAL` (as of) |
|---|---|---|---|---|
| `checking-sgml.qfx` | OFX 1.x SGML, QFX style (`INTU.BID`, `INTU.USERID`) | 8, Oct 1-15 2026 | First import, baseline | 245000 (2026-10-15) |
| `checking-xml.ofx` | OFX 2.x XML (`<?xml?>`, `<?OFX?>`) | 8, Oct 16-31 | Balance check passes; one row uses `PAYEE/NAME` | 396053 (2026-10-31) |
| `checking-overlap.ofx` | OFX 1.x SGML | 9, Oct 25-Nov 10 | Overlapping range: 4 rows share FITIDs with `checking-xml.ofx`, 5 are new (Nov 1-10) | 244414 (2026-11-10) |
| `checking-broken-balance.ofx` | OFX 1.x SGML | 4, Nov 12-19 | Balance mismatch: ledger is 7 cents above the expected 439302 | 439309 (2026-11-20) |
| `checking-cad.ofx` | OFX 1.x SGML | 2 | `CURDEF` is `CAD`; the import is rejected | 148175 (2026-11-05) |
| `checking-no-fitid.ofx` | OFX 1.x SGML | 3, Nov 21-22, no FITIDs | Fallback duplicate match on date + amount + description | none |

## Expected results when imported in this order

1. `checking-sgml.qfx`: added 8, duplicates 0, `baseline`, ledger 245000.
2. `checking-xml.ofx`: added 8, duplicates 0, `passed`, expected = ledger = 396053
   (245000 + 151053).
3. `checking-overlap.ofx`: added 5, duplicates 4, `passed`, expected = ledger = 244414
   (396053 - 151639 for the Nov 1-10 rows).
4. `checking-broken-balance.ofx`: added 4, duplicates 0, `mismatch`, expected 439302
   (244414 + 194888), ledger 439309.
5. `checking-cad.ofx`: `AppError::Import` "Zeni only imports US dollar statements; this file is in CAD.",
   nothing stored.
6. `checking-no-fitid.ofx`: added 3, duplicates 0, `notChecked`. It holds two identical rows on
   2026-11-21 (-450, "BEAN THERE CAFE"). Rows without a FITID are matched on date + amount +
   description against earlier imports only, never against rows in the same file, so both are
   added. Importing the file again adds 0 and counts 3 duplicates.

Re-importing `checking-sgml.qfx` after step 1 adds 0 rows and counts 8 duplicates; it is
`passed`, expected = ledger = 245000, because the first import's balance has the same as-of date
and no rows fall after it. Re-importing `checking-xml.ofx` after step 2 is likewise `passed` at
396053.

## CSV fixtures (V3.1)

Same fake account, payees and bank as above; header names are the PRD's, every value is
invented. Amounts and balances below are in cents.

### Layouts

- **Bank layout** (`checking-bank.csv`, `checking-bank-reimport.csv`,
  `checking-broken-running-balance.csv`, `checking-sub-cent.csv`, `checking-bad-date.csv`): the
  14 PRD headers `Transaction ID, Posting Date, Effective Date, Transaction Type, Posting Status,
  Amount, Check Number, Reference Number, Description, Transaction Category, Type, Balance, Memo,
  Extended Description`, every cell quoted, amounts with 5 decimals. Mapping: date format
  `MM/DD/YYYY`, posted date 1 (Posting Date), description 8, signed amount 5, transaction ID 0,
  memo 13 (Extended Description), transaction type 3, running balance 11, posting status 4, bank
  category 9. The same header as `samples/checking-*.csv`, so they share one saved layout.
- **Split layout** (`checking-split.csv`): `Date,Description,Debit,Credit,Balance`, oldest first.
  Mapping: `M/D/YYYY`, posted date 0, description 1, split debit 2 / credit 3, running balance 4,
  nothing else.
- **Overlap layout** (`checking-overlap-ofx.csv`): `Date,Description,Amount`. Mapping:
  `YYYY-MM-DD`, posted date 0, description 1, signed amount 2; no ID, balance or status column.

### Files

| File | Rows | Tests |
|---|---|---|
| `checking-bank.csv` | 6 posted Nov 23-30 2026 + 1 pending Dec 1 (first line, empty ID and balance), newest first | Signed amounts, pending skipped, running balance passes, newest balance feeds the V3 check. One Extended Description holds a quoted comma |
| `checking-bank-reimport.csv` | 5 posted Nov 27-Dec 3, newest first | Re-import: Nov 27 and Nov 30 are the exact lines of `checking-bank.csv`; Dec 1 is the formerly pending row, now posted with an ID |
| `checking-split.csv` | 4, Dec 4-8, oldest first | Debit/credit columns, `M/D/YYYY` with 1-digit days, a quoted description with a comma |
| `checking-overlap-ofx.csv` | 5, Oct 16-25 | Cross-format suspects against `checking-xml.ofx` |
| `checking-broken-running-balance.csv` | 3, Dec 10-12, newest first | The Dec 12 balance is 1 cent above the expected 146500 |
| `checking-sub-cent.csv` | 2 | Line 3 amount `0.00500` |
| `checking-bad-date.csv` | 1 | Line 2 Posting Date `13/05/2026` |

### Expected results, after the six OFX steps above (step 6 is `checking-no-fitid.ofx`)

7. `checking-bank.csv` (bank layout): added 6, duplicates 0, not posted 1, review skipped 0,
   no suspects (goes straight to `Imported`), file balance `passed`, ledger 630401 as of
   2026-11-30. V3 check `passed`: the prior import is `checking-broken-balance.ofx` (439309 as of
   2026-11-20), plus `checking-no-fitid.ofx`'s rows (-450, -450, -1999) and this file's posted rows
   (+193991): expected = ledger = 630401.
8. `checking-bank-reimport.csv` (bank layout): added 3 (Dec 1-3), duplicates 2, not posted 0,
   file balance `passed`, ledger 646061 as of 2026-12-03. V3 `passed`: 630401 + (-1840 - 7500 +
   25000) = 646061. The same with a bank layout that maps no transaction ID (fallback on date +
   amount + description): added 3, duplicates 2.
9. `checking-split.csv` (split layout): added 4, amounts -2310, +210000, -9120, -450, file balance
   `passed`, ledger 844181 as of 2026-12-08. V3 `passed`: 646061 + 198120 = 844181.

Re-importing `checking-bank.csv` after step 7 adds 0, counts 6 duplicates and 1 not posted, file
balance `passed`, V3 `passed` at 630401 (prior import as of the same date, no rows after it).
Importing `checking-bank.csv` with a bank layout that maps no transaction ID, then the file again,
adds 0 the second time.

### Expected results, other files

- `checking-overlap-ofx.csv` (overlap layout) after steps 1-2 (or after all OFX steps): goes to
  `Review` with 3 pairs, all against `checking-xml.ofx` rows. Descriptions differ in case from the
  OFX names, so exact dedupe never matches them.

  | rowIndex | New CSV row | Existing OFX row | Days |
  |---|---|---|---|
  | 0 | 2026-10-16, -4210, Fresh Market | 2026-10-16, FRESH MARKET | 0 |
  | 1 | 2026-10-19, -12055, Water and Sewer | 2026-10-18, WATER & SEWER DEPT | 1 |
  | 2 | 2026-10-22, -30000, Check 1002 | 2026-10-20, CHECK 1002 | 2 |

  Not suspects: rowIndex 3 (2026-10-25, -1575, Book Nook; BOOK NOOK is 3 days earlier) and
  rowIndex 4 (2026-10-25, -6731, Gas N Go; GAS N GO that day is -6730). File balance and V3 check
  `notChecked`, no ledger. Commit with `skipRows` [0, 1, 2]: added 2, review skipped 3. Commit with
  `skipRows` []: added 5, review skipped 0. Cancel: nothing stored.
- `checking-broken-running-balance.csv` (bank layout): added 3, file balance `mismatch`, ledger
  146501 as of 2026-12-12 (the newest balance still feeds the V3 check). On a fresh account the V3
  check is `baseline`.
- `checking-sub-cent.csv`: `AppError::Import` "Line 3: Amount 0.00500 isn't a whole number of
  cents.", nothing stored.
- `checking-bad-date.csv`: `AppError::Import` "Line 2: Posting Date 13/05/2026 isn't a MM/DD/YYYY
  date.", nothing stored.

`csv_import.rs`'s `parses_every_csv_fixture_as_the_readme_says` checks the parse-level numbers here.
