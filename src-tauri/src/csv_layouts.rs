//! Saved CSV layouts: mapping validation, lookup by header fingerprint, list, update and delete.

use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use crate::security;
use crate::types::{
    AmountColumns, AppError, AppState, CsvLayout, CsvMapping, DeleteCsvLayoutRequest,
    UpdateCsvLayoutRequest,
};

const MAX_NAME_CHARS: usize = 100;

/// The layout SELECT followed by a fixed clause, built at compile time.
macro_rules! select {
    ($clause:literal) => {
        concat!(
            "SELECT id, name, header_fingerprint, date_format, posted_date_column, \
             description_column, amount_column, debit_column, credit_column, transaction_id_column, \
             memo_column, transaction_type_column, running_balance_column, posting_status_column, \
             bank_category_column FROM csv_layouts ",
            $clause
        )
    };
}

/// Checks that every mapped column exists and no column serves two roles.
pub fn validate_mapping(column_count: usize, mapping: &CsvMapping) -> Result<(), AppError> {
    let mut roles = vec![
        ("Posted date", Some(mapping.posted_date)),
        ("Description", Some(mapping.description)),
    ];
    match mapping.amount {
        AmountColumns::Signed { column } => roles.push(("Amount", Some(column))),
        AmountColumns::Split { debit, credit } => {
            roles.push(("Debit", Some(debit)));
            roles.push(("Credit", Some(credit)));
        }
    }
    roles.extend([
        ("Transaction ID", mapping.transaction_id),
        ("Memo", mapping.memo),
        ("Transaction type", mapping.transaction_type),
        ("Running balance", mapping.running_balance),
        ("Posting status", mapping.posting_status),
        ("Bank category", mapping.bank_category),
    ]);
    let mapped: Vec<(&str, u32)> = roles
        .into_iter()
        .filter_map(|(role, column)| column.map(|column| (role, column)))
        .collect();
    for (i, &(role, column)) in mapped.iter().enumerate() {
        if column as usize >= column_count {
            return Err(AppError::Validation(format!(
                "{role} points to column {}, but the file has only {column_count} columns.",
                column as u64 + 1
            )));
        }
        if let Some((other, _)) = mapped[..i].iter().find(|(_, earlier)| *earlier == column) {
            return Err(AppError::Validation(format!(
                "{other} and {role} use the same column. Pick a different column for one of them."
            )));
        }
    }
    Ok(())
}

/// Trims the name and checks it is non-empty and at most 100 characters.
fn validate_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Give the layout a name.".into()));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::Validation(format!(
            "The layout name can be at most {MAX_NAME_CHARS} characters."
        )));
    }
    Ok(name)
}

fn column_count(fingerprint: &str) -> usize {
    fingerprint.split('\n').count()
}

fn layout(row: SqliteRow) -> Result<CsvLayout, AppError> {
    let amount = match (
        row.try_get::<Option<u32>, _>("amount_column")?,
        row.try_get::<Option<u32>, _>("debit_column")?,
        row.try_get::<Option<u32>, _>("credit_column")?,
    ) {
        (Some(column), _, _) => AmountColumns::Signed { column },
        (None, Some(debit), Some(credit)) => AmountColumns::Split { debit, credit },
        _ => {
            return Err(AppError::Database(
                "A saved CSV layout has no amount column.".into(),
            ));
        }
    };
    let fingerprint: String = row.try_get("header_fingerprint")?;
    Ok(CsvLayout {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        headers: fingerprint.split('\n').map(Into::into).collect(),
        mapping: CsvMapping {
            date_format: row.try_get("date_format")?,
            posted_date: row.try_get("posted_date_column")?,
            description: row.try_get("description_column")?,
            amount,
            transaction_id: row.try_get("transaction_id_column")?,
            memo: row.try_get("memo_column")?,
            transaction_type: row.try_get("transaction_type_column")?,
            running_balance: row.try_get("running_balance_column")?,
            posting_status: row.try_get("posting_status_column")?,
            bank_category: row.try_get("bank_category_column")?,
        },
    })
}

