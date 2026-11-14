//! The transaction list: sorting, date filtering, search and paging in SQLite.

use sqlx::{QueryBuilder, Row, Sqlite};

use crate::security;
use crate::types::{
    AppError, AppState, SortDirection, Transaction, TransactionPage, TransactionQuery,
    TransactionSort,
};

const MAX_PAGE_SIZE: u32 = 200;
const MAX_SEARCH_CHARS: usize = 200;

/// Validated filters: dates are strict "YYYY-MM-DD", search is a LIKE pattern with wildcards escaped.
struct Filters {
    from: Option<String>,
    to: Option<String>,
    pattern: Option<String>,
}

/// One page of the checking account's raw transactions.
pub async fn list(state: &AppState, query: TransactionQuery) -> Result<TransactionPage, AppError> {
    let filters = validate(&query)?;
    let pool = security::pool(state)?;

    let mut count = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM raw_transactions");
    push_filters(&mut count, &filters);
    let total: u32 = count.build_query_scalar().fetch_one(pool).await?;

    let mut select = QueryBuilder::<Sqlite>::new(
        "SELECT id, import_id, posted_date, amount_cents, raw_description, memo, \
         transaction_type, running_balance_cents FROM raw_transactions",
    );
    push_filters(&mut select, &filters);
    let column = match query.sort {
        TransactionSort::Date => "posted_date",
        TransactionSort::Amount => "amount_cents",
        TransactionSort::Description => "raw_description COLLATE NOCASE",
    };
    let direction = match query.direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    };
    // Both are fixed strings from the enums above, never user text.
    select.push(format_args!(
        " ORDER BY {column} {direction}, id {direction} LIMIT "
    ));
    select.push_bind(i64::from(query.page_size));
    select.push(" OFFSET ");
    // u32 * u32 always fits in i64.
    select.push_bind(i64::from(query.page) * i64::from(query.page_size));

    let rows = select
        .build()
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| Transaction {
            id: row.get("id"),
            import_id: row.get("import_id"),
            posted_date: row.get("posted_date"),
            amount_cents: row.get("amount_cents"),
            description: row.get("raw_description"),
            memo: row.get("memo"),
            transaction_type: row.get("transaction_type"),
            running_balance_cents: row.get("running_balance_cents"),
        })
        .collect();
    Ok(TransactionPage { rows, total })
}

fn validate(query: &TransactionQuery) -> Result<Filters, AppError> {
    if !(1..=MAX_PAGE_SIZE).contains(&query.page_size) {
        return Err(AppError::Validation(format!(
            "pageSize must be 1 to {MAX_PAGE_SIZE}"
        )));
    }
    let date = |field: &str, value: &Option<String>| match value {
        Some(text) if !is_date(text) => Err(AppError::Validation(format!(
            "{field} must be a date in YYYY-MM-DD form"
        ))),
        _ => Ok(value.clone()),
    };
    let from = date("from", &query.from)?;
    let to = date("to", &query.to)?;
    if let (Some(from), Some(to)) = (&from, &to) {
        // Same fixed-width form, so text order is date order.
        if from > to {
            return Err(AppError::Validation("from must not be after to".into()));
        }
    }
    let search = query.search.as_deref().map(str::trim).unwrap_or("");
    if search.chars().count() > MAX_SEARCH_CHARS {
        return Err(AppError::Validation(format!(
            "search must be at most {MAX_SEARCH_CHARS} characters"
        )));
    }
    let pattern = (!search.is_empty()).then(|| {
        let escaped = search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        format!("%{escaped}%")
    });
    Ok(Filters { from, to, pattern })
}

/// A real calendar date in strict "YYYY-MM-DD" form, year 0001 or later.
pub(crate) fn is_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    let shape = bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, byte)| match i {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });
    if !shape {
        return false;
    }
    // All ASCII digits, so parsing cannot fail.
    let number = |range: std::ops::Range<usize>| text[range].parse::<u32>().unwrap_or(0);
    let (year, month, day) = (number(0..4), number(5..7), number(8..10));
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    year > 0 && (1..=days).contains(&day)
}

