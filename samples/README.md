# Sample statements for manual testing

Fake data for trying Zeni in a dev build (`pnpm tauri dev`, which uses its own database under
`dev/`). Every name, number and amount is invented; nothing comes from a real statement. Never
put real bank exports in this folder.

All three files are the same fake checking account at "Example Community Bank" (routing
`000000000`, account `0000000000`), in consecutive months. Amounts below are in cents; the
balance before August 1 is 321540.

| File | Format | Rows | Ending balance |
|---|---|---|---|
| `checking-2026-08.ofx` | OFX 2.x XML | 26, Aug 1-31 | 486851 (2026-08-31) |
| `checking-2026-09.qfx` | OFX 1.x SGML, QFX style | 27, Sep 1-30 | 658651 (2026-09-30) |
| `checking-2026-10.csv` | CSV in a bank export layout, newest first | 27 posted + 1 pending, Oct 1-31 | 1029791 (2026-10-30) |

Import them in that order. August is the balance baseline; September passes the balance check.
The CSV needs a mapping the first time (V3.1): map Description to description, Extended
Description to memo, Transaction ID as the ID column, Posting Status as the status column and
Balance as the running balance. Its running balance is consistent and continues from September;
the pending row is skipped.

The data is shaped for later versions:

- Recurring charges on fixed days (rent, gym, utilities, streaming, music, phone) and biweekly
  payroll, for recurring-charge detection.
- The same merchant under varying raw text (`CORNER GROCERY #112`, `QUICKFUEL #0412 EXAMPLEVILLE`,
  `SHOPMART*ORDER 7741`), for nickname rules.
- Savings transfers, a refund (`SHOPMART*REFUND 7741`), a service fee, checks and an ATM
  withdrawal, for categorisation and spending rules. The CSV's Transaction Category column gives
  bank category hints.

`src-tauri/src/import_acceptance_tests.rs` (`samples_import_as_consecutive_months`) imports all
three files (the CSV with that mapping: 27 added, 1 not posted, balance check passed at 1029791),
so a parser change that breaks them fails the tests.
