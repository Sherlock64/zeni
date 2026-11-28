# Backend guide

Load when a ticket touches `src-tauri/`, migrations, commands, shared types, bindings or build config.

## How this codebase works

- In `setup`, `src-tauri/src/lib.rs` stores the result of `db::connect` in `AppState` (`src-tauri/src/types/state.rs`): `db` (`RwLock<Result<Database, String>>`, swapped by a restore), `session` (the data key once unlocked), `pending_import` and `backup`. Startup never panics over the database; the UI shows the error instead. Commands are registered in `generate_handler!`.
- `src-tauri/src/commands.rs` holds thin `#[tauri::command]` wrappers over private plain functions (`app_info` calls `load_app_info`). Mark an item `pub` only if another module calls it. Queries live in `db.rs` or a domain module.
- The app version lives only in `src-tauri/Cargo.toml`; `tauri.conf.json` has no `version` key.
- `keyring.rs` holds the `Keyring` trait and its thin oo7 `SecretService` impl; tests use `FakeKeyring` in `security.rs`.
- A domain's types go in `src-tauri/src/types/<domain>.rs`; `types/mod.rs` re-exports every one, so `use crate::types::X` keeps working.
- Money is `Cents` (`types/money.rs`, checked ops only); parse amount text only with `money::parse_amount`.
- To add or change a command, its types or its `AppError`s, follow `.claude/skills/add-command/SKILL.md`.

## Tests

- One owning test per behaviour, at its seam (the module's `pub fn`). Assert state and what the user sees (rows, returned values), not which calls were made. Share setup, not assertions.

## Migrations

- Add `src-tauri/migrations/NNNN_<snake_name>.sql`, numbered one past the highest file.
- `sqlx::migrate!` embeds migrations at compile time; `src-tauri/build.rs` already reruns the build when `migrations/` changes.
- `open_creates_private_db_and_applies_migrations_once` in `db.rs` counts the migrations itself, so it needs no update. Add a test for each migration's schema or data behaviour.
- When a migration adds `REFERENCES` to an existing table, grep every `DELETE`/`UPDATE` on that table and add a test for each; sqlx enables foreign keys.
- A table rebuild follows the `CLAUDE.md` Database rule: `-- no-transaction`, then `PRAGMA foreign_keys = OFF; BEGIN;` ... `PRAGMA foreign_key_check; COMMIT; PRAGMA foreign_keys = ON;`, as `0004_csv_import.sql` does. Recreate the rebuilt table's triggers and indexes.
- Tables holding raw imported data get no update path in code and a `BEFORE UPDATE` trigger that aborts, like `raw_transactions_no_update` in `0003_imports.sql`.

## Security work

`CLAUDE.md`'s encryption and secret rules apply to every line. Also:

- `crypto.rs` is the only place that encrypts, decrypts or runs Argon2id.
- Hold secrets in `Zeroizing` buffers, as `DataKey` does.
- Bind every SQL value with `.bind()` or `QueryBuilder::push_bind`; never build SQL with `format!`. The only text pushed into SQL is a fixed identifier picked by matching an enum, like the sort column in `transactions.rs`.
- Keep `src-tauri/capabilities/` and the CSP in `src-tauri/tauri.conf.json` at the minimum the feature needs. The file picker runs Rust-side (`app.dialog()` from `tauri-plugin-dialog`, see `import_file` in `commands.rs`), so it needs no permission. App commands need no capability, so `permissions` in `src-tauri/capabilities/default.json` stays `[]` unless a plugin needs one.
- Create any new data directory with `db::create_private_dir` (0700); files holding user data are 0600, as `db::open` does for `zeni.db`.

Parser and import tests read the fake bank files in `src-tauri/tests/fixtures/`; its `README.md` lists each file's expected import result. Keep it in sync when you add or change a fixture.
