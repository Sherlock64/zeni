//! Nicknames: rule validation, the matcher, the derived `nickname_matches` lookup table, CRUD and stale flags.

use std::collections::HashMap;

use regex::{Regex, RegexBuilder};
use sqlx::{Row, SqliteConnection, SqlitePool};

use crate::types::{
    AppError, AppState, DeleteNicknameRequest, DeleteNicknameRuleRequest, MatchField, MatchMode,
    Nickname, NicknameRule, NicknameSettings, RuleInput, SaveNicknameRuleRequest,
    UpdateNicknameRequest, UpdateNicknameRuleRequest,
};
use crate::{db, security};

const MAX_NAME_CHARS: usize = 100;
const MAX_PATTERN_CHARS: usize = 500;
const STALE_DAYS_KEY: &str = "nickname_stale_days";
const DEFAULT_STALE_DAYS: u32 = 90;
const MAX_STALE_DAYS: u32 = 3650;

enum Matcher {
    /// Lowercased pattern.
    Exact(String),
    /// Lowercased pattern.
    Contains(String),
    Regex(Regex),
}

/// A compiled rule.
struct Rule {
    id: i64,
    field: MatchField,
    matcher: Matcher,
}

impl Rule {
    fn matches(&self, description: &str, memo: Option<&str>) -> bool {
        let text = match self.field {
            MatchField::Description => description,
            MatchField::Memo => match memo {
                Some(memo) => memo,
                None => return false,
            },
        };
        match &self.matcher {
            Matcher::Exact(pattern) => text.trim().to_lowercase() == *pattern,
            Matcher::Contains(pattern) => text.to_lowercase().contains(pattern.as_str()),
            Matcher::Regex(regex) => regex.is_match(text),
        }
    }
}

fn mode_rank(mode: MatchMode) -> u8 {
    match mode {
        MatchMode::Exact => 0,
        MatchMode::Contains => 1,
        MatchMode::Regex => 2,
    }
}

/// Trims the pattern, checks its length and compiles it.
fn compile(mode: MatchMode, pattern: &str) -> Result<(String, Matcher), AppError> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err(AppError::Validation("Enter a pattern.".into()));
    }
    if pattern.chars().count() > MAX_PATTERN_CHARS {
        return Err(AppError::Validation(format!(
            "Patterns can be at most {MAX_PATTERN_CHARS} characters."
        )));
    }
    let matcher = match mode {
        MatchMode::Exact => Matcher::Exact(pattern.to_lowercase()),
        MatchMode::Contains => Matcher::Contains(pattern.to_lowercase()),
        MatchMode::Regex => Matcher::Regex(
            RegexBuilder::new(pattern)
                .case_insensitive(true)
                .build()
                .map_err(|error| {
                    AppError::Validation(format!("That regex isn't valid: {error}"))
                })?,
        ),
    };
    Ok((pattern.into(), matcher))
}

fn validate_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Enter a nickname.".into()));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::Validation(format!(
            "Nicknames can be at most {MAX_NAME_CHARS} characters."
        )));
    }
    Ok(name)
}

fn nickname_not_found() -> AppError {
    AppError::NotFound("That nickname no longer exists.".into())
}

fn rule_not_found() -> AppError {
    AppError::NotFound("That rule no longer exists.".into())
}

