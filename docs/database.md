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

## Release and update settings

All in `app_meta`, plain text:

- `last_run_version`: the app version that last opened the database, set after migrations succeed.
- `release_notes_since`: the version to show notes after; `0.0.0` for a database from before V7. Deleted when the user closes the What's new dialog.
- `update_checks`: `on` or `off`; absent means on.
- `update_last`: JSON `{"date":"YYYY-MM-DD","result":...}` of the last check.
- `update_dismissed`: the version whose banner the user dismissed.

## Nicknames

- `nicknames`: one row per nickname; `name` is unique ignoring case, `enabled` and `stale_exempt` are 0/1.
- `nickname_rules`: `mode` (`exact`, `contains`, `regex`), `field` (`description`, `memo`) and `pattern`, trimmed. `ON DELETE CASCADE` from `nicknames`.
- `nickname_matches`: derived, one row per raw transaction with the winning rule. `ON DELETE CASCADE` from both `raw_transactions` and `nickname_rules`, so reverting an import or deleting a rule removes its rows. Raw rows are never changed.
- Rebuilt in full, in one SQL transaction, after any nickname or rule create, update or delete (`nicknames::rebuild`). `commit_import` fills it for the new rows only (`nicknames::match_import`). A restore brings it back with the database.
- `app_meta.nickname_stale_days`: days before a nickname is stale; absent means 90.
- Matching and precedence: [nicknames.md](nicknames.md#when-several-rules-match).

## Categories

Added in `0006_categories.sql`. Guide: [categories.md](categories.md). Design: [ADR 0001](adr/0001-derived-effective-category-and-polled-job-slot.md).

- `categories`: `name` (unique ignoring case, 1-40 characters), `description` (0-200), `kind` (`spending`, `income` or `transfer`) and `sort_order`. The migration seeds 22 starter rows.
- `nicknames.default_category_id`: optional; `ON DELETE SET NULL`.
- `transaction_categories`: at most one row per raw transaction (`ON DELETE CASCADE`, so a revert removes it). It holds `user_category_id`, `model_category_id`, `model_build_id`, `model_reviewed`, `note` (1-500 characters or NULL) and `updated_at`. A category delete sets its columns to NULL. It never holds a nickname default.
- `model_builds`: one row per build; `name` is `zeni-<id>`, `sent` is the JSON body sent to Ollama's `/api/create`. A partial unique index allows at most one `active` row.
- `effective_categories` (view): per raw transaction, `category_id` (user, else the enabled winning nickname's default, else model), `set_by` (`user`, `nickname`, `model` or NULL), `reviewed` (always 1 for user and nickname), `model_build_id`, `note` and `nickname`. Every reader uses it.
- Triggers `categories_out_of_date_insert`, `_update` and `_delete` set `out_of_date = 1` on every build after any category change.
- `nicknames::rebuild` clears the model columns of rows whose enabled winning nickname has a default.
- `app_meta` keys: `ollama_port` (absent means 11434), `ollama_base_model` (absent means none), `auto_categorize` (absent means on, `0` off) and `build_examples` (examples per category, 1-20; absent means 5).
