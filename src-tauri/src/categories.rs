//! Categories: validation, CRUD, reorder and delete with a replacement.

use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection};

use crate::types::{
    AppError, AppState, Category, DeleteCategoryRequest, NewCategory, ReorderCategoriesRequest,
    UpdateCategoryRequest,
};
use crate::{jobs, security};

const MAX_NAME_CHARS: usize = 40;
const MAX_DESCRIPTION_CHARS: usize = 200;

/// Every category with its usage counts, followed by a fixed clause.
macro_rules! select {
    ($clause:literal) => {
        concat!(
            "SELECT c.id, c.name, c.description, c.kind, c.sort_order, \
             COALESCE(r.n, 0) AS row_count, \
             (SELECT COUNT(*) FROM nicknames WHERE default_category_id = c.id) AS nickname_count \
             FROM categories c LEFT JOIN (SELECT category_id, COUNT(*) AS n \
             FROM effective_categories GROUP BY category_id) r ON r.category_id = c.id ",
            $clause
        )
    };
}

fn category(row: SqliteRow) -> Result<Category, AppError> {
    Ok(Category {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        kind: row.try_get("kind")?,
        sort_order: row.try_get("sort_order")?,
        row_count: row.try_get("row_count")?,
        nickname_count: row.try_get("nickname_count")?,
    })
}

fn not_found() -> AppError {
    AppError::NotFound("That category no longer exists.".into())
}

/// Trims both fields and checks their lengths, then that no other category has the name (ignoring case).
async fn validate<'a>(
    conn: &mut SqliteConnection,
    id: Option<i64>,
    name: &'a str,
    description: &'a str,
) -> Result<(&'a str, &'a str), AppError> {
    let (name, description) = (name.trim(), description.trim());
    if name.is_empty() {
        return Err(AppError::Validation("Enter a category name.".into()));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::Validation(format!(
            "Use at most {MAX_NAME_CHARS} characters."
        )));
    }
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(AppError::Validation(format!(
            "Use at most {MAX_DESCRIPTION_CHARS} characters."
        )));
    }
    let taken: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM categories WHERE name = ? AND id IS NOT ?)",
    )
    .bind(name)
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    if taken {
        return Err(AppError::Validation(format!(
            "A category named {name} already exists."
        )));
    }
    Ok((name, description))
}

async fn by_id(conn: &mut SqliteConnection, id: i64) -> Result<Category, AppError> {
    let row = sqlx::query(select!("WHERE c.id = ?"))
        .bind(id)
        .fetch_optional(conn)
        .await?
        .ok_or_else(not_found)?;
    category(row)
}

async fn exists(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    let found: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM categories WHERE id = ?)")
        .bind(id)
        .fetch_one(conn)
        .await?;
    if found { Ok(()) } else { Err(not_found()) }
}

/// Every category by `sort_order`.
pub async fn list(state: &AppState) -> Result<Vec<Category>, AppError> {
    sqlx::query(select!("ORDER BY c.sort_order, c.id"))
        .fetch_all(&security::pool(state)?)
        .await?
        .into_iter()
        .map(category)
        .collect()
}

/// Adds a category after the last one.
pub async fn add(state: &AppState, request: NewCategory) -> Result<Category, AppError> {
    jobs::refuse_while_categorizing(&state.jobs)?;
    let mut tx = security::pool(state)?.begin().await?;
    let (name, description) = validate(&mut tx, None, &request.name, &request.description).await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO categories (name, description, kind, sort_order) \
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories)) RETURNING id",
    )
    .bind(name)
    .bind(description)
    .bind(request.kind)
    .fetch_one(&mut *tx)
    .await?;
    let added = by_id(&mut tx, id).await?;
    tx.commit().await?;
    Ok(added)
}