async fn check_category(conn: &mut SqliteConnection, id: Option<i64>) -> Result<(), AppError> {
    let Some(id) = id else { return Ok(()) };
    let found: Option<i64> = sqlx::query_scalar("SELECT id FROM categories WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
    found
        .map(drop)
        .ok_or_else(|| AppError::NotFound("That category no longer exists.".into()))
}

/// Rules of enabled nicknames, best first by the precedence key.
async fn enabled_rules(conn: &mut SqliteConnection) -> Result<Vec<Rule>, AppError> {
    let rows: Vec<(i64, MatchMode, MatchField, String)> = sqlx::query_as(
        "SELECT r.id, r.mode, r.field, r.pattern FROM nickname_rules r \
         JOIN nicknames n ON n.id = r.nickname_id WHERE n.enabled = 1",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut rules = Vec::with_capacity(rows.len());
    for (id, mode, field, pattern) in rows {
        let key = (
            mode_rank(mode),
            std::cmp::Reverse(pattern.chars().count()),
            id,
        );
        rules.push((
            key,
            Rule {
                id,
                field,
                matcher: compile(mode, &pattern)?.1,
            },
        ));
    }
    rules.sort_by_key(|(key, _)| *key);
    Ok(rules.into_iter().map(|(_, rule)| rule).collect())
}

/// Fills `nickname_matches` for raw rows of `import_id`, or of every import when `None`.
async fn fill(conn: &mut SqliteConnection, import_id: Option<i64>) -> Result<(), AppError> {
    let rules = enabled_rules(conn).await?;
    if rules.is_empty() {
        return Ok(());
    }
    let rows: Vec<(i64, String, Option<String>)> = sqlx::query_as(
        "SELECT id, raw_description, memo FROM raw_transactions WHERE ? IS NULL OR import_id = ?",
    )
    .bind(import_id)
    .bind(import_id)
    .fetch_all(&mut *conn)
    .await?;
    for (row_id, description, memo) in rows {
        if let Some(rule) = rules
            .iter()
            .find(|rule| rule.matches(&description, memo.as_deref()))
        {
            sqlx::query("INSERT INTO nickname_matches (raw_transaction_id, rule_id) VALUES (?, ?)")
                .bind(row_id)
                .bind(rule.id)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

/// Recomputes the whole lookup table; call inside the caller's transaction.
async fn rebuild(conn: &mut SqliteConnection) -> Result<(), AppError> {
    sqlx::query("DELETE FROM nickname_matches")
        .execute(&mut *conn)
        .await?;
    fill(conn, None).await?;
    // A nickname default overrides the model; dropping its answer keeps it from coming back later.
    sqlx::query(
        "UPDATE transaction_categories SET model_category_id = NULL, model_build_id = NULL, \
         model_reviewed = 0 WHERE raw_transaction_id IN (SELECT m.raw_transaction_id \
         FROM nickname_matches m JOIN nickname_rules r ON r.id = m.rule_id \
         JOIN nicknames n ON n.id = r.nickname_id \
         WHERE n.enabled = 1 AND n.default_category_id IS NOT NULL)",
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Matches the new rows of one import; called inside the commit transaction.
pub(crate) async fn match_import(
    conn: &mut SqliteConnection,
    import_id: i64,
) -> Result<(), AppError> {
    fill(conn, Some(import_id)).await
}

async fn stale_days(pool: &SqlitePool) -> Result<u32, AppError> {
    let value = db::meta(pool, STALE_DAYS_KEY).await?;
    // A missing or corrupt value falls back to the default on purpose, so the list still loads.
    Ok(value
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_STALE_DAYS))
}

async fn all(pool: &SqlitePool) -> Result<Vec<Nickname>, AppError> {
    let days = stale_days(pool).await?;
    // The newest posted date minus D days; NULL when there are no transactions.
    let cutoff: Option<String> = sqlx::query_scalar(
        "SELECT date(MAX(posted_date), '-' || ? || ' days') FROM raw_transactions",
    )
    .bind(days)
    .fetch_one(pool)
    .await?;
    let mut rules: HashMap<i64, Vec<NicknameRule>> = HashMap::new();
    for row in sqlx::query(
        "SELECT r.id, r.nickname_id, r.mode, r.field, r.pattern, \
         COUNT(t.id) AS match_count, MAX(t.posted_date) AS last_matched \
         FROM nickname_rules r \
         LEFT JOIN nickname_matches m ON m.rule_id = r.id \
         LEFT JOIN raw_transactions t ON t.id = m.raw_transaction_id \
         GROUP BY r.id ORDER BY r.id",
    )
    .fetch_all(pool)
    .await?
    {
        let rule = NicknameRule {
            id: row.try_get("id")?,
            nickname_id: row.try_get("nickname_id")?,
            mode: row.try_get("mode")?,
            field: row.try_get("field")?,
            pattern: row.try_get("pattern")?,
            match_count: row.try_get("match_count")?,
            last_matched: row.try_get("last_matched")?,
        };
        rules.entry(rule.nickname_id).or_default().push(rule);
    }
    let nicknames = sqlx::query(
        "SELECT id, name, enabled, stale_exempt, default_category_id FROM nicknames \
         ORDER BY name COLLATE NOCASE, id",
    )
    .fetch_all(pool)
    .await?;
    nicknames
        .into_iter()
        .map(|row| {
            let id: i64 = row.try_get("id")?;
            let stale_exempt: bool = row.try_get("stale_exempt")?;
            let own = rules.remove(&id).unwrap_or_default();
            let last_matched = own
                .iter()
                .filter_map(|rule| rule.last_matched.clone())
                .max();
            let stale = !stale_exempt
                && match (&last_matched, &cutoff) {
                    (Some(last), Some(cutoff)) => last < cutoff,
                    _ => true,
                };
            Ok(Nickname {
                id,
                name: row.try_get("name")?,
                enabled: row.try_get("enabled")?,
                stale_exempt,
                match_count: own.iter().map(|rule| rule.match_count).sum(),
                last_matched,
                stale,
                rules: own,
                default_category_id: row.try_get("default_category_id")?,
            })
        })
        .collect::<Result<_, sqlx::Error>>()
        .map_err(Into::into)
}

async fn one(pool: &SqlitePool, id: i64) -> Result<Nickname, AppError> {
    all(pool)
        .await?
        .into_iter()
        .find(|nickname| nickname.id == id)
        .ok_or_else(nickname_not_found)
}

/// Every nickname with its rules, counts and stale flag, by name.
pub async fn list(state: &AppState) -> Result<Vec<Nickname>, AppError> {
    all(&security::pool(state)?).await
}

/// Adds a rule to the nickname named `request.name` (case-insensitive), creating it if needed.
pub async fn save_rule(
    state: &AppState,
    request: SaveNicknameRuleRequest,
) -> Result<Nickname, AppError> {
    let name = validate_name(&request.name)?;
    let (pattern, _) = compile(request.rule.mode, &request.rule.pattern)?;
    let pool = security::pool(state)?;
    let mut tx = pool.begin().await?;
    check_category(&mut tx, request.default_category_id).await?;
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM nicknames WHERE name = ?")
        .bind(name)
        .fetch_optional(&mut *tx)
        .await?;
    let nickname_id = match existing {
        Some(id) => {
            let rules: Vec<(MatchMode, MatchField, String)> = sqlx::query_as(
                "SELECT mode, field, pattern FROM nickname_rules WHERE nickname_id = ?",
            )
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
            let lower = pattern.to_lowercase();
            if rules.iter().any(|(mode, field, existing)| {
                *mode == request.rule.mode
                    && *field == request.rule.field
                    && existing.to_lowercase() == lower
            }) {
                return Err(AppError::Validation(
                    "That nickname already has this rule.".into(),
                ));
            }
            sqlx::query("UPDATE nicknames SET default_category_id = ? WHERE id = ?")
                .bind(request.default_category_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            id
        }
        None => sqlx::query("INSERT INTO nicknames (name, default_category_id) VALUES (?, ?)")
            .bind(name)
            .bind(request.default_category_id)
            .execute(&mut *tx)
            .await?
            .last_insert_rowid(),
    };
    sqlx::query(
        "INSERT INTO nickname_rules (nickname_id, mode, field, pattern) VALUES (?, ?, ?, ?)",
    )
    .bind(nickname_id)
    .bind(request.rule.mode)
    .bind(request.rule.field)
    .bind(&pattern)
    .execute(&mut *tx)
    .await?;
    rebuild(&mut tx).await?;
    tx.commit().await?;
    one(&pool, nickname_id).await
}

/// How many rows the rule matches on its own, ignoring precedence and `enabled`.
pub async fn count_matches(state: &AppState, rule: RuleInput) -> Result<u32, AppError> {
    let (_, matcher) = compile(rule.mode, &rule.pattern)?;
    let rule = Rule {
        id: 0,
        field: rule.field,
        matcher,
    };
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT raw_description, memo FROM raw_transactions")
            .fetch_all(&security::pool(state)?)
            .await?;
    let count = rows
        .iter()
        .filter(|(description, memo)| rule.matches(description, memo.as_deref()))
        .count();
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

/// Renames a nickname and sets its flags.
pub async fn update(
    state: &AppState,
    request: UpdateNicknameRequest,
) -> Result<Nickname, AppError> {
    let name = validate_name(&request.name)?;
    let pool = security::pool(state)?;
    let mut tx = pool.begin().await?;
    check_category(&mut tx, request.default_category_id).await?;
    let conflict: Option<i64> =
        sqlx::query_scalar("SELECT id FROM nicknames WHERE name = ? AND id != ?")
            .bind(name)
            .bind(request.id)
            .fetch_optional(&mut *tx)
            .await?;
    if conflict.is_some() {
        return Err(AppError::Validation(format!(
            "A nickname named \"{name}\" already exists."
        )));
    }
    let updated = sqlx::query(
        "UPDATE nicknames SET name = ?, enabled = ?, stale_exempt = ?, default_category_id = ? \
             WHERE id = ?",
    )
    .bind(name)
    .bind(request.enabled)
    .bind(request.stale_exempt)
    .bind(request.default_category_id)
    .bind(request.id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(nickname_not_found());
    }
    rebuild(&mut tx).await?;
    tx.commit().await?;
    one(&pool, request.id).await
}

/// Deletes a nickname; its rules and lookup rows cascade.
pub async fn delete(state: &AppState, request: DeleteNicknameRequest) -> Result<(), AppError> {
    let mut tx = security::pool(state)?.begin().await?;
    let deleted = sqlx::query("DELETE FROM nicknames WHERE id = ?")
        .bind(request.id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(nickname_not_found());
    }
    rebuild(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

/// Replaces a rule's mode, field and pattern.
pub async fn update_rule(
    state: &AppState,
    request: UpdateNicknameRuleRequest,
) -> Result<Nickname, AppError> {
    let (pattern, _) = compile(request.rule.mode, &request.rule.pattern)?;
    let pool = security::pool(state)?;
    let mut tx = pool.begin().await?;
    let nickname_id: i64 = sqlx::query_scalar(
        "UPDATE nickname_rules SET mode = ?, field = ?, pattern = ? WHERE id = ? RETURNING nickname_id",
    )
    .bind(request.rule.mode)
    .bind(request.rule.field)
    .bind(&pattern)
    .bind(request.id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(rule_not_found)?;
    rebuild(&mut tx).await?;
    tx.commit().await?;
    one(&pool, nickname_id).await
}

/// Deletes a rule, unless it is its nickname's only rule.
pub async fn delete_rule(
    state: &AppState,
    request: DeleteNicknameRuleRequest,
) -> Result<(), AppError> {
    let mut tx = security::pool(state)?.begin().await?;
    let siblings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nickname_rules WHERE nickname_id = \
         (SELECT nickname_id FROM nickname_rules WHERE id = ?)",
    )
    .bind(request.id)
    .fetch_one(&mut *tx)
    .await?;
    match siblings {
        0 => return Err(rule_not_found()),
        1 => {
            return Err(AppError::Validation(
                "A nickname needs at least one rule. Delete the nickname instead.".into(),
            ));
        }
        _ => {}
    }
    sqlx::query("DELETE FROM nickname_rules WHERE id = ?")
        .bind(request.id)
        .execute(&mut *tx)
        .await?;
    rebuild(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn settings(state: &AppState) -> Result<NicknameSettings, AppError> {
    Ok(NicknameSettings {
        stale_days: stale_days(&security::pool(state)?).await?,
    })
}

pub async fn set_stale_days(
    state: &AppState,
    request: NicknameSettings,
) -> Result<NicknameSettings, AppError> {
    if !(1..=MAX_STALE_DAYS).contains(&request.stale_days) {
        return Err(AppError::Validation(format!(
            "Stale days must be 1 to {MAX_STALE_DAYS}."
        )));
    }
    sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
        .bind(STALE_DAYS_KEY)
        .bind(request.stale_days.to_string())
        .execute(&security::pool(state)?)
        .await?;
    Ok(request)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct Fixture {
        state: AppState,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    impl Fixture {
        fn pool(&self) -> SqlitePool {
            security::pool(&self.state).unwrap()
        }

        /// Inserts a raw row into `import_id` and returns its id.
        fn row(&self, import_id: i64, date: &str, description: &str, memo: Option<&str>) -> i64 {
            run(sqlx::query(
                "INSERT INTO raw_transactions \
                 (import_id, account_id, posted_date, amount_cents, raw_description, memo, original_row) \
                 VALUES (?, 1, ?, -100, ?, ?, '<STMTTRN>')",
            )
            .bind(import_id)
            .bind(date)
            .bind(description)
            .bind(memo)
            .execute(&self.pool()))
            .unwrap()
            .last_insert_rowid()
        }

        fn save(&self, name: &str, mode: MatchMode, field: MatchField, pattern: &str) -> Nickname {
            run(save_rule(
                &self.state,
                SaveNicknameRuleRequest {
                    name: name.into(),
                    rule: input(mode, field, pattern),
                    default_category_id: None,
                },
            ))
            .unwrap()
        }

        /// (raw_transaction_id, rule_id) pairs in the lookup table.
        fn matches(&self) -> Vec<(i64, i64)> {
            run(sqlx::query_as(
                "SELECT raw_transaction_id, rule_id FROM nickname_matches ORDER BY raw_transaction_id",
            )
            .fetch_all(&self.pool()))
            .unwrap()
        }

        fn winner(&self, row_id: i64) -> Option<i64> {
            self.matches()
                .into_iter()
                .find(|(row, _)| *row == row_id)
                .map(|(_, rule)| rule)
        }

        fn list(&self) -> Vec<Nickname> {
            run(list(&self.state)).unwrap()
        }

        fn by_name(&self, name: &str) -> Nickname {
            self.list().into_iter().find(|n| n.name == name).unwrap()
        }

        fn set(&self, nickname: &Nickname, enabled: bool, stale_exempt: bool) -> Nickname {
            run(update(
                &self.state,
                UpdateNicknameRequest {
                    id: nickname.id,
                    name: nickname.name.clone(),
                    enabled,
                    stale_exempt,
                    default_category_id: None,
                },
            ))
            .unwrap()
        }

        fn count(&self, mode: MatchMode, field: MatchField, pattern: &str) -> u32 {
            run(count_matches(&self.state, input(mode, field, pattern))).unwrap()
        }

        /// Every raw_transactions column of every row, quoted, so any change shows.
        fn raw_snapshot(&self) -> Vec<String> {
            run(sqlx::query_scalar(
                "SELECT quote(id) || quote(import_id) || quote(account_id) || quote(fitid) || \
                 quote(posted_date) || quote(amount_cents) || quote(raw_description) || quote(memo) || \
                 quote(transaction_type) || quote(running_balance_cents) || quote(bank_category) || \
                 quote(original_row) FROM raw_transactions ORDER BY id",
            )
            .fetch_all(&self.pool()))
            .unwrap()
        }
    }

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn input(mode: MatchMode, field: MatchField, pattern: &str) -> RuleInput {
        RuleInput {
            mode,
            field,
            pattern: pattern.into(),
        }
    }

    /// A fresh database with one account and two empty imports.
    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("nicknames-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: std::sync::RwLock::new(run(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let fixture = Fixture { state, dir };
        let pool = fixture.pool();
        run(async {
            sqlx::query(
                "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
                 VALUES ('Checking', 'Me', 'Bank', x'00', x'00')",
            )
            .execute(&pool)
            .await
            .unwrap();
            for _ in 0..2 {
                sqlx::query(
                    "INSERT INTO imports (account_id, file_name, format, balance_check) \
                     VALUES (1, 'a.ofx', 'ofx', 'notChecked')",
                )
                .execute(&pool)
                .await
                .unwrap();
            }
        });
        fixture
    }

    fn validation(result: Result<impl std::fmt::Debug, AppError>) -> String {
        match result {
            Err(AppError::Validation(message)) => message,
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    fn not_found(result: Result<impl std::fmt::Debug, AppError>) -> String {
        match result {
            Err(AppError::NotFound(message)) => message,
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    use MatchField::{Description, Memo};
    use MatchMode::{Contains, Exact, Regex};

    #[test]
    fn precedence_worked_example() {
        let f = fixture("precedence");
        let row = f.row(1, "2026-10-01", "AMAZON MKTPL*AB12", None);
        f.save("A1", Regex, Description, "amazon.*");
        f.save("A2", Contains, Description, "amazon");
        let r3 = f.save("A3", Contains, Description, "amazon mktpl").rules[0].id;
        let off = f.save("A4", Exact, Description, "amazon mktpl*ab12");
        let r4 = off.rules[0].id;
        assert_eq!(f.winner(row), Some(r4));
        let off = f.set(&off, false, false);
        assert_eq!(f.winner(row), Some(r3));
        // A disabled nickname has no lookup rows.
        assert_eq!((off.match_count, off.last_matched.as_deref()), (0, None));
        assert!(off.stale);
        f.set(&off, true, false);
        assert_eq!(f.winner(row), Some(r4));
        assert_eq!(f.by_name("A4").match_count, 1);
    }

    #[test]
    fn mode_rank_beats_length_and_age() {
        let f = fixture("mode-rank");
        let row = f.row(1, "2026-10-01", "Shell", Some("shell oil station"));
        // Older and longer contains (on memo) loses to a newer, shorter exact rule.
        let contains = f.save("Contains", Contains, Memo, "shell oil").rules[0].id;
        assert_eq!(f.winner(row), Some(contains));
        let exact = f.save("Exact", Exact, Description, "shell").rules[0].id;
        assert!(exact > contains);
        assert_eq!(f.winner(row), Some(exact));

        // An older, longer regex loses to a newer, shorter contains rule.
        let other = f.row(1, "2026-10-02", "Bakery Lane 7", None);
        let regex = f
            .save("Regex", Regex, Description, "^bakery lane \\d+$")
            .rules[0]
            .id;
        assert_eq!(f.winner(other), Some(regex));
        let short = f.save("Short", Contains, Description, "bak").rules[0].id;
        assert_eq!(f.winner(other), Some(short));
    }

    #[test]
    fn longest_regex_wins() {
        let f = fixture("longest-regex");
        let row = f.row(1, "2026-10-01", "Amazon Prime 12", None);
        f.save("Short", Regex, Description, "amazon");
        let long = f
            .save("Long", Regex, Description, "amazon prime \\d+")
            .rules[0]
            .id;
        f.save("Middle", Regex, Description, "amazon prime");
        assert_eq!(f.winner(row), Some(long));
    }

    #[test]
    fn equal_length_ties_go_to_the_older_rule() {
        let f = fixture("tie");
        let row = f.row(1, "2026-10-01", "Shell Oil 123", None);
        let r5 = f.save("Older", Contains, Description, "shell").rules[0].id;
        let r7 = f.save("Newer", Contains, Description, "SHELL").rules[0].id;
        assert!(r5 < r7);
        assert_eq!(f.winner(row), Some(r5));
    }

    #[test]
    fn modes_on_description() {
        let f = fixture("modes-description");
        f.row(1, "2026-10-01", "  Coffee Shop ", None);
        f.row(1, "2026-10-02", "COFFEE", Some("coffee shop"));
        assert_eq!(f.count(Exact, Description, "coffee shop"), 1);
        assert_eq!(f.count(Exact, Description, "  Coffee Shop  "), 1);
        assert_eq!(f.count(Contains, Description, "ee sh"), 1);
        assert_eq!(f.count(Exact, Description, "coffee"), 1);
        assert_eq!(f.count(Contains, Description, "coffee"), 2);
        assert_eq!(f.count(Regex, Description, "^coffee$"), 1);
        assert_eq!(f.count(Regex, Description, "shop"), 1);
        // Case-insensitive by default; `(?-i)` turns it off.
        assert_eq!(f.count(Regex, Description, "(?-i)coffee"), 0);
        assert_eq!(f.count(Regex, Description, "(?-i)COFFEE"), 1);
        // Unicode case folding.
        f.row(1, "2026-10-03", "CAFÉ ÉCLAIR", None);
        assert_eq!(f.count(Exact, Description, "café éclair"), 1);
        assert_eq!(f.count(Contains, Description, "é écl"), 1);
    }

    #[test]
    fn modes_on_memo_and_null_memo_never_matches() {
        let f = fixture("modes-memo");
        let salary = f.row(1, "2026-10-01", "PAYROLL", Some("October Salary"));
        let none = f.row(1, "2026-10-02", "october salary", None);
        assert_eq!(f.count(Exact, Memo, "october salary"), 1);
        assert_eq!(f.count(Contains, Memo, "salary"), 1);
        assert_eq!(f.count(Regex, Memo, ".*"), 1);
        let rule = f.save("Salary", Exact, Memo, "october salary").rules[0].id;
        assert_eq!(f.matches(), [(salary, rule)]);
        assert_eq!(f.winner(none), None);
    }

    #[test]
    fn count_ignores_precedence_and_enabled() {
        let f = fixture("count");
        f.row(1, "2026-10-01", "shell", None);
        let n = f.save("Shell", Exact, Description, "shell");
        f.set(&n, false, false);
        assert_eq!(f.count(Exact, Description, "shell"), 1);
        assert!(f.matches().is_empty());
    }

    #[test]
    fn stale_boundary_never_matched_exempt_and_setting() {
        let f = fixture("stale");
        f.row(1, "2026-10-31", "NEWEST", None);
        f.row(1, "2026-08-02", "EDGE", None);
        f.row(1, "2026-08-01", "OLD", None);
        let edge = f.save("Edge", Exact, Description, "edge");
        let old = f.save("Old", Exact, Description, "old");
        let never = f.save("Never", Exact, Description, "nothing");
        assert_eq!(edge.last_matched.as_deref(), Some("2026-08-02"));
        assert!(!edge.stale);
        assert_eq!(old.last_matched.as_deref(), Some("2026-08-01"));
        assert!(old.stale);
        assert_eq!(
            (never.match_count, never.last_matched.as_deref()),
            (0, None)
        );
        assert!(never.stale);
        assert!(!f.set(&old, true, true).stale);
        assert!(!f.set(&never, true, true).stale);

        assert_eq!(run(settings(&f.state)).unwrap().stale_days, 90);
        let saved = run(set_stale_days(
            &f.state,
            NicknameSettings { stale_days: 91 },
        ))
        .unwrap();
        assert_eq!(saved.stale_days, 91);
        assert_eq!(run(settings(&f.state)).unwrap().stale_days, 91);
        let old = f.set(&old, true, false);
        assert!(!old.stale);
        run(set_stale_days(
            &f.state,
            NicknameSettings { stale_days: 89 },
        ))
        .unwrap();
        assert!(f.by_name("Edge").stale);
    }

    #[test]
    fn with_no_transactions_every_non_exempt_nickname_is_stale() {
        let f = fixture("stale-empty");
        let n = f.save("Coffee", Contains, Description, "coffee");
        assert!(n.stale && n.match_count == 0 && n.last_matched.is_none());
        assert!(f.matches().is_empty());
        assert!(!f.set(&n, true, true).stale);
    }

    #[test]
    fn stale_days_must_be_1_to_3650() {
        let f = fixture("stale-days");
        for days in [0, 3651] {
            let result = run(set_stale_days(
                &f.state,
                NicknameSettings { stale_days: days },
            ));
            assert_eq!(validation(result), "Stale days must be 1 to 3650.");
        }
        for days in [1, 3650] {
            run(set_stale_days(
                &f.state,
                NicknameSettings { stale_days: days },
            ))
            .unwrap();
        }
        assert_eq!(run(settings(&f.state)).unwrap().stale_days, 3650);
    }

    #[test]
    fn pattern_validation() {
        let f = fixture("pattern");
        let save = |mode, pattern: &str| {
            run(save_rule(
                &f.state,
                SaveNicknameRuleRequest {
                    name: "X".into(),
                    rule: input(mode, Description, pattern),
                    default_category_id: None,
                },
            ))
        };
        let count =
            |mode, pattern: &str| run(count_matches(&f.state, input(mode, Description, pattern)));
        for mode in [Exact, Contains, Regex] {
            assert_eq!(validation(save(mode, "   ")), "Enter a pattern.");
            assert_eq!(validation(count(mode, "")), "Enter a pattern.");
            let long = "a".repeat(501);
            assert_eq!(
                validation(save(mode, &long)),
                "Patterns can be at most 500 characters."
            );
            assert_eq!(
                validation(count(mode, &long)),
                "Patterns can be at most 500 characters."
            );
        }
        // 500 characters (not bytes), counted after trimming, is fine.
        assert!(save(Contains, &format!(" {} ", "é".repeat(500))).is_ok());
        let message = validation(save(Regex, "abc(def"));
        assert!(message.starts_with("That regex isn't valid: "), "{message}");
        let detail = regex::Regex::new(&String::from("abc(def"))
            .unwrap_err()
            .to_string();
        assert_eq!(message, format!("That regex isn't valid: {detail}"));
        // The regex error marks the position with a caret under the pattern.
        assert!(detail.contains("abc(def\n       ^"), "{detail}");
        assert_eq!(validation(count(Regex, "abc(def")), message);
        let rule = f.by_name("X").rules[0].id;
        let update = run(update_rule(
            &f.state,
            UpdateNicknameRuleRequest {
                id: rule,
                rule: input(Regex, Description, "[a-"),
            },
        ));
        assert!(validation(update).starts_with("That regex isn't valid: "));
        // Nothing was stored by the failed calls.
        let n = f.by_name("X");
        assert_eq!(n.rules.len(), 1);
        assert_eq!(n.rules[0].mode, Contains);
        assert_eq!(f.list().len(), 1);
    }

    #[test]
    fn name_validation() {
        let f = fixture("name");
        let save = |name: &str| {
            run(save_rule(
                &f.state,
                SaveNicknameRuleRequest {
                    name: name.into(),
                    rule: input(Exact, Description, "x"),
                    default_category_id: None,
                },
            ))
        };
        assert_eq!(validation(save("  ")), "Enter a nickname.");
        assert_eq!(
            validation(save(&"a".repeat(101))),
            "Nicknames can be at most 100 characters."
        );
        let n = save(&format!("  {}  ", "é".repeat(100))).unwrap();
        assert_eq!(n.name, "é".repeat(100));
        let rename = |name: &str| {
            run(update(
                &f.state,
                UpdateNicknameRequest {
                    id: n.id,
                    name: name.into(),
                    enabled: true,
                    stale_exempt: false,
                    default_category_id: None,
                },
            ))
        };
        assert_eq!(validation(rename("")), "Enter a nickname.");
        assert_eq!(
            validation(rename(&"a".repeat(101))),
            "Nicknames can be at most 100 characters."
        );
        assert!(f.list().iter().all(|n| n.name == "é".repeat(100)));
    }

    #[test]
    fn saving_to_an_existing_name_adds_the_rule_case_insensitively() {
        let f = fixture("existing");
        let first = f.save("Coffee", Exact, Description, "corner coffee");
        let second = f.save("  COFFEE ", Contains, Memo, "beans");
        assert_eq!(second.id, first.id);
        assert_eq!(second.name, "Coffee");
        assert_eq!(second.rules.len(), 2);
        assert!(second.enabled && !second.stale_exempt);
        assert_eq!(f.list().len(), 1);
        // The same mode, field and pattern (any case) is a duplicate; another field is not.
        let duplicate = run(save_rule(
            &f.state,
            SaveNicknameRuleRequest {
                name: "coffee".into(),
                rule: input(Exact, Description, " CORNER Coffee "),
                default_category_id: None,
            },
        ));
        assert_eq!(
            validation(duplicate),
            "That nickname already has this rule."
        );
        assert_eq!(
            f.save("Coffee", Exact, Memo, "corner coffee").rules.len(),
            3
        );
        // The same rule on another nickname is fine.
        assert_eq!(
            f.save("Cafe", Exact, Description, "corner coffee")
                .rules
                .len(),
            1
        );
    }

    #[test]
    fn rename_and_flag_updates() {
        let f = fixture("rename");
        let row = f.row(1, "2026-10-01", "shell", None);
        let a = f.save("Fuel", Exact, Description, "shell");
        f.save("Gas", Contains, Description, "sh");
        let renamed = run(update(
            &f.state,
            UpdateNicknameRequest {
                id: a.id,
                name: "  Petrol ".into(),
                enabled: true,
                stale_exempt: true,
                default_category_id: None,
            },
        ))
        .unwrap();
        assert_eq!(
            (renamed.name.as_str(), renamed.stale_exempt),
            ("Petrol", true)
        );
        assert_eq!(f.winner(row), Some(a.rules[0].id));
        let conflict = run(update(
            &f.state,
            UpdateNicknameRequest {
                id: a.id,
                name: "gas".into(),
                enabled: true,
                stale_exempt: false,
                default_category_id: None,
            },
        ));
        assert_eq!(
            validation(conflict),
            "A nickname named \"gas\" already exists."
        );
        // Changing only the case of its own name is fine.
        let same = run(update(
            &f.state,
            UpdateNicknameRequest {
                id: a.id,
                name: "PETROL".into(),
                enabled: true,
                stale_exempt: false,
                default_category_id: None,
            },
        ))
        .unwrap();
        assert_eq!(same.name, "PETROL");
        let missing = run(update(
            &f.state,
            UpdateNicknameRequest {
                id: 999,
                name: "New".into(),
                enabled: true,
                stale_exempt: false,
                default_category_id: None,
            },
        ));
        assert_eq!(not_found(missing), "That nickname no longer exists.");
    }

    #[test]
    fn list_is_ordered_by_name_with_rules_by_id_and_counts() {
        let f = fixture("list");
        f.row(1, "2026-10-01", "bravo one", None);
        f.row(1, "2026-10-05", "bravo two", None);
        f.row(1, "2026-10-03", "alpha", Some("memo"));
        f.save("bravo", Contains, Description, "bravo one");
        f.save("Bravo", Contains, Description, "two");
        f.save("Alpha", Exact, Description, "alpha");
        f.save("charlie", Exact, Memo, "nothing");
        let list = f.list();
        let names: Vec<_> = list.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "bravo", "charlie"]);
        let bravo = &list[1];
        assert_eq!(bravo.match_count, 2);
        assert_eq!(bravo.last_matched.as_deref(), Some("2026-10-05"));
        let rules: Vec<_> = bravo
            .rules
            .iter()
            .map(|r| (r.pattern.as_str(), r.match_count, r.last_matched.as_deref()))
            .collect();
        assert_eq!(
            rules,
            [
                ("bravo one", 1, Some("2026-10-01")),
                ("two", 1, Some("2026-10-05"))
            ]
        );
        assert!(bravo.rules[0].id < bravo.rules[1].id);
        assert_eq!(bravo.rules[0].nickname_id, bravo.id);
    }

    #[test]
    fn rule_update_and_delete() {
        let f = fixture("rules");
        let row = f.row(1, "2026-10-01", "Shell 42", None);
        f.save("Fuel", Exact, Description, "nothing");
        let n = f.save("Fuel", Contains, Description, "shell");
        let (first, second) = (n.rules[0].id, n.rules[1].id);
        assert_eq!(f.winner(row), Some(second));
        let updated = run(update_rule(
            &f.state,
            UpdateNicknameRuleRequest {
                id: first,
                rule: input(Regex, Description, "  ^shell \\d+$ "),
            },
        ))
        .unwrap();
        assert_eq!(updated.id, n.id);
        assert_eq!(updated.rules[0].pattern, "^shell \\d+$");
        assert_eq!(updated.rules[0].mode, Regex);
        // Contains still beats regex.
        assert_eq!(f.winner(row), Some(second));
        run(delete_rule(
            &f.state,
            DeleteNicknameRuleRequest { id: second },
        ))
        .unwrap();
        assert_eq!(f.winner(row), Some(first));
        let last = run(delete_rule(
            &f.state,
            DeleteNicknameRuleRequest { id: first },
        ));
        assert_eq!(
            validation(last),
            "A nickname needs at least one rule. Delete the nickname instead."
        );
        assert_eq!(f.winner(row), Some(first));
        let missing = run(delete_rule(
            &f.state,
            DeleteNicknameRuleRequest { id: second },
        ));
        assert_eq!(not_found(missing), "That rule no longer exists.");
        let missing = run(update_rule(
            &f.state,
            UpdateNicknameRuleRequest {
                id: second,
                rule: input(Exact, Description, "x"),
            },
        ));
        assert_eq!(not_found(missing), "That rule no longer exists.");
    }

    #[test]
    fn deleting_a_nickname_cascades_and_lets_other_rules_win() {
        let f = fixture("delete");
        let row = f.row(1, "2026-10-01", "shell", None);
        let a = f.save("Exact", Exact, Description, "shell");
        let b = f.save("Contains", Contains, Description, "shell");
        assert_eq!(f.winner(row), Some(a.rules[0].id));
        run(delete(&f.state, DeleteNicknameRequest { id: a.id })).unwrap();
        assert_eq!(f.winner(row), Some(b.rules[0].id));
        let (rules,): (i64,) = run(sqlx::query_as(
            "SELECT COUNT(*) FROM nickname_rules WHERE nickname_id = ?",
        )
        .bind(a.id)
        .fetch_one(&f.pool()))
        .unwrap();
        assert_eq!(rules, 0);
        let missing = run(delete(&f.state, DeleteNicknameRequest { id: a.id }));
        assert_eq!(not_found(missing), "That nickname no longer exists.");
        run(delete(&f.state, DeleteNicknameRequest { id: b.id })).unwrap();
        assert!(f.matches().is_empty());
    }

    #[test]
    fn match_import_fills_only_that_imports_rows() {
        let f = fixture("match-import");
        f.save("Coffee", Contains, Description, "coffee");
        // Rows added after the rebuild, as a commit would.
        let earlier = f.row(1, "2026-10-01", "coffee one", None);
        let first = f.row(2, "2026-10-02", "coffee two", None);
        let second = f.row(2, "2026-10-03", "COFFEE three", None);
        f.row(2, "2026-10-04", "tea", None);
        let rule = f.by_name("Coffee").rules[0].id;
        run(async {
            let mut conn = f.pool().acquire().await.unwrap();
            match_import(&mut conn, 2).await.unwrap();
        });
        assert_eq!(f.matches(), [(first, rule), (second, rule)]);
        assert_eq!(f.winner(earlier), None);
    }

    #[test]
    fn no_rules_leave_the_lookup_table_empty() {
        let f = fixture("no-rules");
        f.row(1, "2026-10-01", "coffee", None);
        run(async {
            let mut conn = f.pool().acquire().await.unwrap();
            match_import(&mut conn, 1).await.unwrap();
        });
        assert!(f.matches().is_empty());
        assert!(f.list().is_empty());
    }

    #[test]
    fn nickname_operations_never_change_raw_rows() {
        let f = fixture("raw-untouched");
        f.row(1, "2026-10-01", "  Coffee Shop ", Some("beans"));
        f.row(2, "2026-10-02", "Shell", None);
        let before = f.raw_snapshot();
        assert_eq!(before.len(), 2);
        f.save("Coffee", Exact, Description, "coffee shop");
        let n = f.save("Coffee", Contains, Memo, "bean");
        f.count(Regex, Description, "shell");
        f.set(&n, false, true);
        f.set(&n, true, false);
        run(update_rule(
            &f.state,
            UpdateNicknameRuleRequest {
                id: n.rules[1].id,
                rule: input(Regex, Memo, "be+ans"),
            },
        ))
        .unwrap();
        run(delete_rule(
            &f.state,
            DeleteNicknameRuleRequest { id: n.rules[0].id },
        ))
        .unwrap();
        run(async {
            let mut conn = f.pool().acquire().await.unwrap();
            match_import(&mut conn, 2).await.unwrap();
        });
        run(set_stale_days(&f.state, NicknameSettings { stale_days: 5 })).unwrap();
        f.list();
        run(delete(&f.state, DeleteNicknameRequest { id: n.id })).unwrap();
        assert_eq!(f.raw_snapshot(), before);
    }

    #[test]
    fn commands_fail_while_the_database_is_unavailable() {
        let state = AppState {
            db: std::sync::RwLock::new(Err("no database".into())),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let database = |result: Result<(), AppError>| {
            assert!(matches!(result, Err(AppError::Database(_))), "{result:?}");
        };
        let rule = || input(Exact, Description, "coffee");
        database(run(list(&state)).map(drop));
        database(run(settings(&state)).map(drop));
        database(
            run(save_rule(
                &state,
                SaveNicknameRuleRequest {
                    name: "Coffee".into(),
                    rule: rule(),
                    default_category_id: None,
                },
            ))
            .map(drop),
        );
        database(run(count_matches(&state, rule())).map(drop));
        database(
            run(update(
                &state,
                UpdateNicknameRequest {
                    id: 1,
                    name: "Coffee".into(),
                    enabled: true,
                    stale_exempt: false,
                    default_category_id: None,
                },
            ))
            .map(drop),
        );
        database(run(delete(&state, DeleteNicknameRequest { id: 1 })));
        database(
            run(update_rule(
                &state,
                UpdateNicknameRuleRequest {
                    id: 1,
                    rule: rule(),
                },
            ))
            .map(drop),
        );
        database(run(delete_rule(
            &state,
            DeleteNicknameRuleRequest { id: 1 },
        )));
        database(run(set_stale_days(&state, NicknameSettings { stale_days: 30 })).map(drop));
    }

    /// (category_id, set_by, reviewed) of a row in `effective_categories`.
    type Effective = (Option<i64>, Option<String>, i64);

    impl Fixture {
        fn effective(&self, row: i64) -> Effective {
            run(sqlx::query_as(
                "SELECT category_id, set_by, reviewed FROM effective_categories \
                 WHERE raw_transaction_id = ?",
            )
            .bind(row)
            .fetch_one(&self.pool()))
            .unwrap()
        }

        fn model_answer(&self, row: i64, category: i64) {
            run(sqlx::query(
                "INSERT INTO transaction_categories (raw_transaction_id, model_category_id, model_reviewed) \
                 VALUES (?, ?, 1) ON CONFLICT (raw_transaction_id) DO UPDATE \
                 SET model_category_id = excluded.model_category_id, model_reviewed = 1",
            )
            .bind(row)
            .bind(category)
            .execute(&self.pool()))
            .unwrap();
        }

        fn user_answer(&self, row: i64, category: i64) {
            run(sqlx::query(
                "INSERT INTO transaction_categories (raw_transaction_id, user_category_id) VALUES (?, ?) \
                 ON CONFLICT (raw_transaction_id) DO UPDATE SET user_category_id = excluded.user_category_id",
            )
            .bind(row)
            .bind(category)
            .execute(&self.pool()))
            .unwrap();
        }

        fn set_default(
            &self,
            nickname: &Nickname,
            enabled: bool,
            category: Option<i64>,
        ) -> Nickname {
            run(update(
                &self.state,
                UpdateNicknameRequest {
                    id: nickname.id,
                    name: nickname.name.clone(),
                    enabled,
                    stale_exempt: false,
                    default_category_id: category,
                },
            ))
            .unwrap()
        }
    }

    #[test]
    fn nickname_default_category_oracle() {
        const GROCERIES: i64 = 4;
        const DINING: i64 = 5;
        const SHOPPING: i64 = 8;
        let f = fixture("default-oracle");
        let a = f.row(1, "2026-10-01", "coffee one", None);
        let b = f.row(1, "2026-10-02", "coffee two", None);
        let other = f.row(1, "2026-10-03", "tea", None);
        f.model_answer(a, DINING);
        f.model_answer(other, DINING);
        let n = f.save("Coffee", Contains, Description, "coffee");
        let none = (None, None, 0);
        let model = |c| (Some(c), Some("model".to_string()), 1);
        let nick = |c| (Some(c), Some("nickname".to_string()), 1);
        let user = |c| (Some(c), Some("user".to_string()), 1);
        let check = |step: &str, rows: &[(i64, Effective)]| {
            for (row, expected) in rows {
                assert_eq!(&f.effective(*row), expected, "{step}: row {row}");
            }
        };
        check("no default", &[(a, model(DINING)), (b, none.clone())]);

        let n = f.set_default(&n, true, Some(GROCERIES));
        assert_eq!(n.default_category_id, Some(GROCERIES));
        check(
            "set default",
            &[
                (a, nick(GROCERIES)),
                (b, nick(GROCERIES)),
                (other, model(DINING)),
            ],
        );

        let c = f.row(2, "2026-10-04", "COFFEE three", None);
        run(async {
            let mut conn = f.pool().acquire().await.unwrap();
            match_import(&mut conn, 2).await.unwrap();
        });
        check("import", &[(c, nick(GROCERIES))]);

        run(update_rule(
            &f.state,
            UpdateNicknameRuleRequest {
                id: n.rules[0].id,
                rule: input(Contains, Description, "coffee t"),
            },
        ))
        .unwrap();
        // a's old model answer was dropped when the default took over.
        check(
            "change rule",
            &[
                (a, none.clone()),
                (b, nick(GROCERIES)),
                (c, nick(GROCERIES)),
            ],
        );

        f.user_answer(b, SHOPPING);
        check("set by user", &[(b, user(SHOPPING)), (c, nick(GROCERIES))]);

        let n = f.set_default(&n, true, None);
        assert_eq!(n.default_category_id, None);
        check("remove default", &[(b, user(SHOPPING)), (c, none.clone())]);

        let n = f.set_default(&n, true, Some(GROCERIES));
        f.set_default(&n, false, Some(GROCERIES));
        check("disable", &[(b, user(SHOPPING)), (c, none.clone())]);
        // While disabled the model may answer; re-enabling takes the row back.
        f.model_answer(c, DINING);
        check("model while disabled", &[(c, model(DINING))]);

        f.set_default(&n, true, Some(GROCERIES));
        check("re-enable", &[(b, user(SHOPPING)), (c, nick(GROCERIES))]);

        run(delete(&f.state, DeleteNicknameRequest { id: n.id })).unwrap();
        check(
            "delete",
            &[
                (a, none.clone()),
                (b, user(SHOPPING)),
                (c, none.clone()),
                (other, model(DINING)),
            ],
        );
    }

    #[test]
    fn default_category_on_save_and_unknown_category() {
        let f = fixture("default-save");
        let save = |category: Option<i64>| {
            run(save_rule(
                &f.state,
                SaveNicknameRuleRequest {
                    name: "Coffee".into(),
                    rule: input(Contains, Description, &format!("c{category:?}")),
                    default_category_id: category,
                },
            ))
        };
        assert_eq!(save(Some(4)).unwrap().default_category_id, Some(4));
        // Saving to the existing name sets the default to the given value, None included.
        assert_eq!(save(Some(5)).unwrap().default_category_id, Some(5));
        assert_eq!(save(None).unwrap().default_category_id, None);
        assert_eq!(
            not_found(save(Some(999))),
            "That category no longer exists."
        );
        let n = f.by_name("Coffee");
        assert_eq!((n.rules.len(), n.default_category_id), (3, None));
        let update = run(update(
            &f.state,
            UpdateNicknameRequest {
                id: n.id,
                name: n.name.clone(),
                enabled: true,
                stale_exempt: false,
                default_category_id: Some(999),
            },
        ));
        assert_eq!(not_found(update), "That category no longer exists.");
        assert_eq!(f.by_name("Coffee").default_category_id, None);
    }
}
