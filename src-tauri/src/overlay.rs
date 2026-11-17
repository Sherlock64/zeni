//! The user's category and note per transaction, stored in `transaction_categories`.

use crate::security;
use crate::types::{AppError, AppState, SetTransactionCategoryRequest};

const MAX_NOTE_CHARS: usize = 500;

/// Sets or clears the user's category and note of one row.
///
/// Either way the model's answer is dropped: a set category is the user's and reviewed,
/// a cleared one leaves the row uncategorized and open to the model.
pub async fn set_category(
    state: &AppState,
    request: SetTransactionCategoryRequest,
) -> Result<(), AppError> {
    let note = request.note.as_deref().map(str::trim).unwrap_or("");
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::Validation(format!(
            "Use at most {MAX_NOTE_CHARS} characters."
        )));
    }
    let note = (!note.is_empty()).then_some(note);
    let mut tx = security::pool(state)?.begin().await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM raw_transactions WHERE id = ?)")
            .bind(request.transaction_id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(AppError::NotFound(
            "That transaction no longer exists.".into(),
        ));
    }
    if let Some(category_id) = request.category_id {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM categories WHERE id = ?)")
                .bind(category_id)
                .fetch_one(&mut *tx)
                .await?;
        if !exists {
            return Err(AppError::NotFound("That category no longer exists.".into()));
        }
    }
    sqlx::query(
        "INSERT INTO transaction_categories (raw_transaction_id, user_category_id, note) \
         VALUES (?, ?, ?) \
         ON CONFLICT (raw_transaction_id) DO UPDATE SET \
         user_category_id = excluded.user_category_id, model_category_id = NULL, \
         model_build_id = NULL, model_reviewed = 0, note = excluded.note, \
         updated_at = CURRENT_TIMESTAMP",
    )
    .bind(request.transaction_id)
    .bind(request.category_id)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::db;
    use crate::imports;
    use crate::types::RevertImportRequest;

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

    /// One account, import 1 with rows 1 and 2, import 2 with row 3, and a build with id 1.
    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("overlay-{name}"));
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
            for sql in [
                "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number)
                 VALUES ('Checking', 'Me', 'Bank', x'00', x'00')",
                "INSERT INTO imports (account_id, file_name, format, balance_check)
                 VALUES (1, 'a.ofx', 'ofx', 'notChecked'), (1, 'b.ofx', 'ofx', 'notChecked')",
                "INSERT INTO raw_transactions
                 (import_id, account_id, posted_date, amount_cents, raw_description, original_row)
                 VALUES (1, 1, '2026-10-01', -450, 'Coffee', '<STMTTRN>'),
                        (1, 1, '2026-10-02', -900, 'Store', '<STMTTRN>'),
                        (2, 1, '2026-10-03', -100, 'Other', '<STMTTRN>')",
                "INSERT INTO model_builds (id, name, base_model, example_count, sent)
                 VALUES (1, 'zeni-1', 'base', 0, '{}')",
            ] {
                sqlx::query(sql).execute(pool).await.unwrap();
            }
        });
        Fixture { state, dir }
    }

    fn set(
        f: &Fixture,
        transaction_id: i64,
        category_id: Option<i64>,
        note: Option<&str>,
    ) -> Result<(), AppError> {
        run(set_category(
            &f.state,
            SetTransactionCategoryRequest {
                transaction_id,
                category_id,
                note: note.map(Into::into),
            },
        ))
    }

    /// (user, model, build, model_reviewed, note) of one overlay row.
    type Overlay = (Option<i64>, Option<i64>, Option<i64>, bool, Option<String>);

    fn overlay(f: &Fixture, id: i64) -> Option<Overlay> {
        run(sqlx::query_as(
            "SELECT user_category_id, model_category_id, model_build_id, model_reviewed, note \
             FROM transaction_categories WHERE raw_transaction_id = ?",
        )
        .bind(id)
        .fetch_optional(&security::pool(&f.state).unwrap()))
        .unwrap()
    }

    /// (category_id, set_by, reviewed) from the effective view.
    fn effective(f: &Fixture, id: i64) -> (Option<i64>, Option<String>, bool) {
        run(sqlx::query_as(
            "SELECT category_id, set_by, reviewed FROM effective_categories WHERE raw_transaction_id = ?",
        )
        .bind(id)
        .fetch_one(&security::pool(&f.state).unwrap()))
        .unwrap()
    }

    fn model_answer(f: &Fixture, id: i64, category_id: i64) {
        run(sqlx::query(
            "INSERT INTO transaction_categories (raw_transaction_id, model_category_id, model_build_id, model_reviewed)
             VALUES (?, ?, 1, 0)",
        )
        .bind(id)
        .bind(category_id)
        .execute(&security::pool(&f.state).unwrap()))
        .unwrap();
    }

    #[test]
    fn saving_a_category_marks_it_user_set_and_reviewed() {
        let f = fixture("save");
        set(&f, 1, Some(4), Some("  weekly shop  ")).unwrap();
        assert_eq!(
            overlay(&f, 1),
            Some((Some(4), None, None, false, Some("weekly shop".into())))
        );
        assert_eq!(effective(&f, 1), (Some(4), Some("user".into()), true));
    }

    #[test]
    fn saving_the_models_answer_still_marks_it_user_set() {
        let f = fixture("same-as-model");
        model_answer(&f, 1, 5);
        assert_eq!(effective(&f, 1), (Some(5), Some("model".into()), false));
        set(&f, 1, Some(5), None).unwrap();
        assert_eq!(overlay(&f, 1), Some((Some(5), None, None, false, None)));
        assert_eq!(effective(&f, 1), (Some(5), Some("user".into()), true));
    }

    #[test]
    fn clearing_keeps_the_note_and_leaves_the_row_open_to_the_model() {
        let f = fixture("clear");
        model_answer(&f, 1, 5);
        set(&f, 1, Some(4), Some("keep me")).unwrap();
        set(&f, 1, None, Some("keep me")).unwrap();
        assert_eq!(
            overlay(&f, 1),
            Some((None, None, None, false, Some("keep me".into())))
        );
        assert_eq!(effective(&f, 1), (None, None, false));
        // Clearing a row that only has a model answer drops that answer too.
        model_answer(&f, 2, 5);
        set(&f, 2, None, None).unwrap();
        assert_eq!(overlay(&f, 2), Some((None, None, None, false, None)));
    }

    #[test]
    fn notes_are_trimmed_and_limited_to_500_characters() {
        let f = fixture("notes");
        set(&f, 1, None, Some("   ")).unwrap();
        assert_eq!(overlay(&f, 1).unwrap().4, None);
        let longest = format!(" {} ", "é".repeat(500));
        set(&f, 1, None, Some(&longest)).unwrap();
        assert_eq!(overlay(&f, 1).unwrap().4, Some("é".repeat(500)));
        set(&f, 1, None, Some("")).unwrap();
        assert_eq!(overlay(&f, 1).unwrap().4, None);
        match set(&f, 2, Some(4), Some(&"a".repeat(501))) {
            Err(AppError::Validation(message)) => {
                assert_eq!(message, "Use at most 500 characters.")
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
        assert_eq!(overlay(&f, 2), None);
    }

    #[test]
    fn rejects_unknown_transactions_and_categories() {
        let f = fixture("unknown");
        match set(&f, 99, Some(4), None) {
            Err(AppError::NotFound(message)) => {
                assert_eq!(message, "That transaction no longer exists.")
            }
            other => panic!("expected not found, got {other:?}"),
        }
        match set(&f, 1, Some(999), None) {
            Err(AppError::NotFound(message)) => {
                assert_eq!(message, "That category no longer exists.")
            }
            other => panic!("expected not found, got {other:?}"),
        }
        assert_eq!(overlay(&f, 1), None);
    }

    #[test]
    fn never_updates_raw_rows() {
        let f = fixture("raw");
        let pool = &security::pool(&f.state).unwrap();
        // The trigger aborts any UPDATE on raw rows, so a save that touched them would fail.
        let update =
            run(sqlx::query("UPDATE raw_transactions SET memo = 'x' WHERE id = 1").execute(pool));
        assert!(update.is_err());
        set(&f, 1, Some(4), Some("note")).unwrap();
        set(&f, 1, None, None).unwrap();
        let memo: Option<String> = run(sqlx::query_scalar(
            "SELECT memo FROM raw_transactions WHERE id = 1",
        )
        .fetch_one(pool))
        .unwrap();
        assert_eq!(memo, None);
    }

    #[test]
    fn reverting_an_import_deletes_its_overlay_rows() {
        let f = fixture("revert");
        for id in [1, 2, 3] {
            set(&f, id, Some(4), Some("note")).unwrap();
        }
        run(imports::revert(
            &f.state,
            RevertImportRequest { import_id: 1 },
        ))
        .unwrap();
        assert_eq!((overlay(&f, 1), overlay(&f, 2)), (None, None));
        assert!(overlay(&f, 3).is_some());
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
        let request = SetTransactionCategoryRequest {
            transaction_id: 1,
            category_id: None,
            note: None,
        };
        assert!(matches!(
            run(set_category(&state, request)),
            Err(AppError::Database(_))
        ));
    }
}
