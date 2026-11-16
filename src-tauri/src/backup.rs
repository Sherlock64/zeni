//! Backups (`VACUUM INTO` copies of `zeni.db`), retention, the daily backup, and restore with a safety copy.

use std::fs::{self, OpenOptions, Permissions};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::PoisonError;
use std::sync::atomic::{AtomicU64, Ordering};

use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;

use crate::types::{
    AppError, AppState, BackupFile, BackupKind, BackupSettings, Database, RestoreBackupRequest,
    RestoreSource, SetBackupRetentionRequest,
};
use crate::{db, security};

const KINDS: [(BackupKind, &str); 4] = [
    (BackupKind::Manual, "manual"),
    (BackupKind::Daily, "daily"),
    (BackupKind::PreRevert, "pre-revert"),
    (BackupKind::Safety, "safety"),
];
const DEFAULT_KEEP: u32 = 14;
const ZENI_TABLES: [&str; 6] = [
    "_sqlx_migrations",
    "app_meta",
    "key_wraps",
    "accounts",
    "imports",
    "raw_transactions",
];
/// Ends a restore error that left the current database in place.
const UNCHANGED: &str = " Your current data wasn't changed.";
/// Ends an undo error that left the restored database in place.
const STILL_RESTORED: &str = " The restored data is still in place.";
/// Numbers this process's temp files, so two backups never share one.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn kind_name(kind: BackupKind) -> &'static str {
    KINDS
        .iter()
        .find(|(known, _)| *known == kind)
        .map_or("other", |(_, name)| name)
}

/// `(kind, "YYYY-MM-DD HH:MM:SS")` when `name` is `zeni-YYYYMMDD-HHMMSS-<kind>.db`.
fn parse_name(name: &str) -> Option<(BackupKind, String)> {
    let rest = name.strip_prefix("zeni-")?.strip_suffix(".db")?;
    let (stamp, kind) = rest.split_at_checked(15)?;
    let kind = kind.strip_prefix('-')?;
    let kind = KINDS.iter().find(|(_, known)| *known == kind)?.0;
    let well_formed = stamp.bytes().enumerate().all(|(i, c)| {
        if i == 8 {
            c == b'-'
        } else {
            c.is_ascii_digit()
        }
    });
    if !well_formed {
        return None;
    }
    let s = stamp;
    let created_at = format!(
        "{}-{}-{} {}:{}:{}",
        &s[0..4],
        &s[4..6],
        &s[6..8],
        &s[9..11],
        &s[11..13],
        &s[13..15]
    );
    Some((kind, created_at))
}

fn backup_error(context: &str) -> impl FnOnce(AppError) -> AppError {
    move |error| AppError::Backup(format!("{context}: {error}"))
}

/// `error` as a sentence: ends with one full stop.
fn sentence(error: impl std::fmt::Display) -> String {
    let text = error.to_string();
    let stop = if text.ends_with('.') { "" } else { "." };
    format!("{text}{stop}")
}

/// Ends the error with `data_state_note` (`UNCHANGED` or `STILL_RESTORED`) as its own sentence.
fn with_data_state(data_state_note: &str) -> impl Fn(AppError) -> AppError {
    move |error| AppError::Backup(format!("{}{data_state_note}", sentence(error)))
}

/// Like `db::current`, but only while Zeni is unlocked; a missing database is reported first.
fn unlocked(state: &AppState) -> Result<(SqlitePool, PathBuf), AppError> {
    let current = db::current(state)?;
    security::session_key(state)?;
    Ok(current)
}

fn data_dir(db_path: &Path) -> &Path {
    db_path.parent().unwrap_or(Path::new("."))
}

async fn meta(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT value FROM app_meta WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

async fn set_meta(pool: &SqlitePool, key: &str, value: &str) -> Result<(), AppError> {
    sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    Ok(())
}

/// The backup folder in use and whether it is the default `<data_dir>/backups`.
async fn folder(pool: &SqlitePool, db_path: &Path) -> Result<(PathBuf, bool), AppError> {
    Ok(match meta(pool, "backup_folder").await? {
        Some(folder) => (PathBuf::from(folder), false),
        None => (data_dir(db_path).join("backups"), true),
    })
}

/// The backup folder, ready to write: the default one is created 0700, a chosen one must exist.
async fn ready_folder(pool: &SqlitePool, db_path: &Path) -> Result<PathBuf, AppError> {
    let (folder, is_default) = folder(pool, db_path).await?;
    if is_default {
        db::create_private_dir(&folder)
            .map_err(backup_error("Couldn't create the backup folder"))?;
    } else if !folder.is_dir() {
        return Err(AppError::Backup(format!(
            "The backup folder {} is missing. Plug in its drive or choose another folder.",
            folder.display()
        )));
    }
    Ok(folder)
}

async fn keep_automatic(pool: &SqlitePool) -> Result<u32, AppError> {
    Ok(meta(pool, "backup_keep")
        .await?
        .and_then(|keep| keep.parse().ok())
        .unwrap_or(DEFAULT_KEEP))
}

fn temp_path(folder: &Path) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    folder.join(format!(".zeni-backup-{}-{n}.tmp", std::process::id()))
}

