use std::fs::{self, DirBuilder, OpenOptions, Permissions};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;

use crate::types::{AppError, Database};

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
fn create_private_dir(dir: &Path) -> Result<(), AppError> {
    DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    fs::set_permissions(dir, Permissions::from_mode(0o700))?;
    Ok(())
}

/// Opens (creating if missing) the database, makes it owner-only, and applies pending migrations.
async fn open(path: &Path) -> Result<SqlitePool, AppError> {
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
