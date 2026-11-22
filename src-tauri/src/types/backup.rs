use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Backup and restore state that lives until the app quits (Rust only).
#[derive(Default)]
pub struct BackupState {
    /// Path chosen by `pick_restore_file`, until restored or replaced.
    pub picked_file: std::sync::Mutex<Option<PathBuf>>,
    /// Safety copy of the last restore, until undone or the app quits.
    pub undo_path: std::sync::Mutex<Option<PathBuf>>,
    /// Why today's daily backup failed; `None` when it worked or was not due.
    pub daily_warning: std::sync::Mutex<Option<String>>,
}

/// What made a backup file. `Other` is a picked file whose name doesn't match the backup pattern.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BackupKind {
    Manual,
    Daily,
    PreRevert,
    Safety,
    /// Taken at startup before migrating data from an older Zeni; never pruned.
    PreUpdate,
    Other,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupFile {
    /// For example `zeni-20261115-140322-manual.db`.
    pub file_name: String,
    /// Absolute, for display.
    pub path: String,
    pub kind: BackupKind,
    /// Local `YYYY-MM-DD HH:MM:SS`: from the name when it matches the pattern, else the file's mtime.
    pub created_at: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupSettings {
    /// Absolute path in use.
    pub folder: String,
    pub is_default_folder: bool,
    /// How many automatic backups to keep (default 14).
    pub keep_automatic: u32,
    /// Why today's daily backup failed, from `BackupState.daily_warning`.
    pub daily_warning: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetBackupRetentionRequest {
    /// 1..=365.
    pub keep_automatic: u32,
}

#[derive(Debug, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum RestoreSource {
    /// A name from `list_backups`, resolved in the backup folder.
    Backup { file_name: String },
    /// The path held in `BackupState.picked_file`.
    PickedFile,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RestoreBackupRequest {
    pub source: RestoreSource,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_types_match_contract_json() {
        assert_eq!(
            serde_json::to_value(BackupFile {
                file_name: "zeni-20261115-140322-pre-revert.db".into(),
                path: "/b/zeni-20261115-140322-pre-revert.db".into(),
                kind: BackupKind::PreRevert,
                created_at: "2026-11-15 14:03:22".into(),
                size_bytes: 4096,
            })
            .unwrap(),
            serde_json::json!({
                "fileName": "zeni-20261115-140322-pre-revert.db",
                "path": "/b/zeni-20261115-140322-pre-revert.db",
                "kind": "preRevert",
                "createdAt": "2026-11-15 14:03:22",
                "sizeBytes": 4096
            })
        );
        let source = |json| {
            serde_json::from_value::<RestoreBackupRequest>(json)
                .unwrap()
                .source
        };
        assert!(matches!(
            source(serde_json::json!({ "source": { "kind": "backup", "fileName": "a.db" } })),
            RestoreSource::Backup { file_name } if file_name == "a.db"
        ));
        assert!(matches!(
            source(serde_json::json!({ "source": { "kind": "pickedFile" } })),
            RestoreSource::PickedFile
        ));
    }
}