/// Puts `temp` at `target` unless `target` exists. `false` on a name clash.
fn place(temp: &Path, target: &Path) -> std::io::Result<bool> {
    match fs::hard_link(temp, target) {
        Ok(()) => {
            fs::remove_file(temp)?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        // shortcut: filesystems without hard links (FAT) check then rename, which can race another Zeni in the same second; fine for one app.
        Err(_) if !target.exists() => fs::rename(temp, target).map(|()| true),
        Err(_) => Ok(false),
    }
}

/// Writes a consistent copy of the database to `folder` and returns its path.
async fn write(pool: &SqlitePool, folder: &Path, kind: BackupKind) -> Result<PathBuf, AppError> {
    let temp = temp_path(folder);
    let result = write_via(pool, folder, kind, &temp).await;
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(backup_error(&format!(
        "Couldn't write a backup to {}",
        folder.display()
    )))
}

async fn write_via(
    pool: &SqlitePool,
    folder: &Path,
    kind: BackupKind,
    temp: &Path,
) -> Result<PathBuf, AppError> {
    let temp_name = temp
        .to_str()
        .ok_or_else(|| AppError::Validation("The backup folder's name isn't valid text.".into()))?;
    // SQLite writes into an existing empty file, so it is private from the start.
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(temp)?;
    sqlx::query("VACUUM INTO ?")
        .bind(temp_name)
        .execute(pool)
        .await?;
    fs::set_permissions(temp, Permissions::from_mode(0o600))?;
    for attempt in 0..2 {
        let stamp: String =
            sqlx::query_scalar("SELECT strftime('%Y%m%d-%H%M%S','now','localtime')")
                .fetch_one(pool)
                .await?;
        let target = folder.join(format!("zeni-{stamp}-{}.db", kind_name(kind)));
        if place(temp, &target)? {
            return Ok(target);
        }
        if attempt == 0 {
            // shortcut: blocks one runtime worker for a second; only on a same-second clash.
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }
    Err(AppError::Validation(
        "A backup with that name already exists.".into(),
    ))
}

async fn describe(pool: &SqlitePool, path: &Path) -> Result<BackupFile, AppError> {
    let metadata = fs::metadata(path)?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (kind, created_at) = match parse_name(&file_name) {
        Some(parsed) => parsed,
        None => {
            let mtime = metadata
                .modified()?
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_secs() as i64);
            let created_at = sqlx::query_scalar("SELECT datetime(?, 'unixepoch', 'localtime')")
                .bind(mtime)
                .fetch_one(pool)
                .await?;
            (BackupKind::Other, created_at)
        }
    };
    Ok(BackupFile {
        file_name,
        path: path.display().to_string(),
        kind,
        created_at,
        size_bytes: metadata.len(),
    })
}

/// Names in `folder` matching the backup pattern, newest first.
fn backup_names(folder: &Path) -> Result<Vec<(String, BackupKind)>, AppError> {
    let entries = fs::read_dir(folder).map_err(|error| {
        AppError::Backup(format!(
            "Couldn't read the backup folder {}: {error}",
            folder.display()
        ))
    })?;
    let mut names: Vec<_> = entries
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().into_string().ok()?;
            let (kind, _) = parse_name(&name)?;
            Some((name, kind))
        })
        .collect();
    names.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(names)
}

/// Deletes all but the newest `keep` automatic backups. Touches only pattern-matching files.
fn prune(folder: &Path, keep: u32) -> Result<(), AppError> {
    let automatic = backup_names(folder)?
        .into_iter()
        .filter(|(_, kind)| matches!(kind, BackupKind::Daily | BackupKind::PreRevert));
    for (name, _) in automatic.skip(keep as usize) {
        fs::remove_file(folder.join(name))?;
    }
    Ok(())
}

async fn settings_for(
    state: &AppState,
    pool: &SqlitePool,
    db_path: &Path,
) -> Result<BackupSettings, AppError> {
    let (folder, is_default_folder) = folder(pool, db_path).await?;
    Ok(BackupSettings {
        folder: folder.display().to_string(),
        is_default_folder,
        keep_automatic: keep_automatic(pool).await?,
        daily_warning: state
            .backup
            .daily_warning
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone(),
    })
}

pub async fn settings(state: &AppState) -> Result<BackupSettings, AppError> {
    let (pool, db_path) = unlocked(state)?;
    settings_for(state, &pool, &db_path).await
}

/// Stores a folder picked in the dialog after checking that a backup can be written there.
pub async fn set_folder(state: &AppState, folder: &Path) -> Result<BackupSettings, AppError> {
    let (pool, db_path) = unlocked(state)?;
    let text = folder
        .to_str()
        .filter(|_| folder.is_absolute())
        .ok_or_else(|| AppError::Validation("Choose a folder with a plain-text path.".into()))?;
    if !folder.is_dir() {
        return Err(AppError::Backup(format!("{text} isn't a folder.")));
    }
    let probe = temp_path(folder);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&probe)
        .and_then(|_| fs::remove_file(&probe))
        .map_err(|error| AppError::Backup(format!("Zeni can't write to {text}: {error}")))?;
    set_meta(&pool, "backup_folder", text).await?;
    settings_for(state, &pool, &db_path).await
}

pub async fn set_retention(
    state: &AppState,
    request: SetBackupRetentionRequest,
) -> Result<BackupSettings, AppError> {
    if !(1..=365).contains(&request.keep_automatic) {
        return Err(AppError::Validation(
            "Keep between 1 and 365 automatic backups.".into(),
        ));
    }
    let (pool, db_path) = unlocked(state)?;
    set_meta(&pool, "backup_keep", &request.keep_automatic.to_string()).await?;
    let (folder, _) = folder(&pool, &db_path).await?;
    prune(&folder, request.keep_automatic).map_err(backup_error("Couldn't remove old backups"))?;
    settings_for(state, &pool, &db_path).await
}

pub async fn back_up_now(state: &AppState) -> Result<BackupFile, AppError> {
    let (pool, db_path) = unlocked(state)?;
    let folder = ready_folder(&pool, &db_path).await?;
    let path = write(&pool, &folder, BackupKind::Manual).await?;
    describe(&pool, &path).await
}

pub async fn list(state: &AppState) -> Result<Vec<BackupFile>, AppError> {
    let (pool, db_path) = unlocked(state)?;
    let (folder, _) = folder(&pool, &db_path).await?;
    let mut files = Vec::new();
    for (name, _) in backup_names(&folder)? {
        files.push(describe(&pool, &folder.join(name)).await?);
    }
    Ok(files)
}

/// Remembers a file picked in the dialog for `restore` with `RestoreSource::PickedFile`.
pub async fn pick(state: &AppState, path: PathBuf) -> Result<BackupFile, AppError> {
    let (pool, _) = unlocked(state)?;
    let file = describe(&pool, &path).await?;
    *state
        .backup
        .picked_file
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Some(path);
    Ok(file)
}

/// The daily backup at startup: records why it failed in `daily_warning`.
pub async fn daily_backup(state: &AppState) {
    let warning = run_daily(state).await.err().map(|error| error.to_string());
    *state
        .backup
        .daily_warning
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = warning;
}

async fn run_daily(state: &AppState) -> Result<(), AppError> {
    let (pool, db_path) = db::current(state)?;
    let today: String = sqlx::query_scalar("SELECT date('now','localtime')")
        .fetch_one(&pool)
        .await?;
    if meta(&pool, "last_daily_backup").await?.as_deref() == Some(today.as_str()) {
        return Ok(());
    }
    let folder = ready_folder(&pool, &db_path).await?;
    write(&pool, &folder, BackupKind::Daily).await?;
    prune(&folder, keep_automatic(&pool).await?)?;
    set_meta(&pool, "last_daily_backup", &today).await
}

/// The backup `imports::revert` takes first. A prune failure afterwards doesn't stop the revert.
pub async fn before_revert(state: &AppState) -> Result<(), AppError> {
    let (pool, db_path) = db::current(state)?;
    let folder = async {
        let folder = ready_folder(&pool, &db_path).await?;
        write(&pool, &folder, BackupKind::PreRevert).await?;
        Ok::<_, AppError>(folder)
    }
    .await
    .map_err(|error| {
        AppError::Backup(format!(
            "Couldn't back up before reverting, so nothing was reverted: {error}"
        ))
    })?;
    if let Ok(keep) = keep_automatic(&pool).await {
        let _ = prune(&folder, keep);
    }
    Ok(())
}

