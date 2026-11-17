//! Categorize runs: the `Categorizer` seam, the run loop and the run after an import.

use std::future::Future;

use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::ollama::{self, Ollama};
use crate::types::{
    AppError, AppState, CategorizeScope, CategoryKind, CommitImportRequest, ImportSummary, JobCtx,
    JobKind, JobOutcome, JobStatus, PromptCategory, PromptRow, RunSummary, RunTarget,
    StartCategorizeRequest,
};
use crate::{imports, jobs, security};

const NO_MODEL: &str = "Pick a model in Settings first.";

/// Answers one row with a category name.
pub trait Categorizer: Send + Sync {
    fn categorize(
        &self,
        row: &PromptRow,
        categories: &[PromptCategory],
    ) -> impl Future<Output = Result<String, AppError>> + Send;

    /// The active build's id, or `None` when the base model is used.
    fn build_id(&self) -> Option<i64>;
}

/// The real categorizer: the active build, or the base model.
pub struct OllamaCategorizer {
    pub ollama: Ollama,
    pub model: String,
    pub build_id: Option<i64>,
}

fn kind_name(kind: CategoryKind) -> &'static str {
    match kind {
        CategoryKind::Spending => "spending",
        CategoryKind::Income => "income",
        CategoryKind::Transfer => "transfer",
    }
}

/// The category list the model picks from; builds train on the same text.
pub(crate) fn system_prompt(categories: &[PromptCategory]) -> String {
    let mut prompt = String::from(
        "You sort bank transactions into categories. Answer with the one category from this list \
         that fits the transaction best.\n\nCategories:\n",
    );
    for category in categories {
        prompt.push_str(&format!(
            "- {} ({}): {}\n",
            category.name,
            kind_name(category.kind),
            category.description
        ));
    }
    prompt
}

/// One row as the user message.
pub(crate) fn user_prompt(row: &PromptRow) -> String {
    let mut message = String::new();
    if let Some(nickname) = &row.nickname {
        message.push_str(&format!("Nickname: {nickname}\n"));
    }
    message.push_str(&format!("Description: {}\n", row.description));
    if let Some(memo) = &row.memo {
        message.push_str(&format!("Memo: {memo}\n"));
    }
    let sign = if row.amount_cents < 0 { "-" } else { "" };
    let cents = row.amount_cents.unsigned_abs();
    message.push_str(&format!(
        "Amount: {sign}{}.{:02} dollars (negative is money out)\n",
        cents / 100,
        cents % 100
    ));
    if let Some(bank_category) = &row.bank_category {
        message.push_str(&format!("Bank category: {bank_category}\n"));
    }
    message
}

fn schema(categories: &[PromptCategory]) -> Value {
    let names: Vec<&str> = categories.iter().map(|c| c.name.as_str()).collect();
    json!({
        "type": "object",
        "properties": { "category": { "type": "string", "enum": names } },
        "required": ["category"],
    })
}

impl Categorizer for OllamaCategorizer {
    async fn categorize(
        &self,
        row: &PromptRow,
        categories: &[PromptCategory],
    ) -> Result<String, AppError> {
        let content = self
            .ollama
            .chat(
                &self.model,
                &system_prompt(categories),
                &user_prompt(row),
                schema(categories),
            )
            .await?;
        // An unreadable reply is passed on as is: it matches no category, so it is retried.
        Ok(serde_json::from_str::<Value>(&content)
            .ok()
            .and_then(|reply| reply["category"].as_str().map(str::to_string))
            .unwrap_or(content))
    }

    fn build_id(&self) -> Option<i64> {
        self.build_id
    }
}

fn job(target: RunTarget) -> (JobKind, &'static str) {
    match target {
        RunTarget::Uncategorized => (JobKind::CategorizeNow, "Categorize now"),
        RunTarget::NotUserSet => (JobKind::RecategorizeAll, "Recategorize all"),
        RunTarget::Import(_) => (JobKind::AfterImport, "Categorizing new rows"),
    }
}

/// The active build, else the base model; then checks Ollama answers.
async fn categorizer(state: &AppState, pool: &SqlitePool) -> Result<OllamaCategorizer, AppError> {
    let active: Option<(i64, String)> =
        sqlx::query_as("SELECT id, name FROM model_builds WHERE active = 1")
            .fetch_optional(pool)
            .await?;
    let (build_id, model) = match active {
        Some((id, name)) => (Some(id), name),
        None => (
            None,
            ollama::settings(state)
                .await?
                .base_model
                .ok_or_else(|| AppError::Ollama(NO_MODEL.into()))?,
        ),
    };
    let ollama = Ollama::from_settings(pool).await?;
    ollama.version().await?;
    Ok(OllamaCategorizer {
        ollama,
        model,
        build_id,
    })
}

