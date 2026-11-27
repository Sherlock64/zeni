# Personal Finance App — Roadmap

Each item below is an epic: named, not numbered. Shape and slice turns one into an epic issue (its body is the spec) and tickets, and an epic may ship across several releases. Release versions follow the `door:` labels of the PRs merged since the last tag (`.claude/factory/spine.md`), not the epics, unless an epic declares `Release: v<x.y.z>` (`.claude/factory/stations/release.md`). Order within a section is the intended order.

## Product preferences

Shape and slice bases its product recommendations on these; add one when an interview shows a new preference.

- Richer UX is preferred over minimal UI (for example drag reorder over up/down buttons, in-app download over a hint).
- A mature dependency is fine when it buys real UX.
- American spelling.
- Minimal but not plain: color over monochrome (for example a green-on-dark app icon, not white on black).
- The design explains itself: no onboarding flows or tours.
- Backups are the export: no separate export formats.
- Bank data is the truth: nothing the user enters creates or changes a transaction.
- The core app works fully offline before any optional external connection is added.
- Planning tools are calculators that show their assumptions, never personalized financial, investing or tax advice.

## Shipped

Released before the factory spine, one PRD per version.

| Version | Title | PRD |
|---|---|---|
| V1 | App foundation | `PRD-V1.md` |
| V2 | Security | `PRD-V2.md` |
| V3 | Import and transaction list | `PRD-V3.md` |
| V3.1 | CSV import | `PRD-V3.1.md` |
| V4 | Backup and restore | `PRD-V4.md` |
| V5 | Nicknames | `PRD-V5.md` |
| V5.1 | Bug cleanup | `PRD-V5.1.md` |
| V6 | Categorization | `PRD-V6.md` |
| V6.1 | Medium bug cleanup | `PRD-V6.1.md` |
| V7 | CI/CD, installer and updates | `PRD-V7.md` |
| V7.1 | Medium bug cleanup | `PRD-V7.1.md` |
| V7.2 | Low bug cleanup | `PRD-V7.2.md` |

## Engineering foundations

Pure refactor before the feature work, so the roadmap's features land on seams built for them. No user-facing behavior changes.

### Foundations refactor

Order inside the epic: types split, money, test kit, ledger, functional core, query keys, property tests.

- Split `types.rs` into a `types/` folder by domain, re-exported from `types/mod.rs`; bindings unchanged.
- Money: a `Cents(i64)` newtype with checked operations and one `parse_amount(text, style)`; OFX and CSV each keep the inputs they accept today.
- Shared Rust test kit (`TestDb::unlocked()`, `.import(file)`, a row builder) replacing the per-module `Fixture` structs and hand-written `INSERT INTO raw_transactions`.
- Ledger module: every read of `raw_transactions` and `effective_categories` (rows, totals, count, with one filter type) goes through it, and the account scope is decided in one place.
- Functional core for import, nickname matching and categorize batching: a pure plan (new rows, duplicates, suspects, balance check) applied by a thin shell; table-driven tests with no database.
- UI: hierarchical query keys and one `invalidate(change)` map; no component lists keys itself.
- Property tests on amount parsing and ledger totals (`proptest` dev-dependency, needs approval).
- Clock port (`today()`, `now()`) in place of `date('now')` in SQL.
- Network ports: small traits for the update check and the Ollama client, like `Keyring` and `Categorizer`.
- Compile-time checked SQL for the ledger (`query!`, a committed `.sqlx` cache, `cargo sqlx prepare --check` in `check.sh`); `sqlx-cli` needs approval.
- One fake backend through Tauri `mockIPC`, shared by UI tests and snapshots, with the UI test cleanup.
- UI page hooks (`useTransactions`, `useSetCategory`, ...).
- Test cleanup: one owning test per behaviour.
- Agent rules for each new seam (ledger only, `Cents` only, pure decisions, test kit only, `invalidate(change)` only), with `scripts/check.sh` policy greps once the code exists.

## Foundations

These change what the data is, so they come before anything that reports on it.

### Accounts and debts

- Account types: checking, savings, credit card, loan.
- Optional owner label per account (one app user; the label only groups accounts).
- Choose the account on import.
- Transfers between accounts and card payments are matched and excluded from spending.
- Per-account views and an owner filter where useful.
- `raw_transactions` and `imports` already carry `account_id`; the Foundations refactor's ledger decides the account scope in one place.
- Transfer matching is pure decision logic with table-driven tests.

### Line items

- Split a transaction into lines (name, amount, category) through a receipt form.
- Lines are an overlay; the imported row is never changed.
- Lines must add up exactly to the bank amount, or the save is refused.
- Spending uses the lines' categories when a transaction has lines.

