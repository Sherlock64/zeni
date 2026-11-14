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

/// File format of an import, taken from the file extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS, sqlx::Type)]
#[serde(rename_all = "camelCase")]
#[sqlx(rename_all = "camelCase")]
#[ts(export)]
pub enum ImportFormat {
    Ofx,
    Qfx,
}

/// Result of checking a file's `LEDGERBAL` against the prior import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS, sqlx::Type)]
#[serde(rename_all = "camelCase")]
#[sqlx(rename_all = "camelCase")]
#[ts(export)]
pub enum BalanceCheck {
    Passed,
    Mismatch,
    /// The first import with a balance; nothing to check against.
    Baseline,
    /// The file has no `LEDGERBAL`.
    NotChecked,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportSummary {
    #[ts(type = "number")]
    pub import_id: i64,
    pub file_name: String,
    pub format: ImportFormat,
    pub added: u32,
    pub duplicates: u32,
    pub balance_check: BalanceCheck,
    #[ts(type = "number | null")]
    pub ledger_balance_cents: Option<i64>,
    #[ts(type = "number | null")]
    pub expected_balance_cents: Option<i64>,
}

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportRecord {
    #[ts(type = "number")]
    pub id: i64,
    pub file_name: String,
    pub format: ImportFormat,
    /// SQLite `CURRENT_TIMESTAMP`, UTC "YYYY-MM-DD HH:MM:SS".
    pub imported_at: String,
    #[ts(type = "number")]
    pub account_id: i64,
    /// Raw rows currently stored for this import.
    pub row_count: u32,
    #[ts(type = "number | null")]
    pub ledger_balance_cents: Option<i64>,
    /// "YYYY-MM-DD".
    pub balance_as_of: Option<String>,
    #[ts(type = "number | null")]
    pub expected_balance_cents: Option<i64>,
    pub balance_check: BalanceCheck,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RevertImportRequest {
    #[ts(type = "number")]
    pub import_id: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TransactionSort {
    Date,
    Amount,
    Description,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TransactionQuery {
    /// Inclusive "YYYY-MM-DD".
    pub from: Option<String>,
    /// Inclusive "YYYY-MM-DD".
    pub to: Option<String>,
    /// Case-insensitive substring of description or memo; trimmed, empty means none, at most 200 chars.
    pub search: Option<String>,
    pub sort: TransactionSort,
    pub direction: SortDirection,
    /// 0-based.
    pub page: u32,
    /// 1..=200.
    pub page_size: u32,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Transaction {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub import_id: i64,
    /// "YYYY-MM-DD".
    pub posted_date: String,
    /// Negative means money out.
    #[ts(type = "number")]
    pub amount_cents: i64,
    /// The raw description.
    pub description: String,
    pub memo: Option<String>,
    pub transaction_type: Option<String>,
    #[ts(type = "number | null")]
    pub running_balance_cents: Option<i64>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TransactionPage {
    pub rows: Vec<Transaction>,
    pub total: u32,
}

/// A parsed OFX bank statement (Rust only).
#[derive(Debug, PartialEq, Eq)]
pub struct ParsedStatement {
    /// `CURDEF`.
    pub currency: String,
    pub ledger_balance_cents: Option<i64>,
    /// `DTASOF` as "YYYY-MM-DD".
    pub balance_as_of: Option<String>,
    pub transactions: Vec<ParsedTransaction>,
}

/// One `STMTTRN` (Rust only).
#[derive(Debug, PartialEq, Eq)]
pub struct ParsedTransaction {
    pub fitid: Option<String>,
    /// `DTPOSTED` as "YYYY-MM-DD".
    pub posted_date: String,
    /// `TRNAMT` parsed as decimal text into cents, never via float.
    pub amount_cents: i64,
    /// `NAME`, else `PAYEE/NAME`, else `MEMO`, else "".
    pub description: String,
    pub memo: Option<String>,
    /// `TRNTYPE`.
    pub transaction_type: Option<String>,
    /// The full `<STMTTRN>...</STMTTRN>` block text.
    pub original: String,
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
    /// An import file that can't be read, isn't a supported OFX/QFX bank statement, or isn't in US dollars.
    #[error("{0}")]
    Import(String),
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

    #[test]
    fn import_types_match_contract_json() {
        assert_eq!(
            serde_json::to_value(ImportSummary {
                import_id: 4,
                file_name: "checking.qfx".into(),
                format: ImportFormat::Qfx,
                added: 12,
                duplicates: 3,
                balance_check: BalanceCheck::NotChecked,
                ledger_balance_cents: None,
                expected_balance_cents: Some(-150),
            })
            .unwrap(),
            serde_json::json!({
                "importId": 4,
                "fileName": "checking.qfx",
                "format": "qfx",
                "added": 12,
                "duplicates": 3,
                "balanceCheck": "notChecked",
                "ledgerBalanceCents": null,
                "expectedBalanceCents": -150
            })
        );
        assert_eq!(
            serde_json::to_value(ImportRecord {
                id: 2,
                file_name: "checking.ofx".into(),
                format: ImportFormat::Ofx,
                imported_at: "2026-11-01 09:30:00".into(),
                account_id: 1,
                row_count: 7,
                ledger_balance_cents: Some(123_456),
                balance_as_of: Some("2026-10-31".into()),
                expected_balance_cents: Some(123_400),
                balance_check: BalanceCheck::Mismatch,
            })
            .unwrap(),
            serde_json::json!({
                "id": 2,
                "fileName": "checking.ofx",
                "format": "ofx",
                "importedAt": "2026-11-01 09:30:00",
                "accountId": 1,
                "rowCount": 7,
                "ledgerBalanceCents": 123456,
                "balanceAsOf": "2026-10-31",
                "expectedBalanceCents": 123400,
                "balanceCheck": "mismatch"
            })
        );
        for (check, text) in [
            (BalanceCheck::Passed, "passed"),
            (BalanceCheck::Baseline, "baseline"),
        ] {
            assert_eq!(serde_json::to_value(check).unwrap(), text);
        }

        let revert: RevertImportRequest =
            serde_json::from_value(serde_json::json!({ "importId": 9 })).unwrap();
        assert_eq!(revert.import_id, 9);

        assert_eq!(
            serde_json::to_value(AppError::Import("not OFX".into())).unwrap(),
            serde_json::json!({ "kind": "Import", "message": "not OFX" })
        );
    }

    #[test]
    fn transaction_types_match_contract_json() {
        let query: TransactionQuery = serde_json::from_value(serde_json::json!({
            "from": "2026-10-01",
            "to": null,
            "search": "coffee",
            "sort": "amount",
            "direction": "asc",
            "page": 2,
            "pageSize": 50
        }))
        .unwrap();
        assert_eq!(query.from.as_deref(), Some("2026-10-01"));
        assert_eq!(query.to, None);
        assert_eq!(query.search.as_deref(), Some("coffee"));
        assert_eq!(query.sort, TransactionSort::Amount);
        assert_eq!(query.direction, SortDirection::Asc);
        assert_eq!((query.page, query.page_size), (2, 50));
        for (text, sort) in [
            ("date", TransactionSort::Date),
            ("description", TransactionSort::Description),
        ] {
            assert_eq!(
                serde_json::from_value::<TransactionSort>(text.into()).unwrap(),
                sort
            );
        }
        assert_eq!(
            serde_json::from_value::<SortDirection>("desc".into()).unwrap(),
            SortDirection::Desc
        );

        assert_eq!(
            serde_json::to_value(TransactionPage {
                rows: vec![Transaction {
                    id: 5,
                    import_id: 2,
                    posted_date: "2026-10-03".into(),
                    amount_cents: -1299,
                    description: "CORNER COFFEE".into(),
                    memo: None,
                    transaction_type: Some("DEBIT".into()),
                    running_balance_cents: None,
                }],
                total: 57,
            })
            .unwrap(),
            serde_json::json!({
                "rows": [{
                    "id": 5,
                    "importId": 2,
                    "postedDate": "2026-10-03",
                    "amountCents": -1299,
                    "description": "CORNER COFFEE",
                    "memo": null,
                    "transactionType": "DEBIT",
                    "runningBalanceCents": null
                }],
                "total": 57
            })
        );
    }
}
