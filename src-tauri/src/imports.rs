//! OFX/QFX/CSV import into `imports` and `raw_transactions` (preview, review, commit), import
//! history and revert.

use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::{MutexGuard, PoisonError};

use sqlx::{SqliteExecutor, SqlitePool};

use crate::types::{
    AppError, AppState, BalanceCheck, CommitImportRequest, CsvMapping, CsvMappingNeeded,
    CsvPreviewRow, ImportFormat, ImportRecord, ImportReview, ImportStep, ImportSummary,
    ParsedStatement, ParsedTransaction, PendingImport, PendingStep, RevertImportRequest, ReviewRow,
    SaveCsvLayoutRequest, SuspectedDuplicate,
};
use crate::{backup, csv_import, csv_layouts, nicknames, ofx, security};

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// Data rows shown while mapping a CSV.
const PREVIEW_ROWS: usize = 5;

fn pending(state: &AppState) -> MutexGuard<'_, Option<PendingImport>> {
    state
        .pending_import
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn nothing_pending() -> AppError {
    AppError::NotFound("There is no import waiting. Choose the file again.".into())
}

/// The pending CSV's file name and text, while it waits for a mapping.
fn mapping_file(pending: &Option<PendingImport>) -> Result<(&str, &str), AppError> {
    match pending {
        Some(PendingImport {
            file_name,
            step: PendingStep::Mapping { text },
            ..
        }) => Ok((file_name, text)),
        _ => Err(nothing_pending()),
    }
}

/// Reads and parses the file at `path`, then previews it. A CSV with an unknown header waits for a mapping.
pub async fn import_path(state: &AppState, path: &Path) -> Result<ImportStep, AppError> {
    let pool = &security::pool(state)?;
    *pending(state) = None;
    let format = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("ofx") => ImportFormat::Ofx,
        Some("qfx") => ImportFormat::Qfx,
        Some("csv") => ImportFormat::Csv,
        _ => {
            return Err(AppError::Import(
                "Zeni imports .ofx, .qfx and .csv files only.".into(),
            ));
        }
    };
    // Reads at most one byte past the limit, so a huge file is never loaded.
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|error| AppError::Import(format!("Couldn't read the file: {error}")))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(AppError::Import("This file is larger than 10 MiB.".into()));
    }
    // Not UTF-8: mapping each byte to a char decodes the file as Latin-1.
    let text = String::from_utf8(bytes)
        .unwrap_or_else(|error| error.into_bytes().into_iter().map(char::from).collect());
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if format != ImportFormat::Csv {
        let statement = ofx::parse(&text)?;
        return import_or_review(state, file_name, format, None, statement).await;
    }
    let headers = csv_import::read_header(&text)?;
    if let Some(layout) = csv_layouts::find(pool, &csv_import::fingerprint(&headers)).await? {
        let statement = csv_import::parse(&text, &layout.mapping).map_err(|error| match error {
            AppError::Import(message) => AppError::Import(format!(
                "{message} If the saved layout is wrong, edit it in Settings > CSV layouts."
            )),
            other => other,
        })?;
        return import_or_review(state, file_name, format, Some(layout.id), statement).await;
    }
    // Fails before the mapping dialog, so no layout is saved for a file that can't be imported.
    checking_account(pool).await?;
    let rows = csv_import::sample_rows(&text, PREVIEW_ROWS)?;
    *pending(state) = Some(PendingImport {
        file_name: file_name.clone(),
        step: PendingStep::Mapping { text },
    });
    Ok(ImportStep::NeedsMapping(CsvMappingNeeded {
        file_name,
        headers,
        rows,
    }))
}

/// The pending CSV's first rows parsed with a draft mapping.
pub fn preview_csv_mapping(
    state: &AppState,
    mapping: CsvMapping,
) -> Result<Vec<CsvPreviewRow>, AppError> {
    let pending = pending(state);
    let (_, text) = mapping_file(&pending)?;
    csv_layouts::validate_mapping(csv_import::read_header(text)?.len(), &mapping)?;
    csv_import::preview(text, &mapping, PREVIEW_ROWS)
}

/// Parses the whole pending CSV with the mapping, saves the layout and previews the file.
/// A file rejection saves nothing and keeps the file pending, so the mapping can be fixed.
pub async fn save_csv_layout(
    state: &AppState,
    request: SaveCsvLayoutRequest,
) -> Result<ImportStep, AppError> {
    let pool = &security::pool(state)?;
    let (file_name, fingerprint, statement) = {
        let pending = pending(state);
        let (file_name, text) = mapping_file(&pending)?;
        let headers = csv_import::read_header(text)?;
        csv_layouts::validate_mapping(headers.len(), &request.mapping)?;
        let statement = csv_import::parse(text, &request.mapping)?;
        (
            file_name.to_owned(),
            csv_import::fingerprint(&headers),
            statement,
        )
    };
    let layout = csv_layouts::insert(pool, &request.name, &fingerprint, &request.mapping).await?;
    import_or_review(
        state,
        file_name,
        ImportFormat::Csv,
        Some(layout.id),
        statement,
    )
    .await
}

