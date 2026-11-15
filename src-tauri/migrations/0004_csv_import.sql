-- no-transaction
-- Runs outside sqlx's transaction so foreign keys can be turned off first: dropping `imports` with
-- them on would cascade-delete every raw row.
PRAGMA foreign_keys = OFF;
BEGIN;

-- A saved CSV column mapping, matched to a file by its normalised header names joined with '\n'.
-- Columns are zero-based indexes into the header row; the amount is one signed column or a debit/credit pair.
CREATE TABLE csv_layouts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    header_fingerprint TEXT NOT NULL UNIQUE,
    date_format TEXT NOT NULL CHECK (date_format IN ('MM/DD/YYYY', 'M/D/YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY')),
    posted_date_column INTEGER NOT NULL,
    description_column INTEGER NOT NULL,
    amount_column INTEGER,
    debit_column INTEGER,
    credit_column INTEGER,
    transaction_id_column INTEGER,
    memo_column INTEGER,
    transaction_type_column INTEGER,
    running_balance_column INTEGER,
    posting_status_column INTEGER,
    bank_category_column INTEGER,
    CHECK ((amount_column IS NOT NULL AND debit_column IS NULL AND credit_column IS NULL)
        OR (amount_column IS NULL AND debit_column IS NOT NULL AND credit_column IS NOT NULL))
);

-- SQLite can't widen a CHECK, so `imports` is rebuilt to allow 'csv'. csv_layout_id is the layout a CSV
-- import used; file_balance_check is the within-file running-balance check (always 'notChecked' for OFX/QFX).
CREATE TABLE imports_new (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    file_name TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('ofx', 'qfx', 'csv')),
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ledger_balance_cents INTEGER,
    balance_as_of TEXT,
    expected_balance_cents INTEGER,
    balance_check TEXT NOT NULL CHECK (balance_check IN ('passed', 'mismatch', 'baseline', 'notChecked')),
    csv_layout_id INTEGER REFERENCES csv_layouts(id) ON DELETE SET NULL,
    file_balance_check TEXT NOT NULL DEFAULT 'notChecked'
        CHECK (file_balance_check IN ('passed', 'mismatch', 'notChecked'))
);
INSERT INTO imports_new (id, account_id, file_name, format, imported_at, ledger_balance_cents,
    balance_as_of, expected_balance_cents, balance_check)
SELECT id, account_id, file_name, format, imported_at, ledger_balance_cents,
    balance_as_of, expected_balance_cents, balance_check
FROM imports;
DROP TABLE imports;
ALTER TABLE imports_new RENAME TO imports;

-- Values read from the file are never modified. csv_layout_id stays out, so deleting a layout can set it NULL.
CREATE TRIGGER imports_raw_no_update
BEFORE UPDATE OF id, account_id, file_name, format, imported_at, ledger_balance_cents, balance_as_of,
    file_balance_check ON imports
BEGIN SELECT RAISE(ABORT, 'imported file data is never modified'); END;

-- The bank's own category for a CSV row, kept for later prompts.
ALTER TABLE raw_transactions ADD COLUMN bank_category TEXT;

-- Informational only: it reports violations but doesn't abort; the migration test in db.rs checks them.
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys = ON;