/// The WHERE clause shared by the count and the page: the checking account (lowest id) plus filters.
fn push_filters(builder: &mut QueryBuilder<Sqlite>, filters: &Filters) {
    builder.push(" WHERE account_id = (SELECT MIN(id) FROM accounts)");
    if let Some(from) = &filters.from {
        builder
            .push(" AND posted_date >= ")
            .push_bind(from.as_str());
    }
    if let Some(to) = &filters.to {
        builder.push(" AND posted_date <= ").push_bind(to.as_str());
    }
    if let Some(pattern) = &filters.pattern {
        // LIKE is case-insensitive for ASCII only (SQLite without ICU).
        builder
            .push(" AND (raw_description LIKE ")
            .push_bind(pattern.as_str())
            .push(" ESCAPE '\\' OR memo LIKE ")
            .push_bind(pattern.as_str())
            .push(" ESCAPE '\\')");
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::db;

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

    /// (posted_date, amount_cents, raw_description, memo); ids follow this order, 1-based.
    const ROWS: [(&str, i64, &str, Option<&str>); 6] = [
        ("2026-10-01", -450, "Coffee Shop", None),
        ("2026-10-02", 250000, "PAYROLL", Some("october salary")),
        ("2026-10-02", -1299, "grocery store", Some("50% off_sale")),
        ("2026-10-03", -450, "Bakery", Some("COFFEE beans")),
        ("2026-10-05", -8000, "Utility 100%", None),
        ("2026-10-07", -2000, "a\\b transfer", None),
    ];

    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("transactions-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: run(db::connect(&dir)),
            session: Default::default(),
        };
        let pool = security::pool(&state).unwrap();
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
            for (date, amount, description, memo) in ROWS {
                insert(pool, 1, date, amount, description, memo).await;
            }
            // Another account's row never shows up.
            insert(pool, 2, "2026-10-04", -1, "Coffee elsewhere", None).await;
        });
        Fixture { state, dir }
    }

    async fn insert(
        pool: &sqlx::SqlitePool,
        account_id: i64,
        date: &str,
        amount: i64,
        description: &str,
        memo: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO raw_transactions
             (import_id, account_id, posted_date, amount_cents, raw_description, memo, original_row)
             VALUES (1, ?, ?, ?, ?, ?, '<STMTTRN>')",
        )
        .bind(account_id)
        .bind(date)
        .bind(amount)
        .bind(description)
        .bind(memo)
        .execute(pool)
        .await
        .unwrap();
    }

    fn query() -> TransactionQuery {
        TransactionQuery {
            from: None,
            to: None,
            search: None,
            sort: TransactionSort::Date,
            direction: SortDirection::Asc,
            page: 0,
            page_size: 200,
        }
    }

    fn ids(fixture: &Fixture, change: impl FnOnce(&mut TransactionQuery)) -> (Vec<i64>, u32) {
        let mut q = query();
        change(&mut q);
        let page = run(list(&fixture.state, q)).unwrap();
        (page.rows.iter().map(|row| row.id).collect(), page.total)
    }

    fn error(change: impl FnOnce(&mut TransactionQuery)) -> String {
        let mut q = query();
        change(&mut q);
        match validate(&q) {
            Err(AppError::Validation(message)) => message,
            _ => panic!("expected a validation error"),
        }
    }

    #[test]
    fn sorts_by_each_column_with_id_as_tie_breaker() {
        let f = fixture("sort");
        use SortDirection::{Asc, Desc};
        use TransactionSort::{Amount, Date, Description};
        for (sort, direction, expected) in [
            (Date, Asc, vec![1, 2, 3, 4, 5, 6]),
            (Date, Desc, vec![6, 5, 4, 3, 2, 1]),
            (Amount, Asc, vec![5, 6, 3, 1, 4, 2]),
            (Amount, Desc, vec![2, 4, 1, 3, 6, 5]),
            (Description, Asc, vec![6, 4, 1, 3, 2, 5]),
            (Description, Desc, vec![5, 2, 3, 1, 4, 6]),
        ] {
            let (got, total) = ids(&f, |q| (q.sort, q.direction) = (sort, direction));
            assert_eq!(got, expected, "{sort:?} {direction:?}");
            assert_eq!(total, 6);
        }
    }

    #[test]
    fn maps_every_field() {
        let f = fixture("fields");
        let page = run(list(&f.state, query())).unwrap();
        let row = &page.rows[2];
        assert_eq!(
            (row.id, row.import_id, row.posted_date.as_str()),
            (3, 1, "2026-10-02")
        );
        assert_eq!(
            (row.amount_cents, row.description.as_str()),
            (-1299, "grocery store")
        );
        assert_eq!(row.memo.as_deref(), Some("50% off_sale"));
        assert_eq!(
            (row.transaction_type.clone(), row.running_balance_cents),
            (None, None)
        );
    }

    #[test]
    fn date_bounds_are_inclusive() {
        let f = fixture("dates");
        let range = |from: Option<&str>, to: Option<&str>| {
            ids(&f, |q| {
                q.from = from.map(Into::into);
                q.to = to.map(Into::into);
            })
        };
        assert_eq!(
            range(Some("2026-10-02"), Some("2026-10-05")),
            (vec![2, 3, 4, 5], 4)
        );
        assert_eq!(
            range(Some("2026-10-02"), Some("2026-10-02")),
            (vec![2, 3], 2)
        );
        assert_eq!(range(Some("2026-10-05"), None), (vec![5, 6], 2));
        assert_eq!(range(None, Some("2026-10-01")), (vec![1], 1));
        assert_eq!(range(Some("2026-11-01"), None), (vec![], 0));
    }

    #[test]
    fn search_matches_description_or_memo_case_insensitively() {
        let f = fixture("search");
        let search = |text: Option<&str>| ids(&f, |q| q.search = text.map(Into::into));
        assert_eq!(search(Some("  coffee ")), (vec![1, 4], 2));
        assert_eq!(search(Some("SALARY")), (vec![2], 1));
        assert_eq!(search(Some("   ")), (vec![1, 2, 3, 4, 5, 6], 6));
        assert_eq!(search(None).1, 6);
        assert_eq!(search(Some("nothing")), (vec![], 0));
    }

    #[test]
    fn search_treats_wildcards_and_escape_literally() {
        let f = fixture("wildcards");
        let search = |text: &str| ids(&f, |q| q.search = Some(text.into())).0;
        assert_eq!(search("%"), vec![3, 5]);
        assert_eq!(search("0%"), vec![3, 5]);
        assert_eq!(search("_"), vec![3]);
        assert_eq!(search("off_s"), vec![3]);
        assert_eq!(search("o_f"), Vec::<i64>::new());
        assert_eq!(search("\\"), vec![6]);
        assert_eq!(search("a\\b"), vec![6]);
    }

    #[test]
    fn pages_with_total_of_all_matches() {
        let f = fixture("paging");
        let page = |page: u32| {
            ids(&f, |q| {
                q.page = page;
                q.page_size = 4;
            })
        };
        assert_eq!(page(0), (vec![1, 2, 3, 4], 6));
        assert_eq!(page(1), (vec![5, 6], 6));
        assert_eq!(page(2), (vec![], 6));
        assert_eq!(page(u32::MAX), (vec![], 6));
        let filtered = ids(&f, |q| {
            q.search = Some("coffee".into());
            q.page = 1;
            q.page_size = 1;
        });
        assert_eq!(filtered, (vec![4], 2));
    }

    #[test]
    fn rejects_invalid_queries() {
        let size = "pageSize must be 1 to 200";
        assert_eq!(error(|q| q.page_size = 0), size);
        assert_eq!(error(|q| q.page_size = 201), size);
        assert!(
            validate(&TransactionQuery {
                page_size: 1,
                ..query()
            })
            .is_ok()
        );
        for bad in [
            "2026-1-01",
            "2026/10/01",
            "26-10-01",
            "2026-10-01T00",
            "2026-13-01",
            "2026-00-10",
            "2026-02-29",
            "2026-04-31",
            "2026-10-00",
            "+026-10-01",
            "2026-+1-01",
            "",
        ] {
            assert_eq!(
                error(|q| q.from = Some(bad.into())),
                "from must be a date in YYYY-MM-DD form",
                "{bad}"
            );
            assert_eq!(
                error(|q| q.to = Some(bad.into())),
                "to must be a date in YYYY-MM-DD form"
            );
        }
        assert!(is_date("2024-02-29") && is_date("2000-02-29") && !is_date("1900-02-29"));
        assert!(!is_date("0000-01-01"));
        assert_eq!(
            error(|q| {
                q.from = Some("2026-10-02".into());
                q.to = Some("2026-10-01".into());
            }),
            "from must not be after to"
        );
        assert!(
            validate(&TransactionQuery {
                search: Some(format!("  {}  ", "é".repeat(200))),
                ..query()
            })
            .is_ok()
        );
        assert_eq!(
            error(|q| q.search = Some("a".repeat(201))),
            "search must be at most 200 characters"
        );
    }

    #[test]
    fn reports_a_missing_database() {
        let state = AppState {
            db: Err("no database".into()),
            session: Default::default(),
        };
        assert!(matches!(
            run(list(&state, query())),
            Err(AppError::Database(_))
        ));
    }
}
