//! OFX/QFX import into `imports` and `raw_transactions`, import history and revert.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use sqlx::SqlitePool;

use crate::security;
use crate::types::{
    AppError, AppState, BalanceCheck, ImportFormat, ImportRecord, ImportSummary, ParsedStatement,
    RevertImportRequest,
};

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// Reads, parses and imports the file at `path` into the checking account.
pub async fn import_path(state: &AppState, path: &Path) -> Result<ImportSummary, AppError> {
    let pool = security::pool(state)?;
    let format = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("ofx") => ImportFormat::Ofx,
        Some("qfx") => ImportFormat::Qfx,
        _ => {
            return Err(AppError::Import(
                "Zeni imports .ofx and .qfx files only.".into(),
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
    let statement = crate::ofx::parse(&text)?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    import_statement(pool, &file_name, format, &statement).await
}

/// Imports an already parsed statement, skipping duplicates, and runs the balance check.
async fn import_statement(
    pool: &SqlitePool,
    file_name: &str,
    format: ImportFormat,
    statement: &ParsedStatement,
) -> Result<ImportSummary, AppError> {
    if !statement.currency.eq_ignore_ascii_case("USD") {
        return Err(AppError::Import(format!(
            "Zeni only imports US dollar statements; this file is in {}.",
            statement.currency
        )));
    }
    let mut tx = pool.begin().await?;
    let (account_id,): (Option<i64>,) = sqlx::query_as("SELECT MIN(id) FROM accounts")
        .fetch_one(&mut *tx)
        .await?;
    let account_id = account_id
        .ok_or_else(|| AppError::NotFound("Add a checking account before importing.".into()))?;
    let import_id = sqlx::query(
        "INSERT INTO imports (account_id, file_name, format, ledger_balance_cents, balance_as_of, balance_check) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(account_id)
    .bind(file_name)
    .bind(format)
    .bind(statement.ledger_balance_cents)
    .bind(&statement.balance_as_of)
    .bind(BalanceCheck::NotChecked)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();
    let (mut added, mut duplicates) = (0, 0);
    for row in &statement.transactions {
        // Without a FITID, only rows from earlier imports count, so two equal rows in one file both stay.
        let duplicate_without_fitid = row.fitid.is_none()
            && sqlx::query(
                "SELECT 1 FROM raw_transactions WHERE account_id = ? AND import_id <> ? \
                 AND posted_date = ? AND amount_cents = ? AND raw_description = ?",
            )
            .bind(account_id)
            .bind(import_id)
            .bind(&row.posted_date)
            .bind(row.amount_cents)
            .bind(&row.description)
            .fetch_optional(&mut *tx)
            .await?
            .is_some();
        let inserted = !duplicate_without_fitid
            && sqlx::query(
                "INSERT INTO raw_transactions (import_id, account_id, fitid, posted_date, amount_cents, \
                 raw_description, memo, transaction_type, original_row) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
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
         ledger_balance_cents, balance_as_of, expected_balance_cents, balance_check \
         FROM imports ORDER BY id DESC",
    )
    .fetch_all(security::pool(state)?)
    .await?)
}

/// Deletes one import and its raw rows in one transaction.
pub async fn revert(state: &AppState, request: RevertImportRequest) -> Result<(), AppError> {
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
    use crate::types::ParsedTransaction;

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
        }
    }

    /// A fresh database, with one account unless `with_account` is false.
    fn state(name: &str, with_account: bool) -> (PathBuf, AppState) {
        let dir = db::temp_dir(name);
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: tauri::async_runtime::block_on(db::connect(&dir)),
            session: Default::default(),
        };
        if with_account {
            tauri::async_runtime::block_on(
                sqlx::query(
                    "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
                     VALUES ('Checking', 'Sam', 'Bank', x'00', x'00')",
                )
                .execute(security::pool(&state).unwrap()),
            )
            .unwrap();
        }
        (dir, state)
    }

    async fn import(state: &AppState, statement: &ParsedStatement) -> ImportSummary {
        import_statement(
            security::pool(state).unwrap(),
            "a.ofx",
            ImportFormat::Ofx,
            statement,
        )
        .await
        .unwrap()
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
            let records = list(&state).await.unwrap();
            assert_eq!(records.len(), 1);
            assert_eq!((records[0].id, records[0].row_count), (second.import_id, 1));
            let (rows,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM raw_transactions")
                .fetch_one(security::pool(&state).unwrap())
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

    #[test]
    fn import_needs_an_account_and_us_dollars() {
        let (dir, state) = state("imports-rejects", false);
        tauri::async_runtime::block_on(async {
            let pool = security::pool(&state).unwrap();
            let usd = statement(None, vec![row(Some("A"), "2026-10-01", 1, "X")]);
            let error = import_statement(pool, "a.ofx", ImportFormat::Ofx, &usd).await;
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
            match import_statement(pool, "a.ofx", ImportFormat::Ofx, &euro).await {
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
            let message = |result: Result<ImportSummary, AppError>| match result {
                Err(AppError::Import(message)) => message,
                other => panic!("expected an import error, got {other:?}"),
            };
            for name in ["a.csv", "a", "a.ofx.txt"] {
                let path = dir.join(name);
                std::fs::write(&path, "OFXHEADER:100").unwrap();
                assert_eq!(
                    message(import_path(&state, &path).await),
                    "Zeni imports .ofx and .qfx files only."
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
            .fetch_one(security::pool(&state).unwrap())
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
            let pool = security::pool(&state).unwrap();
            match import_statement(pool, "a.ofx", ImportFormat::Ofx, &next).await {
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
            db: Err("no database".into()),
            session: Default::default(),
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
        });
    }

    /// Migration 0003: raw rows and imported file values can't be updated, FITIDs are unique per account, and enums are checked.
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
                         VALUES (1, 'a.csv', 'csv', 'notChecked')"
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
