//! Spending and income per category over a date range.

use sqlx::Row;

use crate::security;
use crate::transactions::validate_range;
use crate::types::{
    AppError, AppState, CategoryKind, CategorySpending, SpendingQuery, SpendingSummary,
};

/// Totals by effective category over the checking account's rows from `from` to `to`, both inclusive.
pub async fn summary(state: &AppState, query: SpendingQuery) -> Result<SpendingSummary, AppError> {
    validate_range(Some(&query.from), Some(&query.to))?;
    let pool = &security::pool(state)?;
    // A NULL category id is the uncategorized bucket; kind is read live from categories.
    let rows = sqlx::query(
        "SELECT c.id AS id, c.name AS name, c.kind AS kind,
                COUNT(*) AS count, SUM(r.amount_cents) AS total
         FROM raw_transactions r
         JOIN effective_categories e ON e.raw_transaction_id = r.id
         LEFT JOIN categories c ON c.id = e.category_id
         WHERE r.account_id = (SELECT MIN(id) FROM accounts)
           AND r.posted_date BETWEEN ? AND ?
         GROUP BY c.id
         ORDER BY c.sort_order",
    )
    .bind(&query.from)
    .bind(&query.to)
    .fetch_all(pool)
    .await?;
    let mut summary = SpendingSummary {
        categories: Vec::new(),
        uncategorized_count: 0,
        uncategorized_cents: 0,
    };
    for row in rows {
        let count: u32 = row.get("count");
        let total: i64 = row.get("total");
        let Some(category_id) = row.get::<Option<i64>, _>("id") else {
            summary.uncategorized_count = count;
            summary.uncategorized_cents = total;
            continue;
        };
        let kind: CategoryKind = row.get("kind");
        summary.categories.push(CategorySpending {
            category_id,
            name: row.get("name"),
            kind,
            count,
            spending_cents: if kind == CategoryKind::Spending {
                -total
            } else {
                0
            },
            income_cents: if kind == CategoryKind::Income {
                total
            } else {
                0
            },
        });
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::db;
    use crate::security;

    struct Fixture {
        state: AppState,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    /// (account_id, posted_date, amount_cents, category name or uncategorized).
    const ROWS: [(i64, &str, i64, Option<&str>); 9] = [
        (1, "2026-10-01", -5000, Some("Groceries")),
        (1, "2026-10-02", 1000, Some("Groceries")),
        (1, "2026-10-03", 300000, Some("Paycheck")),
        (1, "2026-10-04", -20000, Some("Paycheck")),
        (1, "2026-10-05", -50000, Some("Savings transfer")),
        (1, "2026-10-06", -700, None),
        (1, "2026-10-07", -300, None),
        // Outside the range.
        (1, "2026-11-01", -9999, Some("Groceries")),
        // Another account never counts.
        (2, "2026-10-03", -12345, Some("Groceries")),
    ];

    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("spending-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: std::sync::RwLock::new(run(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let pool = &security::pool(&state).unwrap();
        run(async {
            for _ in 0..2 {
                sqlx::query(
                    "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number)
                     VALUES ('Checking', 'Me', 'Bank', x'00', x'00')",
                )
                .execute(pool)
                .await
                .unwrap();
            }
            sqlx::query(
                "INSERT INTO imports (account_id, file_name, format, balance_check)
                 VALUES (1, 'a.ofx', 'ofx', 'notChecked')",
            )
            .execute(pool)
            .await
            .unwrap();
            for (account, date, amount, category) in ROWS {
                let id: i64 = sqlx::query_scalar(
                    "INSERT INTO raw_transactions
                     (import_id, account_id, posted_date, amount_cents, raw_description, original_row)
                     VALUES (1, ?, ?, ?, 'Row', '<STMTTRN>') RETURNING id",
                )
                .bind(account)
                .bind(date)
                .bind(amount)
                .fetch_one(pool)
                .await
                .unwrap();
                if let Some(category) = category {
                    sqlx::query(
                        "INSERT INTO transaction_categories (raw_transaction_id, user_category_id)
                         SELECT ?, id FROM categories WHERE name = ?",
                    )
                    .bind(id)
                    .bind(category)
                    .execute(pool)
                    .await
                    .unwrap();
                }
            }
        });
        Fixture { state, dir }
    }

    fn october(f: &Fixture) -> SpendingSummary {
        run(summary(&f.state, range("2026-10-01", "2026-10-31"))).unwrap()
    }

    fn range(from: &str, to: &str) -> SpendingQuery {
        SpendingQuery {
            from: from.into(),
            to: to.into(),
        }
    }

    fn category<'a>(summary: &'a SpendingSummary, name: &str) -> &'a CategorySpending {
        summary
            .categories
            .iter()
            .find(|c| c.name == name)
            .expect("category present")
    }

    #[test]
    fn a_refund_reduces_spending() {
        let f = fixture("refund");
        let groceries = category(&october(&f), "Groceries").values();
        assert_eq!(groceries, (CategoryKind::Spending, 2, 4000, 0));
    }

    #[test]
    fn income_is_the_sum_of_income_rows() {
        let f = fixture("income");
        let paycheck = category(&october(&f), "Paycheck").values();
        assert_eq!(paycheck, (CategoryKind::Income, 2, 0, 280000));
    }

    #[test]
    fn transfers_count_in_neither() {
        let f = fixture("transfer");
        let transfer = category(&october(&f), "Savings transfer").values();
        assert_eq!(transfer, (CategoryKind::Transfer, 1, 0, 0));
    }

    #[test]
    fn uncategorized_rows_get_their_own_count_and_sum() {
        let f = fixture("uncategorized");
        let october = october(&f);
        assert_eq!(
            (october.uncategorized_count, october.uncategorized_cents),
            (2, -1000)
        );
        // In sort order, only categories with rows, the other account and November left out.
        let names: Vec<&str> = october.categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["Groceries", "Paycheck", "Savings transfer"]);
    }

    #[test]
    fn range_is_inclusive_on_both_ends() {
        let f = fixture("inclusive");
        let day = run(summary(&f.state, range("2026-10-01", "2026-10-01"))).unwrap();
        assert_eq!(category(&day, "Groceries").values().2, 5000);
        let november = run(summary(&f.state, range("2026-11-01", "2026-11-01"))).unwrap();
        assert_eq!(category(&november, "Groceries").values().2, 9999);
    }

    #[test]
    fn a_kind_change_shows_at_once() {
        let f = fixture("kind");
        let pool = &security::pool(&f.state).unwrap();
        run(
            sqlx::query("UPDATE categories SET kind = 'income' WHERE name = 'Groceries'")
                .execute(pool),
        )
        .unwrap();
        let groceries = category(&october(&f), "Groceries").values();
        assert_eq!(groceries, (CategoryKind::Income, 2, 0, -4000));
    }

    #[test]
    fn an_empty_range_is_empty() {
        let f = fixture("empty");
        let empty = run(summary(&f.state, range("2020-01-01", "2020-12-31"))).unwrap();
        assert!(empty.categories.is_empty());
        assert_eq!(
            (empty.uncategorized_count, empty.uncategorized_cents),
            (0, 0)
        );
    }

    #[test]
    fn rejects_bad_ranges_with_the_list_messages() {
        let f = fixture("invalid");
        for (from, to, expected) in [
            ("2026-10-31", "2026-10-01", "from must not be after to"),
            (
                "2026-02-30",
                "2026-10-01",
                "from must be a date in YYYY-MM-DD form",
            ),
            ("2026-10-01", "", "to must be a date in YYYY-MM-DD form"),
        ] {
            match run(summary(&f.state, range(from, to))) {
                Err(AppError::Validation(message)) => assert_eq!(message, expected),
                other => panic!("expected a validation error, got {other:?}"),
            }
        }
    }

    impl CategorySpending {
        fn values(&self) -> (CategoryKind, u32, i64, i64) {
            (
                self.kind,
                self.count,
                self.spending_cents,
                self.income_cents,
            )
        }
    }

    #[test]
    fn nickname_defaults_and_model_answers_count_in_their_category() {
        let f = fixture("set-by");
        let pool = &security::pool(&f.state).unwrap();
        run(async {
            for statement in [
                "INSERT INTO nicknames (id, name, default_category_id)
                 SELECT 1, 'Cafe', id FROM categories WHERE name = 'Dining out'",
                "INSERT INTO nickname_rules (id, nickname_id, mode, field, pattern)
                 VALUES (1, 1, 'contains', 'description', 'Row')",
                "INSERT INTO raw_transactions
                 (id, import_id, account_id, posted_date, amount_cents, raw_description, original_row)
                 VALUES (100, 1, 1, '2026-10-08', -1500, 'Row', '<STMTTRN>'),
                        (101, 1, 1, '2026-10-09', -2500, 'Row', '<STMTTRN>')",
                "INSERT INTO nickname_matches (raw_transaction_id, rule_id) VALUES (100, 1)",
                "INSERT INTO transaction_categories (raw_transaction_id, model_category_id)
                 SELECT 101, id FROM categories WHERE name = 'Shopping'",
            ] {
                sqlx::query(statement).execute(pool).await.unwrap();
            }
        });
        let october = october(&f);
        assert_eq!(
            category(&october, "Dining out").values(),
            (CategoryKind::Spending, 1, 1500, 0)
        );
        assert_eq!(
            category(&october, "Shopping").values(),
            (CategoryKind::Spending, 1, 2500, 0)
        );
        assert_eq!(october.uncategorized_count, 2);
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
        assert!(matches!(
            run(summary(&state, range("2026-10-01", "2026-10-31"))),
            Err(AppError::Database(_))
        ));
    }
}