/// Renames, redescribes or changes the kind; rows stay on the category.
pub async fn update(
    state: &AppState,
    request: UpdateCategoryRequest,
) -> Result<Category, AppError> {
    jobs::refuse_while_categorizing(&state.jobs)?;
    let mut tx = security::pool(state)?.begin().await?;
    let (name, description) = validate(
        &mut tx,
        Some(request.id),
        &request.name,
        &request.description,
    )
    .await?;
    let updated =
        sqlx::query("UPDATE categories SET name = ?, description = ?, kind = ? WHERE id = ?")
            .bind(name)
            .bind(description)
            .bind(request.kind)
            .bind(request.id)
            .execute(&mut *tx)
            .await?;
    if updated.rows_affected() == 0 {
        return Err(not_found());
    }
    let category = by_id(&mut tx, request.id).await?;
    tx.commit().await?;
    Ok(category)
}

/// `request.ids` lists every category once, in the new order.
pub async fn reorder(
    state: &AppState,
    request: ReorderCategoriesRequest,
) -> Result<Vec<Category>, AppError> {
    jobs::refuse_while_categorizing(&state.jobs)?;
    let pool = security::pool(state)?;
    let mut tx = pool.begin().await?;
    let stored: Vec<i64> = sqlx::query_scalar("SELECT id FROM categories ORDER BY id")
        .fetch_all(&mut *tx)
        .await?;
    let mut given = request.ids.clone();
    given.sort_unstable();
    if given != stored {
        return Err(AppError::Validation(
            "Reorder must list every category once.".into(),
        ));
    }
    for (position, id) in (1_u32..).zip(&request.ids) {
        sqlx::query("UPDATE categories SET sort_order = ? WHERE id = ?")
            .bind(position)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    list(state).await
}

/// Deletes a category, moving its rows and nicknames to `replacement_id` or leaving them uncategorized.
pub async fn delete(state: &AppState, request: DeleteCategoryRequest) -> Result<(), AppError> {
    jobs::refuse_while_categorizing(&state.jobs)?;
    if request.replacement_id == Some(request.id) {
        return Err(AppError::Validation(
            "Pick a different category to move them to.".into(),
        ));
    }
    let mut tx = security::pool(state)?.begin().await?;
    exists(&mut tx, request.id).await?;
    match request.replacement_id {
        Some(replacement) => {
            exists(&mut tx, replacement).await?;
            // Who set a row and its reviewed state stay as they are; only the category moves.
            for sql in [
                "UPDATE transaction_categories SET user_category_id = ?1 WHERE user_category_id = ?2",
                "UPDATE transaction_categories SET model_category_id = ?1 WHERE model_category_id = ?2",
                "UPDATE nicknames SET default_category_id = ?1 WHERE default_category_id = ?2",
            ] {
                sqlx::query(sql)
                    .bind(replacement)
                    .bind(request.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        None => {
            // A row on it may hold a model answer elsewhere under the user's choice; drop that so the row ends uncategorized.
            sqlx::query(
                "UPDATE transaction_categories \
                 SET model_category_id = NULL, model_build_id = NULL, model_reviewed = 0 \
                 WHERE raw_transaction_id IN \
                 (SELECT raw_transaction_id FROM effective_categories WHERE category_id = ?)",
            )
            .bind(request.id)
            .execute(&mut *tx)
            .await?;
        }
    }
    // ON DELETE SET NULL clears whatever still points at it.
    sqlx::query("DELETE FROM categories WHERE id = ?")
        .bind(request.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use sqlx::SqlitePool;

    use super::*;
    use crate::types::{CategoryKind, JobKind, JobOutcome};
    use crate::{db, security};

    fn state(name: &str) -> (PathBuf, AppState) {
        let dir = db::temp_dir(name);
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: std::sync::RwLock::new(tauri::async_runtime::block_on(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        (dir, state)
    }

    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn run<T>(name: &str, test: impl AsyncFnOnce(&AppState, &SqlitePool) -> T) -> T {
        let (dir, state) = state(name);
        // Removes the dir even when the test panics.
        let _dir = TempDir(dir);
        tauri::async_runtime::block_on(async {
            let pool = security::pool(&state).unwrap();
            test(&state, &pool).await
        })
    }

    fn new(name: &str, description: &str) -> NewCategory {
        NewCategory {
            name: name.into(),
            description: description.into(),
            kind: CategoryKind::Spending,
        }
    }

    fn validation<T: std::fmt::Debug>(result: Result<T, AppError>) -> String {
        match result {
            Err(AppError::Validation(message)) => message,
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    fn not_found<T: std::fmt::Debug>(result: Result<T, AppError>) -> String {
        match result {
            Err(AppError::NotFound(message)) => message,
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    async fn id_of(state: &AppState, name: &str) -> i64 {
        list(state)
            .await
            .unwrap()
            .into_iter()
            .find(|category| category.name == name)
            .unwrap()
            .id
    }

    async fn count(pool: &SqlitePool, sql: &'static str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    /// Five rows: 1 user-set, 2 model-set and reviewed, 3 model-set unreviewed, 4 via a nickname default, 5 uncategorized.
    /// Groceries is the user/model category of rows 1-3 and the default of nickname "Fresh Mart" (row 4).
    async fn seed_rows(state: &AppState, pool: &SqlitePool) -> i64 {
        let groceries = id_of(state, "Groceries").await;
        for sql in [
            "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
             VALUES ('Checking', 'Sam', 'Bank', x'00', x'00')",
            "INSERT INTO imports (account_id, file_name, format, balance_check) \
             VALUES (1, 'oct.csv', 'csv', 'notChecked')",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
        for id in 1..=5 {
            sqlx::query(
                "INSERT INTO raw_transactions (id, import_id, account_id, posted_date, amount_cents, \
                 raw_description, original_row) VALUES (?, 1, 1, '2026-10-01', -500, 'Shop', 'line')",
            )
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
        }
        for (row, user, model, reviewed) in [
            (1, Some(groceries), None, 0),
            (2, None, Some(groceries), 1),
            (3, None, Some(groceries), 0),
        ] {
            sqlx::query(
                "INSERT INTO transaction_categories (raw_transaction_id, user_category_id, \
                 model_category_id, model_reviewed) VALUES (?, ?, ?, ?)",
            )
            .bind(row)
            .bind(user)
            .bind(model)
            .bind(reviewed)
            .execute(pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO nicknames (id, name, default_category_id) VALUES (1, 'Fresh Mart', ?)",
        )
        .bind(groceries)
        .execute(pool)
        .await
        .unwrap();
        for sql in [
            "INSERT INTO nickname_rules (id, nickname_id, mode, field, pattern) \
             VALUES (1, 1, 'contains', 'description', 'Shop')",
            "INSERT INTO nickname_matches (raw_transaction_id, rule_id) VALUES (4, 1)",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
        groceries
    }

    async fn effective(pool: &SqlitePool) -> Vec<(i64, Option<i64>, Option<String>, i64)> {
        sqlx::query_as(
            "SELECT raw_transaction_id, category_id, set_by, reviewed FROM effective_categories \
             ORDER BY raw_transaction_id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[test]
    fn a_fresh_database_lists_the_starter_categories_in_order() {
        run("categories-starter", async |state, _| {
            let categories = list(state).await.unwrap();
            assert_eq!(categories.len(), 22);
            let orders: Vec<u32> = categories.iter().map(|c| c.sort_order).collect();
            assert_eq!(orders, (1..=22).collect::<Vec<u32>>());
            assert_eq!(categories[0].name, "Housing");
            assert!(categories.iter().all(|c| !c.description.is_empty()));
            assert!(
                categories
                    .iter()
                    .all(|c| c.row_count == 0 && c.nickname_count == 0)
            );
            let kind = |name: &str| categories.iter().find(|c| c.name == name).unwrap().kind;
            assert_eq!(kind("Paycheck"), CategoryKind::Income);
            assert_eq!(kind("Other income"), CategoryKind::Income);
            assert_eq!(kind("Savings transfer"), CategoryKind::Transfer);
        });
    }

    #[test]
    fn add_trims_and_appends_last() {
        run("categories-add", async |state, _| {
            let added = add(
                state,
                NewCategory {
                    kind: CategoryKind::Income,
                    ..new("  Side gig ", "  Freelance work  ")
                },
            )
            .await
            .unwrap();
            assert_eq!(added.name, "Side gig");
            assert_eq!(added.description, "Freelance work");
            assert_eq!(added.kind, CategoryKind::Income);
            assert_eq!(added.sort_order, 23);
            let last = list(state).await.unwrap().pop().unwrap();
            assert_eq!((last.id, last.name.as_str()), (added.id, "Side gig"));
        });
    }

    #[test]
    fn add_refuses_bad_names_and_descriptions_and_stores_nothing() {
        run("categories-add-invalid", async |state, pool| {
            let cases = [
                (new("   ", ""), "Enter a category name."),
                (new(&"a".repeat(41), ""), "Use at most 40 characters."),
                (
                    new(" groceries ", ""),
                    "A category named groceries already exists.",
                ),
                (new("Pets", &"d".repeat(201)), "Use at most 200 characters."),
            ];
            for (request, message) in cases {
                assert_eq!(validation(add(state, request).await), message);
            }
            assert_eq!(count(pool, "SELECT COUNT(*) FROM categories").await, 22);
            // The limits themselves are allowed, counted in characters, after trimming.
            add(
                state,
                new(&format!(" {} ", "é".repeat(40)), &"d".repeat(200)),
            )
            .await
            .unwrap();
        });
    }

    #[test]
    fn update_changes_fields_and_allows_a_case_only_rename() {
        run("categories-update", async |state, pool| {
            let groceries = seed_rows(state, pool).await;
            let updated = update(
                state,
                UpdateCategoryRequest {
                    id: groceries,
                    name: " GROCERIES ".into(),
                    description: " Food ".into(),
                    kind: CategoryKind::Spending,
                },
            )
            .await
            .unwrap();
            assert_eq!(updated.name, "GROCERIES");
            assert_eq!(updated.description, "Food");
            assert_eq!(updated.sort_order, 4);
            assert_eq!((updated.row_count, updated.nickname_count), (4, 1));
        });
    }

    #[test]
    fn update_refuses_bad_fields_and_unknown_ids_and_stores_nothing() {
        run("categories-update-invalid", async |state, pool| {
            let groceries = id_of(state, "Groceries").await;
            let request = |name: &str, description: &str| UpdateCategoryRequest {
                id: groceries,
                name: name.into(),
                description: description.into(),
                kind: CategoryKind::Income,
            };
            let cases = [
                (request("", ""), "Enter a category name."),
                (request(&"a".repeat(41), ""), "Use at most 40 characters."),
                (
                    request("dining OUT", ""),
                    "A category named dining OUT already exists.",
                ),
                (
                    request("Food", &"d".repeat(201)),
                    "Use at most 200 characters.",
                ),
            ];
            for (request, message) in cases {
                assert_eq!(validation(update(state, request).await), message);
            }
            assert_eq!(
                not_found(
                    update(
                        state,
                        UpdateCategoryRequest {
                            id: 999,
                            ..request("Food", "")
                        }
                    )
                    .await
                ),
                "That category no longer exists."
            );
            let stored: (String, String) =
                sqlx::query_as("SELECT name, kind FROM categories WHERE id = ?")
                    .bind(groceries)
                    .fetch_one(pool)
                    .await
                    .unwrap();
            assert_eq!(stored, ("Groceries".into(), "spending".into()));
        });
    }

    #[test]
    fn a_kind_change_keeps_the_rows_on_the_category() {
        run("categories-kind", async |state, pool| {
            let groceries = seed_rows(state, pool).await;
            let before = effective(pool).await;
            let updated = update(
                state,
                UpdateCategoryRequest {
                    id: groceries,
                    name: "Groceries".into(),
                    description: "Food".into(),
                    kind: CategoryKind::Transfer,
                },
            )
            .await
            .unwrap();
            assert_eq!(updated.kind, CategoryKind::Transfer);
            assert_eq!(effective(pool).await, before);
            // Kind is read live by joining the effective category to categories.
            let kinds: Vec<String> = sqlx::query_scalar(
                "SELECT c.kind FROM effective_categories e JOIN categories c ON c.id = e.category_id",
            )
            .fetch_all(pool)
            .await
            .unwrap();
            assert_eq!(kinds, vec!["transfer"; 4]);
        });
    }

    #[test]
    fn reorder_stores_the_new_order() {
        run("categories-reorder", async |state, _| {
            let mut ids: Vec<i64> = list(state).await.unwrap().iter().map(|c| c.id).collect();
            ids.reverse();
            let reordered = reorder(state, ReorderCategoriesRequest { ids: ids.clone() })
                .await
                .unwrap();
            let listed: Vec<i64> = list(state).await.unwrap().iter().map(|c| c.id).collect();
            assert_eq!(listed, ids);
            assert_eq!(reordered.iter().map(|c| c.id).collect::<Vec<_>>(), ids);
            assert_eq!(reordered[0].sort_order, 1);
            assert_eq!(reordered[0].name, "Credit card payment");
        });
    }

    #[test]
    fn reorder_refuses_lists_that_are_not_every_category_once() {
        run("categories-reorder-invalid", async |state, _| {
            let ids: Vec<i64> = list(state).await.unwrap().iter().map(|c| c.id).collect();
            let mut duplicate = ids.clone();
            duplicate[1] = duplicate[0];
            let mut unknown = ids.clone();
            unknown[0] = 999;
            let mut extra = ids.clone();
            extra.push(ids[0]);
            for bad in [vec![], ids[1..].to_vec(), duplicate, unknown, extra] {
                assert_eq!(
                    validation(reorder(state, ReorderCategoriesRequest { ids: bad }).await),
                    "Reorder must list every category once."
                );
            }
            let listed: Vec<i64> = list(state).await.unwrap().iter().map(|c| c.id).collect();
            assert_eq!(listed, ids);
        });
    }

    #[test]
    fn delete_with_a_replacement_moves_rows_and_nicknames_keeping_set_by_and_reviewed() {
        run("categories-delete-move", async |state, pool| {
            let groceries = seed_rows(state, pool).await;
            let used = list(state)
                .await
                .unwrap()
                .into_iter()
                .find(|c| c.id == groceries)
                .unwrap();
            assert_eq!((used.row_count, used.nickname_count), (4, 1));
            let dining = id_of(state, "Dining out").await;
            delete(
                state,
                DeleteCategoryRequest {
                    id: groceries,
                    replacement_id: Some(dining),
                },
            )
            .await
            .unwrap();
            let some = |s: &str| Some(s.to_string());
            assert_eq!(
                effective(pool).await,
                vec![
                    (1, Some(dining), some("user"), 1),
                    (2, Some(dining), some("model"), 1),
                    (3, Some(dining), some("model"), 0),
                    (4, Some(dining), some("nickname"), 1),
                    (5, None, None, 0),
                ]
            );
            let categories = list(state).await.unwrap();
            assert_eq!(categories.len(), 21);
            assert!(categories.iter().all(|c| c.id != groceries));
            let moved = categories.iter().find(|c| c.id == dining).unwrap();
            assert_eq!((moved.row_count, moved.nickname_count), (4, 1));
        });
    }

    #[test]
    fn delete_without_a_replacement_leaves_rows_uncategorized_and_clears_defaults() {
        run("categories-delete-clear", async |state, pool| {
            let groceries = seed_rows(state, pool).await;
            // Row 1 also has a model answer elsewhere; it still ends up uncategorized.
            let dining = id_of(state, "Dining out").await;
            sqlx::query("UPDATE transaction_categories SET model_category_id = ? WHERE raw_transaction_id = 1")
                .bind(dining)
                .execute(pool)
                .await
                .unwrap();
            delete(
                state,
                DeleteCategoryRequest {
                    id: groceries,
                    replacement_id: None,
                },
            )
            .await
            .unwrap();
            assert!(
                effective(pool)
                    .await
                    .iter()
                    .all(|(_, category, _, _)| category.is_none())
            );
            assert_eq!(
                count(
                    pool,
                    "SELECT COUNT(*) FROM nicknames WHERE default_category_id IS NULL"
                )
                .await,
                1
            );
            assert_eq!(
                count(pool, "SELECT COUNT(*) FROM raw_transactions").await,
                5
            );
            assert_eq!(count(pool, "SELECT COUNT(*) FROM categories").await, 21);
        });
    }

    #[test]
    fn delete_refuses_a_bad_replacement_or_unknown_id_and_changes_nothing() {
        run("categories-delete-invalid", async |state, pool| {
            let groceries = seed_rows(state, pool).await;
            let before = effective(pool).await;
            assert_eq!(
                validation(
                    delete(
                        state,
                        DeleteCategoryRequest {
                            id: groceries,
                            replacement_id: Some(groceries)
                        }
                    )
                    .await
                ),
                "Pick a different category to move them to."
            );
            for request in [
                DeleteCategoryRequest {
                    id: 999,
                    replacement_id: None,
                },
                DeleteCategoryRequest {
                    id: groceries,
                    replacement_id: Some(999),
                },
            ] {
                assert_eq!(
                    not_found(delete(state, request).await),
                    "That category no longer exists."
                );
            }
            assert_eq!(effective(pool).await, before);
            assert_eq!(count(pool, "SELECT COUNT(*) FROM categories").await, 22);
        });
    }

    #[test]
    fn edits_are_refused_while_categorizing() {
        run("categories-busy", async |state, pool| {
            let groceries = id_of(state, "Groceries").await;
            let ids: Vec<i64> = list(state).await.unwrap().iter().map(|c| c.id).collect();
            jobs::start(
                &state.jobs,
                JobKind::CategorizeNow,
                "Categorize now".into(),
                |ctx| async move {
                    while !ctx.cancelled() {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    JobOutcome {
                        kind: JobKind::CategorizeNow,
                        label: "Categorize now".into(),
                        cancelled: true,
                        error: None,
                        summary: None,
                    }
                },
            )
            .unwrap();
            let busy = |result: Result<(), AppError>| match result {
                Err(AppError::Busy(message)) => {
                    assert_eq!(message, "Wait for categorizing to finish.")
                }
                other => panic!("expected Busy, got {other:?}"),
            };
            busy(add(state, new("Pets", "")).await.map(drop));
            busy(
                update(
                    state,
                    UpdateCategoryRequest {
                        id: groceries,
                        name: "Food".into(),
                        description: String::new(),
                        kind: CategoryKind::Spending,
                    },
                )
                .await
                .map(drop),
            );
            busy(
                reorder(state, ReorderCategoriesRequest { ids })
                    .await
                    .map(drop),
            );
            busy(
                delete(
                    state,
                    DeleteCategoryRequest {
                        id: groceries,
                        replacement_id: None,
                    },
                )
                .await,
            );
            jobs::stop_and_wait(&state.jobs).await;
            assert_eq!(
                count(
                    pool,
                    "SELECT COUNT(*) FROM categories WHERE name = 'Groceries'"
                )
                .await,
                1
            );
            assert_eq!(count(pool, "SELECT COUNT(*) FROM categories").await, 22);
        });
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
            assert!(matches!(
                add(&state, new("Pets", "")).await,
                Err(AppError::Database(_))
            ));
            let update_request = UpdateCategoryRequest {
                id: 1,
                name: "Pets".into(),
                description: String::new(),
                kind: CategoryKind::Spending,
            };
            assert!(matches!(
                update(&state, update_request).await,
                Err(AppError::Database(_))
            ));
            let reorder_request = ReorderCategoriesRequest { ids: vec![1] };
            assert!(matches!(
                reorder(&state, reorder_request).await,
                Err(AppError::Database(_))
            ));
            let delete_request = DeleteCategoryRequest {
                id: 1,
                replacement_id: None,
            };
            assert!(matches!(
                delete(&state, delete_request).await,
                Err(AppError::Database(_))
            ));
        });
    }
}
