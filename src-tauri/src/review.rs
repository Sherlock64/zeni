//! Review of model answers: groups by category, the unreviewed count and marking reviewed.

use crate::security;
use crate::transactions::{transaction_columns, transaction_from_row, transactions_from};
use crate::types::{AppError, AppState, MarkReviewedRequest, ReviewGroup};

/// Unreviewed model answers in the checking account (lowest id), as `transactions::list` scopes.
// A macro so `concat!` can build the two static queries from it.
macro_rules! unreviewed {
    () => {
        concat!(
            transactions_from!(),
            " WHERE r.account_id = (SELECT MIN(id) FROM accounts) \
             AND e.set_by = 'model' AND e.reviewed = 0"
        )
    };
}

/// Unreviewed model answers by category sort order, rows newest first.
pub async fn groups(state: &AppState) -> Result<Vec<ReviewGroup>, AppError> {
    let pool = &security::pool(state)?;
    let rows = sqlx::query(concat!(
        transaction_columns!(),
        unreviewed!(),
        " ORDER BY c.sort_order, c.id, r.posted_date DESC, r.id DESC"
    ))
    .fetch_all(pool)
    .await?;
    let mut groups: Vec<ReviewGroup> = Vec::new();
    for row in rows {
        let row = transaction_from_row(&row);
        // A model answer always names an existing category, so both are present.
        let category_id = row.category_id.unwrap_or_default();
        match groups.last_mut() {
            Some(group) if group.category_id == category_id => group.rows.push(row),
            _ => groups.push(ReviewGroup {
                category_id,
                category: row.category.clone().unwrap_or_default(),
                rows: vec![row],
            }),
        }
    }
    Ok(groups)
}

pub async fn unreviewed_count(state: &AppState) -> Result<u32, AppError> {
    let pool = &security::pool(state)?;
    Ok(
        sqlx::query_scalar(concat!("SELECT COUNT(*)", unreviewed!()))
            .fetch_one(pool)
            .await?,
    )
}

