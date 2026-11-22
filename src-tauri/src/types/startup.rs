use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What startup is waiting on. `Ready` lets the security gate run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum StartupStatus {
    Ready,
    /// The pre-update backup failed, so nothing was migrated.
    BackupFailed {
        reason: String,
    },
    /// The data was written by a newer Zeni; `version` is its last run version when known.
    NewerData {
        version: Option<String>,
    },
}

/// Why `startup::prepare` returned no database (Rust only).
#[derive(Debug)]
pub enum StartupProblem {
    /// One of the two blocking states the UI explains.
    Blocked(StartupStatus),
    /// The database couldn't open; the text goes to `AppState.db`.
    Failed(String),
}

/// Managed Tauri state beside `AppState` (Rust only): `Some` while startup is blocked.
#[derive(Default)]
pub struct Startup(pub std::sync::Mutex<Option<StartupStatus>>);

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ContinueStartupRequest {
    pub without_backup: bool,
}