### Attachments

- Link one or more image or PDF files to a transaction, and view them. The app never reads their contents.
- Backups become one archive holding the database and the attachment files; restore replaces both.
- The safety copy and Undo restore cover the files; database-only backups from earlier versions still restore.
- `docs/security.md`: attachments are plain files by design and may show card last-4 digits and addresses.
- One-way door: it changes the backup format.

## Planning

### Monthly budget

- Budget lines attached to categories, with a nickname as a shortcut to a line.
- 50/30/20 bucket per line; planned vs actual per month; rollups by type and owner.
- Budget editor.
- One-time seed from the Monthly Tracker (see appendix).

### Bills and recurring charges

- Detection: 3 or more occurrences at a regular interval, amounts within 10%; confirm or dismiss.
- Bills calendar: due, paid, late; next expected date.
- Due-soon desktop notification.
- Price-increase flag when a confirmed charge's amount goes up.

### Savings goals

- Goal: name, target amount, target date.
- Monthly amount needed to reach it.
- Progress from a chosen account's balance.

### Cash-flow forecast

- Projected balance per account 30, 60 and 90 days out, from recurring charges, income and the budget.
- Low-balance warning with the date it happens.

### What-if planner

- Extra monthly income (for example a second job) needed to reach a goal by a date.
- Debt payoff: avalanche vs snowball, with a debt-free date per plan.
- Investing-readiness checklist of common milestones (emergency fund covered, high-interest debt paid), each showing where the user stands.
- Every result shows its inputs and assumptions.

## Insight

### Month close

- Guided monthly routine: accounts not imported this month, unreviewed or uncategorized rows, budget vs actual.
- Close the month once every step is done.

### Spending insights

- Cut candidates: non-essential items or categories bought often and not budgeted, from line items and categories.
- Unusual and duplicate charges.
- Yearly tax summary: spending in user-tagged tax-relevant categories, organized for a tax preparer (no tax advice).

### Dashboard

- Built once, after the data above exists.
- One chart library.
- Main page: headline numbers, spending by category, month-over-month trend, upcoming bills, goal progress, forecast warning.
- Date range picker driving every view.
- Secondary pages only when a feature needs one.
- Design variants through the snapshot harness (`snapshot.html`), not a separate prototype setup. Checkpoint: the user picks one variant before the build continues.

## Future items (after the core app works; each one optional)

- Financial guide: an opt-in background crawler builds a local RAG library of articles (tags, description, URL) matched to the user's milestones. Needs a Settings switch, since it breaks "the update check is the only outside call"; a trusted-source allowlist; local Ollama embeddings; vector search would need a dependency such as `sqlite-vec`.
- Teller bank connections.
- Claude API advisor.
- Jev categorizer, Unsloth fine-tuning.
- GPUI or Dioxus UI rewrite.
- Structured `AppError`: typed reasons inside variants (database kind, I/O apart from database, validation field), turned into the user's string only at the command boundary; same binding shape, same no-secrets rule.
- `cargo-mutants` as an occasional run on money, ledger, imports and crypto (dev tool; needs approval, and a decision on CI).

## Decided against

- Onboarding: a well-designed app needs none.
- Data export: backups are the export.
- Demo mode.
- Manual transactions: they would undermine the accuracy of the data.
- Reading or scanning attachments (OCR, vision): item codes aren't reliably readable; the user enters line items.

## Appendix: Budget details (Monthly budget)

**Source:** the app replaces the Household Budget Google Sheet. Only the Monthly Tracker tab is imported, once, by an AI agent with Sheets access (other tabs are outdated). The agent produces a seed file the app loads; the app needs no Google sign-in. After that, budgets are edited in the app.

**Monthly Tracker inventory:**

- Income list: name, amount, owner.
- Expense lines (about 37): name, monthly amount, total balance owed (loans and cards), type, 50/30/20 bucket, owner.
- Type list (10): Home, Extra, Idemnity (typo for Indemnity), Utility, Loan, Credit Card, Food, Pet, Medical, Savings.
- Summary: total income, total expenses, total debt, non-house debt.
- Goals: 50/30/20 targets vs actual, plus an Unplanned amount.
- Rollups: spending and debt by type; debt and income per person; monthly unplanned per person.

**Budget lines:** name, monthly amount, type, 50/30/20 bucket, owner, due day, linked category. Balances owed come from the loan and card accounts of Accounts and debts rather than the budget. Income gets its own small table. The Sheet's Loan Estimator and Savings Calculator are replaced by the What-if planner and Savings goals.
