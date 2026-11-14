use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use zeroize::Zeroizing;

/// Managed Tauri state. `db` holds the startup result, so the app still runs when the database can't open.
/// `session` holds the unlocked data key until the app exits.
pub struct AppState {
    pub db: Result<Database, String>,
    pub session: std::sync::Mutex<Option<Session>>,
}

/// The 256-bit data key that encrypts account fields. Zeroized on drop; never Debug-printed.
pub struct DataKey(pub Zeroizing<[u8; 32]>);

/// The unlocked state. `keyring_saved` is cached at unlock time for `security_status`.
pub struct Session {
    pub key: DataKey,
    pub keyring_saved: bool,
}

/// Argon2id parameters, stored per `key_wraps` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

/// Result of reading the data key from the Secret Service.
pub enum KeyringLoad {
    Found(DataKey),
    /// No item, or one with a different key id.
    Missing,
    Locked,
    /// No D-Bus service, an error, or a timeout.
    Unavailable,
}

/// A `key_wraps` value pair: `(salt, wrapped_key)`.
pub type KeyWrap = ([u8; 16], Vec<u8>);

/// A `key_wraps` row: `(id, salt, kdf_m_kib, kdf_t, kdf_p, wrapped_key)`.
pub type KeyWrapRow = (i64, Vec<u8>, u32, u32, u32, Vec<u8>);

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

#[derive(Debug, Serialize, TS)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum SecurityStatus {
    NeedsSetup {
        default_owner: String,
    },
    Locked {
        reason: LockReason,
    },
    Unlocked {
        keyring_saved: bool,
        recovery_codes_left: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LockReason {
    KeyringLocked,
    KeyringUnavailable,
    KeyMissing,
}

// Secret-holding types below (passwords, codes, account/routing numbers) deliberately don't derive Debug.

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewAccount {
    pub name: String,
    pub owner: String,
    pub bank_name: String,
    pub account_number: String,
    pub routing_number: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetupRequest {
    pub master_password: String,
    pub account: NewAccount,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetupResponse {
    pub recovery_codes: Vec<String>,
    pub keyring_saved: bool,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UnlockRequest {
    pub master_password: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecoverRequest {
    pub recovery_code: String,
    pub new_master_password: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecoveryCodes {
    pub codes: Vec<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Account {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub owner: String,
    pub bank_name: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RevealAccountNumbersRequest {
    #[ts(type = "number")]
    pub account_id: i64,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AccountNumbers {
    pub account_number: String,
    pub routing_number: String,
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
    /// The data key isn't loaded, or setup is already done / not done for the called command.
    #[error("{0}")]
    Locked(String),
    #[error("{0}")]
    WrongPassword(String),
    /// Malformed, used or unknown recovery code.
    #[error("{0}")]
    InvalidRecoveryCode(String),
    #[error("{0}")]
    NotFound(String),
    /// A stored value failed to decrypt, or a crypto/RNG failure.
    #[error("{0}")]
    Crypto(String),
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

    #[test]
    fn security_types_match_contract_json() {
        let json = |status| serde_json::to_value(status).unwrap();
        assert_eq!(
            json(SecurityStatus::NeedsSetup {
                default_owner: "sherlock".into()
            }),
            serde_json::json!({ "state": "needsSetup", "defaultOwner": "sherlock" })
        );
        assert_eq!(
            json(SecurityStatus::Locked {
                reason: LockReason::KeyringLocked
            }),
            serde_json::json!({ "state": "locked", "reason": "keyringLocked" })
        );
        assert_eq!(
            json(SecurityStatus::Unlocked {
                keyring_saved: true,
                recovery_codes_left: 8
            }),
            serde_json::json!({ "state": "unlocked", "keyringSaved": true, "recoveryCodesLeft": 8 })
        );
        assert_eq!(
            serde_json::to_value(LockReason::KeyringUnavailable).unwrap(),
            "keyringUnavailable"
        );
        assert_eq!(
            serde_json::to_value(LockReason::KeyMissing).unwrap(),
            "keyMissing"
        );

        let request: RecoverRequest = serde_json::from_value(serde_json::json!({
            "recoveryCode": "ABCDE-FGHJK-MNPQR-STVWX",
            "newMasterPassword": "correct horse battery"
        }))
        .unwrap();
        assert_eq!(request.recovery_code, "ABCDE-FGHJK-MNPQR-STVWX");
        assert_eq!(request.new_master_password, "correct horse battery");
    }
}
