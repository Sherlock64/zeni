# Database

Schema detail for backend work. The rules (location, permissions, migrations, immutability) are in `CLAUDE.md` under Database; the schema is in `src-tauri/migrations/`.

## Security

- `key_wraps` holds the data key wrapped by the master password (one `password` row, enforced by a unique index) and by each unused recovery code (`recovery` rows). Each row stores its own salt and Argon2id parameters.
- `app_meta.data_key_id` names the matching keyring item.
- `accounts.account_number` and `routing_number` are `nonce || ciphertext` BLOBs.

## Imports

- `imports` has one row per imported file (`format` `ofx`, `qfx` or `csv`), also when every row was a duplicate.
- `imports.csv_layout_id` stays updatable so deleting a layout can set it NULL (`ON DELETE SET NULL`). `expected_balance_cents` and `balance_check` are also not guarded by `imports_raw_no_update`; every other column is.
- `file_balance_check` is the CSV running-balance check; always `notChecked` for OFX/QFX.
- A mapped CSV transaction ID is stored as `fitid`, the bank's category as `bank_category`, the CSV line as `original_row` (for OFX/QFX, the full `STMTTRN` block). `(account_id, fitid)` is unique where `fitid` is not null.
- Dedupe and cross-format rules: [importing.md](importing.md).

## CSV layouts

`csv_layouts` holds one saved mapping per `header_fingerprint` (unique): each header name with whitespace collapsed and lowercased, joined with `\n` (`csv_import::fingerprint`). Columns are zero-based indexes; a `CHECK` allows one `amount_column` or a `debit_column`/`credit_column` pair, not both.

## Backup settings

`app_meta` holds `backup_folder` (the chosen folder; absent means `<data dir>/backups`), `backup_keep` (automatic backups kept, 1-365, default 14) and `last_daily_backup` (local date, `YYYY-MM-DD`, of the last successful daily backup). Behaviour: [backup.md](backup.md).
