//! Startup: newer-data and pre-update backup checks around migrating `zeni.db`.

use std::path::Path;

use sqlx::SqlitePool;

use crate::types::{AppError, Database, StartupProblem, StartupStatus};
use crate::{backup, db, version};

/// Opens `zeni.db` in `data_dir`, taking a pre-update backup before migrating older data.
pub async fn prepare(
    data_dir: &Path,
    allow_without_backup: bool,
) -> Result<Database, StartupProblem> {
    prepare_as(data_dir, allow_without_backup, version::APP_VERSION).await
}

/// `prepare` for app version `app`, so tests can play other versions.
async fn prepare_as(
    data_dir: &Path,
    allow_without_backup: bool,
    app: &str,
) -> Result<Database, StartupProblem> {
    let path = data_dir.join("zeni.db");
    let failed = |error: AppError| StartupProblem::Failed(db::open_failed(&path, error));
    db::create_private_dir(data_dir).map_err(failed)?;
    let pool = db::open_unmigrated(&path).await.map_err(failed)?;
    let result = check_and_migrate(&pool, &path, allow_without_backup, app).await;
    match result {
        Ok(()) => Ok(Database { pool, path }),
        Err(problem) => {
            pool.close().await;
            Err(match problem {
                Problem::Blocked(status) => StartupProblem::Blocked(status),
                Problem::Error(error) => failed(error),
            })
        }
    }
}

enum Problem {
    Blocked(StartupStatus),
    Error(AppError),
}

impl From<AppError> for Problem {
    fn from(error: AppError) -> Self {
        Self::Error(error)
    }
}

impl From<sqlx::Error> for Problem {
    fn from(error: sqlx::Error) -> Self {
        Self::Error(error.into())
    }
}

