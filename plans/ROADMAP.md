# Personal Finance App — Roadmap

One major change per version; each version gets its own PRD, written from this roadmap.

## V1: App foundation

- Tauri 2 project: Rust backend, TypeScript + React frontend.
- Repo layout and CLAUDE.md coding rules (types kept separate from logic, no new dependencies without asking, money as integer cents).
- SQLite via sqlx with versioned migrations.
- shadcn, TanStack Router and TanStack Query set up.
- App shell: dark theme, navigation, settings page, empty states.
- Typed command layer between the Rust backend and the UI, with typed errors.
- Test setup for Rust and the frontend.
- Dev and release builds running on Pop!_OS.

## V2: Security

- Accounts table: name, owner, bank name, account number, routing number.
- Field-level AES-256-GCM encryption for account and routing numbers.
- Key stored via the Secret Service API (GNOME Keyring today, oo7 later), unlocked at login.
- Master-password fallback (Argon2-derived key) when the keyring is locked or missing.
- First-run setup: create the key and add the checking account.
- Locked-keyring detection and unlock prompt.
- Documented scope: only account details are encrypted; everything else is plain text by choice.

## V3: Import and transaction list

- Parsers for OFX and QFX (OFX 1.x SGML and 2.x XML).
- Imports table and raw transactions table; raw rows are never edited.
- Posted transactions only; US dollars only.
- Duplicate matching: account + FITID, falling back to date + amount + description.
- Import summary: rows added and duplicates skipped.
- Revert a whole import in one step.
- Balance check: each import's ledger balance against the prior import's.
- Transaction list: sort, filter by date range, search.
- Sample OFX/QFX files with fake data, modelled on public OFX examples, as test fixtures.

**Release cut:** after V3 the app is fully functional (set up, secure, imports and lists transactions) and is pushed to GitHub.

## V3.1: CSV import

- CSV parser (`csv` crate) with column mapping saved per layout.
- Duplicate matching on date + amount + description.
- Running-balance check when the CSV has a balance column.

## V4: Backup and restore

- One-click timestamped backup using SQLite's online backup API.
- Restore with confirmation, keeping a safety copy of the replaced database.
- Encrypted fields stay encrypted; restoring needs the same key.

## V5: Nicknames

- Nicknames table.
- Right-click "Rename it" with a "What's its nickname?" pop-up.
- Match modes: exact, pattern, regex; match on description or memo.
- Precedence: exact, then pattern, then regex.
- Applies to all past and future matching transactions; unmapped items show raw text.
- Match count, last matched date, stale flag, stale-flag exempt option, on/off switch.
- Nicknames management page.

## V6: Categorisation

- Flat categories table with an editable starter list and descriptions; category editor.
- Transaction overlay table: category, note, set by (model or user), reviewed.
- Ollama integration: detect Ollama, list installed models, choose a base model.
- Prompts constrained to the category list; out-of-list answers rejected.
- "Categorize now", "Categorize all" and "Recategorize all" (skips user-set rows).
- Batch review screen grouped by category, with a "Looks good" button.
- Model builds: up to N reviewed examples per category, Modelfile generation, builds table, choose the active build.
- Nickname default category skips the model.
- Rules: savings transfers tagged and excluded from spending; refunds count as negative spending.
- Pluggable categoriser interface for future backends.

## V7: Dashboard

- Prototype phase: at least three variants via Podman Compose. Checkpoint: the user picks one before the build continues.
- Design: Copilot Money style; dark, colourful, clean, limited data per chart.
- Charts: shadcn charts (Recharts), ECharts for heavier visuals.
- Main page: headline numbers, spending by category, month-over-month trend, status badges.
- Secondary pages: top nicknames, running balance, cash-flow Sankey, spending heatmap, biggest transactions, category drill-down.
- Date range picker driving every view.

## V8: Recurring charges

- Recurring charges table.
- Detection: 3 or more occurrences at a regular interval, amounts within 10%.
- Confirm or dismiss suggestions.
- Next expected date.
- Upcoming recurring charges on the dashboard main page, plus a recurring list page.

## V9: Multiple accounts and people

- People table; accounts linked to owners.
- Multiple checking and savings accounts; choose the account on import.
- Savings transfers matched across accounts.
- Person filter on every chart (one or several people).
- Per-account views.

## V10: Budget

- One-time import of the Monthly Tracker tab by an AI agent, producing a seed file (see appendix).
- Budget items and income tables, types and 50/30/20 buckets.
- Budget editor.
- Linking transactions to budget items (overlay link, nickname default budget item).
- Over/under comparison, 50/30/20 goals, rollups by type and person.
- Loan estimator and savings calculator.

## V11: Advisor

- Claude API integration, with the API key stored via Secret Service.
- Research financial-certification study material to shape the prompts.
- Data preparation for advisor prompts.
- Forward-looking advice: upcoming issues, investing suggestions, needs.

## Future items to review (not assigned to a version)

- Teller bank connections.
- Jev categoriser (TypeSafe System One model; cheap, confidence scores).
- Unsloth fine-tuning.
- GPUI or Dioxus UI rewrite.
- Split transactions.

## Appendix: Budget Details (V10)

**Source:** the app replaces the Household Budget Google Sheet. Only the Monthly Tracker tab is imported, once, by an AI agent with Sheets access (other tabs are outdated). The agent produces a seed file the app loads; the app needs no Google sign-in. After that, budgets are edited in the app.

**Monthly Tracker inventory:**

- Income list: name, amount, owner.
- Expense lines (about 37): name, monthly amount, total balance owed (loans and cards), type, 50/30/20 bucket, owner.
- Type list (10): Home, Extra, Idemnity (typo for Indemnity), Utility, Loan, Credit Card, Food, Pet, Medical, Savings.
- Summary: total income, total expenses, total debt, non-house debt.
- Goals: 50/30/20 targets vs actual, plus an Unplanned amount.
- Rollups: spending and debt by type; debt and income per person; monthly unplanned per person.
- Calculators: Loan Estimator and Savings Calculator (target with 3, 5 and 10 year plans).

**Budget items:** name, monthly amount, balance owed, type, 50/30/20 bucket, owner, due day. Income gets its own small table.

**Linking:** a secondary categorisation. The transaction overlay gets an optional budget item link, and nicknames get an optional default budget item, so e.g. every CenterPoint payment links to the CenterPoint budget line automatically.