/// Checks `path` is an intact Zeni database no newer than this app, without changing it.
async fn validate(path: &Path) -> Result<(), AppError> {
    let damaged = || AppError::Backup("That file is damaged, so it can't be restored.".into());
    let not_zeni = || AppError::Backup("That file isn't a Zeni backup.".into());
    let unreadable = |error: sqlx::Error| {
        let code = error.as_database_error().and_then(|error| error.code());
        // SQLITE_CORRUPT and its extended codes; anything else (SQLITE_NOTADB, missing) isn't Zeni's.
        match code.as_deref().and_then(|code| code.parse::<u32>().ok()) {
            Some(code) if code & 0xff == 11 => damaged(),
            _ => not_zeni(),
        }
    };
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(unreadable)?;
    let result = async {
        let check: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_all(&pool)
            .await
            .map_err(unreadable)?;
        if check != ["ok"] {
            return Err(damaged());
        }
        let tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?)",
        )
        .bind(ZENI_TABLES[0])
        .bind(ZENI_TABLES[1])
        .bind(ZENI_TABLES[2])
        .bind(ZENI_TABLES[3])
        .bind(ZENI_TABLES[4])
        .bind(ZENI_TABLES[5])
        .fetch_one(&pool)
        .await?;
        if tables != ZENI_TABLES.len() as i64 {
            return Err(not_zeni());
        }
        let triggers: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND (\
             (name = 'imports_raw_no_update' AND tbl_name = 'imports') OR \
             (name = 'raw_transactions_no_update' AND tbl_name = 'raw_transactions'))",
        )
        .fetch_one(&pool)
        .await?;
        if triggers != 2 {
            return Err(AppError::Backup(
                "That backup is missing Zeni's protection for imported data, so it can't be restored."
                    .into(),
            ));
        }
        let version: Option<i64> =
            sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations WHERE success")
                .fetch_one(&pool)
                .await?;
        let newest = sqlx::migrate!("./migrations")
            .migrations
            .iter()
            .map(|migration| migration.version)
            .max();
        if version > newest {
            return Err(AppError::Backup(
                "That backup is from a newer version of Zeni. Update Zeni, then restore it.".into(),
            ));
        }
        Ok(())
    }
    .await;
    pool.close().await;
    result
}

/// Copies `source` to a private temp file next to the database.
fn stage(source: &Path, data_dir: &Path) -> Result<PathBuf, AppError> {
    let temp = data_dir.join(".zeni-restore.tmp");
    let result = fs::copy(source, &temp)
        .and_then(|_| fs::set_permissions(&temp, Permissions::from_mode(0o600)));
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(temp)
}

/// Drops the old database's side files, then renames the staged file over `zeni.db`, so an
/// error leaves the old database in place.
fn swap(temp: &Path, db_path: &Path) -> Result<(), AppError> {
    for suffix in ["-wal", "-shm"] {
        let mut side = db_path.as_os_str().to_owned();
        side.push(suffix);
        match fs::remove_file(PathBuf::from(side)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => {}
        }
    }
    Ok(fs::rename(temp, db_path)?)
}