/// Marks the rows that are still effectively set by the model as reviewed.
pub async fn mark_reviewed(state: &AppState, request: MarkReviewedRequest) -> Result<(), AppError> {
    let pool = &security::pool(state)?;
    if request.transaction_ids.is_empty() {
        return Ok(());
    }
    // One JSON array bind, so any number of ids fits under SQLite's parameter limit.
    let ids = serde_json::to_string(&request.transaction_ids)?;
    sqlx::query(
        "UPDATE transaction_categories SET model_reviewed = 1, updated_at = CURRENT_TIMESTAMP \
         WHERE raw_transaction_id IN (SELECT value FROM json_each(?)) \
         AND raw_transaction_id IN (SELECT r.id FROM raw_transactions r \
             JOIN effective_categories e ON e.raw_transaction_id = r.id \
             WHERE r.account_id = (SELECT MIN(id) FROM accounts) AND e.set_by = 'model')",
    )
    .bind(ids)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::db;
    use crate::security;
    use crate::types::SetBy;

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

    fn fixture(name: &str, sql: &[&'static str]) -> Fixture {
        let dir = db::temp_dir(&format!("review-{name}"));
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
            for &sql in sql {
                sqlx::query(sql).execute(pool).await.unwrap();
            }
        });
        Fixture { state, dir }
    }

    /// Rows 1-6 in the checking account, row 7 in another account.
    /// Model answers: 1 and 3 Dining out (5), 2 Groceries (4), 4 reviewed, 7 other account.
    /// Row 5 is set by the user and row 6 by a nickname, both over a model answer.
    const ROWS: &[&str] = &[
        "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number)
         VALUES ('Checking', 'Me', 'Bank', x'00', x'00'), ('Other', 'Me', 'Bank', x'00', x'00')",
        "INSERT INTO imports (account_id, file_name, format, balance_check)
         VALUES (1, 'a.ofx', 'ofx', 'notChecked')",
        "INSERT INTO raw_transactions
         (import_id, account_id, posted_date, amount_cents, raw_description, original_row) VALUES
         (1, 1, '2026-10-01', -450, 'Cafe', 'x'), (1, 1, '2026-10-02', -1299, 'Market', 'x'),
         (1, 1, '2026-10-03', -800, 'Diner', 'x'), (1, 1, '2026-10-03', -900, 'Bistro', 'x'),
         (1, 1, '2026-10-04', -100, 'Shop', 'x'), (1, 1, '2026-10-05', -200000, 'Rent', 'x'),
         (1, 2, '2026-10-06', -1, 'Elsewhere', 'x')",
        "INSERT INTO nicknames (id, name, enabled, default_category_id) VALUES (1, 'Rent Co', 1, 1)",
        "INSERT INTO nickname_rules (id, nickname_id, mode, field, pattern)
         VALUES (1, 1, 'exact', 'description', 'Rent')",
        "INSERT INTO nickname_matches (raw_transaction_id, rule_id) VALUES (6, 1)",
        "INSERT INTO transaction_categories
         (raw_transaction_id, user_category_id, model_category_id, model_reviewed) VALUES
         (1, NULL, 5, 0), (2, NULL, 4, 0), (3, NULL, 5, 0), (4, NULL, 5, 1),
         (5, 4, 1, 0), (6, NULL, 5, 0), (7, NULL, 5, 0)",
    ];

    fn reviewed_flags(f: &Fixture) -> Vec<(i64, i64)> {
        let pool = &security::pool(&f.state).unwrap();
        run(sqlx::query_as(
            "SELECT raw_transaction_id, model_reviewed FROM transaction_categories ORDER BY 1",
        )
        .fetch_all(pool))
        .unwrap()
    }

    #[test]
    fn groups_unreviewed_model_rows_by_category_order_newest_first() {
        let f = fixture("groups", ROWS);
        let groups = run(groups(&f.state)).unwrap();
        let got: Vec<_> = groups
            .iter()
            .map(|g| {
                let ids: Vec<i64> = g.rows.iter().map(|r| r.id).collect();
                (g.category_id, g.category.as_str(), ids)
            })
            .collect();
        assert_eq!(
            got,
            [(4, "Groceries", vec![2]), (5, "Dining out", vec![3, 1])]
        );
        let row = &groups[1].rows[0];
        assert_eq!(
            (
                row.posted_date.as_str(),
                row.amount_cents,
                row.description.as_str(),
                row.category_id,
                row.category.as_deref(),
                row.set_by,
                row.reviewed,
            ),
            (
                "2026-10-03",
                -800,
                "Diner",
                Some(5),
                Some("Dining out"),
                Some(SetBy::Model),
                false
            )
        );
        assert_eq!(run(unreviewed_count(&f.state)).unwrap(), 3);
    }

    #[test]
    fn marks_only_listed_rows_still_set_by_the_model() {
        let f = fixture("mark", ROWS);
        let request = MarkReviewedRequest {
            transaction_ids: vec![1, 5, 6, 7, 999],
        };
        run(mark_reviewed(&f.state, request)).unwrap();
        assert_eq!(
            reviewed_flags(&f),
            [(1, 1), (2, 0), (3, 0), (4, 1), (5, 0), (6, 0), (7, 0)]
        );
        assert_eq!(run(unreviewed_count(&f.state)).unwrap(), 2);
        let ids: Vec<i64> = run(groups(&f.state))
            .unwrap()
            .iter()
            .flat_map(|g| g.rows.iter().map(|r| r.id))
            .collect();
        assert_eq!(ids, [2, 3]);
    }

    #[test]
    fn empty_when_nothing_to_review() {
        let f = fixture("empty", &ROWS[..2]);
        assert!(run(groups(&f.state)).unwrap().is_empty());
        assert_eq!(run(unreviewed_count(&f.state)).unwrap(), 0);
        let request = MarkReviewedRequest {
            transaction_ids: vec![],
        };
        run(mark_reviewed(&f.state, request)).unwrap();
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
        assert!(matches!(run(groups(&state)), Err(AppError::Database(_))));
        assert!(matches!(
            run(unreviewed_count(&state)),
            Err(AppError::Database(_))
        ));
        let request = MarkReviewedRequest {
            transaction_ids: vec![1],
        };
        assert!(matches!(
            run(mark_reviewed(&state, request)),
            Err(AppError::Database(_))
        ));
    }
}