fn spawn(
    state: &AppState,
    pool: SqlitePool,
    categorizer: OllamaCategorizer,
    target: RunTarget,
) -> Result<JobStatus, AppError> {
    let (kind, label) = job(target);
    jobs::start(&state.jobs, kind, label.into(), move |ctx| async move {
        run(&pool, &categorizer, target, &ctx).await
    })
}

/// Starts `Categorize now` or `Recategorize all`.
pub async fn start(
    state: &AppState,
    request: StartCategorizeRequest,
) -> Result<JobStatus, AppError> {
    let pool = security::pool(state)?;
    let categorizer = categorizer(state, &pool).await?;
    let target = match request.scope {
        CategorizeScope::Uncategorized => RunTarget::Uncategorized,
        CategorizeScope::NotUserSet => RunTarget::NotUserSet,
    };
    spawn(state, pool, categorizer, target)
}

/// The rows `target` takes, in the checking account like the list.
async fn rows(pool: &SqlitePool, target: RunTarget) -> Result<Vec<PromptRow>, AppError> {
    let import_id = match target {
        RunTarget::Import(id) => Some(id),
        _ => None,
    };
    Ok(sqlx::query_as(
        "SELECT r.id, e.nickname, r.raw_description AS description, r.memo, r.amount_cents,
                r.bank_category
         FROM raw_transactions r JOIN effective_categories e ON e.raw_transaction_id = r.id
         WHERE r.account_id = (SELECT MIN(id) FROM accounts)
           AND CASE WHEN ?1 THEN e.set_by IS NULL OR e.set_by = 'model'
                    ELSE e.category_id IS NULL END
           AND (?2 IS NULL OR r.import_id = ?2)
         ORDER BY r.id",
    )
    .bind(target == RunTarget::NotUserSet)
    .bind(import_id)
    .fetch_all(pool)
    .await?)
}

/// The category id of a valid answer, retrying once; `None` when both answers are off the list.
async fn answer<C: Categorizer>(
    categorizer: &C,
    row: &PromptRow,
    categories: &[PromptCategory],
) -> Result<Option<i64>, AppError> {
    for attempt in 0..2 {
        match categorizer.categorize(row, categories).await {
            Ok(name) => {
                if let Some(category) = categories.iter().find(|c| c.name == name) {
                    return Ok(Some(category.id));
                }
            }
            Err(error) if attempt == 1 => return Err(error),
            Err(_) => {}
        }
    }
    Ok(None)
}

