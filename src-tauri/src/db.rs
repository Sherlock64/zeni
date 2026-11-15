use std::fs::{self, DirBuilder, OpenOptions, Permissions};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;

use crate::types::{AppError, Database};

/// Debug builds (`pnpm tauri dev`) keep their own database in `dev/`, so they never touch real data.
pub fn data_dir(app_data_dir: PathBuf) -> PathBuf {
    if cfg!(debug_assertions) {
        app_data_dir.join("dev")
    } else {
        app_data_dir
    }
}

/// Startup: opens `zeni.db` inside `data_dir`, describing any failure for the UI.
pub async fn connect(data_dir: &Path) -> Result<Database, String> {
    let path = data_dir.join("zeni.db");
    let pool = async {
        create_private_dir(data_dir)?;
        open(&path).await
    }
    .await
    .map_err(|error| format!("Couldn't open the database at {}: {error}", path.display()))?;
    Ok(Database { pool, path })
}

/// Creates `dir` (and parents) readable only by the current user; tightens it if it already exists.
pub fn create_private_dir(dir: &Path) -> Result<(), AppError> {
    DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    fs::set_permissions(dir, Permissions::from_mode(0o700))?;
    Ok(())
}

/// Opens (creating if missing) the database, makes it owner-only, and applies pending migrations.
pub async fn open(path: &Path) -> Result<SqlitePool, AppError> {
    // Create it owner-only before SQLite opens it: SQLite gives its -journal/-wal/-shm files the same mode.
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false) // never wipe an existing database
        .mode(0o600)
        .open(path)?;
    fs::set_permissions(path, Permissions::from_mode(0o600))?; // tighten a file from an older run
    let pool = SqlitePool::connect_with(SqliteConnectOptions::new().filename(path)).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

pub async fn applied_migrations(pool: &SqlitePool) -> Result<u32, AppError> {
    let count = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success")
        .fetch_one(pool)
        .await?;
    Ok(count)
}

