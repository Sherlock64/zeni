use std::path::PathBuf;

use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

use super::{BackupState, Jobs, PendingImport, Session};

/// Managed Tauri state. `db` holds the startup result, so the app still runs when the database can't open.
/// `session` holds the unlocked data key until the app exits. `pending_import` holds the one import
/// waiting for a CSV mapping or a duplicate review. A restore swaps `db`, so read it through `security::pool`.
/// `jobs` holds the one Ollama job (a categorize run, a download or a build).
pub struct AppState {
    pub db: std::sync::RwLock<Result<Database, String>>,
    pub session: std::sync::Mutex<Option<Session>>,
    pub pending_import: std::sync::Mutex<Option<PendingImport>>,
    pub backup: BackupState,
    pub jobs: Jobs,
}

pub struct Database {
    pub pool: SqlitePool,
    pub path: PathBuf,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub db_path: String,
    pub migrations_applied: u32,
}
