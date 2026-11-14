# OFX/QFX test fixtures

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