/// Stores the file under review, without the rows answered "Yes, duplicate".
pub async fn commit_import(
    state: &AppState,
    request: CommitImportRequest,
) -> Result<ImportSummary, AppError> {
    let pool = &security::pool(state)?;
    let taken = {
        let mut pending = pending(state);
        let Some(PendingImport {
            step: PendingStep::Review { suspect_rows, .. },
            ..
        }) = pending.as_ref()
        else {
            *pending = None;
            return Err(nothing_pending());
        };
        // A rejected list keeps the review pending, so it can be answered again.
        let mut seen = HashSet::new();
        for row in &request.skip_rows {
            if !suspect_rows.contains(row) {
                return Err(AppError::Validation(format!(
                    "Row {row} isn't a suspected duplicate in this review."
                )));
            }
            if !seen.insert(row) {
                return Err(AppError::Validation(format!(
                    "Row {row} is listed more than once."
                )));
            }
        }
        pending.take()
    };
    let Some(PendingImport {
        file_name,
        step:
            PendingStep::Review {
                format,
                csv_layout_id,
                statement,
                ..
            },
    }) = taken
    else {
        return Err(nothing_pending());
    };
    import_statement(
        pool,
        &file_name,
        format,
        csv_layout_id,
        &statement,
        &request.skip_rows,
    )
    .await
}

/// Drops the pending import; nothing is stored.
pub fn cancel_import(state: &AppState) {
    *pending(state) = None;
}

/// Finds suspected cross-format duplicates. None: imports straight away; some: holds the file for review.
async fn import_or_review(
    state: &AppState,
    file_name: String,
    format: ImportFormat,
    csv_layout_id: Option<i64>,
    statement: ParsedStatement,
) -> Result<ImportStep, AppError> {
    *pending(state) = None;
    let pool = &security::pool(state)?;
    if !statement.currency.eq_ignore_ascii_case("USD") {
        return Err(AppError::Import(format!(
            "Zeni only imports US dollar statements; this file is in {}.",
            statement.currency
        )));
    }
    let account_id = checking_account(pool).await?;
    let pairs = suspects(pool, account_id, format, &statement).await?;
    if pairs.is_empty() {
        let summary =
            import_statement(pool, &file_name, format, csv_layout_id, &statement, &[]).await?;
        return Ok(ImportStep::Imported(summary));
    }
    let review = ImportReview {
        file_name: file_name.clone(),
        format,
        pairs,
    };
    let suspect_rows = review.pairs.iter().map(|pair| pair.row_index).collect();
    *pending(state) = Some(PendingImport {
        file_name,
        step: PendingStep::Review {
            format,
            csv_layout_id,
            statement,
            suspect_rows,
        },
    });
    Ok(ImportStep::Review(review))
}

/// The checking account every import goes into.
async fn checking_account(executor: impl SqliteExecutor<'_>) -> Result<i64, AppError> {
    let (account_id,): (Option<i64>,) = sqlx::query_as("SELECT MIN(id) FROM accounts")
        .fetch_one(executor)
        .await?;
    account_id.ok_or_else(|| AppError::NotFound("Add a checking account before importing.".into()))
}

/// V3 exact dedupe against stored rows: the same FITID for the account, or, without one, the same
/// date + amount + description in an import other than `import_id`.
async fn is_stored(
    executor: impl SqliteExecutor<'_>,
    account_id: i64,
    import_id: i64,
    row: &ParsedTransaction,
) -> Result<bool, AppError> {
    let query = match &row.fitid {
        Some(fitid) => {
            sqlx::query("SELECT 1 FROM raw_transactions WHERE account_id = ? AND fitid = ?")
                .bind(account_id)
                .bind(fitid)
        }
        None => sqlx::query(
            "SELECT 1 FROM raw_transactions WHERE account_id = ? AND import_id <> ? \
             AND posted_date = ? AND amount_cents = ? AND raw_description = ?",
        )
        .bind(account_id)
        .bind(import_id)
        .bind(&row.posted_date)
        .bind(row.amount_cents)
        .bind(&row.description),
    };
    Ok(query.fetch_optional(executor).await?.is_some())
}

/// R8: for each row that passes exact dedupe, the closest stored row (then lowest id) from the other
/// format family with the same amount, posted within 2 days.
async fn suspects(
    pool: &SqlitePool,
    account_id: i64,
    format: ImportFormat,
    statement: &ParsedStatement,
) -> Result<Vec<SuspectedDuplicate>, AppError> {
    let mut fitids = HashSet::new();
    let mut pairs = Vec::new();
    for (row_index, row) in (0u32..).zip(&statement.transactions) {
        let repeated_in_file = row
            .fitid
            .as_ref()
            .is_some_and(|fitid| !fitids.insert(fitid));
        // No import exists yet, so 0 matches no stored row's import.
        if repeated_in_file || is_stored(pool, account_id, 0, row).await? {
            continue;
        }
        let existing: Option<(String, i64, String, String, ImportFormat)> = sqlx::query_as(
            "SELECT r.posted_date, r.amount_cents, r.raw_description, i.file_name, i.format \
             FROM raw_transactions r JOIN imports i ON i.id = r.import_id \
             WHERE r.account_id = ? AND r.amount_cents = ? AND (i.format = 'csv') = ? \
             AND abs(julianday(r.posted_date) - julianday(?)) <= 2 \
             ORDER BY abs(julianday(r.posted_date) - julianday(?)), r.id LIMIT 1",
        )
        .bind(account_id)
        .bind(row.amount_cents)
        .bind(format != ImportFormat::Csv)
        .bind(&row.posted_date)
        .bind(&row.posted_date)
        .fetch_optional(pool)
        .await?;
        if let Some((posted_date, amount_cents, description, existing_file_name, existing_format)) =
            existing
        {
            pairs.push(SuspectedDuplicate {
                row_index,
                new_row: ReviewRow {
                    posted_date: row.posted_date.clone(),
                    amount_cents: row.amount_cents,
                    description: row.description.clone(),
                },
                existing: ReviewRow {
                    posted_date,
                    amount_cents,
                    description,
                },
                existing_file_name,
                existing_format,
            });
        }
    }
    Ok(pairs)
}

