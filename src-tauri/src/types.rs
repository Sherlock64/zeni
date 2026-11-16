use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use zeroize::Zeroizing;

/// Managed Tauri state. `db` holds the startup result, so the app still runs when the database can't open.
/// `session` holds the unlocked data key until the app exits. `pending_import` holds the one import
/// waiting for a CSV mapping or a duplicate review. A restore swaps `db`, so read it through `security::pool`.
pub struct AppState {
    pub db: std::sync::RwLock<Result<Database, String>>,
    pub session: std::sync::Mutex<Option<Session>>,
    pub pending_import: std::sync::Mutex<Option<PendingImport>>,
    pub backup: BackupState,
}

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

/// A file read by `import_file` but not stored yet (Rust only). Holds file text, never secrets.
pub struct PendingImport {
    pub file_name: String,
    pub step: PendingStep,
}

/// What a pending import waits for (Rust only).
pub enum PendingStep {
    /// A CSV whose header matches no saved layout: its text, until `save_csv_layout`.
    Mapping { text: String },
    /// A parsed file with suspected duplicates, until `commit_import`. `skipRows` index its transactions.
    Review {
        format: ImportFormat,
        csv_layout_id: Option<i64>,
        statement: ParsedStatement,
        /// The suspected pairs' row indexes: the only values `skipRows` may hold.
        suspect_rows: Vec<u32>,
    },
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
        /// True while the last restore can be undone.
        can_undo_restore: bool,
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
    Csv,
}

/// Date format of a CSV layout's posted-date column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[ts(export)]
pub enum DateFormat {
    /// Exactly 2/2/4 digits.
    #[serde(rename = "MM/DD/YYYY")]
    #[sqlx(rename = "MM/DD/YYYY")]
    MmDdYyyy,
    /// 1-2/1-2/4 digits.
    #[serde(rename = "M/D/YYYY")]
    #[sqlx(rename = "M/D/YYYY")]
    MDYyyy,
    #[serde(rename = "YYYY-MM-DD")]
    #[sqlx(rename = "YYYY-MM-DD")]
    YyyyMmDd,
    #[serde(rename = "DD/MM/YYYY")]
    #[sqlx(rename = "DD/MM/YYYY")]
    DdMmYyyy,
}

/// Where a CSV row's amount comes from: one signed column, or separate debit and credit columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AmountColumns {
    Signed {
        column: u32,
    },
    /// Amount is |credit| - |debit|; an empty cell counts as 0.
    Split {
        debit: u32,
        credit: u32,
    },
}

/// A CSV column mapping. Every column is a zero-based index into the header row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CsvMapping {
    pub date_format: DateFormat,
    pub posted_date: u32,
    pub description: u32,
    pub amount: AmountColumns,
    /// Works like FITID for dedupe.
    pub transaction_id: Option<u32>,
    pub memo: Option<u32>,
    pub transaction_type: Option<u32>,
    pub running_balance: Option<u32>,
    /// When mapped, only rows whose status is `Posted` import.
    pub posting_status: Option<u32>,
    pub bank_category: Option<u32>,
}