async fn by_id(pool: &SqlitePool, id: i64) -> Result<Option<CsvLayout>, AppError> {
    sqlx::query(select!("WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(layout)
        .transpose()
}

fn amount_columns(amount: AmountColumns) -> (Option<u32>, Option<u32>, Option<u32>) {
    match amount {
        AmountColumns::Signed { column } => (Some(column), None, None),
        AmountColumns::Split { debit, credit } => (None, Some(debit), Some(credit)),
    }
}

/// The saved layout whose header fingerprint matches, if any.
pub async fn find(pool: &SqlitePool, fingerprint: &str) -> Result<Option<CsvLayout>, AppError> {
    sqlx::query(select!("WHERE header_fingerprint = ?"))
        .bind(fingerprint)
        .fetch_optional(pool)
        .await?
        .map(layout)
        .transpose()
}

/// Saves a new layout for `fingerprint`, after validating the name and mapping.
pub async fn insert(
    pool: &SqlitePool,
    name: &str,
    fingerprint: &str,
    mapping: &CsvMapping,
) -> Result<CsvLayout, AppError> {
    let name = validate_name(name)?;
    validate_mapping(column_count(fingerprint), mapping)?;
    let (amount, debit, credit) = amount_columns(mapping.amount);
    let id: Option<i64> = sqlx::query_scalar(
        "INSERT INTO csv_layouts (name, header_fingerprint, date_format, posted_date_column, \
         description_column, amount_column, debit_column, credit_column, transaction_id_column, \
         memo_column, transaction_type_column, running_balance_column, posting_status_column, \
         bank_category_column) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT (header_fingerprint) DO NOTHING RETURNING id",
    )
    .bind(name)
    .bind(fingerprint)
    .bind(mapping.date_format)
    .bind(mapping.posted_date)
    .bind(mapping.description)
    .bind(amount)
    .bind(debit)
    .bind(credit)
    .bind(mapping.transaction_id)
    .bind(mapping.memo)
    .bind(mapping.transaction_type)
    .bind(mapping.running_balance)
    .bind(mapping.posting_status)
    .bind(mapping.bank_category)
    .fetch_optional(pool)
    .await?;
    let id =
        id.ok_or_else(|| AppError::Validation("A layout for this header already exists.".into()))?;
    Ok(CsvLayout {
        id,
        name: name.into(),
        headers: fingerprint.split('\n').map(Into::into).collect(),
        mapping: mapping.clone(),
    })
}

/// Every saved layout, by name.
pub async fn list(state: &AppState) -> Result<Vec<CsvLayout>, AppError> {
    sqlx::query(select!("ORDER BY name COLLATE NOCASE, id"))
        .fetch_all(security::pool(state)?)
        .await?
        .into_iter()
        .map(layout)
        .collect()
}

/// Renames a layout and replaces its mapping, validated against the layout's own header.
pub async fn update(
    state: &AppState,
    request: UpdateCsvLayoutRequest,
) -> Result<CsvLayout, AppError> {
    let pool = security::pool(state)?;
    let name = validate_name(&request.name)?;
    let existing = by_id(pool, request.layout_id)
        .await?
        .ok_or_else(not_found)?;
    validate_mapping(existing.headers.len(), &request.mapping)?;
    let (amount, debit, credit) = amount_columns(request.mapping.amount);
    sqlx::query(
        "UPDATE csv_layouts SET name = ?, date_format = ?, posted_date_column = ?, \
         description_column = ?, amount_column = ?, debit_column = ?, credit_column = ?, \
         transaction_id_column = ?, memo_column = ?, transaction_type_column = ?, \
         running_balance_column = ?, posting_status_column = ?, bank_category_column = ? \
         WHERE id = ?",
    )
    .bind(name)
    .bind(request.mapping.date_format)
    .bind(request.mapping.posted_date)
    .bind(request.mapping.description)
    .bind(amount)
    .bind(debit)
    .bind(credit)
    .bind(request.mapping.transaction_id)
    .bind(request.mapping.memo)
    .bind(request.mapping.transaction_type)
    .bind(request.mapping.running_balance)
    .bind(request.mapping.posting_status)
    .bind(request.mapping.bank_category)
    .bind(request.layout_id)
    .execute(pool)
    .await?;
    Ok(CsvLayout {
        name: name.into(),
        mapping: request.mapping,
        ..existing
    })
}

/// Deletes a layout. Imports that used it keep their rows; their `csv_layout_id` becomes NULL (FK).
pub async fn delete(state: &AppState, request: DeleteCsvLayoutRequest) -> Result<(), AppError> {
    let deleted = sqlx::query("DELETE FROM csv_layouts WHERE id = ?")
        .bind(request.layout_id)
        .execute(security::pool(state)?)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(not_found());
    }
    Ok(())
}

fn not_found() -> AppError {
    AppError::NotFound("That CSV layout no longer exists.".into())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::db;
    use crate::types::DateFormat;

    const FINGERPRINT: &str = "posting date\ndescription\namount\nbalance";
    const SPLIT_FINGERPRINT: &str = "date\ndescription\ndebit\ncredit\nstatus";

    fn state(name: &str) -> (PathBuf, AppState) {
        let dir = db::temp_dir(name);
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: tauri::async_runtime::block_on(db::connect(&dir)),
            session: Default::default(),
            pending_import: Default::default(),
        };
        (dir, state)
    }

    fn signed() -> CsvMapping {
        CsvMapping {
            date_format: DateFormat::MmDdYyyy,
            posted_date: 0,
            description: 1,
            amount: AmountColumns::Signed { column: 2 },
            transaction_id: None,
            memo: None,
            transaction_type: None,
            running_balance: Some(3),
            posting_status: None,
            bank_category: None,
        }
    }

    fn split() -> CsvMapping {
        CsvMapping {
            date_format: DateFormat::YyyyMmDd,
            amount: AmountColumns::Split {
                debit: 2,
                credit: 3,
            },
            running_balance: None,
            posting_status: Some(4),
            ..signed()
        }
    }

    fn validation(result: Result<impl std::fmt::Debug, AppError>) -> String {
        match result {
            Err(AppError::Validation(message)) => message,
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn validate_mapping_accepts_good_mappings_and_names_the_bad_role() {
        assert!(validate_mapping(4, &signed()).is_ok());
        assert!(validate_mapping(5, &split()).is_ok());

        let message = validation(validate_mapping(3, &signed()).map(|_| ()));
        assert_eq!(
            message,
            "Running balance points to column 4, but the file has only 3 columns."
        );

        let mapping = CsvMapping {
            memo: Some(1),
            ..signed()
        };
        assert_eq!(
            validation(validate_mapping(4, &mapping)),
            "Description and Memo use the same column. Pick a different column for one of them."
        );

        let mapping = CsvMapping {
            amount: AmountColumns::Split {
                debit: 2,
                credit: 2,
            },
            ..split()
        };
        assert_eq!(
            validation(validate_mapping(5, &mapping)),
            "Debit and Credit use the same column. Pick a different column for one of them."
        );

        let mapping = CsvMapping {
            description: 0,
            ..signed()
        };
        assert!(
            validation(validate_mapping(4, &mapping)).starts_with("Posted date and Description")
        );
    }

    #[test]
    fn insert_find_and_list_round_trip_signed_and_split() {
        let (dir, state) = state("csv-layouts-round-trip");
        tauri::async_runtime::block_on(async {
            let pool = security::pool(&state).unwrap();
            let saved = insert(pool, "  Credit union  ", FINGERPRINT, &signed())
                .await
                .unwrap();
            assert_eq!(saved.name, "Credit union");
            assert_eq!(
                saved.headers,
                ["posting date", "description", "amount", "balance"]
            );
            let found = find(pool, FINGERPRINT).await.unwrap().unwrap();
            assert_eq!(
                (
                    found.id,
                    found.name.as_str(),
                    &found.headers,
                    &found.mapping
                ),
                (saved.id, "Credit union", &saved.headers, &signed())
            );

            let other = insert(pool, "another bank", SPLIT_FINGERPRINT, &split())
                .await
                .unwrap();
            assert_eq!(
                find(pool, SPLIT_FINGERPRINT)
                    .await
                    .unwrap()
                    .unwrap()
                    .mapping,
                split()
            );
            assert!(find(pool, "unknown").await.unwrap().is_none());

            let listed = list(&state).await.unwrap();
            let summary: Vec<_> = listed
                .iter()
                .map(|layout| (layout.id, layout.name.as_str(), layout.mapping.clone()))
                .collect();
            assert_eq!(
                summary,
                [
                    (other.id, "another bank", split()),
                    (saved.id, "Credit union", signed())
                ]
            );
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn insert_rejects_bad_names_bad_mappings_and_a_known_header() {
        let (dir, state) = state("csv-layouts-insert-errors");
        tauri::async_runtime::block_on(async {
            let pool = security::pool(&state).unwrap();
            assert_eq!(
                validation(insert(pool, "   ", FINGERPRINT, &signed()).await),
                "Give the layout a name."
            );
            assert_eq!(
                validation(insert(pool, &"x".repeat(101), FINGERPRINT, &signed()).await),
                "The layout name can be at most 100 characters."
            );
            assert!(
                insert(pool, &"é".repeat(100), FINGERPRINT, &signed())
                    .await
                    .is_ok()
            );
            assert_eq!(
                validation(insert(pool, "Again", FINGERPRINT, &signed()).await),
                "A layout for this header already exists."
            );
            // Three header columns: the split mapping's credit (3) and status (4) don't exist.
            assert!(
                validation(insert(pool, "Short", "a\nb\nc", &split()).await)
                    .starts_with("Credit points to column 4")
            );
            assert_eq!(list(&state).await.unwrap().len(), 1);
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn update_validates_against_its_own_header() {
        let (dir, state) = state("csv-layouts-update");
        tauri::async_runtime::block_on(async {
            let pool = security::pool(&state).unwrap();
            let saved = insert(pool, "Bank", SPLIT_FINGERPRINT, &split())
                .await
                .unwrap();
            let request = |name: &str, mapping: CsvMapping| UpdateCsvLayoutRequest {
                layout_id: saved.id,
                name: name.into(),
                mapping,
            };

            // The signed mapping fits the five-column header.
            let updated = update(&state, request(" Renamed ", signed()))
                .await
                .unwrap();
            assert_eq!(
                (updated.id, updated.name.as_str(), &updated.headers),
                (saved.id, "Renamed", &saved.headers)
            );
            let stored = find(pool, SPLIT_FINGERPRINT).await.unwrap().unwrap();
            assert_eq!(
                (stored.name.as_str(), stored.mapping),
                ("Renamed", signed())
            );

            let too_far = CsvMapping {
                bank_category: Some(5),
                ..signed()
            };
            assert!(
                validation(update(&state, request("Renamed", too_far)).await)
                    .starts_with("Bank category points to column 6")
            );
            assert_eq!(
                validation(update(&state, request("", signed())).await),
                "Give the layout a name."
            );
            let missing = UpdateCsvLayoutRequest {
                layout_id: saved.id + 1,
                name: "Nope".into(),
                mapping: signed(),
            };
            assert!(matches!(
                update(&state, missing).await,
                Err(AppError::NotFound(_))
            ));
            assert_eq!(
                find(pool, SPLIT_FINGERPRINT)
                    .await
                    .unwrap()
                    .unwrap()
                    .mapping,
                signed()
            );
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn delete_clears_the_import_link_and_leaves_imported_data_alone() {
        let (dir, state) = state("csv-layouts-delete");
        tauri::async_runtime::block_on(async {
            let pool = security::pool(&state).unwrap();
            let saved = insert(pool, "Bank", FINGERPRINT, &signed()).await.unwrap();
            sqlx::query(
                "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
                 VALUES ('Checking', 'Sam', 'Bank', x'00', x'00')",
            )
            .execute(pool)
            .await
            .unwrap();
            let import_id: i64 = sqlx::query_scalar(
                "INSERT INTO imports (account_id, file_name, format, ledger_balance_cents, \
                 balance_as_of, balance_check, csv_layout_id, file_balance_check) \
                 VALUES (1, 'oct.csv', 'csv', 1000, '2026-10-02', 'baseline', ?, 'passed') \
                 RETURNING id",
            )
            .bind(saved.id)
            .fetch_one(pool)
            .await
            .unwrap();
            for (date, cents) in [("2026-10-01", -500), ("2026-10-02", 1500)] {
                sqlx::query(
                    "INSERT INTO raw_transactions (import_id, account_id, posted_date, \
                     amount_cents, raw_description, original_row, bank_category) \
                     VALUES (?, 1, ?, ?, 'Shop', 'line', 'Food')",
                )
                .bind(import_id)
                .bind(date)
                .bind(cents)
                .execute(pool)
                .await
                .unwrap();
            }
            let snapshot = || async {
                let import: (String, String, Option<i64>, String, String, Option<i64>) =
                    sqlx::query_as(
                        "SELECT file_name, format, ledger_balance_cents, balance_check, \
                         file_balance_check, csv_layout_id FROM imports",
                    )
                    .fetch_one(pool)
                    .await
                    .unwrap();
                let rows: Vec<(i64, String, i64, String, String, Option<String>)> = sqlx::query_as(
                    "SELECT import_id, posted_date, amount_cents, raw_description, \
                         original_row, bank_category FROM raw_transactions ORDER BY id",
                )
                .fetch_all(pool)
                .await
                .unwrap();
                (import, rows)
            };
            let before = snapshot().await;
            assert_eq!(before.0.5, Some(saved.id));

            delete(
                &state,
                DeleteCsvLayoutRequest {
                    layout_id: saved.id,
                },
            )
            .await
            .unwrap();

            let after = snapshot().await;
            assert_eq!(after.0.5, None);
            assert_eq!(
                (&after.0.0, &after.0.1, after.0.2, &after.0.3, &after.0.4),
                (
                    &before.0.0,
                    &before.0.1,
                    before.0.2,
                    &before.0.3,
                    &before.0.4
                )
            );
            assert_eq!(after.1, before.1);
            assert!(list(&state).await.unwrap().is_empty());
            assert!(matches!(
                delete(
                    &state,
                    DeleteCsvLayoutRequest {
                        layout_id: saved.id
                    }
                )
                .await,
                Err(AppError::NotFound(_))
            ));
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn database_unavailable_is_reported() {
        let state = AppState {
            db: Err("disk gone".into()),
            session: Default::default(),
            pending_import: Default::default(),
        };
        tauri::async_runtime::block_on(async {
            assert!(matches!(list(&state).await, Err(AppError::Database(_))));
            let request = UpdateCsvLayoutRequest {
                layout_id: 1,
                name: "x".into(),
                mapping: signed(),
            };
            assert!(matches!(
                update(&state, request).await,
                Err(AppError::Database(_))
            ));
            assert!(matches!(
                delete(&state, DeleteCsvLayoutRequest { layout_id: 1 }).await,
                Err(AppError::Database(_))
            ));
        });
    }
}
