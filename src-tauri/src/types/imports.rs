use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Cents;

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
    pub amount_cents: Option<Cents>,
    pub description: Option<String>,
    pub transaction_id: Option<String>,
    pub memo: Option<String>,
    pub transaction_type: Option<String>,
    #[ts(type = "number | null")]
    pub running_balance_cents: Option<Cents>,
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
    pub amount_cents: Cents,
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
    pub ledger_balance_cents: Option<Cents>,
    #[ts(type = "number | null")]
    pub expected_balance_cents: Option<Cents>,
    /// Rows skipped because their posting status isn't `Posted`.
    pub not_posted: u32,
    /// Rows skipped as "Yes, duplicate" in review.
    pub review_skipped: u32,
    pub file_balance_check: FileBalanceCheck,
    /// Why categorizing the new rows didn't start; `None` when it started or wasn't due.
    pub categorize_notice: Option<String>,
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
    pub ledger_balance_cents: Option<Cents>,
    /// "YYYY-MM-DD".
    pub balance_as_of: Option<String>,
    #[ts(type = "number | null")]
    pub expected_balance_cents: Option<Cents>,
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

/// A parsed OFX or CSV bank statement (Rust only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedStatement {
    /// `CURDEF`.
    pub currency: String,
    pub ledger_balance_cents: Option<Cents>,
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
    pub amount_cents: Cents,
    /// `NAME`, else `PAYEE/NAME`, else `MEMO`, else "".
    pub description: String,
    pub memo: Option<String>,
    /// `TRNTYPE`.
    pub transaction_type: Option<String>,
    /// CSV running balance; `None` for OFX/QFX.
    pub running_balance_cents: Option<Cents>,
    /// CSV bank category; `None` for OFX/QFX.
    pub bank_category: Option<String>,
    /// The full `<STMTTRN>...</STMTTRN>` block text, or the CSV record's source line.
    pub original: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AppError;

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
                expected_balance_cents: Some(Cents::new(-150)),
                not_posted: 1,
                review_skipped: 2,
                file_balance_check: FileBalanceCheck::Passed,
                categorize_notice: None,
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
                "fileBalanceCheck": "passed",
                "categorizeNotice": null
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
                ledger_balance_cents: Some(Cents::new(123_456)),
                balance_as_of: Some("2026-10-31".into()),
                expected_balance_cents: Some(Cents::new(123_400)),
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
            amount_cents: Cents::new(-4500),
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
}
