# Glossary

Zeni's domain terms as the code uses them. One line each; details live in the linked docs.

## Data

- **Account**: a bank account the user adds; its account and routing numbers are encrypted (`accounts.rs`).
- **Import**: one imported OFX, QFX or CSV file, one `imports` row, kept also when every row was a duplicate (`imports.rs`).
- **Raw transaction**: one imported row in `raw_transactions`, never modified; deleted only by reverting its import.
- **Revert**: hard-deletes an import and its raw transactions, after a pre-revert backup.
- **FITID**: the bank's transaction ID from an OFX/QFX `STMTTRN`; a mapped CSV transaction ID is stored in the same `fitid` column and drives dedupe.
- **Duplicate**: a row Zeni skips because it already has it, by FITID or, without one, by date, amount and description ([importing.md](importing.md#duplicates)).
- **Suspected duplicate** (cross-format suspect): a new row matching an earlier row from the other format by exact amount and dates at most 2 days apart; the user confirms or rejects it before commit (`SuspectedDuplicate`).
- **Pending import**: a parsed file held in `AppState.pending_import` between preview and commit or cancel.
- **Balance check**: the file's ledger balance compared with the expected balance from earlier imports: `passed`, `mismatch`, `baseline` (first balance recorded) or `notChecked` (`BalanceCheck`).
- **File balance check**: the CSV running-balance check within one file: `passed`, `mismatch` or `notChecked`; always `notChecked` for OFX/QFX (`FileBalanceCheck`).
- **CSV layout**: a saved CSV column mapping, reused for files with the same header fingerprint (`csv_layouts.rs`).
- **Header fingerprint**: a CSV header's names, each whitespace-collapsed and lowercased, joined with `\n` (`csv_import::fingerprint`).

## Security

- **Master password**: the user's password; an Argon2id key derived from it wraps the data key.
- **Data key**: the random AES-256-GCM key that encrypts account and routing numbers; the database holds it only as key wraps, and it is cached in the keyring item named by `app_meta.data_key_id` so launches can skip the master password.
- **Key wrap**: a `key_wraps` row holding the data key encrypted under the master password (`password`) or one recovery code (`recovery`).
- **Recovery code**: a one-time code of 20 Crockford base32 characters that lets the user set a new master password; its key wrap is deleted once used (`crypto.rs`).
- **Keyring**: the desktop Secret Service, where the data key is cached; dev builds tag items `zeni-dev` (`keyring.rs`).

## Backups

- **Backup**: a `VACUUM INTO` copy of the database, kind `manual`, `daily`, `pre-revert` or `safety` ([backup.md](backup.md#file-names-and-kinds)).
- **Automatic backup**: a `daily` or `pre-revert` backup; only these are pruned ([backup.md](backup.md#how-many-backups-zeni-keeps)).
- **Safety copy**: the backup written just before a restore ([backup.md](backup.md#file-names-and-kinds)).
- **Restore**: replaces the database with a backup file ([backup.md](backup.md)).

## Workflow

- **Evidence manifest**: `snapshots/V<n>/evidence.yaml`, written by `scripts/check.sh integration` with the changed files and check results.