/// Stores a model answer unless the row is gone or now set by user or nickname; `false` = skipped.
async fn store(
    pool: &SqlitePool,
    row_id: i64,
    category_id: i64,
    build_id: Option<i64>,
) -> Result<bool, AppError> {
    let result = sqlx::query(
        "INSERT INTO transaction_categories (raw_transaction_id, model_category_id, model_build_id, model_reviewed, updated_at)
         SELECT r.id, ?1, ?2, 0, CURRENT_TIMESTAMP FROM raw_transactions r
         WHERE r.id = ?3 AND EXISTS (SELECT 1 FROM categories WHERE id = ?1)
           AND (SELECT set_by FROM effective_categories WHERE raw_transaction_id = r.id) IS NOT 'user'
           AND (SELECT set_by FROM effective_categories WHERE raw_transaction_id = r.id) IS NOT 'nickname'
         ON CONFLICT (raw_transaction_id) DO UPDATE SET model_category_id = excluded.model_category_id,
           model_build_id = excluded.model_build_id, model_reviewed = 0, updated_at = excluded.updated_at
           WHERE transaction_categories.user_category_id IS NULL",
    )
    .bind(category_id)
    .bind(build_id)
    .bind(row_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Categorizes the rows of `target`, stopping between rows when cancelled.
pub async fn run<C: Categorizer>(
    pool: &SqlitePool,
    categorizer: &C,
    target: RunTarget,
    ctx: &JobCtx,
) -> JobOutcome {
    let (kind, label) = job(target);
    let (summary, error) = match categorize_rows(pool, categorizer, target, ctx).await {
        Ok(done) => done,
        Err(error) => (None, Some(error.to_string())),
    };
    JobOutcome {
        kind,
        label: label.into(),
        cancelled: ctx.cancelled(),
        error,
        summary,
    }
}

async fn categorize_rows<C: Categorizer>(
    pool: &SqlitePool,
    categorizer: &C,
    target: RunTarget,
    ctx: &JobCtx,
) -> Result<(Option<RunSummary>, Option<String>), AppError> {
    let categories: Vec<PromptCategory> =
        sqlx::query_as("SELECT id, name, kind, description FROM categories ORDER BY sort_order")
            .fetch_all(pool)
            .await?;
    let rows = rows(pool, target).await?;
    let total = rows.len() as u64;
    ctx.progress(0, total);
    let (mut categorized, mut couldnt, mut done, mut error) = (0, 0, 0, None);
    for row in &rows {
        if ctx.cancelled() {
            break;
        }
        match answer(categorizer, row, &categories).await {
            Ok(Some(category_id)) => {
                match store(pool, row.id, category_id, categorizer.build_id()).await {
                    Ok(true) => categorized += 1,
                    Ok(false) => {}
                    Err(store_error) => {
                        error = Some(store_error.to_string());
                        break;
                    }
                }
            }
            Ok(None) => couldnt += 1,
            Err(_) => {
                error = Some(format!("Ollama stopped responding after {done} rows."));
                break;
            }
        }
        done += 1;
        ctx.progress(done, total);
    }
    let summary = RunSummary {
        categorized,
        couldnt_categorize: couldnt,
        not_reached: (total - done) as u32,
    };
    Ok((Some(summary), error))
}

/// Starts categorizing an import's new rows when auto is on; the notice when it can't start.
pub async fn after_import(state: &AppState, import_id: i64) -> Option<String> {
    let target = RunTarget::Import(import_id);
    // Unreachable after a commit: committing needs the database too.
    let pool = security::pool(state).ok()?;
    let started = async {
        if !ollama::settings(state).await?.auto_categorize || rows(&pool, target).await?.is_empty()
        {
            return Ok(());
        }
        let categorizer = categorizer(state, &pool).await?;
        spawn(state, pool.clone(), categorizer, target).map(|_| ())
    }
    .await;
    let reason = match started {
        Ok(()) => return None,
        Err(AppError::Ollama(message)) if message == NO_MODEL => {
            "no model is picked in Settings.".to_string()
        }
        Err(AppError::Ollama(_)) => "Ollama isn't running.".to_string(),
        Err(AppError::Busy(message)) => jobs::status(&state.jobs)
            .running
            .map(|running| format!("{} is running.", running.label))
            .unwrap_or(message),
        Err(error) => error.to_string(),
    };
    Some(format!("Imported. Categorizing didn't start: {reason}"))
}

/// Commits the import under review, then starts categorizing its new rows.
pub async fn commit_import(
    state: &AppState,
    request: CommitImportRequest,
) -> Result<ImportSummary, AppError> {
    let mut summary = imports::commit_import(state, request).await?;
    summary.categorize_notice = after_import(state, summary.import_id).await;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::*;
    use crate::db;
    use crate::types::{
        FileBalanceCheck, ImportFormat, Jobs, ParsedStatement, ParsedTransaction, PendingImport,
        PendingStep, SetOllamaPortRequest,
    };

    type Answer = Box<dyn Fn(&PromptRow) -> Result<String, AppError> + Send + Sync>;

    /// Answers with `answer` and records every row id it was sent; `hook` runs SQL during one row's request.
    struct FakeCategorizer {
        answer: Answer,
        sent: Mutex<Vec<i64>>,
        build_id: Option<i64>,
        hook: Option<(SqlitePool, i64, &'static str)>,
    }

    impl FakeCategorizer {
        fn new(
            answer: impl Fn(&PromptRow) -> Result<String, AppError> + Send + Sync + 'static,
        ) -> Self {
            FakeCategorizer {
                answer: Box::new(answer),
                sent: Mutex::new(Vec::new()),
                build_id: None,
                hook: None,
            }
        }

        fn sent(&self) -> Vec<i64> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl Categorizer for FakeCategorizer {
        async fn categorize(
            &self,
            row: &PromptRow,
            categories: &[PromptCategory],
        ) -> Result<String, AppError> {
            assert_eq!(categories.len(), 22, "every category is sent");
            self.sent.lock().unwrap().push(row.id);
            if let Some((pool, id, sql)) = &self.hook
                && *id == row.id
            {
                sqlx::raw_sql(*sql).execute(pool).await.unwrap();
            }
            (self.answer)(row)
        }

        fn build_id(&self) -> Option<i64> {
            self.build_id
        }
    }

    struct Fixture {
        state: AppState,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn block<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    /// A port nothing listens on.
    fn closed_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    /// Answers every request with Ollama's version, so the reachability check passes.
    fn version_stub() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let _ = stream.read(&mut [0; 4096]);
                let body = r#"{"version":"0.12.0"}"#;
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        port
    }

    /// Answers `/api/version` and answers every `/api/chat` with Groceries; records each chat body.
    fn chat_stub() -> (u16, Arc<Mutex<Vec<Value>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let seen = bodies.clone();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let (mut line, mut length) = (String::new(), 0);
                reader.read_line(&mut line).unwrap();
                let chat = line.starts_with("POST /api/chat");
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header.trim().is_empty() {
                        break;
                    }
                    if let Some((name, value)) = header.split_once(':')
                        && name.eq_ignore_ascii_case("content-length")
                    {
                        length = value.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let reply = if chat {
                    seen.lock()
                        .unwrap()
                        .push(serde_json::from_slice(&body).unwrap());
                    json!({ "message": { "content": "{\"category\":\"Groceries\"}" } })
                } else {
                    json!({ "version": "0.12.0" })
                }
                .to_string();
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                    reply.len()
                );
            }
        });
        (port, bodies)
    }

    impl Fixture {
        fn pool(&self) -> SqlitePool {
            security::pool(&self.state).unwrap()
        }

        fn sql(&self, sql: &'static str) {
            block(sqlx::raw_sql(sql).execute(&self.pool())).unwrap();
        }

        fn port(&self, port: u16) {
            block(ollama::set_port(
                &self.state,
                SetOllamaPortRequest { port: port.into() },
            ))
            .unwrap();
        }

        /// `(raw id, model category name, build id, reviewed)` of every row with a model answer.
        fn model_rows(&self) -> Vec<(i64, String, Option<i64>, i64)> {
            block(
                sqlx::query_as(
                    "SELECT t.raw_transaction_id, c.name, t.model_build_id, t.model_reviewed
                     FROM transaction_categories t JOIN categories c ON c.id = t.model_category_id
                     ORDER BY t.raw_transaction_id",
                )
                .fetch_all(&self.pool()),
            )
            .unwrap()
        }

        fn user_category(&self, row: i64) -> Option<i64> {
            block(
                sqlx::query_scalar(
                    "SELECT user_category_id FROM transaction_categories WHERE raw_transaction_id = ?",
                )
                .bind(row)
                .fetch_optional(&self.pool()),
            )
            .unwrap()
            .flatten()
        }

        fn run(&self, fake: &FakeCategorizer, target: RunTarget, ctx: &JobCtx) -> JobOutcome {
            block(run(&self.pool(), fake, target, ctx))
        }

        fn wait_until_idle(&self) -> JobStatus {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let status = jobs::status(&self.state.jobs);
                if status.running.is_none() {
                    return status;
                }
                assert!(Instant::now() < deadline, "the job never ended");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }

    /// Rows 1-6 in import 1 and row 7 in import 2, all in the checking account, plus row 8 in a second
    /// account. Row 1 is set by user (Dining out), row 2 by nickname "Fresh Mart" (default Groceries), row 3
    /// by model (Dining out, reviewed), row 4 matches nickname "Corner Shop" (no default), rows 5-7 are bare.
    /// Ollama points at a closed port, so nothing real is ever contacted.
    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("categorize-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let fixture = Fixture {
            state: AppState {
                db: std::sync::RwLock::new(block(db::connect(&dir))),
                session: Default::default(),
                backup: Default::default(),
                pending_import: Default::default(),
                jobs: Default::default(),
            },
            dir,
        };
        fixture.port(closed_port());
        fixture.sql(
            "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number)
               VALUES ('Checking', 'Me', 'Bank', x'00', x'00'), ('Savings', 'Me', 'Bank', x'00', x'00');
             INSERT INTO imports (account_id, file_name, format, balance_check)
               VALUES (1, 'oct.csv', 'csv', 'notChecked'), (1, 'nov.csv', 'csv', 'notChecked');
             INSERT INTO raw_transactions
               (id, import_id, account_id, posted_date, amount_cents, raw_description, memo, bank_category, original_row)
             VALUES (1, 1, 1, '2026-10-01', -100, 'Diner', NULL, NULL, 'l'),
                    (2, 1, 1, '2026-10-02', -200, 'FRESH MART 12', NULL, NULL, 'l'),
                    (3, 1, 1, '2026-10-03', -300, 'Cafe', NULL, NULL, 'l'),
                    (4, 1, 1, '2026-10-04', -1234, 'CORNER SHOP', 'card 1', 'Food', 'l'),
                    (5, 1, 1, '2026-10-05', 250000, 'Payroll', NULL, NULL, 'l'),
                    (6, 1, 1, '2026-10-06', -5, 'Misc', NULL, NULL, 'l'),
                    (7, 2, 1, '2026-11-01', -700, 'Gas', NULL, NULL, 'l'),
                    (8, 1, 2, '2026-10-01', -800, 'Elsewhere', NULL, NULL, 'l');
             INSERT INTO nicknames (id, name, default_category_id)
               VALUES (1, 'Fresh Mart', (SELECT id FROM categories WHERE name = 'Groceries')),
                      (2, 'Corner Shop', NULL);
             INSERT INTO nickname_rules (id, nickname_id, mode, field, pattern)
               VALUES (1, 1, 'contains', 'description', 'FRESH MART'), (2, 2, 'contains', 'description', 'CORNER');
             INSERT INTO nickname_matches (raw_transaction_id, rule_id) VALUES (2, 1), (4, 2);
             INSERT INTO transaction_categories (raw_transaction_id, user_category_id, model_category_id, model_reviewed)
               VALUES (1, (SELECT id FROM categories WHERE name = 'Dining out'), NULL, 0),
                      (3, NULL, (SELECT id FROM categories WHERE name = 'Dining out'), 1);",
        );
        fixture
    }

    fn ctx() -> JobCtx {
        JobCtx {
            jobs: Jobs::default(),
            cancel: Default::default(),
        }
    }

    fn groceries(_: &PromptRow) -> Result<String, AppError> {
        Ok("Groceries".into())
    }

    fn summary(outcome: &JobOutcome) -> (u32, u32, u32) {
        let summary = outcome.summary.as_ref().unwrap();
        (
            summary.categorized,
            summary.couldnt_categorize,
            summary.not_reached,
        )
    }

    #[test]
    fn categorize_now_sends_only_uncategorized_rows_and_stores_unreviewed_model_answers() {
        let fixture = fixture("now");
        block(
            sqlx::query(
                "INSERT INTO model_builds (id, name, base_model, example_count, active, sent)
             VALUES (7, 'zeni-7', 'phi4-mini', 3, 1, '{}')",
            )
            .execute(&fixture.pool()),
        )
        .unwrap();
        let mut fake = FakeCategorizer::new(groceries);
        fake.build_id = Some(7);
        let outcome = fixture.run(&fake, RunTarget::Uncategorized, &ctx());
        // Not 1 (user), 2 (nickname default), 3 (model) or 8 (other account).
        assert_eq!(fake.sent(), vec![4, 5, 6, 7]);
        assert_eq!(outcome.kind, JobKind::CategorizeNow);
        assert_eq!(outcome.label, "Categorize now");
        assert_eq!(outcome.error, None);
        assert!(!outcome.cancelled);
        assert_eq!(summary(&outcome), (4, 0, 0));
        let model = fixture.model_rows();
        assert_eq!(model[0], (3, "Dining out".into(), None, 1));
        for (i, id) in [4, 5, 6, 7].into_iter().enumerate() {
            assert_eq!(model[i + 1], (id, "Groceries".into(), Some(7), 0));
        }
    }

    #[test]
    fn recategorize_all_resends_model_rows_but_never_user_or_nickname_rows() {
        let fixture = fixture("all");
        let fake = FakeCategorizer::new(groceries);
        let outcome = fixture.run(&fake, RunTarget::NotUserSet, &ctx());
        assert_eq!(fake.sent(), vec![3, 4, 5, 6, 7]);
        assert_eq!(outcome.kind, JobKind::RecategorizeAll);
        assert_eq!(summary(&outcome), (5, 0, 0));
        // The reviewed model row is overwritten and unreviewed again.
        assert_eq!(fixture.model_rows()[0], (3, "Groceries".into(), None, 0));
        assert!(fixture.user_category(1).is_some());
    }

    #[test]
    fn after_import_target_takes_only_that_imports_uncategorized_rows() {
        let fixture = fixture("import-target");
        let fake = FakeCategorizer::new(groceries);
        let outcome = fixture.run(&fake, RunTarget::Import(2), &ctx());
        assert_eq!(fake.sent(), vec![7]);
        assert_eq!(outcome.kind, JobKind::AfterImport);
        assert_eq!(outcome.label, "Categorizing new rows");
        assert_eq!(summary(&outcome), (1, 0, 0));
    }

    #[test]
    fn an_answer_off_the_list_is_retried_once_then_counts_as_couldnt_categorize() {
        let fixture = fixture("off-list");
        let calls = Arc::new(Mutex::new(0));
        let seen = calls.clone();
        // Row 4: off the list twice. Row 5: off the list, then valid. Others: valid.
        let fake = FakeCategorizer::new(move |row| {
            let mut calls = seen.lock().unwrap();
            *calls += 1;
            Ok(match (row.id, *calls) {
                (4, _) => "Snacks".into(),
                (5, 3) => "groceries".into(),
                _ => "Paycheck".into(),
            })
        });
        let outcome = fixture.run(&fake, RunTarget::Uncategorized, &ctx());
        assert_eq!(fake.sent(), vec![4, 4, 5, 5, 6, 7]);
        assert_eq!(summary(&outcome), (3, 1, 0));
        let stored: Vec<i64> = fixture.model_rows().iter().map(|row| row.0).collect();
        assert_eq!(stored, vec![3, 5, 6, 7]);
    }

    #[test]
    fn ollama_failing_twice_stops_the_run_and_keeps_finished_rows() {
        let fixture = fixture("stopped");
        let fake = FakeCategorizer::new(|row| match row.id {
            6 => Err(AppError::Ollama("Ollama said: boom".into())),
            _ => Ok("Groceries".into()),
        });
        let outcome = fixture.run(&fake, RunTarget::Uncategorized, &ctx());
        assert_eq!(fake.sent(), vec![4, 5, 6, 6]);
        assert_eq!(
            outcome.error.as_deref(),
            Some("Ollama stopped responding after 2 rows.")
        );
        assert!(!outcome.cancelled);
        assert_eq!(summary(&outcome), (2, 0, 2));
        let stored: Vec<i64> = fixture.model_rows().iter().map(|row| row.0).collect();
        assert_eq!(stored, vec![3, 4, 5]);
    }

    #[test]
    fn one_ollama_error_is_retried() {
        let fixture = fixture("retry");
        let failed = AtomicBool::new(false);
        let fake = FakeCategorizer::new(move |_| {
            if failed.swap(true, Ordering::Relaxed) {
                Ok("Groceries".into())
            } else {
                Err(AppError::Ollama("Ollama said: busy".into()))
            }
        });
        let outcome = fixture.run(&fake, RunTarget::Import(2), &ctx());
        assert_eq!(fake.sent(), vec![7, 7]);
        assert_eq!(outcome.error, None);
        assert_eq!(summary(&outcome), (1, 0, 0));
    }

    #[test]
    fn cancel_keeps_finished_rows_and_leaves_the_rest_untouched() {
        let fixture = fixture("cancel");
        let ctx = ctx();
        let cancel = ctx.cancel.clone();
        let fake = FakeCategorizer::new(move |row| {
            if row.id == 5 {
                cancel.store(true, Ordering::Relaxed);
            }
            Ok("Groceries".into())
        });
        let outcome = fixture.run(&fake, RunTarget::Uncategorized, &ctx);
        assert_eq!(fake.sent(), vec![4, 5]);
        assert!(outcome.cancelled);
        assert_eq!(outcome.error, None);
        assert_eq!(summary(&outcome), (2, 0, 2));
        let stored: Vec<i64> = fixture.model_rows().iter().map(|row| row.0).collect();
        assert_eq!(stored, vec![3, 4, 5]);
    }

    #[test]
    fn a_row_deleted_mid_run_is_skipped() {
        let fixture = fixture("deleted");
        let mut fake = FakeCategorizer::new(groceries);
        fake.hook = Some((
            fixture.pool(),
            5,
            "DELETE FROM raw_transactions WHERE id = 5;",
        ));
        let outcome = fixture.run(&fake, RunTarget::Uncategorized, &ctx());
        assert_eq!(fake.sent(), vec![4, 5, 6, 7]);
        // Row 5 counts as neither categorized nor couldn't.
        assert_eq!(summary(&outcome), (3, 0, 0));
        let stored: Vec<i64> = fixture.model_rows().iter().map(|row| row.0).collect();
        assert_eq!(stored, vec![3, 4, 6, 7]);
    }

    #[test]
    fn a_user_edit_or_nickname_default_landing_mid_request_wins() {
        let fixture = fixture("race");
        let mut fake = FakeCategorizer::new(groceries);
        // During row 4's request: row 4 is set by user, and row 5 gains a nickname with a default.
        fake.hook = Some((
            fixture.pool(),
            4,
            "INSERT INTO transaction_categories (raw_transaction_id, user_category_id)
               VALUES (4, (SELECT id FROM categories WHERE name = 'Dining out'));
             INSERT INTO nickname_rules (id, nickname_id, mode, field, pattern)
               VALUES (3, 1, 'exact', 'description', 'Payroll');
             INSERT INTO nickname_matches (raw_transaction_id, rule_id) VALUES (5, 3);",
        ));
        let outcome = fixture.run(&fake, RunTarget::Uncategorized, &ctx());
        assert_eq!(fake.sent(), vec![4, 5, 6, 7]);
        assert_eq!(summary(&outcome), (2, 0, 0));
        let stored: Vec<i64> = fixture.model_rows().iter().map(|row| row.0).collect();
        assert_eq!(stored, vec![3, 6, 7]);
        let effective: Vec<(i64, String)> = block(
            sqlx::query_as(
                "SELECT raw_transaction_id, set_by FROM effective_categories
                 WHERE raw_transaction_id IN (4, 5) ORDER BY raw_transaction_id",
            )
            .fetch_all(&fixture.pool()),
        )
        .unwrap();
        assert_eq!(
            effective,
            vec![(4, "user".to_string()), (5, "nickname".to_string())]
        );
    }

    #[test]
    fn progress_is_reported_after_each_row() {
        let fixture = fixture("progress");
        let jobs = Jobs::default();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (watch, record) = (jobs.clone(), seen.clone());
        let fake = FakeCategorizer::new(move |_| {
            let running = jobs::status(&watch).running.unwrap();
            record.lock().unwrap().push((running.done, running.total));
            Ok("Groceries".into())
        });
        let pool = fixture.pool();
        jobs::start(
            &jobs,
            JobKind::CategorizeNow,
            "Categorize now".into(),
            |ctx| async move { run(&pool, &fake, RunTarget::Uncategorized, &ctx).await },
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while jobs::status(&jobs).running.is_some() {
            assert!(Instant::now() < deadline, "the job never ended");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(*seen.lock().unwrap(), vec![(0, 4), (1, 4), (2, 4), (3, 4)]);
        let last = jobs::status(&jobs).last.unwrap();
        assert_eq!(summary(&last), (4, 0, 0));
    }

    #[test]
    fn the_ollama_prompt_has_every_field_the_category_list_and_the_enum_schema() {
        let fixture = fixture("prompt");
        let pool = fixture.pool();
        let categories: Vec<PromptCategory> = block(
            sqlx::query_as(
                "SELECT id, name, kind, description FROM categories ORDER BY sort_order",
            )
            .fetch_all(&pool),
        )
        .unwrap();
        let row = block(rows(&pool, RunTarget::Uncategorized))
            .unwrap()
            .remove(0);
        assert_eq!(
            user_prompt(&row),
            "Nickname: Corner Shop\nDescription: CORNER SHOP\nMemo: card 1\n\
             Amount: -12.34 dollars (negative is money out)\nBank category: Food\n"
        );
        let system = system_prompt(&categories);
        for category in &categories {
            assert!(system.contains(&format!(
                "- {} ({}): {}\n",
                category.name,
                kind_name(category.kind),
                category.description
            )));
        }
        let names: Vec<&str> = categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            schema(&categories),
            json!({
                "type": "object",
                "properties": { "category": { "type": "string", "enum": names } },
                "required": ["category"],
            })
        );
    }

    fn set_base_model(fixture: &Fixture) {
        fixture.sql("INSERT INTO app_meta (key, value) VALUES ('ollama_base_model', 'phi4-mini');");
    }

    fn request(scope: CategorizeScope) -> StartCategorizeRequest {
        StartCategorizeRequest { scope }
    }

    #[test]
    fn start_needs_a_model_a_running_ollama_and_no_other_job() {
        let fixture = fixture("start");
        let try_start = |scope| block(start(&fixture.state, request(scope)));
        match try_start(CategorizeScope::Uncategorized) {
            Err(AppError::Ollama(message)) => assert_eq!(message, NO_MODEL),
            other => panic!("expected Ollama, got {other:?}"),
        }
        set_base_model(&fixture);
        match try_start(CategorizeScope::NotUserSet) {
            Err(AppError::Ollama(message)) => assert!(message.starts_with("Ollama isn't running")),
            other => panic!("expected Ollama, got {other:?}"),
        }
        fixture.port(version_stub());
        wait_forever(&fixture.state.jobs);
        match try_start(CategorizeScope::Uncategorized) {
            Err(AppError::Busy(message)) => {
                assert_eq!(
                    message,
                    "Download x is running. Wait for it to finish or cancel it."
                )
            }
            other => panic!("expected Busy, got {other:?}"),
        }
        jobs::cancel(&fixture.state.jobs);
        fixture.wait_until_idle();
        let status = try_start(CategorizeScope::NotUserSet).unwrap();
        assert_eq!(status.running.unwrap().kind, JobKind::RecategorizeAll);
        // The stub answers no chat, so the run stops after its retry.
        let last = fixture.wait_until_idle().last.unwrap();
        assert_eq!(
            last.error.as_deref(),
            Some("Ollama stopped responding after 0 rows.")
        );
    }

    /// Starts a job that runs until cancelled.
    fn wait_forever(jobs: &Jobs) -> JobStatus {
        jobs::start(
            jobs,
            JobKind::Download,
            "Download x".into(),
            |ctx| async move {
                while !ctx.cancelled() {
                    pause().await;
                }
                JobOutcome {
                    kind: JobKind::Download,
                    label: "Download x".into(),
                    cancelled: true,
                    error: None,
                    summary: None,
                }
            },
        )
        .unwrap()
    }

    async fn pause() {
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(5)))
            .await
            .unwrap();
    }

    #[test]
    fn after_import_does_nothing_when_auto_is_off_or_nothing_is_uncategorized() {
        let fixture = fixture("after-nothing");
        set_base_model(&fixture);
        // Ollama is unreachable, so a started check would give a notice instead of None.
        fixture.sql(
            "INSERT INTO imports (account_id, file_name, format, balance_check)
             VALUES (1, 'empty.csv', 'csv', 'notChecked');",
        );
        assert_eq!(block(after_import(&fixture.state, 3)), None);
        fixture.sql("INSERT INTO app_meta (key, value) VALUES ('auto_categorize', '0');");
        assert_eq!(block(after_import(&fixture.state, 2)), None);
        assert!(jobs::status(&fixture.state.jobs).last.is_none());
    }

    #[test]
    fn after_import_returns_a_notice_when_the_run_cant_start() {
        let fixture = fixture("after-notice");
        let notice = || block(after_import(&fixture.state, 2));
        assert_eq!(
            notice().as_deref(),
            Some("Imported. Categorizing didn't start: no model is picked in Settings.")
        );
        set_base_model(&fixture);
        assert_eq!(
            notice().as_deref(),
            Some("Imported. Categorizing didn't start: Ollama isn't running.")
        );
        fixture.port(version_stub());
        wait_forever(&fixture.state.jobs);
        assert_eq!(
            notice().as_deref(),
            Some("Imported. Categorizing didn't start: Download x is running.")
        );
        jobs::cancel(&fixture.state.jobs);
        fixture.wait_until_idle();
        assert_eq!(notice(), None);
        let last = fixture.wait_until_idle().last.unwrap();
        assert_eq!(last.kind, JobKind::AfterImport);
        assert_eq!(summary(&last), (0, 0, 1));
    }

    #[test]
    fn a_run_uses_the_active_build_else_the_base_model() {
        let fixture = fixture("model-choice");
        set_base_model(&fixture);
        let (port, bodies) = chat_stub();
        fixture.port(port);
        fixture.sql(
            "INSERT INTO model_builds (id, name, base_model, example_count, active, sent)
             VALUES (7, 'zeni-7', 'phi4-mini', 3, 1, '{}');",
        );
        let models = || -> Vec<String> {
            let mut bodies = bodies.lock().unwrap();
            let models = bodies
                .iter()
                .map(|body| body["model"].as_str().unwrap().into())
                .collect();
            bodies.clear();
            models
        };
        block(start(
            &fixture.state,
            request(CategorizeScope::Uncategorized),
        ))
        .unwrap();
        assert_eq!(summary(&fixture.wait_until_idle().last.unwrap()), (4, 0, 0));
        assert_eq!(models(), vec!["zeni-7"; 4]);
        for row in &fixture.model_rows()[1..] {
            assert_eq!(row.2, Some(7));
        }
        fixture.sql("UPDATE model_builds SET active = 0;");
        block(start(&fixture.state, request(CategorizeScope::NotUserSet))).unwrap();
        assert_eq!(summary(&fixture.wait_until_idle().last.unwrap()), (5, 0, 0));
        assert_eq!(models(), vec!["phi4-mini"; 5]);
        for row in fixture.model_rows() {
            assert_eq!(row.2, None);
        }
    }

    #[test]
    fn a_store_failing_mid_run_stops_the_run_and_keeps_finished_rows() {
        let fixture = fixture("store-fails");
        let mut fake = FakeCategorizer::new(groceries);
        fake.hook = Some((fixture.pool(), 5, "DROP VIEW effective_categories;"));
        let outcome = fixture.run(&fake, RunTarget::Uncategorized, &ctx());
        assert_eq!(fake.sent(), vec![4, 5]);
        assert!(
            outcome
                .error
                .as_deref()
                .unwrap()
                .contains("effective_categories"),
            "{:?}",
            outcome.error
        );
        // Row 4 is stored; row 5's store failed, so it and 6, 7 are not reached.
        assert_eq!(summary(&outcome), (1, 0, 3));
        let stored: Vec<i64> = fixture.model_rows().iter().map(|row| row.0).collect();
        assert_eq!(stored, vec![3, 4]);
    }

    #[test]
    fn start_and_after_import_report_a_missing_database() {
        let state = AppState {
            db: std::sync::RwLock::new(Err("no database".into())),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        assert!(matches!(
            block(start(&state, request(CategorizeScope::Uncategorized))),
            Err(AppError::Database(_))
        ));
        assert_eq!(block(after_import(&state, 1)), None);
        assert!(jobs::status(&state.jobs).last.is_none());
    }

    #[test]
    fn after_import_returns_a_database_error_as_a_notice() {
        let fixture = fixture("after-db-error");
        fixture.sql("DROP VIEW effective_categories;");
        let notice = block(after_import(&fixture.state, 2)).unwrap();
        assert!(
            notice.starts_with("Imported. Categorizing didn't start: ")
                && notice.contains("effective_categories"),
            "{notice}"
        );
    }

    #[test]
    fn commit_import_returns_the_committed_summary_with_the_categorize_notice() {
        let fixture = fixture("commit");
        *fixture.state.pending_import.lock().unwrap() = Some(PendingImport {
            file_name: "dec.ofx".into(),
            step: PendingStep::Review {
                format: ImportFormat::Ofx,
                csv_layout_id: None,
                statement: ParsedStatement {
                    currency: "USD".into(),
                    ledger_balance_cents: None,
                    balance_as_of: None,
                    transactions: vec![ParsedTransaction {
                        fitid: Some("D1".into()),
                        posted_date: "2026-12-01".into(),
                        amount_cents: -900,
                        description: "Books".into(),
                        memo: None,
                        transaction_type: None,
                        running_balance_cents: None,
                        bank_category: None,
                        original: "<STMTTRN></STMTTRN>".into(),
                    }],
                    not_posted: 0,
                    file_balance_check: FileBalanceCheck::NotChecked,
                },
                suspect_rows: vec![],
            },
        });
        let summary = block(commit_import(
            &fixture.state,
            CommitImportRequest { skip_rows: vec![] },
        ))
        .unwrap();
        assert_eq!((summary.file_name.as_str(), summary.added), ("dec.ofx", 1));
        assert_eq!(
            summary.categorize_notice.as_deref(),
            Some("Imported. Categorizing didn't start: no model is picked in Settings.")
        );
    }
}