#[cfg(test)]
pub fn temp_dir(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("zeni-test-{}-{name}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqliteJournalMode;

    use super::*;

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn debug_builds_use_a_separate_dev_folder() {
        // Tests are debug builds, so this is what `pnpm tauri dev` opens.
        let base = PathBuf::from("/data/com.sherlock64.zeni");
        assert_eq!(data_dir(base.clone()), base.join("dev"));
    }

    #[test]
    fn open_creates_private_db_and_applies_migrations_once() {
        let dir = temp_dir("db");
        let path = dir.join("zeni.db");
        let expected = sqlx::migrate!("./migrations").migrations.len() as u32;

        create_private_dir(&dir).unwrap();
        fs::set_permissions(&dir, Permissions::from_mode(0o755)).unwrap();
        create_private_dir(&dir).unwrap();
        assert_eq!(mode(&dir), 0o700);

        tauri::async_runtime::block_on(async {
            let pool = open(&path).await.unwrap();
            assert_eq!(applied_migrations(&pool).await.unwrap(), expected);
            pool.close().await;
            assert_eq!(mode(&path), 0o600);

            // A second launch finds nothing new to apply.
            let pool = open(&path).await.unwrap();
            assert_eq!(applied_migrations(&pool).await.unwrap(), expected);
            pool.close().await;
        });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sqlite_side_files_are_private() {
        let dir = temp_dir("wal");
        let path = dir.join("zeni.db");
        create_private_dir(&dir).unwrap();
        tauri::async_runtime::block_on(async {
            let pool = open(&path).await.unwrap();
            // The app uses SQLite's default journal; WAL is the case with long-lived side files.
            let wal = SqliteConnectOptions::new()
                .filename(&path)
                .journal_mode(SqliteJournalMode::Wal);
            let wal_pool = SqlitePool::connect_with(wal).await.unwrap();
            sqlx::query("INSERT INTO app_meta (key, value) VALUES ('probe', 'x')")
                .execute(&wal_pool)
                .await
                .unwrap();
            assert_eq!(mode(&path), 0o600);
            assert_eq!(mode(&dir.join("zeni.db-wal")), 0o600);
            assert_eq!(mode(&dir.join("zeni.db-shm")), 0o600);
            wal_pool.close().await;
            pool.close().await;
        });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn open_tightens_existing_db_without_truncating() {
        let dir = temp_dir("tighten");
        let path = dir.join("zeni.db");
        let expected = sqlx::migrate!("./migrations").migrations.len() as u32;
        create_private_dir(&dir).unwrap();
        tauri::async_runtime::block_on(async {
            open(&path).await.unwrap().close().await;
            fs::set_permissions(&path, Permissions::from_mode(0o644)).unwrap();

            let pool = open(&path).await.unwrap();
            assert_eq!(mode(&path), 0o600);
            // Still migrated, so the existing file was reused, not truncated.
            assert_eq!(applied_migrations(&pool).await.unwrap(), expected);
            pool.close().await;
        });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn csv_migration_keeps_v3_rows_and_constraints() {
        let dir = temp_dir("migrate-0004");
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("zeni.db");
        create_private_dir(&dir).unwrap();
        let exec = |pool: &SqlitePool, sql: &'static str| {
            let pool = pool.clone();
            async move { sqlx::query(sql).execute(&pool).await }
        };
        tauri::async_runtime::block_on(async {
            // A V3 database: migrations up to 0003, with two imports and their rows.
            let mut v3 = sqlx::migrate!("./migrations");
            v3.migrations = v3
                .migrations
                .iter()
                .filter(|m| m.version <= 3)
                .cloned()
                .collect();
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.unwrap();
            v3.run(&pool).await.unwrap();
            for sql in [
                "INSERT INTO accounts (id, name, owner, bank_name, account_number, routing_number) \
                 VALUES (1, 'Checking', 'Sam', 'Bank', x'00', x'00')",
                "INSERT INTO imports (id, account_id, file_name, format, ledger_balance_cents, balance_as_of, \
                 expected_balance_cents, balance_check) VALUES \
                 (1, 1, 'a.ofx', 'ofx', 1000, '2026-10-01', NULL, 'baseline'), \
                 (2, 1, 'b.qfx', 'qfx', 1500, '2026-10-31', 1500, 'passed')",
                "INSERT INTO raw_transactions (import_id, account_id, fitid, posted_date, amount_cents, \
                 raw_description, original_row) VALUES \
                 (1, 1, 'A1', '2026-09-30', -100, 'x', 'o'), (1, 1, 'A2', '2026-10-01', 200, 'y', 'o'), \
                 (2, 1, 'B1', '2026-10-15', 500, 'z', 'o')",
            ] {
                exec(&pool, sql).await.unwrap();
            }
            let snapshot = |pool: SqlitePool| async move {
                sqlx::query_as::<_, (i64, String, String, String, Option<i64>, Option<String>, Option<i64>, String)>(
                    "SELECT id, file_name, format, imported_at, ledger_balance_cents, balance_as_of, \
                     expected_balance_cents, balance_check FROM imports ORDER BY id",
                )
                .fetch_all(&pool)
                .await
                .unwrap()
            };
            let raw_count = |pool: SqlitePool| async move {
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM raw_transactions")
                    .fetch_one(&pool)
                    .await
                    .unwrap()
            };
            let before = snapshot(pool.clone()).await;
            pool.close().await;

            let pool = open(&path).await.unwrap();
            assert_eq!(snapshot(pool.clone()).await, before);
            assert_eq!(raw_count(pool.clone()).await, 3);
            let checks: Vec<String> = sqlx::query_scalar("SELECT file_balance_check FROM imports")
                .fetch_all(&pool)
                .await
                .unwrap();
            assert_eq!(checks, ["notChecked", "notChecked"]);
            let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(foreign_keys, 1);
            assert!(
                sqlx::query("PRAGMA foreign_key_check")
                    .fetch_all(&pool)
                    .await
                    .unwrap()
                    .is_empty()
            );

            // Deleting an import still cascades to its raw rows.
            exec(&pool, "DELETE FROM imports WHERE id = 1")
                .await
                .unwrap();
            assert_eq!(raw_count(pool.clone()).await, 1);

            // A CSV import with a layout and a bank category; deleting the layout only clears the link.
            for sql in [
                "INSERT INTO csv_layouts (id, name, header_fingerprint, date_format, posted_date_column, \
                 description_column, amount_column) VALUES (7, 'Bank', 'posting date\namount', 'MM/DD/YYYY', 0, 1, 2)",
                "INSERT INTO imports (id, account_id, file_name, format, balance_check, csv_layout_id, \
                 file_balance_check) VALUES (3, 1, 'c.csv', 'csv', 'notChecked', 7, 'mismatch')",
                "INSERT INTO raw_transactions (import_id, account_id, posted_date, amount_cents, \
                 raw_description, bank_category, original_row) VALUES (3, 1, '2026-11-01', -5, 'w', 'Food', 'o')",
                "DELETE FROM csv_layouts WHERE id = 7",
            ] {
                exec(&pool, sql).await.unwrap();
            }
            let row: (Option<i64>, String) = sqlx::query_as(
                "SELECT csv_layout_id, file_balance_check FROM imports WHERE id = 3",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(row, (None, "mismatch".into()));

            // File data stays immutable; the derived V3 check columns stay writable.
            for sql in [
                "UPDATE imports SET file_name = 'x' WHERE id = 2",
                "UPDATE imports SET format = 'csv' WHERE id = 2",
                "UPDATE imports SET file_balance_check = 'passed' WHERE id = 3",
            ] {
                let error = exec(&pool, sql).await.unwrap_err().to_string();
                assert!(
                    error.contains("imported file data is never modified"),
                    "{error}"
                );
            }
            exec(
                &pool,
                "UPDATE imports SET balance_check = 'mismatch' WHERE id = 2",
            )
            .await
            .unwrap();
            // The layout CHECK needs one signed amount or a debit/credit pair.
            assert!(
                exec(
                    &pool,
                    "INSERT INTO csv_layouts (name, header_fingerprint, date_format, posted_date_column, \
                     description_column, amount_column, debit_column, credit_column) \
                     VALUES ('Both', 'x', 'M/D/YYYY', 0, 1, 2, 3, 4)"
                )
                .await
                .is_err()
            );
            pool.close().await;
        });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn connect_describes_failure_with_path() {
        // A regular file where the data folder should be makes the folder impossible to create.
        let blocker = temp_dir("blocker");
        fs::write(&blocker, "").unwrap();
        let error = tauri::async_runtime::block_on(connect(&blocker.join("data")))
            .err()
            .unwrap();
        let expected = format!(
            "Couldn't open the database at {}: ",
            blocker.join("data/zeni.db").display()
        );
        assert!(error.starts_with(&expected), "{error}");
        fs::remove_file(&blocker).unwrap();
    }
}
