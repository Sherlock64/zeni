use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

/// Managed Tauri state. `db` holds the startup result, so the app still runs when the database can't open.
pub struct AppState {
    pub db: Result<Database, String>,
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

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SampleErrorRequest {
    pub reason: String,
}

/// Every command error. Serialized as `{ kind, message }` for the UI.
#[derive(Debug, thiserror::Error, Serialize, TS)]
#[serde(tag = "kind", content = "message")]
#[ts(export)]
pub enum AppError {
    #[error("{0}")]
    Database(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Sample(String),
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        Self::Database(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_serializes_as_kind_and_message() {
        let json = serde_json::to_value(AppError::Sample("boom".into())).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "Sample", "message": "boom" })
        );
    }
}