/// A saved CSV layout, matched to files by their header.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CsvLayout {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    /// The normalised header names, i.e. the fingerprint split on '\n'.
    pub headers: Vec<String>,
    pub mapping: CsvMapping,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SaveCsvLayoutRequest {
    /// Trimmed, non-empty, at most 100 chars.
    pub name: String,
    pub mapping: CsvMapping,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateCsvLayoutRequest {
    #[ts(type = "number")]
    pub layout_id: i64,
    /// Trimmed, non-empty, at most 100 chars.
    pub name: String,
    pub mapping: CsvMapping,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteCsvLayoutRequest {
    #[ts(type = "number")]
    pub layout_id: i64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitImportRequest {
    /// `rowIndex` values the user answered "Yes, duplicate"; these rows aren't stored.
    pub skip_rows: Vec<u32>,
}

/// What `import_file` (or `save_csv_layout`) did next.
#[derive(Debug, Serialize, TS)]
#[serde(tag = "step", content = "data", rename_all = "camelCase")]
#[ts(export)]
pub enum ImportStep {
    /// A CSV whose header matches no saved layout.
    NeedsMapping(CsvMappingNeeded),
    /// Suspected duplicates to confirm before `commit_import`.
    Review(ImportReview),
    /// Stored straight away.
    Imported(ImportSummary),
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CsvMappingNeeded {
    pub file_name: String,
    /// Header cells as in the file, trimmed (original case), file order.
    pub headers: Vec<String>,
    /// The first up to 5 data rows, raw cells.
    pub rows: Vec<Vec<String>>,
}

/// One data row parsed with a draft mapping, for the mapping dialog's preview.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CsvPreviewRow {
    /// 1-based line number in the file (the header is line 1).
    pub line: u32,
    /// "YYYY-MM-DD" when it parsed.
    pub posted_date: Option<String>,
    #[ts(type = "number | null")]
    pub amount_cents: Option<i64>,
    pub description: Option<String>,
    pub transaction_id: Option<String>,
    pub memo: Option<String>,
    pub transaction_type: Option<String>,
    #[ts(type = "number | null")]
    pub running_balance_cents: Option<i64>,
    pub posting_status: Option<String>,
    pub bank_category: Option<String>,
    /// The first problem on this row.
    pub error: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportReview {
    pub file_name: String,
    pub format: ImportFormat,
    pub pairs: Vec<SuspectedDuplicate>,
}

/// A new row that may repeat a stored row from an import in the other format family (CSV vs OFX/QFX).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SuspectedDuplicate {
    /// Index into the parsed file's imported rows; what `commit_import`'s `skipRows` holds.
    pub row_index: u32,
    pub new_row: ReviewRow,
    pub existing: ReviewRow,
    pub existing_file_name: String,
    pub existing_format: ImportFormat,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReviewRow {
    /// "YYYY-MM-DD".
    pub posted_date: String,
    #[ts(type = "number")]
    pub amount_cents: i64,
    pub description: String,
}

/// Result of checking a CSV's running balance row by row within the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS, sqlx::Type)]
#[serde(rename_all = "camelCase")]
#[sqlx(rename_all = "camelCase")]
#[ts(export)]
pub enum FileBalanceCheck {
    Passed,
    Mismatch,
    /// No balance column mapped, no posted rows, or an OFX/QFX file.
    NotChecked,
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
    /// Rows skipped because their posting status isn't `Posted`.
    pub not_posted: u32,
    /// Rows skipped as "Yes, duplicate" in review.
    pub review_skipped: u32,
    pub file_balance_check: FileBalanceCheck,
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
    pub file_balance_check: FileBalanceCheck,
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
    /// Case-insensitive substring of nickname, description or memo; trimmed, empty means none, at most 200 chars.
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
    /// The winning rule's nickname name; `None` when unmapped.
    pub nickname: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TransactionPage {
    pub rows: Vec<Transaction>,
    pub total: u32,
}

/// A parsed OFX or CSV bank statement (Rust only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedStatement {
    /// `CURDEF`.
    pub currency: String,
    pub ledger_balance_cents: Option<i64>,
    /// `DTASOF` as "YYYY-MM-DD".
    pub balance_as_of: Option<String>,
    pub transactions: Vec<ParsedTransaction>,
    /// CSV rows skipped because their posting status isn't `Posted`; 0 for OFX/QFX.
    pub not_posted: u32,
    /// `NotChecked` for OFX/QFX.
    pub file_balance_check: FileBalanceCheck,
}

/// One `STMTTRN` or CSV row (Rust only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTransaction {
    /// `FITID`, or the CSV transaction ID.
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
    /// CSV running balance; `None` for OFX/QFX.
    pub running_balance_cents: Option<i64>,
    /// CSV bank category; `None` for OFX/QFX.
    pub bank_category: Option<String>,
    /// The full `<STMTTRN>...</STMTTRN>` block text, or the CSV record's source line.
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
    /// An import file that can't be read, isn't a supported OFX/QFX/CSV bank statement, or isn't in US dollars.
    #[error("{0}")]
    Import(String),
    /// Backup folder, backup write, restore validation and restore failures.
    #[error("{0}")]
    Backup(String),
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

/// How a nickname rule compares its pattern with a transaction field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[ts(export)]
pub enum MatchMode {
    /// Case-insensitive whole text after trimming.
    Exact,
    /// Case-insensitive substring.
    Contains,
    /// Rust regex, case-insensitive by default.
    Regex,
}

/// Which raw transaction field a nickname rule reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[ts(export)]
pub enum MatchField {
    Description,
    /// A row with no memo never matches.
    Memo,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NicknameRule {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub nickname_id: i64,
    pub mode: MatchMode,
    pub field: MatchField,
    pub pattern: String,
    /// "YYYY-MM-DD HH:MM:SS" (UTC, SQLite CURRENT_TIMESTAMP).
    pub created_at: String,
    /// Rows where this rule won.
    pub match_count: u32,
    /// "YYYY-MM-DD", newest posted date where this rule won.
    pub last_matched: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Nickname {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub enabled: bool,
    pub stale_exempt: bool,
    /// "YYYY-MM-DD HH:MM:SS" (UTC).
    pub created_at: String,
    /// Sum over its rules.
    pub match_count: u32,
    /// "YYYY-MM-DD", newest over its rules.
    pub last_matched: Option<String>,
    pub stale: bool,
    /// Ordered by id ascending; never empty.
    pub rules: Vec<NicknameRule>,
}

/// A rule as the user typed it; shared by the nickname requests.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuleInput {
    pub mode: MatchMode,
    pub field: MatchField,
    /// Trimmed, 1..=500 chars; a regex must compile.
    pub pattern: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SaveNicknameRuleRequest {
    /// Trimmed, 1..=100 chars; an existing name (case-insensitive) gets the rule added.
    pub name: String,
    pub rule: RuleInput,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateNicknameRequest {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub enabled: bool,
    pub stale_exempt: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteNicknameRequest {
    #[ts(type = "number")]
    pub id: i64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateNicknameRuleRequest {
    #[ts(type = "number")]
    pub id: i64,
    pub rule: RuleInput,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteNicknameRuleRequest {
    #[ts(type = "number")]
    pub id: i64,
}

/// Also the `set_nickname_stale_days` request.
#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NicknameSettings {
    /// 1..=3650; stored as `app_meta` `nickname_stale_days`, absent means 90.
    pub stale_days: u32,
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
                reason: LockReason::KeyringLocked,
                can_undo_restore: true,
            }),
            serde_json::json!({ "state": "locked", "reason": "keyringLocked", "canUndoRestore": true })
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
                not_posted: 1,
                review_skipped: 2,
                file_balance_check: FileBalanceCheck::Passed,
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
                "expectedBalanceCents": -150,
                "notPosted": 1,
                "reviewSkipped": 2,
                "fileBalanceCheck": "passed"
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
                file_balance_check: FileBalanceCheck::NotChecked,
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
                "balanceCheck": "mismatch",
                "fileBalanceCheck": "notChecked"
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
    fn csv_import_types_match_contract_json() {
        let mapping: CsvMapping = serde_json::from_value(serde_json::json!({
            "dateFormat": "M/D/YYYY",
            "postedDate": 1,
            "description": 8,
            "amount": { "kind": "split", "debit": 5, "credit": 6 },
            "transactionId": 0,
            "memo": null,
            "transactionType": null,
            "runningBalance": 11,
            "postingStatus": 4,
            "bankCategory": null
        }))
        .unwrap();
        assert_eq!(mapping.date_format, DateFormat::MDYyyy);
        assert_eq!(
            mapping.amount,
            AmountColumns::Split {
                debit: 5,
                credit: 6
            }
        );
        assert_eq!(
            (mapping.transaction_id, mapping.running_balance),
            (Some(0), Some(11))
        );
        for (format, text) in [
            (DateFormat::MmDdYyyy, "MM/DD/YYYY"),
            (DateFormat::YyyyMmDd, "YYYY-MM-DD"),
            (DateFormat::DdMmYyyy, "DD/MM/YYYY"),
        ] {
            assert_eq!(serde_json::to_value(format).unwrap(), text);
        }
        assert_eq!(
            serde_json::to_value(AmountColumns::Signed { column: 3 }).unwrap(),
            serde_json::json!({ "kind": "signed", "column": 3 })
        );
        assert_eq!(serde_json::to_value(ImportFormat::Csv).unwrap(), "csv");

        let commit: CommitImportRequest =
            serde_json::from_value(serde_json::json!({ "skipRows": [0, 4] })).unwrap();
        assert_eq!(commit.skip_rows, [0, 4]);

        assert_eq!(
            serde_json::to_value(ImportStep::NeedsMapping(CsvMappingNeeded {
                file_name: "a.csv".into(),
                headers: vec!["Amount".into()],
                rows: vec![vec!["-1.00".into()]],
            }))
            .unwrap(),
            serde_json::json!({
                "step": "needsMapping",
                "data": { "fileName": "a.csv", "headers": ["Amount"], "rows": [["-1.00"]] }
            })
        );
        let review_row = || ReviewRow {
            posted_date: "2026-10-03".into(),
            amount_cents: -4500,
            description: "GROCER".into(),
        };
        assert_eq!(
            serde_json::to_value(ImportStep::Review(ImportReview {
                file_name: "a.csv".into(),
                format: ImportFormat::Csv,
                pairs: vec![SuspectedDuplicate {
                    row_index: 2,
                    new_row: review_row(),
                    existing: review_row(),
                    existing_file_name: "a.ofx".into(),
                    existing_format: ImportFormat::Ofx,
                }],
            }))
            .unwrap(),
            serde_json::json!({
                "step": "review",
                "data": {
                    "fileName": "a.csv",
                    "format": "csv",
                    "pairs": [{
                        "rowIndex": 2,
                        "newRow": { "postedDate": "2026-10-03", "amountCents": -4500, "description": "GROCER" },
                        "existing": { "postedDate": "2026-10-03", "amountCents": -4500, "description": "GROCER" },
                        "existingFileName": "a.ofx",
                        "existingFormat": "ofx"
                    }]
                }
            })
        );
        assert_eq!(
            serde_json::to_value(FileBalanceCheck::Mismatch).unwrap(),
            "mismatch"
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
                    nickname: Some("Coffee".into()),
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
                    "runningBalanceCents": null,
                    "nickname": "Coffee"
                }],
                "total": 57
            })
        );
    }

    #[test]
    fn nickname_types_match_contract_json() {
        for (text, mode) in [
            ("exact", MatchMode::Exact),
            ("contains", MatchMode::Contains),
            ("regex", MatchMode::Regex),
        ] {
            assert_eq!(serde_json::to_value(mode).unwrap(), text);
            assert_eq!(
                serde_json::from_value::<MatchMode>(text.into()).unwrap(),
                mode
            );
        }
        for (text, field) in [
            ("description", MatchField::Description),
            ("memo", MatchField::Memo),
        ] {
            assert_eq!(serde_json::to_value(field).unwrap(), text);
            assert_eq!(
                serde_json::from_value::<MatchField>(text.into()).unwrap(),
                field
            );
        }

        let save: SaveNicknameRuleRequest = serde_json::from_value(serde_json::json!({
            "name": "Coffee",
            "rule": { "mode": "contains", "field": "memo", "pattern": "corner" }
        }))
        .unwrap();
        assert_eq!(save.name, "Coffee");
        assert_eq!(
            (save.rule.mode, save.rule.field, save.rule.pattern.as_str()),
            (MatchMode::Contains, MatchField::Memo, "corner")
        );
        let update: UpdateNicknameRequest = serde_json::from_value(serde_json::json!({
            "id": 3, "name": "Cafe", "enabled": false, "staleExempt": true
        }))
        .unwrap();
        assert_eq!(
            (update.id, update.enabled, update.stale_exempt),
            (3, false, true)
        );
        assert_eq!(
            serde_json::to_value(NicknameSettings { stale_days: 90 }).unwrap(),
            serde_json::json!({ "staleDays": 90 })
        );

        assert_eq!(
            serde_json::to_value(Nickname {
                id: 1,
                name: "Coffee".into(),
                enabled: true,
                stale_exempt: false,
                created_at: "2026-11-01 10:00:00".into(),
                match_count: 2,
                last_matched: Some("2026-10-31".into()),
                stale: false,
                rules: vec![NicknameRule {
                    id: 4,
                    nickname_id: 1,
                    mode: MatchMode::Exact,
                    field: MatchField::Description,
                    pattern: "corner coffee".into(),
                    created_at: "2026-11-01 10:00:00".into(),
                    match_count: 2,
                    last_matched: Some("2026-10-31".into()),
                }],
            })
            .unwrap(),
            serde_json::json!({
                "id": 1,
                "name": "Coffee",
                "enabled": true,
                "staleExempt": false,
                "createdAt": "2026-11-01 10:00:00",
                "matchCount": 2,
                "lastMatched": "2026-10-31",
                "stale": false,
                "rules": [{
                    "id": 4,
                    "nicknameId": 1,
                    "mode": "exact",
                    "field": "description",
                    "pattern": "corner coffee",
                    "createdAt": "2026-11-01 10:00:00",
                    "matchCount": 2,
                    "lastMatched": "2026-10-31"
                }]
            })
        );
    }
}
