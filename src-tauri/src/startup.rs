//! Startup: newer-data and pre-update backup checks around migrating `zeni.db`.

use std::path::Path;
use std::sync::PoisonError;

use sqlx::SqlitePool;

use crate::types::{
    AppError, AppState, ContinueStartupRequest, Database, Startup, StartupProblem, StartupStatus,
};
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
    if let Err(problem) = check_and_migrate(&pool, &path, allow_without_backup, app).await {
        pool.close().await;
        return Err(problem);
    }
    Ok(Database { pool, path })
}

async fn check_and_migrate(
    pool: &SqlitePool,
    path: &Path,
    allow_without_backup: bool,
    app: &str,
) -> Result<(), StartupProblem> {
    let failed = |error: AppError| StartupProblem::Failed(db::open_failed(path, error));
    let app_version = version::parse(app);
    // No migrations table: a new (or never migrated) file, so there is nothing to back up.
    let fresh: bool = sqlx::query_scalar(
        "SELECT NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| failed(error.into()))?;
    let mut since = None;
    if !fresh {
        let last = db::meta(pool, "last_run_version")
            .await
            .map_err(failed)?
            .filter(|last| version::parse(last).is_some());
        let last_parsed = last.as_deref().and_then(version::parse);
        if blocked_by_newer_data(pool, last_parsed, app_version)
            .await
            .map_err(failed)?
        {
            return Err(StartupProblem::Blocked(StartupStatus::NewerData {
                version: last,
            }));
        }
        // An unreadable last run version counts as older: backing up is the safe side.
        if last_parsed.is_none() || last_parsed < app_version {
            if !allow_without_backup {
                back_up_before_migrating(pool, path).await?;
            }
            since = Some(last.unwrap_or("0.0.0".into()));
        }
    }
    db::migrate(pool).await.map_err(failed)?;
    // Notes first: a crash before the version write just repeats the upgrade next launch.
    if let Some(since) = since {
        db::set_meta(pool, "release_notes_since", &since)
            .await
            .map_err(failed)?;
    }
    db::set_meta(pool, "last_run_version", app)
        .await
        .map_err(failed)?;
    Ok(())
}

/// True when the data was last run by a newer app or has migrations this app doesn't know.
async fn blocked_by_newer_data(
    pool: &SqlitePool,
    last: Option<(u64, u64, u64)>,
    app: Option<(u64, u64, u64)>,
) -> Result<bool, AppError> {
    let applied: Vec<i64> = sqlx::query_scalar("SELECT version FROM _sqlx_migrations")
        .fetch_all(pool)
        .await?;
    let known = sqlx::migrate!("./migrations").migrations;
    let unknown = applied
        .iter()
        .any(|v| !known.iter().any(|migration| migration.version == *v));
    Ok(unknown || last > app)
}

/// Takes the `pre-update` backup; a failure blocks startup with its reason.
async fn back_up_before_migrating(pool: &SqlitePool, path: &Path) -> Result<(), StartupProblem> {
    backup::pre_update(pool, path).await.map_err(|error| {
        StartupProblem::Blocked(StartupStatus::BackupFailed {
            reason: error.to_string(),
        })
    })?;
    Ok(())
}

/// The `AppState.db` value and the blocked status `prepare`'s result leads to.
pub fn outcome(
    prepared: Result<Database, StartupProblem>,
) -> (Result<Database, String>, Option<StartupStatus>) {
    match prepared {
        Ok(database) => (Ok(database), None),
        Err(StartupProblem::Blocked(status)) => (Err(blocked_text(&status)), Some(status)),
        Err(StartupProblem::Failed(error)) => (Err(error), None),
    }
}

/// The blocked status, or `Ready`.
pub fn current(startup: &Startup) -> StartupStatus {
    startup
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
        .unwrap_or(StartupStatus::Ready)
}

/// Retries `prepare` after a failed pre-update backup and stores the outcome in `state` and
/// `startup`.
pub async fn continue_prepare(
    state: &AppState,
    startup: &Startup,
    data_dir: &Path,
    request: ContinueStartupRequest,
) -> Result<StartupStatus, AppError> {
    if !matches!(current(startup), StartupStatus::BackupFailed { .. }) {
        return Err(AppError::Validation(
            "Startup isn't waiting on a failed backup.".into(),
        ));
    }
    let (db, blocked) = outcome(prepare(data_dir, request.without_backup).await);
    let result = match (&db, &blocked) {
        (Ok(_), _) => Ok(StartupStatus::Ready),
        (Err(_), Some(status)) => Ok(status.clone()),
        // Stays blocked, so the user can retry.
        (Err(error), None) => Err(AppError::Database(error.clone())),
    };
    *state.db.write().unwrap_or_else(PoisonError::into_inner) = db;
    if result.is_ok() {
        *startup.0.lock().unwrap_or_else(PoisonError::into_inner) = blocked;
    }
    result
}

/// The one-line text `AppState.db` holds while startup is blocked.
fn blocked_text(status: &StartupStatus) -> String {
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
            run(db::set_meta(&pool, key, value)).unwrap();
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
        // A chosen folder: startup resets the default one to 0700 before writing.
        let folder = dir.0.join("chosen");
        db::create_private_dir(&folder).unwrap();
        dir.set("backup_folder", folder.to_str().unwrap());
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o500)).unwrap();
        if fs::write(folder.join("probe"), "").is_ok() {
            return; // Root ignores the mode, so the folder can't be made unwritable here.
        }
        let status = dir.prepare(false, "7.0.0");
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(
            matches!(
                &status,
                Err(StartupProblem::Blocked(StartupStatus::BackupFailed { reason }))
                    if reason.starts_with("Couldn't write a backup to")
            ),
            "{:?}",
            status.as_ref().err()
        );
        assert_eq!(dir.state().0, migration_count() - 1);
    }

    #[test]
    fn outcome_maps_each_startup_problem() {
        let newer = StartupStatus::NewerData { version: None };
        let (db, blocked) = outcome(Err(StartupProblem::Blocked(newer.clone())));
        assert_eq!(db.err(), Some(blocked_text(&newer)));
        assert_eq!(blocked, Some(newer));

        let failed = StartupStatus::BackupFailed {
            reason: "gone".into(),
        };
        let (db, blocked) = outcome(Err(StartupProblem::Blocked(failed.clone())));
        assert_eq!(db.err(), Some(blocked_text(&failed)));
        assert_eq!(blocked, Some(failed));

        let (db, blocked) = outcome(Err(StartupProblem::Failed("broken".into())));
        assert_eq!(db.err().as_deref(), Some("broken"));
        assert_eq!(blocked, None);

        let dir = Dir::new("outcome");
        let (db, blocked) = outcome(run(prepare_as(&dir.0, false, "7.0.0")));
        run(db.unwrap().pool.close());
        assert_eq!(blocked, None);
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
    fn continue_startup_runs_only_after_a_failed_backup() {
        let state = AppState {
            db: std::sync::RwLock::new(Err("down".into())),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let startup = Startup::default();
        assert_eq!(current(&startup), StartupStatus::Ready);
        for blocked in [None, Some(StartupStatus::NewerData { version: None })] {
            *startup.0.lock().unwrap() = blocked.clone();
            let request = ContinueStartupRequest {
                without_backup: true,
            };
            let error = tauri::async_runtime::block_on(continue_prepare(
                &state,
                &startup,
                Path::new("/nonexistent"),
                request,
            ))
            .unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap()["kind"], "Validation");
            // Nothing changed.
            assert_eq!(*startup.0.lock().unwrap(), blocked);
            assert!(state.db.read().unwrap().is_err());
        }
    }

    fn blocked_startup(reason: &str) -> (AppState, Startup) {
        let state = AppState {
            db: std::sync::RwLock::new(Err("blocked".into())),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let startup = Startup::default();
        *startup.0.lock().unwrap() = Some(StartupStatus::BackupFailed {
            reason: reason.into(),
        });
        (state, startup)
    }

    fn continue_with(
        state: &AppState,
        startup: &Startup,
        dir: &Path,
        without_backup: bool,
    ) -> Result<StartupStatus, AppError> {
        let request = ContinueStartupRequest { without_backup };
        tauri::async_runtime::block_on(continue_prepare(state, startup, dir, request))
    }

    #[test]
    fn continue_startup_stays_blocked_on_retry_and_opens_without_backup() {
        let dir = db::temp_dir("continue-startup");
        let _ = std::fs::remove_dir_all(&dir);
        db::create_private_dir(&dir).unwrap();
        // Data from an older Zeni (all but the newest migration) whose backup folder is gone.
        let mut migrator = sqlx::migrate!("./migrations");
        let newest = migrator.migrations.len();
        migrator.migrations = migrator.migrations[..newest - 1].to_vec().into();
        let pool = run(db::open_unmigrated(&dir.join("zeni.db"))).unwrap();
        run(migrator.run(&pool)).unwrap();
        let missing = dir.join("unplugged-drive");
        run(
            sqlx::query("INSERT INTO app_meta (key, value) VALUES ('backup_folder', ?)")
                .bind(missing.to_str().unwrap())
                .execute(&pool),
        )
        .unwrap();
        run(pool.close());
        let (state, startup) = blocked_startup("earlier");

        // Retrying hits the same failure: the new reason is stored and returned.
        let status = continue_with(&state, &startup, &dir, false).unwrap();
        let StartupStatus::BackupFailed { reason } = &status else {
            panic!("expected BackupFailed, got {status:?}");
        };
        assert!(reason.contains("is missing"), "{reason}");
        assert_eq!(current(&startup), status);
        assert_eq!(
            state.db.read().unwrap().as_ref().err(),
            Some(&blocked_text(&status))
        );

        // Continuing without a backup opens the database and clears the block.
        assert_eq!(
            continue_with(&state, &startup, &dir, true).unwrap(),
            StartupStatus::Ready
        );
        assert_eq!(*startup.0.lock().unwrap(), None);
        let Ok(Database { pool, .. }) = state.db.into_inner().unwrap() else {
            panic!("db not open");
        };
        let applied: i64 =
            run(sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations").fetch_one(&pool))
                .unwrap();
        assert_eq!(applied as usize, newest);
        run(pool.close());
        assert!(!missing.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn continue_startup_keeps_the_block_when_the_database_cant_open() {
        let blocker = db::temp_dir("continue-startup-blocker");
        std::fs::write(&blocker, "").unwrap();
        let (state, startup) = blocked_startup("earlier");
        let result = continue_with(&state, &startup, &blocker.join("data"), false);
        std::fs::remove_file(&blocker).unwrap();
        let Err(AppError::Database(error)) = result else {
            panic!("expected a Database error");
        };
        assert!(
            error.starts_with("Couldn't open the database at "),
            "{error}"
        );
        // The earlier status stays, so the user can retry.
        assert_eq!(
            current(&startup),
            StartupStatus::BackupFailed {
                reason: "earlier".into()
            }
        );
        assert_eq!(state.db.read().unwrap().as_ref().err(), Some(&error));
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