/// Stores a parsed statement, skipping `skip_rows` and duplicates, and runs the balance check.
async fn import_statement(
    pool: &SqlitePool,
    file_name: &str,
    format: ImportFormat,
    csv_layout_id: Option<i64>,
    statement: &ParsedStatement,
    skip_rows: &[u32],
) -> Result<ImportSummary, AppError> {
    let mut tx = pool.begin().await?;
    let account_id = checking_account(&mut *tx).await?;
    let import_id = sqlx::query(
        "INSERT INTO imports (account_id, file_name, format, ledger_balance_cents, balance_as_of, balance_check, \
         csv_layout_id, file_balance_check) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(account_id)
    .bind(file_name)
    .bind(format)
    .bind(statement.ledger_balance_cents)
    .bind(&statement.balance_as_of)
    .bind(BalanceCheck::NotChecked)
    .bind(csv_layout_id)
    .bind(statement.file_balance_check)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();
    let skip_rows: HashSet<u32> = skip_rows.iter().copied().collect();
    let (mut added, mut duplicates, mut review_skipped) = (0, 0, 0);
    for (row_index, row) in (0u32..).zip(&statement.transactions) {
        if skip_rows.contains(&row_index) {
            review_skipped += 1;
            continue;
        }
        // Without a FITID, only rows from earlier imports count, so two equal rows in one file both stay.
        let duplicate_without_fitid =
            row.fitid.is_none() && is_stored(&mut *tx, account_id, import_id, row).await?;
        let inserted = !duplicate_without_fitid
            && sqlx::query(
                "INSERT INTO raw_transactions (import_id, account_id, fitid, posted_date, amount_cents, \
                 raw_description, memo, transaction_type, running_balance_cents, bank_category, original_row) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT DO NOTHING",
            )
            .bind(import_id)
            .bind(account_id)
            .bind(&row.fitid)
            .bind(&row.posted_date)
            .bind(row.amount_cents)
            .bind(&row.description)
            .bind(&row.memo)
            .bind(&row.transaction_type)
            .bind(row.running_balance_cents)
            .bind(&row.bank_category)
            .bind(&row.original)
            .execute(&mut *tx)
            .await?
            .rows_affected()
                == 1;
        if inserted {
            added += 1;
        } else {
            duplicates += 1;
        }
    }

    let (balance_check, expected_balance_cents) =
        check_balance(&mut tx, account_id, import_id, statement).await?;
    sqlx::query("UPDATE imports SET expected_balance_cents = ?, balance_check = ? WHERE id = ?")
        .bind(expected_balance_cents)
        .bind(balance_check)
        .bind(import_id)
        .execute(&mut *tx)
        .await?;
    nicknames::match_import(&mut tx, import_id).await?;
    tx.commit().await?;

    Ok(ImportSummary {
        import_id,
        file_name: file_name.into(),
        format,
        added,
        duplicates,
        balance_check,
        ledger_balance_cents: statement.ledger_balance_cents,
        expected_balance_cents,
        not_posted: statement.not_posted,
        review_skipped,
        file_balance_check: statement.file_balance_check,
        categorize_notice: None,
    })
}

/// Compares the file's ledger balance with the prior import's balance (as of the same day or
/// earlier) plus the rows dated after its as-of date, up to and including this file's as-of date.
async fn check_balance(
    tx: &mut sqlx::SqliteConnection,
    account_id: i64,
    import_id: i64,
    statement: &ParsedStatement,
) -> Result<(BalanceCheck, Option<i64>), AppError> {
    let (Some(ledger), Some(as_of)) = (statement.ledger_balance_cents, &statement.balance_as_of)
    else {
        return Ok((BalanceCheck::NotChecked, None));
    };
    let previous: Option<(i64, String)> = sqlx::query_as(
        "SELECT ledger_balance_cents, balance_as_of FROM imports WHERE account_id = ? AND id <> ? \
         AND ledger_balance_cents IS NOT NULL AND balance_as_of <= ? \
         ORDER BY balance_as_of DESC, id DESC LIMIT 1",
    )
    .bind(account_id)
    .bind(import_id)
    .bind(as_of)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((previous_ledger, previous_as_of)) = previous else {
        return Ok((BalanceCheck::Baseline, None));
    };
    let (change,): (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM raw_transactions \
         WHERE account_id = ? AND posted_date > ? AND posted_date <= ?",
    )
    .bind(account_id)
    .bind(&previous_as_of)
    .bind(as_of)
    .fetch_one(&mut *tx)
    .await?;
    let expected = previous_ledger
        .checked_add(change)
        .ok_or_else(|| AppError::Import("The statement amounts are too large.".into()))?;
    let check = if expected == ledger {
        BalanceCheck::Passed
    } else {
        BalanceCheck::Mismatch
    };
    Ok((check, Some(expected)))
}

/// Every import, newest first.
pub async fn list(state: &AppState) -> Result<Vec<ImportRecord>, AppError> {
    Ok(sqlx::query_as(
        "SELECT id, file_name, format, imported_at, account_id, \
         (SELECT COUNT(*) FROM raw_transactions r WHERE r.import_id = imports.id) AS row_count, \
         ledger_balance_cents, balance_as_of, expected_balance_cents, balance_check, file_balance_check \
         FROM imports ORDER BY id DESC",
    )
    .fetch_all(&security::pool(state)?)
    .await?)
}

/// Takes a pre-revert backup, then deletes one import and its raw rows in one transaction.
pub async fn revert(state: &AppState, request: RevertImportRequest) -> Result<(), AppError> {
    backup::before_revert(state).await?;
    let mut tx = security::pool(state)?.begin().await?;
    sqlx::query("DELETE FROM raw_transactions WHERE import_id = ?")
        .bind(request.import_id)
        .execute(&mut *tx)
        .await?;
    let deleted = sqlx::query("DELETE FROM imports WHERE id = ?")
        .bind(request.import_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(AppError::NotFound("That import no longer exists.".into()));
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::db;
    use crate::types::{FileBalanceCheck, ParsedTransaction};

    fn row(
        fitid: Option<&str>,
        date: &str,
        amount_cents: i64,
        description: &str,
    ) -> ParsedTransaction {
        ParsedTransaction {
            fitid: fitid.map(Into::into),
            posted_date: date.into(),
            amount_cents,
            description: description.into(),
            memo: None,
            transaction_type: None,
            running_balance_cents: None,
            bank_category: None,
            original: "<STMTTRN></STMTTRN>".into(),
        }
    }

    fn statement(
        ledger: Option<(i64, &str)>,
        transactions: Vec<ParsedTransaction>,
    ) -> ParsedStatement {
        ParsedStatement {
            currency: "USD".into(),
            ledger_balance_cents: ledger.map(|(cents, _)| cents),
            balance_as_of: ledger.map(|(_, date)| date.into()),
            transactions,
            not_posted: 0,
            file_balance_check: FileBalanceCheck::NotChecked,
        }
    }

    /// A fresh database, with one account unless `with_account` is false.
    fn state(name: &str, with_account: bool) -> (PathBuf, AppState) {
        let dir = db::temp_dir(name);
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: std::sync::RwLock::new(tauri::async_runtime::block_on(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        if with_account {
            tauri::async_runtime::block_on(
                sqlx::query(
                    "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
                     VALUES ('Checking', 'Sam', 'Bank', x'00', x'00')",
                )
                .execute(&security::pool(&state).unwrap()),
            )
            .unwrap();
        }
        (dir, state)
    }

    /// Previews `statement` as an OFX file named "a.ofx".
    async fn try_import(
        state: &AppState,
        statement: &ParsedStatement,
    ) -> Result<ImportStep, AppError> {
        import_or_review(
            state,
            "a.ofx".into(),
            ImportFormat::Ofx,
            None,
            statement.clone(),
        )
        .await
    }

    async fn import(state: &AppState, statement: &ParsedStatement) -> ImportSummary {
        match try_import(state, statement).await.unwrap() {
            ImportStep::Imported(summary) => summary,
            other => panic!("expected Imported, got {other:?}"),
        }
    }

    fn counts(summary: &ImportSummary) -> (u32, u32) {
        (summary.added, summary.duplicates)
    }

    #[test]
    fn duplicates_by_fitid_are_skipped_across_and_within_imports() {
        let (dir, state) = state("imports-fitid", true);
        tauri::async_runtime::block_on(async {
            let first = statement(
                None,
                vec![
                    row(Some("F1"), "2026-10-01", -500, "COFFEE"),
                    row(Some("F2"), "2026-10-02", -700, "LUNCH"),
                    row(Some("F1"), "2026-10-01", -500, "COFFEE"),
                ],
            );
            let summary = import(&state, &first).await;
            assert_eq!(counts(&summary), (2, 1));
            assert_eq!(summary.balance_check, BalanceCheck::NotChecked);

            let second = statement(
                None,
                vec![
                    // Same FITID with other details is still the same transaction.
                    row(Some("F2"), "2026-10-03", -1, "OTHER"),
                    row(Some("F3"), "2026-10-04", 2500, "REFUND"),
                ],
            );
            assert_eq!(counts(&import(&state, &second).await), (1, 1));
            // A fully duplicate file is still recorded.
            assert_eq!(counts(&import(&state, &second).await), (0, 2));

            let records = list(&state).await.unwrap();
            let rows: Vec<_> = records.iter().map(|r| (r.id, r.row_count)).collect();
            assert_eq!(rows, [(3, 0), (2, 1), (1, 2)]);
            assert_eq!(records[0].file_name, "a.ofx");
            assert_eq!(records[0].format, ImportFormat::Ofx);
            assert_eq!(records[0].imported_at.len(), 19);
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rows_without_fitid_dedupe_on_date_amount_and_description() {
        let (dir, state) = state("imports-no-fitid", true);
        tauri::async_runtime::block_on(async {
            let coffee = || row(None, "2026-10-01", -500, "COFFEE");
            // Two equal coffees in one file are two real purchases.
            let first = statement(None, vec![coffee(), coffee()]);
            assert_eq!(counts(&import(&state, &first).await), (2, 0));
            let second = statement(
                None,
                vec![
                    coffee(),
                    row(None, "2026-10-01", -501, "COFFEE"),
                    row(None, "2026-10-02", -500, "COFFEE"),
                    row(None, "2026-10-01", -500, "TEA"),
                ],
            );
            assert_eq!(counts(&import(&state, &second).await), (3, 1));
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn balance_check_compares_with_the_prior_ledger_balance() {
        let (dir, state) = state("imports-balance", true);
        tauri::async_runtime::block_on(async {
            let baseline = import(&state, &statement(Some((100_000, "2026-10-01")), vec![])).await;
            assert_eq!(baseline.balance_check, BalanceCheck::Baseline);
            assert_eq!(baseline.expected_balance_cents, None);

            let passed = import(
                &state,
                &statement(
                    Some((70_000, "2026-10-31")),
                    vec![
                        // Dated on the baseline's as-of day, so the baseline already counts it.
                        row(Some("Z"), "2026-10-01", -1_234, "EARLY"),
                        row(Some("A"), "2026-10-05", -40_000, "RENT"),
                        row(Some("B"), "2026-10-31", 10_000, "PAY"),
                    ],
                ),
            )
            .await;
            assert_eq!(passed.balance_check, BalanceCheck::Passed);
            assert_eq!(passed.ledger_balance_cents, Some(70_000));
            assert_eq!(passed.expected_balance_cents, Some(70_000));

            let mismatch = import(
                &state,
                &statement(
                    Some((60_000, "2026-11-30")),
                    vec![row(Some("C"), "2026-11-03", -5_000, "GAS")],
                ),
            )
            .await;
            assert_eq!(mismatch.balance_check, BalanceCheck::Mismatch);
            assert_eq!(mismatch.expected_balance_cents, Some(65_000));

            let unchecked = import(&state, &statement(None, vec![])).await;
            assert_eq!(unchecked.balance_check, BalanceCheck::NotChecked);

            let records = list(&state).await.unwrap();
            let stored: Vec<_> = records
                .iter()
                .map(|r| {
                    (
                        r.balance_check,
                        r.ledger_balance_cents,
                        r.expected_balance_cents,
                    )
                })
                .collect();
            assert_eq!(
                stored,
                [
                    (BalanceCheck::NotChecked, None, None),
                    (BalanceCheck::Mismatch, Some(60_000), Some(65_000)),
                    (BalanceCheck::Passed, Some(70_000), Some(70_000)),
                    (BalanceCheck::Baseline, Some(100_000), None),
                ]
            );
            assert_eq!(records[1].balance_as_of.as_deref(), Some("2026-11-30"));
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn same_as_of_date_compares_with_the_earlier_import() {
        let (dir, state) = state("imports-same-as-of", true);
        tauri::async_runtime::block_on(async {
            let rows = || vec![row(Some("A"), "2026-10-01", -500, "COFFEE")];
            let first = import(&state, &statement(Some((100_000, "2026-10-01")), rows())).await;
            assert_eq!(first.balance_check, BalanceCheck::Baseline);

            let again = import(&state, &statement(Some((100_000, "2026-10-01")), rows())).await;
            assert_eq!(again.balance_check, BalanceCheck::Passed);
            assert_eq!(again.expected_balance_cents, Some(100_000));

            let other = import(&state, &statement(Some((100_700, "2026-10-01")), vec![])).await;
            assert_eq!(other.balance_check, BalanceCheck::Mismatch);
            assert_eq!(other.ledger_balance_cents, Some(100_700));
            assert_eq!(other.expected_balance_cents, Some(100_000));
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn revert_removes_exactly_one_import_and_its_rows() {
        let (dir, state) = state("imports-revert", true);
        tauri::async_runtime::block_on(async {
            let first = import(
                &state,
                &statement(None, vec![row(Some("A"), "2026-10-01", 1, "X")]),
            )
            .await;
            let second = import(
                &state,
                &statement(None, vec![row(Some("B"), "2026-10-02", 2, "Y")]),
            )
            .await;
            revert(
                &state,
                RevertImportRequest {
                    import_id: first.import_id,
                },
            )
            .await
            .unwrap();
            let backups: Vec<_> = std::fs::read_dir(dir.join("backups"))
                .unwrap()
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .collect();
            assert_eq!(backups.len(), 1);
            assert!(backups[0].ends_with("-pre-revert.db"), "{backups:?}");
            let records = list(&state).await.unwrap();
            assert_eq!(records.len(), 1);
            assert_eq!((records[0].id, records[0].row_count), (second.import_id, 1));
            let (rows,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM raw_transactions")
                .fetch_one(&security::pool(&state).unwrap())
                .await
                .unwrap();
            assert_eq!(rows, 1);
            // Reverting makes the rows importable again.
            let again = import(
                &state,
                &statement(None, vec![row(Some("A"), "2026-10-01", 1, "X")]),
            )
            .await;
            assert_eq!(counts(&again), (1, 0));

            for id in [first.import_id, 999] {
                let error = revert(&state, RevertImportRequest { import_id: id }).await;
                assert!(matches!(error, Err(AppError::NotFound(_))));
            }
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// V5: commit fills the nickname lookup for its new rows; duplicates add none; revert cascades.
    #[test]
    fn nickname_matches_follow_commit_and_revert() {
        use crate::types::{MatchField, MatchMode, RuleInput, SaveNicknameRuleRequest};
        let (dir, state) = state("imports-nicknames", true);
        tauri::async_runtime::block_on(async {
            let pool = security::pool(&state).unwrap();
            let lookup = || async {
                let rows: Vec<(i64,)> =
                    sqlx::query_as("SELECT raw_transaction_id FROM nickname_matches ORDER BY 1")
                        .fetch_all(&pool)
                        .await
                        .unwrap();
                rows.into_iter().map(|(id,)| id).collect::<Vec<_>>()
            };
            nicknames::save_rule(
                &state,
                SaveNicknameRuleRequest {
                    name: "Coffee".into(),
                    rule: RuleInput {
                        mode: MatchMode::Contains,
                        field: MatchField::Description,
                        pattern: "coffee".into(),
                    },
                    default_category_id: None,
                },
            )
            .await
            .unwrap();
            let coffee = || nicknames::list(&state);
            let first = statement(
                None,
                vec![
                    row(Some("A"), "2026-10-01", -1, "COFFEE ONE"),
                    row(Some("B"), "2026-10-02", -1, "TEA"),
                ],
            );
            let first = import(&state, &first).await;
            assert_eq!(lookup().await, [1]);
            let second = statement(None, vec![row(Some("C"), "2026-10-05", -1, "coffee two")]);
            import(&state, &second).await;
            assert_eq!(lookup().await, [1, 3]);
            let n = &coffee().await.unwrap()[0];
            assert_eq!(
                (n.match_count, n.last_matched.as_deref()),
                (2, Some("2026-10-05"))
            );

            // An all-duplicate re-import adds no rows and no lookup rows.
            assert_eq!(counts(&import(&state, &second).await), (0, 1));
            assert_eq!(lookup().await, [1, 3]);

            // Revert cascades; count and last matched fall back to what remains.
            revert(&state, RevertImportRequest { import_id: 2 })
                .await
                .unwrap();
            assert_eq!(lookup().await, [1]);
            let n = &coffee().await.unwrap()[0];
            assert_eq!(
                (n.match_count, n.last_matched.as_deref()),
                (1, Some("2026-10-01"))
            );
            revert(
                &state,
                RevertImportRequest {
                    import_id: first.import_id,
                },
            )
            .await
            .unwrap();
            assert!(lookup().await.is_empty());
            let n = &coffee().await.unwrap()[0];
            assert_eq!((n.match_count, n.last_matched.as_deref()), (0, None));
            assert!(n.stale);
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_pre_revert_backup_reverts_nothing() {
        let (dir, state) = state("imports-revert-no-backup", true);
        tauri::async_runtime::block_on(async {
            let summary = import(
                &state,
                &statement(None, vec![row(Some("A"), "2026-10-01", 1, "X")]),
            )
            .await;
            let unplugged = dir.join("unplugged");
            sqlx::query("INSERT INTO app_meta (key, value) VALUES ('backup_folder', ?)")
                .bind(unplugged.to_str().unwrap())
                .execute(&security::pool(&state).unwrap())
                .await
                .unwrap();
            let request = RevertImportRequest {
                import_id: summary.import_id,
            };
            match revert(&state, request).await {
                Err(AppError::Backup(message)) => assert!(
                    message.starts_with(
                        "Couldn't back up before reverting, so nothing was reverted: "
                    ),
                    "{message}"
                ),
                other => panic!("expected a Backup error, got {other:?}"),
            }
            assert_eq!(list(&state).await.unwrap().len(), 1);
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_needs_an_account_and_us_dollars() {
        let (dir, state) = state("imports-rejects", false);
        tauri::async_runtime::block_on(async {
            let pool = &security::pool(&state).unwrap();
            let usd = statement(None, vec![row(Some("A"), "2026-10-01", 1, "X")]);
            let error = try_import(&state, &usd).await;
            assert!(matches!(error, Err(AppError::NotFound(_))));

            sqlx::query(
                "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
                 VALUES ('Checking', 'Sam', 'Bank', x'00', x'00')",
            )
            .execute(pool)
            .await
            .unwrap();
            let euro = ParsedStatement {
                currency: "EUR".into(),
                ..usd
            };
            match try_import(&state, &euro).await {
                Err(AppError::Import(message)) => assert_eq!(
                    message,
                    "Zeni only imports US dollar statements; this file is in EUR."
                ),
                other => panic!("expected an import error, got {other:?}"),
            }
            assert!(list(&state).await.unwrap().is_empty());
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_path_checks_extension_size_and_readability() {
        let (dir, state) = state("imports-path", true);
        tauri::async_runtime::block_on(async {
            let message = |result: Result<ImportStep, AppError>| match result {
                Err(AppError::Import(message)) => message,
                other => panic!("expected an import error, got {other:?}"),
            };
            for name in ["a.txt", "a", "a.ofx.txt", "a.csv.xls"] {
                let path = dir.join(name);
                std::fs::write(&path, "OFXHEADER:100").unwrap();
                assert_eq!(
                    message(import_path(&state, &path).await),
                    "Zeni imports .ofx, .qfx and .csv files only."
                );
            }
            // An upper-case extension passes, so the size check is what rejects it.
            let big = dir.join("big.QFX");
            std::fs::write(&big, vec![b' '; MAX_FILE_BYTES as usize + 1]).unwrap();
            assert_eq!(
                message(import_path(&state, &big).await),
                "This file is larger than 10 MiB."
            );
            assert!(
                message(import_path(&state, &dir.join("missing.ofx")).await)
                    .starts_with("Couldn't read the file")
            );
            assert!(list(&state).await.unwrap().is_empty());
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_path_decodes_non_utf8_files_as_latin1() {
        let (dir, state) = state("imports-latin1", true);
        tauri::async_runtime::block_on(async {
            let fixture = std::fs::read(
                Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/checking-no-fitid.ofx"),
            )
            .unwrap();
            let text = String::from_utf8(fixture).unwrap();
            let mut bytes = text.replace("BOOK NOOK", "CAF\u{1}").into_bytes();
            // Byte 0xE9 alone is invalid UTF-8; in Latin-1 it is "é".
            *bytes.iter_mut().find(|byte| **byte == 1).unwrap() = 0xE9;
            let path = dir.join("latin1.ofx");
            std::fs::write(&path, bytes).unwrap();
            import_path(&state, &path).await.unwrap();
            let (description,): (String,) = sqlx::query_as(
                "SELECT raw_description FROM raw_transactions WHERE amount_cents = -1999",
            )
            .fetch_one(&security::pool(&state).unwrap())
            .await
            .unwrap();
            assert_eq!(description, "CAF\u{e9}");
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn balance_overflow_is_an_import_error_and_stores_nothing() {
        let (dir, state) = state("imports-overflow", true);
        tauri::async_runtime::block_on(async {
            import(&state, &statement(Some((i64::MAX, "2026-10-01")), vec![])).await;
            let next = statement(
                Some((0, "2026-10-31")),
                vec![row(Some("A"), "2026-10-05", 1, "PAY")],
            );
            match try_import(&state, &next).await {
                Err(AppError::Import(message)) => {
                    assert_eq!(message, "The statement amounts are too large.")
                }
                other => panic!("expected an import error, got {other:?}"),
            }
            assert_eq!(list(&state).await.unwrap().len(), 1);
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reports_a_missing_database() {
        let state = AppState {
            db: std::sync::RwLock::new(Err("no database".into())),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        tauri::async_runtime::block_on(async {
            assert!(matches!(list(&state).await, Err(AppError::Database(_))));
            let request = RevertImportRequest { import_id: 1 };
            assert!(matches!(
                revert(&state, request).await,
                Err(AppError::Database(_))
            ));
            let path = Path::new("missing.ofx");
            assert!(matches!(
                import_path(&state, path).await,
                Err(AppError::Database(_))
            ));
            let commit = CommitImportRequest { skip_rows: vec![] };
            assert!(matches!(
                commit_import(&state, commit).await,
                Err(AppError::Database(_))
            ));
            let save = SaveCsvLayoutRequest {
                name: "Bank".into(),
                mapping: CsvMapping {
                    date_format: crate::types::DateFormat::YyyyMmDd,
                    posted_date: 0,
                    description: 1,
                    amount: crate::types::AmountColumns::Signed { column: 2 },
                    transaction_id: None,
                    memo: None,
                    transaction_type: None,
                    running_balance: None,
                    posting_status: None,
                    bank_category: None,
                },
            };
            assert!(matches!(
                save_csv_layout(&state, save).await,
                Err(AppError::Database(_))
            ));
        });
    }

    /// The suspected pairs' (row index, existing description) for a new file of `format`, without storing it.
    async fn suspected(
        state: &AppState,
        format: ImportFormat,
        transactions: Vec<ParsedTransaction>,
    ) -> Vec<(u32, String)> {
        let pool = &security::pool(state).unwrap();
        suspects(pool, 1, format, &statement(None, transactions))
            .await
            .unwrap()
            .into_iter()
            .map(|pair| (pair.row_index, pair.existing.description))
            .collect()
    }

    async fn store(state: &AppState, format: ImportFormat, transactions: Vec<ParsedTransaction>) {
        let pool = &security::pool(state).unwrap();
        import_statement(
            pool,
            "old",
            format,
            None,
            &statement(None, transactions),
            &[],
        )
        .await
        .unwrap();
    }

    /// R8's worked examples: other format family, same amount, within 2 days, closest then lowest id.
    #[test]
    fn suspects_follow_the_cross_format_rule() {
        let (dir, state) = state("imports-suspects", true);
        tauri::async_runtime::block_on(async {
            use ImportFormat::*;
            store(
                &state,
                Ofx,
                vec![row(Some("O1"), "2026-10-03", -4500, "GYM")],
            )
            .await;
            let csv = |date, amount| row(None, date, amount, "Gym");
            assert_eq!(
                suspected(&state, Csv, vec![csv("2026-10-05", -4500)]).await,
                [(0, "GYM".to_string())]
            );
            assert!(
                suspected(&state, Csv, vec![csv("2026-10-06", -4500)])
                    .await
                    .is_empty()
            );
            assert!(
                suspected(&state, Csv, vec![csv("2026-10-05", -4501)])
                    .await
                    .is_empty()
            );
            // OFX and QFX are one family: exact dedupe only.
            assert!(
                suspected(
                    &state,
                    Qfx,
                    vec![row(Some("Q1"), "2026-10-03", -4500, "GYM")]
                )
                .await
                .is_empty()
            );

            // Closest date wins, then the lowest id; a row repeating a FITID in the file is a duplicate.
            store(
                &state,
                Qfx,
                vec![row(Some("O2"), "2026-10-04", -4500, "FIRST")],
            )
            .await;
            store(
                &state,
                Ofx,
                vec![row(Some("O3"), "2026-10-04", -4500, "SECOND")],
            )
            .await;
            let pairs = suspected(
                &state,
                Csv,
                vec![
                    row(Some("C1"), "2026-10-05", -4500, "Gym"),
                    row(Some("C1"), "2026-10-05", -4500, "Gym"),
                    row(Some("C2"), "2026-10-02", -4500, "Gym"),
                    // Exact duplicates of a stored row are never suspects.
                    row(Some("O1"), "2026-10-03", -4500, "GYM"),
                ],
            )
            .await;
            assert_eq!(pairs, [(0, "FIRST".to_string()), (2, "GYM".to_string())]);

            // The other way round: a stored CSV row makes a new OFX row a suspect.
            store(&state, Csv, vec![csv("2026-11-01", -999)]).await;
            assert_eq!(
                suspected(&state, Ofx, vec![row(Some("O4"), "2026-11-01", -999, "X")]).await,
                [(0, "Gym".to_string())]
            );
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Without an account a new CSV header fails before the mapping dialog, so no layout is saved.
    #[test]
    fn csv_without_an_account_fails_before_mapping() {
        let (dir, state) = state("imports-csv-no-account", false);
        tauri::async_runtime::block_on(async {
            let csv = dir.join("simple.csv");
            std::fs::write(&csv, "Date,Description,Amount\n2026-10-01,Coffee,-5.00\n").unwrap();
            assert!(matches!(
                import_path(&state, &csv).await,
                Err(AppError::NotFound(_))
            ));
            assert!(pending(&state).is_none());
            let (layouts,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM csv_layouts")
                .fetch_one(&security::pool(&state).unwrap())
                .await
                .unwrap();
            assert_eq!(layouts, 0);
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn pending_steps_without_a_pending_import_are_not_found() {
        let (dir, state) = state("imports-pending", true);
        tauri::async_runtime::block_on(async {
            let message = |error: AppError| match error {
                AppError::NotFound(message) => message,
                other => panic!("expected NotFound, got {other:?}"),
            };
            let expected = "There is no import waiting. Choose the file again.";
            let mapping = || CsvMapping {
                date_format: crate::types::DateFormat::YyyyMmDd,
                posted_date: 0,
                description: 1,
                amount: crate::types::AmountColumns::Signed { column: 2 },
                transaction_id: None,
                memo: None,
                transaction_type: None,
                running_balance: None,
                posting_status: None,
                bank_category: None,
            };
            let save = || SaveCsvLayoutRequest {
                name: "Simple".into(),
                mapping: mapping(),
            };
            let commit = || CommitImportRequest { skip_rows: vec![] };
            cancel_import(&state);
            assert_eq!(
                message(preview_csv_mapping(&state, mapping()).unwrap_err()),
                expected
            );
            assert_eq!(
                message(save_csv_layout(&state, save()).await.unwrap_err()),
                expected
            );
            assert_eq!(
                message(commit_import(&state, commit()).await.unwrap_err()),
                expected
            );

            // A CSV waiting for a mapping can't be committed, and committing clears it.
            let csv = dir.join("simple.csv");
            std::fs::write(&csv, "Date,Description,Amount\n2026-10-01,Coffee,-5.00\n").unwrap();
            assert!(matches!(
                import_path(&state, &csv).await.unwrap(),
                ImportStep::NeedsMapping(_)
            ));
            assert_eq!(
                message(commit_import(&state, commit()).await.unwrap_err()),
                expected
            );
            assert!(preview_csv_mapping(&state, mapping()).is_err());

            // A bad mapping is a validation error and keeps the file pending.
            import_path(&state, &csv).await.unwrap();
            let bad = CsvMapping {
                description: 0,
                ..mapping()
            };
            assert!(matches!(
                preview_csv_mapping(&state, bad.clone()),
                Err(AppError::Validation(_))
            ));
            let request = SaveCsvLayoutRequest {
                name: "Simple".into(),
                mapping: bad,
            };
            assert!(matches!(
                save_csv_layout(&state, request).await,
                Err(AppError::Validation(_))
            ));
            assert_eq!(preview_csv_mapping(&state, mapping()).unwrap().len(), 1);

            // A new import replaces the pending one.
            let ofx =
                Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/checking-no-fitid.ofx");
            import_path(&state, &ofx).await.unwrap();
            assert!(preview_csv_mapping(&state, mapping()).is_err());

            // Saving imports the file and clears the slot.
            import_path(&state, &csv).await.unwrap();
            let step = save_csv_layout(&state, save()).await.unwrap();
            assert!(matches!(step, ImportStep::Imported(ref summary) if summary.added == 1));
            assert!(preview_csv_mapping(&state, mapping()).is_err());
            assert_eq!(list(&state).await.unwrap()[0].format, ImportFormat::Csv);
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Migrations 0003/0004: raw rows and imported file values can't be updated, FITIDs are unique per account, and enums are checked.
    #[test]
    fn imports_schema_protects_raw_rows() {
        let dir = db::temp_dir("imports-schema");
        tauri::async_runtime::block_on(async {
            let pool = db::connect(&dir).await.unwrap().pool;
            let run = |sql: &'static str| sqlx::query(sql).execute(&pool);
            run(
                "INSERT INTO accounts (id, name, owner, bank_name, account_number, routing_number) \
                 VALUES (1, 'Checking', 'Sam', 'Bank', x'00', x'00')",
            )
            .await
            .unwrap();
            run(
                "INSERT INTO imports (id, account_id, file_name, format, balance_check) \
                 VALUES (1, 1, 'a.ofx', 'ofx', 'notChecked')",
            )
            .await
            .unwrap();
            assert!(
                run(
                    "INSERT INTO imports (account_id, file_name, format, balance_check) \
                         VALUES (1, 'a.xls', 'xls', 'notChecked')"
                )
                .await
                .is_err()
            );
            assert!(
                run(
                    "INSERT INTO imports (account_id, file_name, format, balance_check) \
                         VALUES (1, 'a.ofx', 'ofx', 'unknown')"
                )
                .await
                .is_err()
            );

            let insert = "INSERT INTO raw_transactions \
                (import_id, account_id, fitid, posted_date, amount_cents, raw_description, original_row) \
                VALUES (1, 1, 'F1', '2026-10-01', -500, 'COFFEE', '<STMTTRN></STMTTRN>')";
            run(insert).await.unwrap();
            assert!(
                run(insert).await.is_err(),
                "duplicate FITID for the account"
            );
            let no_fitid = "INSERT INTO raw_transactions \
                (import_id, account_id, posted_date, amount_cents, raw_description, original_row) \
                VALUES (1, 1, '2026-10-01', -500, 'COFFEE', '')";
            run(no_fitid).await.unwrap();
            run(no_fitid).await.unwrap();

            let error = run("UPDATE raw_transactions SET amount_cents = 0")
                .await
                .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("raw transactions are never modified")
            );
            let (amount,): (i64,) =
                sqlx::query_as("SELECT amount_cents FROM raw_transactions WHERE fitid = 'F1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(amount, -500);
            run("DELETE FROM raw_transactions WHERE import_id = 1")
                .await
                .unwrap();

            let error = run("UPDATE imports SET ledger_balance_cents = 1")
                .await
                .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("imported file data is never modified")
            );
            assert!(run("UPDATE imports SET id = 2").await.is_err());
            // The balance check result is derived, so it may still be written.
            run("UPDATE imports SET expected_balance_cents = 5, balance_check = 'passed'")
                .await
                .unwrap();
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