/// `swap`, removing the staged file when it fails.
fn swap_or_discard(temp: &Path, db_path: &Path) -> Result<(), AppError> {
    let result = swap(temp, db_path);
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

async fn reopen(db_path: &Path) -> Result<Database, AppError> {
    Ok(Database {
        pool: db::open(db_path).await?,
        path: db_path.to_path_buf(),
    })
}

fn set_db(state: &AppState, database: Result<Database, AppError>) {
    *state.db.write().unwrap_or_else(PoisonError::into_inner) =
        database.map_err(|error| format!("Couldn't open the database: {error}"));
}

/// Replaces the database with `source`. With `fallback` (the safety copy), a restored file that
/// won't open is replaced by it again. Errors before the swap end with `data_state_note`.
async fn replace(
    state: &AppState,
    pool: SqlitePool,
    db_path: &Path,
    source: &Path,
    fallback: Option<&Path>,
    data_state_note: &str,
) -> Result<(), AppError> {
    let kept = with_data_state(data_state_note);
    let temp = stage(source, data_dir(db_path))
        .map_err(backup_error("Couldn't restore that backup"))
        .map_err(&kept)?;
    // The copy is what gets swapped in, so check it rather than trust the earlier check.
    if let Err(error) = validate(&temp).await {
        let _ = fs::remove_file(&temp);
        return Err(kept(error));
    }
    pool.close().await;
    if let Err(error) = swap_or_discard(&temp, db_path) {
        set_db(state, reopen(db_path).await);
        return Err(kept(backup_error("Couldn't restore that backup")(error)));
    }
    match reopen(db_path).await {
        Ok(database) => {
            set_db(state, Ok(database));
            Ok(())
        }
        Err(error) => {
            let Some(safety) = fallback else {
                set_db(state, Err(AppError::Backup(error.to_string())));
                return Err(AppError::Backup(format!(
                    "Couldn't open your previous data: {} Zeni can't open its database. \
                     Your previous data is still in the safety copy in the backup folder.",
                    sentence(&error)
                )));
            };
            let back = async {
                swap_or_discard(&stage(safety, data_dir(db_path))?, db_path)?;
                reopen(db_path).await
            }
            .await;
            let error = sentence(&error);
            let message = if back.is_ok() {
                format!("Couldn't open the restored backup: {error} Your data was put back.")
            } else {
                // The file name only: the safety copy is always in the backup folder Settings shows.
                let name = safety
                    .file_name()
                    .map(|name| name.to_string_lossy())
                    .unwrap_or_default();
                format!(
                    "Couldn't open the restored backup: {error} Putting your data back failed \
                     too, so your data is in the safety copy {name} in the backup folder."
                )
            };
            set_db(state, back);
            Err(AppError::Backup(message))
        }
    }
}

/// Forgets everything tied to the replaced database.
fn after_replace(state: &AppState, undo_path: Option<PathBuf>) {
    *state.session.lock().unwrap_or_else(PoisonError::into_inner) = None;
    *state
        .pending_import
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = None;
    *state
        .backup
        .picked_file
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = None;
    *state
        .backup
        .undo_path
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = undo_path;
}

pub async fn restore(state: &AppState, request: RestoreBackupRequest) -> Result<(), AppError> {
    let (pool, db_path) = unlocked(state)?;
    let source = match request.source {
        RestoreSource::Backup { file_name } => {
            // The pattern allows no path separator, so the name stays inside the folder.
            if parse_name(&file_name).is_none() {
                return Err(AppError::Validation(
                    "That isn't a Zeni backup name.".into(),
                ));
            }
            folder(&pool, &db_path).await?.0.join(file_name)
        }
        RestoreSource::PickedFile => state
            .backup
            .picked_file
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
            .ok_or_else(|| AppError::NotFound("Pick a backup file first.".into()))?,
    };
    let kept = with_data_state(UNCHANGED);
    validate(&source).await.map_err(&kept)?;
    let safety = async {
        let folder = ready_folder(&pool, &db_path).await?;
        write(&pool, &folder, BackupKind::Safety).await
    }
    .await
    .map_err(backup_error("Couldn't make a safety copy"))
    .map_err(&kept)?;
    replace(state, pool, &db_path, &source, Some(&safety), UNCHANGED).await?;
    after_replace(state, Some(safety));
    Ok(())
}

/// Puts the safety copy of the last restore back. Allowed while locked.
pub async fn undo_restore(state: &AppState) -> Result<(), AppError> {
    let (pool, db_path) = db::current(state)?;
    let undo = state
        .backup
        .undo_path
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
        .ok_or_else(|| AppError::NotFound("There's no restore to undo.".into()))?;
    validate(&undo)
        .await
        .map_err(with_data_state(STILL_RESTORED))?;
    replace(state, pool, &db_path, &undo, None, STILL_RESTORED).await?;
    after_replace(state, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::sample_account;
    use crate::security::tests::{FakeKeyring, PASSWORD};
    use crate::types::{SecurityStatus, SetupRequest, UnlockRequest};

    const OTHER_PASSWORD: &str = "a different long password";

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    struct Fixture {
        state: AppState,
        keyring: FakeKeyring,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("backup-{name}"));
        let _ = fs::remove_dir_all(&dir);
        Fixture {
            state: AppState {
                db: std::sync::RwLock::new(run(db::connect(&dir))),
                session: Default::default(),
                pending_import: Default::default(),
                backup: Default::default(),
            },
            keyring: FakeKeyring::default(),
            dir,
        }
    }

    impl Fixture {
        /// Sets up with one account called `account`, leaving Zeni unlocked.
        fn setup(&self, password: &str, account: &str) {
            let mut new_account = sample_account();
            new_account.name = account.into();
            let request = SetupRequest {
                master_password: password.into(),
                account: new_account,
            };
            run(security::complete_setup(
                &self.state,
                &self.keyring,
                request,
            ))
            .unwrap();
        }
        fn pool(&self) -> SqlitePool {
            security::pool(&self.state).unwrap()
        }
        fn folder(&self) -> PathBuf {
            self.dir.join("backups")
        }
        fn lock(&self) {
            *self.state.session.lock().unwrap() = None;
        }
        fn status(&self) -> serde_json::Value {
            serde_json::to_value(run(security::status(&self.state, &self.keyring)).unwrap())
                .unwrap()
        }
        fn unlock(&self, password: &str) -> Result<(), AppError> {
            let request = UnlockRequest {
                master_password: password.into(),
            };
            run(security::unlock(&self.state, &self.keyring, request))
        }
        fn accounts(&self) -> Vec<String> {
            run(sqlx::query_scalar("SELECT name FROM accounts ORDER BY id").fetch_all(&self.pool()))
                .unwrap()
        }
        fn backups(&self) -> Vec<(String, BackupKind)> {
            backup_names(&self.folder()).unwrap()
        }
        fn back_up(&self) -> BackupFile {
            run(back_up_now(&self.state)).unwrap()
        }
        fn restore(&self, source: RestoreSource) -> Result<(), AppError> {
            run(restore(&self.state, RestoreBackupRequest { source }))
        }
        fn meta(&self, key: &str) -> Option<String> {
            run(meta(&self.pool(), key)).unwrap()
        }
        fn undo_path(&self) -> Option<PathBuf> {
            self.state.backup.undo_path.lock().unwrap().clone()
        }
    }

    fn by_name(file: &BackupFile) -> RestoreSource {
        RestoreSource::Backup {
            file_name: file.file_name.clone(),
        }
    }

    fn message(result: Result<impl Sized, AppError>) -> String {
        match result.err().expect("expected an error") {
            AppError::Backup(message) => message,
            other => panic!("expected a Backup error, got {other:?}"),
        }
    }

    #[test]
    fn names_follow_the_backup_pattern_only() {
        assert_eq!(
            parse_name("zeni-20261115-140322-pre-revert.db"),
            Some((BackupKind::PreRevert, "2026-11-15 14:03:22".into()))
        );
        for (kind, name) in KINDS {
            let file = format!("zeni-20260101-000000-{name}.db");
            assert_eq!(parse_name(&file).map(|parsed| parsed.0), Some(kind));
        }
        for name in [
            "zeni-old.db",
            "notes.txt",
            "zeni-20261115-140322-weekly.db",
            "zeni-2026111a-140322-manual.db",
            "zeni-20261115_140322-manual.db",
            "zeni-20261115-140322-manual.db.tmp",
            "../zeni-20261115-140322-manual.db",
            "zeni-20261115-14032é-manual.db",
        ] {
            assert_eq!(parse_name(name), None, "{name}");
        }
    }

    #[test]
    fn back_up_now_writes_private_valid_files_and_never_overwrites() {
        let f = fixture("manual");
        f.setup(PASSWORD, "Checking");
        let first = f.back_up();
        // Same second or not, the second backup gets its own name.
        let second = f.back_up();
        assert_ne!(first.file_name, second.file_name);
        assert_eq!(mode(&f.folder()), 0o700);
        for file in [&first, &second] {
            let path = Path::new(&file.path);
            assert_eq!(file.kind, BackupKind::Manual);
            assert_eq!(mode(path), 0o600);
            assert_eq!(file.size_bytes, fs::metadata(path).unwrap().len());
            run(validate(path)).unwrap();
        }
        // Newest first, and no temp file left behind.
        let listed: Vec<_> = run(list(&f.state))
            .unwrap()
            .into_iter()
            .map(|file| file.file_name)
            .collect();
        assert_eq!(listed, [second.file_name.clone(), first.file_name.clone()]);
        assert_eq!(fs::read_dir(f.folder()).unwrap().count(), 2);
    }

    #[test]
    fn a_backup_during_an_open_write_is_consistent() {
        let f = fixture("consistent");
        f.setup(PASSWORD, "Checking");
        let pool = f.pool();
        let mut tx = run(pool.begin()).unwrap();
        run(
            sqlx::query("INSERT INTO app_meta (key, value) VALUES ('probe', 'x')")
                .execute(&mut *tx),
        )
        .unwrap();
        let file = f.back_up();
        run(tx.commit()).unwrap();
        run(validate(Path::new(&file.path))).unwrap();
        let copy = run(SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(&file.path)
                .read_only(true),
        ))
        .unwrap();
        let probe: Option<String> = run(sqlx::query_scalar(
            "SELECT value FROM app_meta WHERE key = 'probe'",
        )
        .fetch_optional(&copy))
        .unwrap();
        assert_eq!(probe, None, "the uncommitted row isn't in the backup");
        run(copy.close());
    }

    #[test]
    fn data_commands_need_an_unlocked_database() {
        let f = fixture("gating");
        f.setup(PASSWORD, "Checking");
        f.lock();
        let kind = |error: AppError| serde_json::to_value(error).unwrap()["kind"].clone();
        let locked = |result: Result<(), AppError>| kind(result.unwrap_err());
        let state = &f.state;
        assert_eq!(locked(run(settings(state)).map(drop)), "Locked");
        assert_eq!(locked(run(set_folder(state, &f.dir)).map(drop)), "Locked");
        let keep = SetBackupRetentionRequest { keep_automatic: 3 };
        assert_eq!(locked(run(set_retention(state, keep)).map(drop)), "Locked");
        assert_eq!(locked(run(back_up_now(state)).map(drop)), "Locked");
        assert_eq!(locked(run(list(state)).map(drop)), "Locked");
        assert_eq!(
            locked(run(pick(state, f.dir.join("zeni.db"))).map(drop)),
            "Locked"
        );
        assert_eq!(locked(f.restore(RestoreSource::PickedFile)), "Locked");
        // Undo is allowed while locked; here there is nothing to undo.
        assert_eq!(locked(run(undo_restore(state))), "NotFound");

        let missing = AppState {
            db: std::sync::RwLock::new(Err("no database".into())),
            session: Default::default(),
            pending_import: Default::default(),
            backup: Default::default(),
        };
        let database = |result: Result<(), AppError>| kind(result.unwrap_err());
        assert_eq!(database(run(settings(&missing)).map(drop)), "Database");
        assert_eq!(
            database(run(set_folder(&missing, &f.dir)).map(drop)),
            "Database"
        );
        let keep = SetBackupRetentionRequest { keep_automatic: 3 };
        assert_eq!(
            database(run(set_retention(&missing, keep)).map(drop)),
            "Database"
        );
        assert_eq!(
            database(run(pick(&missing, f.dir.join("zeni.db"))).map(drop)),
            "Database"
        );
        let request = RestoreBackupRequest {
            source: RestoreSource::PickedFile,
        };
        assert_eq!(database(run(restore(&missing, request))), "Database");
        assert_eq!(database(run(back_up_now(&missing)).map(drop)), "Database");
        assert_eq!(database(run(list(&missing)).map(drop)), "Database");
        assert_eq!(database(run(undo_restore(&missing))), "Database");
        assert_eq!(database(run(before_revert(&missing))), "Database");
    }

    #[test]
    fn settings_default_and_change_folder_and_retention() {
        let f = fixture("settings");
        f.setup(PASSWORD, "Checking");
        let defaults = run(settings(&f.state)).unwrap();
        assert_eq!(defaults.folder, f.folder().display().to_string());
        assert!(defaults.is_default_folder);
        assert_eq!(defaults.keep_automatic, 14);
        assert_eq!(defaults.daily_warning, None);

        let elsewhere = f.dir.join("elsewhere");
        fs::create_dir(&elsewhere).unwrap();
        let changed = run(set_folder(&f.state, &elsewhere)).unwrap();
        assert_eq!(changed.folder, elsewhere.display().to_string());
        assert!(!changed.is_default_folder);
        assert_eq!(
            fs::read_dir(&elsewhere).unwrap().count(),
            0,
            "probe removed"
        );
        let missing = f.dir.join("unplugged");
        assert!(message(run(set_folder(&f.state, &missing))).contains("isn't a folder"));
        assert!(matches!(
            run(set_folder(&f.state, Path::new("relative"))),
            Err(AppError::Validation(_))
        ));
        // A chosen folder is never created: a missing one fails the backup.
        run(set_meta(
            &f.pool(),
            "backup_folder",
            missing.to_str().unwrap(),
        ))
        .unwrap();
        assert!(message(run(back_up_now(&f.state))).contains("is missing"));
        assert!(!missing.exists());

        for keep_automatic in [0, 366] {
            let request = SetBackupRetentionRequest { keep_automatic };
            assert!(matches!(
                run(set_retention(&f.state, request)),
                Err(AppError::Validation(_))
            ));
        }
        run(set_meta(
            &f.pool(),
            "backup_folder",
            elsewhere.to_str().unwrap(),
        ))
        .unwrap();
        for keep_automatic in [1, 365, 3] {
            let request = SetBackupRetentionRequest { keep_automatic };
            assert_eq!(
                run(set_retention(&f.state, request))
                    .unwrap()
                    .keep_automatic,
                keep_automatic
            );
        }
    }

    #[test]
    fn set_folder_reports_a_folder_it_cannot_write() {
        let f = fixture("read-only");
        f.setup(PASSWORD, "Checking");
        let read_only = f.dir.join("read-only");
        fs::create_dir(&read_only).unwrap();
        fs::set_permissions(&read_only, Permissions::from_mode(0o500)).unwrap();
        let result = run(set_folder(&f.state, &read_only));
        fs::set_permissions(&read_only, Permissions::from_mode(0o700)).unwrap();
        let error = message(result);
        assert!(
            error.starts_with(&format!("Zeni can't write to {}: ", read_only.display())),
            "{error}"
        );
        assert_eq!(fs::read_dir(&read_only).unwrap().count(), 0);
        let defaults = run(settings(&f.state)).unwrap();
        assert!(defaults.is_default_folder, "the folder wasn't stored");
    }

    #[test]
    fn retention_change_prunes_old_automatic_backups() {
        let f = fixture("retention-prune");
        f.setup(PASSWORD, "Checking");
        fs::create_dir_all(f.folder()).unwrap();
        for name in [
            "zeni-20261113-090000-daily.db",
            "zeni-20261112-090000-pre-revert.db",
            "zeni-20261111-090000-daily.db",
            "zeni-20261101-090000-manual.db",
        ] {
            fs::write(f.folder().join(name), b"").unwrap();
        }
        let request = SetBackupRetentionRequest { keep_automatic: 1 };
        run(set_retention(&f.state, request)).unwrap();
        let left: Vec<_> = f.backups().into_iter().map(|(name, _)| name).collect();
        assert_eq!(
            left,
            [
                "zeni-20261113-090000-daily.db",
                "zeni-20261101-090000-manual.db"
            ]
        );
    }

    #[test]
    fn retention_keeps_the_newest_automatic_backups_only() {
        let dir = db::temp_dir("backup-prune");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let kept = [
            "zeni-20261113-090000-daily.db",
            "zeni-20261112-150000-pre-revert.db",
            "zeni-20261112-090000-daily.db",
            "zeni-20261101-090000-manual.db",
            "zeni-20261102-090000-safety.db",
            "notes.txt",
            "zeni-old.db",
        ];
        let pruned = [
            "zeni-20261111-090000-daily.db",
            "zeni-20261110-090000-daily.db",
        ];
        for name in kept.iter().chain(&pruned) {
            fs::write(dir.join(name), b"").unwrap();
        }
        prune(&dir, 3).unwrap();
        let mut left: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        let mut expected: Vec<_> = kept.iter().map(|name| name.to_string()).collect();
        expected.sort();
        assert_eq!(left, expected);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_daily_backup_runs_once_a_day_and_warns_on_failure() {
        // No setup or unlock needed.
        let f = fixture("daily");
        run(daily_backup(&f.state));
        let today: String =
            run(sqlx::query_scalar("SELECT date('now','localtime')").fetch_one(&f.pool())).unwrap();
        assert_eq!(f.meta("last_daily_backup"), Some(today));
        assert_eq!(f.backups().len(), 1);
        assert_eq!(f.backups()[0].1, BackupKind::Daily);
        run(daily_backup(&f.state));
        assert_eq!(
            f.backups().len(),
            1,
            "a later launch the same day backs up nothing"
        );
        assert_eq!(*f.state.backup.daily_warning.lock().unwrap(), None);

        let pool = f.pool();
        run(set_meta(&pool, "last_daily_backup", "2000-01-01")).unwrap();
        run(set_meta(
            &pool,
            "backup_folder",
            f.dir.join("unplugged").to_str().unwrap(),
        ))
        .unwrap();
        run(daily_backup(&f.state));
        let warning = f
            .state
            .backup
            .daily_warning
            .lock()
            .unwrap()
            .clone()
            .unwrap();
        assert!(warning.contains("is missing"), "{warning}");
        // Not recorded, so the next launch retries.
        assert_eq!(f.meta("last_daily_backup").as_deref(), Some("2000-01-01"));
    }

    #[test]
    fn restore_replaces_the_data_keeps_a_safety_copy_and_undo_puts_it_back() {
        let f = fixture("restore");
        f.setup(PASSWORD, "Checking");
        let old = f.back_up();
        run(sqlx::query(
            "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
             VALUES ('Savings', 'Sam', 'Bank', x'00', x'00')",
        )
        .execute(&f.pool()))
        .unwrap();
        *f.state.backup.picked_file.lock().unwrap() = Some(f.dir.join("x.db"));

        f.restore(by_name(&old)).unwrap();
        assert_eq!(f.accounts(), ["Checking"]);
        assert!(security::session_key(&f.state).is_err(), "locked again");
        assert_eq!(*f.state.backup.picked_file.lock().unwrap(), None);
        let safety = f.undo_path().unwrap();
        assert!(
            f.backups()
                .iter()
                .any(|(_, kind)| *kind == BackupKind::Safety)
        );
        assert_eq!(mode(&f.dir.join("zeni.db")), 0o600);
        assert!(!f.dir.join(".zeni-restore.tmp").exists());
        // The keyring still holds this key, so the app reopens and works on the restored data.
        assert_eq!(f.status()["state"], "unlocked");
        f.back_up();

        run(undo_restore(&f.state)).unwrap();
        assert_eq!(f.accounts(), ["Checking", "Savings"]);
        assert_eq!(f.undo_path(), None);
        assert!(safety.exists(), "the safety copy stays in the folder");
        assert_eq!(f.status()["state"], "unlocked");
    }

    #[test]
    fn restore_by_name_accepts_a_safety_copy() {
        let f = fixture("restore-safety");
        f.setup(PASSWORD, "Checking");
        let old = f.back_up();
        run(sqlx::query(
            "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
             VALUES ('Savings', 'Sam', 'Bank', x'00', x'00')",
        )
        .execute(&f.pool()))
        .unwrap();
        f.restore(by_name(&old)).unwrap();
        assert_eq!(f.accounts(), ["Checking"]);
        assert_eq!(f.status()["state"], "unlocked");
        let (safety, _) = f
            .backups()
            .into_iter()
            .find(|(_, kind)| *kind == BackupKind::Safety)
            .unwrap();

        f.restore(RestoreSource::Backup { file_name: safety })
            .unwrap();
        assert_eq!(f.accounts(), ["Checking", "Savings"]);
    }

    #[test]
    fn restore_rejects_damaged_foreign_and_newer_files_and_changes_nothing() {
        let f = fixture("reject");
        f.setup(PASSWORD, "Checking");
        let good = f.back_up();
        let not_zeni = format!("That file isn't a Zeni backup.{UNCHANGED}");

        let notes = not_a_backup(&f);
        assert_eq!(run(pick(&f.state, notes)).unwrap().kind, BackupKind::Other);
        assert_eq!(message(f.restore(RestoreSource::PickedFile)), not_zeni);

        let other = f.dir.join("other.db");
        let pool = run(SqlitePool::connect_with(
            SqliteConnectOptions::new()
                .filename(&other)
                .create_if_missing(true),
        ))
        .unwrap();
        run(sqlx::query("CREATE TABLE notes (body TEXT)").execute(&pool)).unwrap();
        run(pool.close());
        run(pick(&f.state, other)).unwrap();
        assert_eq!(message(f.restore(RestoreSource::PickedFile)), not_zeni);

        let damaged = f.dir.join("damaged.db");
        let mut bytes = fs::read(&good.path).unwrap();
        bytes[4096..].fill(0x55);
        fs::write(&damaged, bytes).unwrap();
        run(pick(&f.state, damaged)).unwrap();
        assert_eq!(
            message(f.restore(RestoreSource::PickedFile)),
            format!("That file is damaged, so it can't be restored.{UNCHANGED}")
        );

        let newer = f.dir.join("newer.db");
        fs::copy(&good.path, &newer).unwrap();
        let pool = run(SqlitePool::connect_with(
            SqliteConnectOptions::new().filename(&newer),
        ))
        .unwrap();
        run(sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
             VALUES (99999, 'future', TRUE, x'00', 0)",
        )
        .execute(&pool))
        .unwrap();
        run(pool.close());
        run(pick(&f.state, newer)).unwrap();
        assert_eq!(
            message(f.restore(RestoreSource::PickedFile)),
            format!(
                "That backup is from a newer version of Zeni. Update Zeni, then restore it.{UNCHANGED}"
            )
        );

        let outside = RestoreSource::Backup {
            file_name: "../zeni.db".into(),
        };
        assert!(matches!(f.restore(outside), Err(AppError::Validation(_))));

        // Nothing changed: no safety copy, same data, still unlocked.
        assert_eq!(f.backups().len(), 1);
        assert_eq!(f.accounts(), ["Checking"]);
        assert_eq!(f.undo_path(), None);
        assert!(security::session_key(&f.state).is_ok());
    }

    #[test]
    fn an_older_schema_is_migrated_after_restore() {
        let f = fixture("older");
        f.setup(PASSWORD, "Checking");
        // A database from before the newest migration.
        let old = f.dir.join("old.db");
        let mut migrator = sqlx::migrate!("./migrations");
        let newest = migrator.migrations.len();
        migrator.migrations = migrator.migrations[..newest - 1].to_vec().into();
        let options = SqliteConnectOptions::new()
            .filename(&old)
            .create_if_missing(true);
        let pool = run(SqlitePool::connect_with(options)).unwrap();
        run(migrator.run(&pool)).unwrap();
        run(pool.close());

        run(pick(&f.state, old)).unwrap();
        f.restore(RestoreSource::PickedFile).unwrap();
        let applied = run(db::applied_migrations(&f.pool())).unwrap();
        assert_eq!(applied as usize, newest);
    }

    /// A backup that passes `validate` but won't open: the newest migration looks pending while
    /// its tables exist, so rerunning it fails.
    fn broken_backup(f: &Fixture) -> BackupFile {
        let broken = f.back_up();
        let options = SqliteConnectOptions::new().filename(&broken.path);
        let pool = run(SqlitePool::connect_with(options)).unwrap();
        run(sqlx::query(
            "DELETE FROM _sqlx_migrations WHERE version = (SELECT MAX(version) FROM _sqlx_migrations)",
        )
        .execute(&pool))
        .unwrap();
        run(pool.close());
        broken
    }

    #[test]
    fn a_restored_file_that_fails_to_migrate_puts_the_data_back() {
        let f = fixture("fallback");
        f.setup(PASSWORD, "Checking");
        let broken = broken_backup(&f);
        run(sqlx::query("UPDATE accounts SET name = 'Changed'").execute(&f.pool())).unwrap();

        let error = message(f.restore(by_name(&broken)));
        assert!(
            error.starts_with("Couldn't open the restored backup: while executing migration"),
            "{error}"
        );
        assert!(error.ends_with(". Your data was put back."), "{error}");
        assert!(!error.contains(".."), "{error}");
        assert_eq!(f.accounts(), ["Changed"]);
        assert_eq!(f.undo_path(), None);
    }

    #[test]
    fn a_double_failure_names_the_safety_copy_holding_the_data() {
        let f = fixture("double");
        f.setup(PASSWORD, "Checking");
        let broken = broken_backup(&f);
        // A safety copy that can't be staged, so putting the data back fails too.
        let safety = f.folder().join("zeni-20260101-000000-safety.db");
        let db_path = f.dir.join("zeni.db");
        let error = message(run(replace(
            &f.state,
            f.pool(),
            &db_path,
            Path::new(&broken.path),
            Some(&safety),
            UNCHANGED,
        )));
        assert!(
            error.starts_with("Couldn't open the restored backup: "),
            "{error}"
        );
        assert!(
            error.ends_with(
                ". Putting your data back failed too, so your data is in the safety copy \
                 zeni-20260101-000000-safety.db in the backup folder."
            ),
            "{error}"
        );
        assert!(!error.contains(&*f.dir.to_string_lossy()), "{error}");
    }

    #[test]
    fn an_undo_whose_safety_copy_wont_open_says_so() {
        let f = fixture("undo-broken");
        f.setup(PASSWORD, "Checking");
        let broken = broken_backup(&f);
        *f.state.backup.undo_path.lock().unwrap() = Some(PathBuf::from(&broken.path));
        let error = message(run(undo_restore(&f.state)));
        assert!(
            error.starts_with("Couldn't open your previous data: "),
            "{error}"
        );
        assert!(
            error.ends_with(
                ". Zeni can't open its database. Your previous data is still in the \
                 safety copy in the backup folder."
            ),
            "{error}"
        );
        assert!(Path::new(&broken.path).exists());
    }

    #[test]
    fn restore_across_a_reset_asks_for_the_old_password_and_undo_returns() {
        let f = fixture("reset");
        f.setup(PASSWORD, "Before");
        let old = f.back_up();
        f.lock();
        run(security::reset(&f.state, &f.keyring)).unwrap();
        f.setup(OTHER_PASSWORD, "After");

        f.restore(by_name(&old)).unwrap();
        assert_eq!(
            f.status(),
            serde_json::json!({ "state": "locked", "reason": "keyMissing", "canUndoRestore": true })
        );
        assert!(matches!(
            f.unlock(OTHER_PASSWORD),
            Err(AppError::WrongPassword(_))
        ));
        f.unlock(PASSWORD).unwrap();
        assert_eq!(f.accounts(), ["Before"]);

        run(undo_restore(&f.state)).unwrap();
        assert_eq!(f.accounts(), ["After"]);
        assert!(matches!(
            run(security::status(&f.state, &f.keyring)).unwrap(),
            SecurityStatus::Unlocked { .. }
        ));
        assert_eq!(f.undo_path(), None);
    }

    /// A Zeni database file outside the backup folder, ready to pick.
    fn valid_copy(f: &Fixture, name: &str) -> PathBuf {
        let path = f.dir.join(name);
        fs::copy(&f.back_up().path, &path).unwrap();
        path
    }

    fn not_a_backup(f: &Fixture) -> PathBuf {
        let notes = f.dir.join("notes.txt");
        fs::write(&notes, "hello").unwrap();
        notes
    }

    #[test]
    fn a_side_file_that_cant_be_removed_leaves_the_current_data() {
        let f = fixture("side-file");
        f.setup(PASSWORD, "Checking");
        let old = f.back_up();
        run(sqlx::query("UPDATE accounts SET name = 'Changed'").execute(&f.pool())).unwrap();
        // A directory can't be removed as a file; the default journal never opens -shm.
        let shm = f.dir.join("zeni.db-shm");
        fs::create_dir(&shm).unwrap();
        fs::write(shm.join("x"), b"").unwrap();

        let error = message(f.restore(by_name(&old)));
        assert_eq!(f.accounts(), ["Changed"]);
        assert!(error.ends_with(UNCHANGED), "{error}");
        assert_eq!(f.undo_path(), None);
        assert!(security::session_key(&f.state).is_ok());
        assert!(!f.dir.join(".zeni-restore.tmp").exists());
    }

    #[test]
    fn a_failed_swap_removes_the_staged_copy() {
        let f = fixture("swap-discard");
        f.setup(PASSWORD, "Checking");
        let db_path = f.dir.join("zeni.db");
        let before = fs::read(&db_path).unwrap();
        let temp = stage(&valid_copy(&f, "good.db"), &f.dir).unwrap();
        // A directory at -shm can't be removed as a file, so the swap fails.
        let shm = f.dir.join("zeni.db-shm");
        fs::create_dir(&shm).unwrap();
        fs::write(shm.join("x"), b"").unwrap();
        assert!(swap_or_discard(&temp, &db_path).is_err());
        assert!(!temp.exists());
        assert_eq!(fs::read(&db_path).unwrap(), before);
    }

    #[test]
    fn replace_rejects_a_staged_copy_that_isnt_a_zeni_backup() {
        let f = fixture("staged");
        f.setup(PASSWORD, "Checking");
        // As if the source changed between `validate` and `stage`.
        let notes = not_a_backup(&f);
        let db_path = f.dir.join("zeni.db");
        for note in [UNCHANGED, STILL_RESTORED] {
            let result = run(replace(&f.state, f.pool(), &db_path, &notes, None, note));
            assert_eq!(
                message(result),
                format!("That file isn't a Zeni backup.{note}")
            );
            assert_eq!(f.accounts(), ["Checking"]);
            assert!(!f.dir.join(".zeni-restore.tmp").exists());
        }
    }

    #[test]
    fn a_backup_without_the_imported_data_triggers_is_rejected() {
        let f = fixture("triggers");
        f.setup(PASSWORD, "Checking");
        let missing =
            "That backup is missing Zeni's protection for imported data, so it can't be restored.";
        for statements in [
            &["DROP TRIGGER imports_raw_no_update"][..],
            &["DROP TRIGGER raw_transactions_no_update"],
            // The right name on the wrong table protects nothing.
            &[
                "DROP TRIGGER imports_raw_no_update",
                "CREATE TRIGGER imports_raw_no_update BEFORE UPDATE ON accounts \
                 BEGIN SELECT RAISE(ABORT, 'no'); END",
            ],
        ] {
            let path = valid_copy(&f, "no-trigger.db");
            let pool = run(SqlitePool::connect_with(
                SqliteConnectOptions::new().filename(&path),
            ))
            .unwrap();
            for statement in statements {
                run(sqlx::query(*statement).execute(&pool)).unwrap();
            }
            run(pool.close());
            let drop = statements[0];
            assert_eq!(message(run(validate(&path))), missing, "{drop}");
            run(pick(&f.state, path)).unwrap();
            assert_eq!(
                message(f.restore(RestoreSource::PickedFile)),
                format!("{missing}{UNCHANGED}"),
                "{drop}"
            );
        }
        assert_eq!(f.accounts(), ["Checking"]);
        assert_eq!(f.undo_path(), None);
    }

    #[test]
    fn restore_and_undo_failures_say_what_happened_to_the_data() {
        let f = fixture("messages");
        f.setup(PASSWORD, "Checking");
        let good = valid_copy(&f, "good.db");
        let notes = not_a_backup(&f);
        let not_zeni = "That file isn't a Zeni backup.";
        // A directory in the temp file's place fails staging; one at -shm fails the swap.
        let temp = f.dir.join(".zeni-restore.tmp");
        let shm = f.dir.join("zeni.db-shm");
        let staging = "Couldn't restore that backup: Is a directory (os error 21).";

        run(pick(&f.state, notes.clone())).unwrap();
        let restore = || message(f.restore(RestoreSource::PickedFile));
        assert_eq!(restore(), format!("{not_zeni}{UNCHANGED}"));
        run(pick(&f.state, good.clone())).unwrap();
        fs::create_dir(&temp).unwrap();
        assert_eq!(restore(), format!("{staging}{UNCHANGED}"));
        fs::remove_dir(&temp).unwrap();
        fs::create_dir(&shm).unwrap();
        assert_eq!(restore(), format!("{staging}{UNCHANGED}"));
        fs::remove_dir(&shm).unwrap();
        let folder = f.dir.join("unplugged");
        run(set_meta(
            &f.pool(),
            "backup_folder",
            folder.to_str().unwrap(),
        ))
        .unwrap();
        let error = restore();
        assert!(
            error.starts_with("Couldn't make a safety copy: The backup folder "),
            "{error}"
        );
        assert!(
            error.ends_with(&format!(
                "is missing. Plug in its drive or choose another folder.{UNCHANGED}"
            )),
            "{error}"
        );
        assert_eq!(f.accounts(), ["Checking"]);

        let undo = |path: &PathBuf| {
            *f.state.backup.undo_path.lock().unwrap() = Some(path.clone());
            message(run(undo_restore(&f.state)))
        };
        assert_eq!(undo(&notes), format!("{not_zeni}{STILL_RESTORED}"));
        fs::create_dir(&temp).unwrap();
        assert_eq!(undo(&good), format!("{staging}{STILL_RESTORED}"));
        fs::remove_dir(&temp).unwrap();
        fs::create_dir(&shm).unwrap();
        assert_eq!(undo(&good), format!("{staging}{STILL_RESTORED}"));
        assert_eq!(f.accounts(), ["Checking"]);
    }

    #[test]
    fn backups_keep_account_numbers_encrypted() {
        let f = fixture("encrypted");
        f.setup(PASSWORD, "Checking");
        let manual = f.back_up();
        run(daily_backup(&f.state));
        let numbers = "SELECT account_number, routing_number FROM accounts ORDER BY id";
        let live: Vec<(Vec<u8>, Vec<u8>)> =
            run(sqlx::query_as(numbers).fetch_all(&f.pool())).unwrap();
        for (name, _) in f.backups() {
            let path = f.folder().join(&name);
            let copy = run(SqlitePool::connect_with(
                SqliteConnectOptions::new().filename(&path).read_only(true),
            ))
            .unwrap();
            let stored: Vec<(Vec<u8>, Vec<u8>)> =
                run(sqlx::query_as(numbers).fetch_all(&copy)).unwrap();
            run(copy.close());
            assert_eq!(stored, live, "{name}");
            let bytes = fs::read(&path).unwrap();
            for plain in [&b"123456789012"[..], b"011000015"] {
                assert!(
                    !bytes.windows(plain.len()).any(|window| window == plain),
                    "{name}"
                );
            }
        }
        assert_eq!(f.backups().len(), 2);
        assert!(
            f.backups()
                .iter()
                .any(|(name, _)| *name == manual.file_name)
        );
    }
}