async fn check_and_migrate(
    pool: &SqlitePool,
    path: &Path,
    allow_without_backup: bool,
    app: &str,
) -> Result<(), Problem> {
    let app_version = version::parse(app);
    // No migrations table: a new (or never migrated) file, so there is nothing to back up.
    let fresh: bool = sqlx::query_scalar(
        "SELECT NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await?;
    let mut since = None;
    if !fresh {
        let last: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'last_run_version'")
                .fetch_optional(pool)
                .await?;
        let last_parsed = last.as_deref().and_then(version::parse);
        let applied: Vec<i64> = sqlx::query_scalar("SELECT version FROM _sqlx_migrations")
            .fetch_all(pool)
            .await?;
        let known = sqlx::migrate!("./migrations").migrations;
        let unknown = applied
            .iter()
            .any(|v| !known.iter().any(|migration| migration.version == *v));
        if unknown || last_parsed > app_version {
            return Err(Problem::Blocked(StartupStatus::NewerData {
                version: last.filter(|_| last_parsed.is_some()),
            }));
        }
        // An unreadable last run version counts as older: backing up is the safe side.
        if last_parsed.is_none() || last_parsed < app_version {
            if !allow_without_backup && let Err(error) = backup::pre_update(pool, path).await {
                return Err(Problem::Blocked(StartupStatus::BackupFailed {
                    reason: error.to_string(),
                }));
            }
            since = Some(
                last.filter(|_| last_parsed.is_some())
                    .unwrap_or("0.0.0".into()),
            );
        }
    }
    db::migrate(pool).await?;
    // Notes first: a crash before the version write just repeats the upgrade next launch.
    if let Some(since) = since {
        set_meta(pool, "release_notes_since", &since).await?;
    }
    set_meta(pool, "last_run_version", app).await?;
    Ok(())
}

async fn set_meta(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    Ok(())
}

/// The one-line text `AppState.db` holds while startup is blocked.
pub fn blocked_text(status: &StartupStatus) -> String {
    match status {
        StartupStatus::Ready => "Zeni is starting.".into(),
        StartupStatus::BackupFailed { reason } => format!("Backup before update failed: {reason}"),
        StartupStatus::NewerData { .. } => "This data is from a newer Zeni.".into(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use sqlx::sqlite::SqliteConnectOptions;

    use super::*;

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn migration_count() -> u32 {
        sqlx::migrate!("./migrations").migrations.len() as u32
    }

    struct Dir(PathBuf);

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    impl Dir {
        fn new(name: &str) -> Self {
            let dir = db::temp_dir(&format!("startup-{name}"));
            let _ = fs::remove_dir_all(&dir);
            db::create_private_dir(&dir).unwrap();
            Self(dir)
        }
        fn db_path(&self) -> PathBuf {
            self.0.join("zeni.db")
        }
        /// A database from an older Zeni: every migration but the newest, no last run version.
        fn older_schema(&self) {
            let mut migrator = sqlx::migrate!("./migrations");
            let newest = migrator.migrations.len();
            migrator.migrations = migrator.migrations[..newest - 1].to_vec().into();
            let options = SqliteConnectOptions::new()
                .filename(self.db_path())
                .create_if_missing(true);
            let pool = run(SqlitePool::connect_with(options)).unwrap();
            run(migrator.run(&pool)).unwrap();
            run(pool.close());
        }
        /// A database from V6: every migration, no last run version.
        fn full_schema(&self) {
            run(run(db::open(&self.db_path())).unwrap().close());
        }
        fn set(&self, key: &str, value: &str) {
            let pool = run(db::open_unmigrated(&self.db_path())).unwrap();
            run(set_meta(&pool, key, value)).unwrap();
            run(pool.close());
        }
        fn sql(&self, query: &'static str) {
            let pool = run(db::open_unmigrated(&self.db_path())).unwrap();
            run(sqlx::query(query).execute(&pool)).unwrap();
            run(pool.close());
        }
        fn prepare(&self, allow: bool, app: &str) -> Result<Database, StartupProblem> {
            let result = run(prepare_as(&self.0, allow, app));
            if let Ok(database) = &result {
                run(database.pool.close());
            }
            result
        }
        fn ready(&self, app: &str) {
            self.prepare(false, app).map(|_| ()).unwrap();
        }
        fn blocked(&self, allow: bool, app: &str) -> StartupStatus {
            match self.prepare(allow, app) {
                Err(StartupProblem::Blocked(status)) => status,
                Err(StartupProblem::Failed(error)) => panic!("failed: {error}"),
                Ok(_) => panic!("expected startup to be blocked"),
            }
        }
        fn backups(&self) -> Vec<PathBuf> {
            match fs::read_dir(self.0.join("backups")) {
                Ok(entries) => entries.map(|entry| entry.unwrap().path()).collect(),
                Err(_) => Vec::new(),
            }
        }
        /// Applied migrations and the two startup keys, read without migrating.
        fn state(&self) -> (u32, Option<String>, Option<String>) {
            let pool = run(db::open_unmigrated(&self.db_path())).unwrap();
            let meta = |key: &'static str| {
                run(
                    sqlx::query_scalar("SELECT value FROM app_meta WHERE key = ?")
                        .bind(key)
                        .fetch_optional(&pool),
                )
                .unwrap()
            };
            let state = (
                run(db::applied_migrations(&pool)).unwrap(),
                meta("last_run_version"),
                meta("release_notes_since"),
            );
            run(pool.close());
            state
        }
    }

    fn migrations_in(backup: &Path) -> u32 {
        let options = SqliteConnectOptions::new().filename(backup).read_only(true);
        let pool = run(SqlitePool::connect_with(options)).unwrap();
        let count = run(db::applied_migrations(&pool)).unwrap();
        run(pool.close());
        count
    }

    fn some(text: &str) -> Option<String> {
        Some(text.into())
    }

    #[test]
    fn older_data_gets_one_pre_update_backup_before_migrating() {
        let dir = Dir::new("older");
        dir.older_schema();
        dir.ready("7.0.0");
        let backups = dir.backups();
        assert_eq!(backups.len(), 1);
        let name = backups[0].file_name().unwrap().to_str().unwrap();
        assert!(
            name.starts_with("zeni-") && name.ends_with("-pre-update.db"),
            "{name}"
        );
        assert_eq!(migrations_in(&backups[0]), migration_count() - 1);
        assert_eq!(
            dir.state(),
            (migration_count(), some("7.0.0"), some("0.0.0"))
        );

        // The next launch on the same version takes none and keeps the notes pending.
        dir.ready("7.0.0");
        assert_eq!(dir.backups().len(), 1);
        assert_eq!(
            dir.state(),
            (migration_count(), some("7.0.0"), some("0.0.0"))
        );
    }

    #[test]
    fn a_v6_database_is_backed_up_once() {
        let dir = Dir::new("v6");
        dir.full_schema();
        dir.ready("7.0.0");
        assert_eq!(dir.backups().len(), 1);
        assert_eq!(migrations_in(&dir.backups()[0]), migration_count());
        dir.ready("7.0.0");
        assert_eq!(dir.backups().len(), 1);
    }

    #[test]
    fn a_fresh_install_takes_no_backup_and_has_nothing_pending() {
        let dir = Dir::new("fresh");
        dir.ready("7.0.0");
        assert!(dir.backups().is_empty());
        assert_eq!(dir.state(), (migration_count(), some("7.0.0"), None));
    }

    #[test]
    fn the_same_version_takes_no_backup() {
        let dir = Dir::new("same");
        dir.ready("7.0.0");
        dir.ready("7.0.0");
        assert!(dir.backups().is_empty());
        assert_eq!(dir.state(), (migration_count(), some("7.0.0"), None));
    }

    #[test]
    fn data_from_an_older_app_version_on_a_newer_app_is_backed_up() {
        let dir = Dir::new("minor");
        dir.ready("7.0.0");
        dir.ready("7.1.0");
        assert_eq!(dir.backups().len(), 1);
        assert_eq!(
            dir.state(),
            (migration_count(), some("7.1.0"), some("7.0.0"))
        );
        // Patch and double-digit versions compare as numbers.
        dir.ready("7.10.0");
        assert_eq!(dir.state().2, some("7.1.0"));
    }

    #[test]
    fn a_failed_backup_migrates_nothing() {
        let dir = Dir::new("backup-fails");
        dir.older_schema();
        let missing = dir.0.join("unplugged-drive");
        dir.set("backup_folder", missing.to_str().unwrap());
        let StartupStatus::BackupFailed { reason } = dir.blocked(false, "7.0.0") else {
            panic!("expected BackupFailed");
        };
        assert!(reason.contains("is missing"), "{reason}");
        assert_eq!(dir.state(), (migration_count() - 1, None, None));

        // Retrying fails the same way; continuing without a backup migrates with none.
        assert!(matches!(
            dir.blocked(false, "7.0.0"),
            StartupStatus::BackupFailed { .. }
        ));
        dir.prepare(true, "7.0.0").map(|_| ()).unwrap();
        assert!(!missing.exists());
        assert!(dir.backups().is_empty());
        assert_eq!(
            dir.state(),
            (migration_count(), some("7.0.0"), some("0.0.0"))
        );
    }

    #[test]
    fn an_unwritable_backup_folder_blocks_startup() {
        use std::os::unix::fs::PermissionsExt;
        let dir = Dir::new("read-only");
        dir.older_schema();
        let folder = dir.0.join("backups");
        db::create_private_dir(&folder).unwrap();
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o500)).unwrap();
        let status = dir.prepare(false, "7.0.0");
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).unwrap();
        // Root ignores the mode, so only assert when the write was refused.
        if let Err(StartupProblem::Blocked(StartupStatus::BackupFailed { reason })) = status {
            assert!(reason.starts_with("Couldn't write a backup to"), "{reason}");
            assert_eq!(dir.state().0, migration_count() - 1);
        }
    }

    #[test]
    fn a_newer_last_run_version_opens_nothing() {
        let dir = Dir::new("newer-version");
        dir.older_schema();
        dir.set("last_run_version", "7.1.0");
        assert_eq!(
            dir.blocked(true, "7.0.0"),
            StartupStatus::NewerData {
                version: some("7.1.0")
            }
        );
        assert!(dir.backups().is_empty());
        assert_eq!(dir.state(), (migration_count() - 1, some("7.1.0"), None));
    }

    #[test]
    fn an_unknown_applied_migration_opens_nothing() {
        let dir = Dir::new("newer-migration");
        dir.full_schema();
        dir.sql(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
             VALUES (9999, 'from the future', 1, x'00', 0)",
        );
        assert_eq!(
            dir.blocked(false, "7.0.0"),
            StartupStatus::NewerData { version: None }
        );
        assert!(dir.backups().is_empty());
        assert_eq!(dir.state(), (migration_count() + 1, None, None));

        // A known last run version is named.
        dir.set("last_run_version", "7.0.0");
        assert_eq!(
            dir.blocked(false, "7.0.0"),
            StartupStatus::NewerData {
                version: some("7.0.0")
            }
        );
    }

    #[test]
    fn an_unreadable_last_run_version_is_treated_as_older() {
        let dir = Dir::new("garbage-version");
        dir.ready("7.0.0");
        dir.set("last_run_version", "v7");
        dir.ready("7.0.0");
        assert_eq!(dir.backups().len(), 1);
        assert_eq!(
            dir.state(),
            (migration_count(), some("7.0.0"), some("0.0.0"))
        );
    }

    #[test]
    fn an_unopenable_folder_fails_with_the_path() {
        let blocker = db::temp_dir("startup-blocker");
        fs::write(&blocker, "").unwrap();
        let result = run(prepare(&blocker.join("data"), false));
        fs::remove_file(&blocker).unwrap();
        let Err(StartupProblem::Failed(error)) = result else {
            panic!("expected Failed");
        };
        let expected = format!(
            "Couldn't open the database at {}: ",
            blocker.join("data/zeni.db").display()
        );
        assert!(error.starts_with(&expected), "{error}");
    }
}
