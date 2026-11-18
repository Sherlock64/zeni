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

## Nicknames

- **Nickname**: a short name shown in place of a transaction's bank text; one row in `nicknames`, with one or more rules ([nicknames.md](nicknames.md)).
- **Rule**: a mode, a field and a pattern that decide which transactions get a nickname (`nickname_rules`).
- **Match mode**: `exact`, `contains` or `regex` (`MatchMode`).
- **Precedence**: which rule wins when several match: exact, then contains, then regex; then the longer pattern; then the older rule ([nicknames.md](nicknames.md#when-several-rules-match)).
- **Stale**: a nickname that never matched, or whose last match is more than `nickname_stale_days` before the newest transaction; stale-exempt nicknames are never stale.

## Categories

- **Category**: one entry of the user's flat category list, with a kind ([categories.md](categories.md)).
- **Kind**: `spending`, `income` or `transfer`; decides how a category counts in the spending query (`CategoryKind`).
- **Effective category**: the category a row shows: set by user, else the enabled nickname's default, else the model's, else uncategorized (`effective_categories` view).
- **Set by**: who set a row's category: `model`, `nickname` or `user` (`SetBy`).
- **Reviewed**: a model answer the user confirmed; user- and nickname-set rows count as reviewed.
- **Categorizer**: the backend that picks a category for a row; the Ollama one is `OllamaCategorizer` (`categorize.rs`).
- **Base model**: the installed Ollama model chosen in Settings.
- **Model build**: an Ollama model `zeni-<number>` made from the base model, the category list and reviewed examples (`model_builds`).
- **Active build**: the model build used for categorizing; with none, the base model.
- **Categorize run**: one background "Categorize now", "Recategorize all" or post-import pass.
- **Job slot**: the one place (`AppState.jobs`) where the running Ollama job (run, download or build) and the last outcome live; the UI polls `job_status` ([ADR 0001](adr/0001-derived-effective-category-and-polled-job-slot.md)).

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
