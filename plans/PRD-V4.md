# Personal Finance App — V4 PRD: Backup and Restore

V4 adds timestamped backups of the whole database, automatic and on demand, and a safe restore. Builds on PRD-V1.md to PRD-V3.1.md; see ROADMAP.md.

## Requirements

- **V4-R1:** Backups use `VACUUM INTO` (sqlx exposes no backup API), so they are consistent while the app runs. Write to a temp name in the backup folder, set 0600, then rename. Each file is `zeni-YYYYMMDD-HHMMSS-<kind>.db`, kind being `manual`, `daily`, `pre-revert` or `safety`.
- **V4-R2:** Backup folder set in Settings, chosen with the native folder dialog; default `~/.local/share/com.sherlock64.zeni/backups` (0700). Stored in `app_meta`.
- **V4-R3:** "Back up now" button in Settings, showing the result and the file path.
- **V4-R4:** Automatic backups: on the first app start each day (no unlock needed), and before every import revert. A failed pre-revert backup stops the revert with an error. The restore safety copy (V4-R8) covers restores.
- **V4-R5:** Retention: keep the newest N automatic backups (`daily`, `pre-revert`), N set in Settings, default 14. Manual and safety backups are never pruned. Pruning only touches files in the backup folder that match the naming pattern.
- **V4-R6:** Restore: Settings lists backups in the backup folder (date, kind, size), plus "Restore from file…" for any other file. A confirm dialog names the backup's date and warns that current data will be replaced.
- **V4-R7:** Restore validation before anything is replaced: `PRAGMA integrity_check` passes, the file has Zeni's tables, and its migration version is not newer than the app's. Older backups are migrated after restore.
- **V4-R8:** Safety copy: before replacing the database, the current one is copied to a `safety` backup. The restore closes the pool (checkpointing WAL), copies the backup to a temp file in the data folder, renames it over `zeni.db`, removes stale `-wal`/`-shm` files, keeps 0600, and reopens.
- **V4-R9:** Encrypted fields stay encrypted; the backup is the plain SQLite file, matching the documented scope. After a restore the app re-reads its security status. If the restored `data_key_id` has no keyring item, the existing unlock page asks for the master password or a recovery code valid when the backup was made. After a restore, the unlock page also offers "Undo restore", which puts the safety copy back.
- **V4-R10:** docs: `docs/backup.md` for users; `docs/security.md` states that backup files hold all data except account and routing numbers in plain text and should be kept somewhere private.

## Out of Scope

- Encrypting whole backup files.
- Cloud upload or sync (point the folder at a synced directory instead).
- Partial or merge restores.
- Automatic backup before imports (reverting an import undoes it).

## Edge Cases

- **Backup folder missing or unwritable** (an unplugged USB drive): manual backup shows an error; the daily backup retries on the next launch and shows a non-blocking warning.
- **Restore fails midway:** the original file is untouched until the final rename; on any error the app reopens the original.
- **Restore of a backup from a newer app version:** refused with a clear message.
- **Restoring the safety copy itself:** allowed like any other backup.

## Acceptance Criteria

1. "Back up now" writes a timestamped, 0600 file that opens as a valid Zeni database.
2. A backup taken during an import is consistent (integrity check passes).
3. The first launch of a day creates one daily backup; later launches that day don't.
4. Reverting an import creates a pre-revert backup first.
5. With N = 3, only the newest 3 automatic backups remain; manual and safety backups are kept.
6. Restoring after confirmation replaces the data, keeps a safety copy, and the app works on the restored data.
7. A corrupt file, a non-Zeni file or a newer-schema backup is rejected and nothing changes.
8. Restoring a backup made before a security reset asks for that backup's master password, then works; "Undo restore" returns to the pre-restore data.
9. Account and routing numbers remain ciphertext in every backup file.
