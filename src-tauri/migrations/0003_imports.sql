-- One row per imported file, recorded even when every row was a duplicate.
-- ledger_balance_cents/balance_as_of come from the file's LEDGERBAL; expected_balance_cents is
-- the latest import's balance dated on or before this one plus the rows between the two as-of dates (see balance_check).
CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    file_name TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('ofx', 'qfx')),
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ledger_balance_cents INTEGER,
    balance_as_of TEXT,
    expected_balance_cents INTEGER,
    balance_check TEXT NOT NULL CHECK (balance_check IN ('passed', 'mismatch', 'baseline', 'notChecked'))
);
-- Values read from the file are never modified; only the derived balance check columns are written.
CREATE TRIGGER imports_raw_no_update
BEFORE UPDATE OF id, account_id, file_name, format, imported_at, ledger_balance_cents, balance_as_of ON imports
BEGIN SELECT RAISE(ABORT, 'imported file data is never modified'); END;

-- Raw imported rows, never modified (the trigger enforces it); only a whole-import revert deletes them.
-- Amounts are integer cents, negative for money out. original_row is the full STMTTRN block.
CREATE TABLE raw_transactions (
    id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    fitid TEXT,
    posted_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    raw_description TEXT NOT NULL,
    memo TEXT,
    transaction_type TEXT,
    running_balance_cents INTEGER,
    original_row TEXT NOT NULL
);
CREATE UNIQUE INDEX raw_transactions_account_fitid ON raw_transactions (account_id, fitid) WHERE fitid IS NOT NULL;
CREATE INDEX raw_transactions_posted ON raw_transactions (account_id, posted_date);
CREATE TRIGGER raw_transactions_no_update BEFORE UPDATE ON raw_transactions
BEGIN SELECT RAISE(ABORT, 'raw transactions are never modified'); END;
