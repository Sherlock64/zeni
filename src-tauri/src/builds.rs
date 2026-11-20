//! Model builds: examples from reviewed rows, `/api/create`, activate and delete.

use std::collections::HashSet;

use serde_json::{Value, json};
use sqlx::{Row, SqlitePool};

use crate::categorize::{system_prompt, user_prompt};
use crate::ollama;
use crate::types::{
    AppError, AppState, BuildRequest, JobKind, JobOutcome, JobStatus, ModelBuild, Ollama,
    OllamaSettings, PromptCategory, PromptRow,
};
use crate::{jobs, security};

fn gone() -> AppError {
    AppError::NotFound("That build no longer exists.".into())
}

/// Newest first.
pub async fn list(state: &AppState) -> Result<Vec<ModelBuild>, AppError> {
    let rows: Vec<(i64, String, String, String, u32, bool, bool)> = sqlx::query_as(
        "SELECT id, name, base_model, created_at, example_count, active, out_of_date \
         FROM model_builds ORDER BY id DESC",
    )
    .fetch_all(&security::pool(state)?)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, name, base_model, created_at, example_count, active, out_of_date)| ModelBuild {
                id,
                name,
                base_model,
                created_at,
                example_count,
                active,
                out_of_date,
            },
        )
        .collect())
}

/// Up to `per_category` reviewed rows per category, newest first, distinct keys before repeats.
async fn examples(
    pool: &SqlitePool,
    per_category: u32,
) -> Result<Vec<(PromptRow, String)>, AppError> {
    let rows = sqlx::query(
        "SELECT r.id, e.nickname, r.raw_description AS description, r.memo, r.amount_cents, \
                r.bank_category, e.category_id, c.name AS category \
         FROM effective_categories e \
         JOIN raw_transactions r ON r.id = e.raw_transaction_id \
         JOIN categories c ON c.id = e.category_id \
         WHERE e.reviewed = 1 AND r.account_id = (SELECT MIN(id) FROM accounts) \
         ORDER BY c.sort_order, c.id, r.posted_date DESC, r.id DESC",
    )
    .fetch_all(pool)
    .await?;
    let mut picked = Vec::new();
    let mut start = 0;
    while start < rows.len() {
        let category_id: i64 = rows[start].try_get("category_id")?;
        let mut end = start;
        while end < rows.len() && rows[end].try_get::<i64, _>("category_id")? == category_id {
            end += 1;
        }
        let mut seen = HashSet::new();
        let (mut firsts, mut repeats) = (Vec::new(), Vec::new());
        for row in &rows[start..end] {
            let example: PromptRow = sqlx::FromRow::from_row(row)?;
            let key = example
                .nickname
                .as_deref()
                .unwrap_or(&example.description)
                .to_lowercase();
            let category: String = row.try_get("category")?;
            if seen.insert(key) {
                firsts.push((example, category));
            } else {
                repeats.push((example, category));
            }
        }
        picked.extend(
            firsts
                .into_iter()
                .chain(repeats)
                .take(per_category as usize),
        );
        start = end;
    }
    Ok(picked)
}

/// The new build's id, label, example count and its `/api/create` body.
async fn prepare(
    pool: &SqlitePool,
    settings: &OllamaSettings,
) -> Result<(i64, String, u32, Value), AppError> {
    let base = settings
        .base_model
        .clone()
        .ok_or_else(|| AppError::Ollama("Pick a model in Settings first.".into()))?;
    let examples = examples(pool, settings.examples_per_category).await?;
    if examples.is_empty() {
        return Err(AppError::Validation(
            "Review some rows first: a build needs at least one example.".into(),
        ));
    }
    let categories: Vec<PromptCategory> = sqlx::query_as(
        "SELECT id, name, kind, description FROM categories ORDER BY sort_order, id",
    )
    .fetch_all(pool)
    .await?;
    let id: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(id), 0) + 1 FROM model_builds")
        .fetch_one(pool)
        .await?;
    let messages: Vec<Value> = examples
        .iter()
        .flat_map(|(row, category)| {
            [
                json!({ "role": "user", "content": user_prompt(row) }),
                json!({
                    "role": "assistant",
                    "content": json!({ "category": category }).to_string(),
                }),
            ]
        })
        .collect();
    let body = json!({
        "model": format!("zeni-{id}"),
        "from": base,
        "system": system_prompt(&categories),
        "messages": messages,
        "stream": true,
    });
    Ok((id, format!("Build zeni-{id}"), examples.len() as u32, body))
}

/// Stores the build Ollama just created.
async fn insert(pool: &SqlitePool, id: i64, count: u32, body: &Value) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO model_builds (id, name, base_model, example_count, sent) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(format!("zeni-{id}"))
    .bind(body["from"].as_str())
    .bind(count)
    .bind(body.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

/// Starts the `Build` job for a new `zeni-<id>` model.
pub async fn start(state: &AppState) -> Result<JobStatus, AppError> {
    let pool = security::pool(state)?;
    let settings = ollama::settings(state).await?;
    let ollama = Ollama::from_settings(&pool).await?;
    let (id, label, count, body) = prepare(&pool, &settings).await?;
    jobs::start(
        &state.jobs,
        JobKind::Build,
        label.clone(),
        |ctx| async move {
            let mut result = ollama.create(&body, &ctx).await;
            // The row exists only once Ollama reported success; a cancel leaves none.
            if result.is_ok() && !ctx.cancelled() {
                result = insert(&pool, id, count, &body).await;
            }
            JobOutcome {
                kind: JobKind::Build,
                label,
                cancelled: ctx.cancelled(),
                error: result.err().map(|error| error.to_string()),
                summary: None,
            }
        },
    )
}

/// Makes this build the one the categorize run uses.
pub async fn activate(state: &AppState, request: BuildRequest) -> Result<(), AppError> {
    let mut tx = security::pool(state)?.begin().await?;
    // Two statements: the one-active index is checked row by row.
    sqlx::query("UPDATE model_builds SET active = 0 WHERE active = 1 AND id <> ?")
        .bind(request.id)
        .execute(&mut *tx)
        .await?;
    let updated = sqlx::query("UPDATE model_builds SET active = 1 WHERE id = ?")
        .bind(request.id)
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(gone());
    }
    tx.commit().await?;
    Ok(())
}

/// Deletes the build here and its model in Ollama.
pub async fn delete(state: &AppState, request: BuildRequest) -> Result<(), AppError> {
    let pool = security::pool(state)?;
    let name: String = sqlx::query_scalar("SELECT name FROM model_builds WHERE id = ?")
        .bind(request.id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(gone)?;
    Ollama::from_settings(&pool)
        .await?
        .delete_model(&name)
        .await?;
    sqlx::query("DELETE FROM model_builds WHERE id = ?")
        .bind(request.id)
        .execute(&pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::*;
    use crate::db;
    use crate::types::SetOllamaPortRequest;

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    type Requests = Arc<Mutex<Vec<(String, Value)>>>;

    /// A tiny HTTP stub on 127.0.0.1 standing in for Ollama: `create` answers `create_status`,
    /// `delete` answers 404. Records `(method path, body)`.
    fn stub(create_status: u16) -> (u16, Requests) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests: Requests = Default::default();
        let seen = requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let seen = seen.clone();
                std::thread::spawn(move || serve(stream.unwrap(), &seen, create_status));
            }
        });
        (port, requests)
    }

    fn serve(mut stream: TcpStream, seen: &Mutex<Vec<(String, Value)>>, create_status: u16) {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut request_line = String::new();
        reader.read_line(&mut request_line).unwrap();
        let mut length = 0;
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
        let target = request_line
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" ");
        let (status, reply) = match (target.as_str(), create_status) {
            ("POST /api/create", 200) => (200, r#"{"status":"success"}"#),
            ("POST /api/create", status) => (status, r#"{"error":"boom"}"#),
            _ => (404, r#"{"error":"model not found"}"#),
        };
        seen.lock()
            .unwrap()
            .push((target, serde_json::from_slice(&body).unwrap_or(Value::Null)));
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{reply}\n"
            )
            .as_bytes(),
        );
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

    impl Fixture {
        fn pool(&self) -> SqlitePool {
            security::pool(&self.state).unwrap()
        }

        fn exec(&self, sql: &'static str) {
            run(sqlx::query(sql).execute(&self.pool())).unwrap();
        }

        fn port(&self, port: u16) {
            run(ollama::set_port(
                &self.state,
                SetOllamaPortRequest { port: port.into() },
            ))
            .unwrap();
        }

        /// A reviewed row set by the user in `category`.
        fn reviewed(&self, id: i64, date: &str, description: &str, category: &str) {
            run(sqlx::query(
                "INSERT INTO raw_transactions \
                 (id, import_id, account_id, posted_date, amount_cents, raw_description, original_row) \
                 VALUES (?, 1, 1, ?, -1234, ?, 'o')",
            )
            .bind(id)
            .bind(date)
            .bind(description)
            .execute(&self.pool()))
            .unwrap();
            run(sqlx::query(
                "INSERT INTO transaction_categories (raw_transaction_id, user_category_id) \
                 SELECT ?, id FROM categories WHERE name = ?",
            )
            .bind(id)
            .bind(category)
            .execute(&self.pool()))
            .unwrap();
        }

        fn picked(&self, per_category: u32) -> Vec<(String, String)> {
            run(examples(&self.pool(), per_category))
                .unwrap()
                .into_iter()
                .map(|(row, category)| (row.description, category))
                .collect()
        }

        fn wait_until_idle(&self) -> JobStatus {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let current = jobs::status(&self.state.jobs);
                if current.running.is_none() {
                    return current;
                }
                assert!(Instant::now() < deadline, "the job never ended");
                std::thread::sleep(Duration::from_millis(5));
            }
        }

        fn builds(&self) -> Vec<ModelBuild> {
            run(list(&self.state)).unwrap()
        }
    }

    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("builds-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: std::sync::RwLock::new(run(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let f = Fixture { state, dir };
        f.exec(
            "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
             VALUES ('Checking', 'Me', 'Bank', x'00', x'00')",
        );
        f.exec(
            "INSERT INTO imports (account_id, file_name, format, balance_check) \
             VALUES (1, 'a.ofx', 'ofx', 'notChecked')",
        );
        f
    }

    fn error_json(error: AppError) -> Value {
        serde_json::to_value(error).unwrap()
    }

    #[test]
    fn examples_match_the_prd_example() {
        let f = fixture("prd");
        f.reviewed(1, "2026-10-01", "Corner Shop", "Groceries");
        f.reviewed(2, "2026-10-02", "Fresh Mart", "Groceries");
        f.reviewed(3, "2026-10-03", "Fresh Mart", "Groceries");
        let pick = |description: &str| (description.to_string(), "Groceries".to_string());
        assert_eq!(f.picked(2), [pick("Fresh Mart"), pick("Corner Shop")]);
    }

    #[test]
    fn examples_take_distinct_names_first_newest_first_capped_per_category() {
        let f = fixture("pick");
        assert!(f.picked(5).is_empty());
        f.reviewed(1, "2026-10-01", "Corner Shop", "Groceries");
        f.reviewed(2, "2026-10-02", "FRESH MART", "Groceries");
        // Same date: the higher raw id is newer.
        f.reviewed(3, "2026-10-03", "Fresh Mart", "Groceries");
        f.reviewed(4, "2026-10-03", "Fresh Mart", "Groceries");
        f.reviewed(5, "2026-10-01", "Paycheck", "Paycheck");
        let groceries = |n| {
            f.picked(n)
                .into_iter()
                .filter(|(_, category)| category == "Groceries")
                .map(|(description, _)| description)
                .collect::<Vec<_>>()
        };
        assert_eq!(groceries(2), ["Fresh Mart", "Corner Shop"]);
        assert_eq!(
            groceries(20),
            ["Fresh Mart", "Corner Shop", "Fresh Mart", "FRESH MART"]
        );
        assert_eq!(groceries(1), ["Fresh Mart"]);
        // Only the two categories with reviewed rows get examples.
        let categories: HashSet<String> = f.picked(5).into_iter().map(|(_, c)| c).collect();
        assert_eq!(
            categories,
            HashSet::from(["Groceries".to_string(), "Paycheck".to_string()])
        );
    }

    #[test]
    fn examples_include_nickname_set_and_reviewed_model_rows_only() {
        let f = fixture("sources");
        f.reviewed(1, "2026-10-01", "Mart #1", "Groceries");
        // A model guess counts only once reviewed.
        for (id, reviewed) in [(2, 0), (3, 1)] {
            run(sqlx::query(
                "INSERT INTO raw_transactions \
                 (id, import_id, account_id, posted_date, amount_cents, raw_description, original_row) \
                 VALUES (?, 1, 1, '2026-10-05', -1, ?, 'o')",
            )
            .bind(id)
            .bind(format!("Model {id}"))
            .execute(&f.pool()))
            .unwrap();
            run(sqlx::query(
                "INSERT INTO transaction_categories (raw_transaction_id, model_category_id, model_reviewed) \
                 SELECT ?, id, ? FROM categories WHERE name = 'Groceries'",
            )
            .bind(id)
            .bind(reviewed)
            .execute(&f.pool()))
            .unwrap();
        }
        // A nickname with a default sets row 4; its key is the nickname, shared with row 1's.
        f.exec(
            "INSERT INTO raw_transactions \
             (id, import_id, account_id, posted_date, amount_cents, raw_description, original_row) \
             VALUES (4, 1, 1, '2026-10-06', -1, 'MART 2', 'o')",
        );
        f.exec(
            "INSERT INTO nicknames (id, name, default_category_id) \
             SELECT 1, 'mart #1', id FROM categories WHERE name = 'Groceries'",
        );
        f.exec(
            "INSERT INTO nickname_rules (id, nickname_id, mode, field, pattern) \
             VALUES (1, 1, 'contains', 'description', 'MART')",
        );
        f.exec("INSERT INTO nickname_matches (raw_transaction_id, rule_id) VALUES (4, 1)");
        assert_eq!(
            f.picked(2),
            [
                ("MART 2".to_string(), "Groceries".to_string()),
                ("Model 3".to_string(), "Groceries".to_string()),
            ]
        );
    }

    #[test]
    fn build_is_refused_without_a_base_model_or_examples() {
        let f = fixture("refused");
        assert_eq!(
            error_json(run(start(&f.state)).unwrap_err()),
            json!({ "kind": "Ollama", "message": "Pick a model in Settings first." })
        );
        f.exec("INSERT INTO app_meta (key, value) VALUES ('ollama_base_model', 'phi4-mini')");
        assert_eq!(
            error_json(run(start(&f.state)).unwrap_err()),
            json!({
                "kind": "Validation",
                "message": "Review some rows first: a build needs at least one example.",
            })
        );
        assert!(f.builds().is_empty());
    }

    #[test]
    fn build_sends_create_and_stores_what_it_sent_after_success() {
        let f = fixture("build");
        let (port, requests) = stub(200);
        f.port(port);
        f.exec("INSERT INTO app_meta (key, value) VALUES ('ollama_base_model', 'phi4-mini')");
        f.exec("UPDATE categories SET description = '' WHERE name <> 'Groceries'");
        f.reviewed(1, "2026-10-01", "Fresh Mart", "Groceries");
        f.exec("INSERT INTO app_meta (key, value) VALUES ('build_examples', '1')");
        f.reviewed(2, "2026-10-02", "Corner Shop", "Groceries");

        let started = run(start(&f.state)).unwrap();
        assert_eq!(started.running.unwrap().label, "Build zeni-1");
        // One job at a time.
        assert!(matches!(run(start(&f.state)), Err(AppError::Busy(_))));
        let last = f.wait_until_idle().last.unwrap();
        assert_eq!(last.error, None);

        let sent = requests.lock().unwrap()[0].clone();
        assert_eq!(sent.0, "POST /api/create");
        let body = sent.1;
        assert_eq!(body["model"], "zeni-1");
        assert_eq!(body["from"], "phi4-mini");
        assert_eq!(body["stream"], true);
        let system = body["system"].as_str().unwrap();
        assert!(system.contains("\n- Groceries (spending): "));
        assert!(system.contains("\n- Housing (spending): \n"));
        assert_eq!(
            body["messages"],
            json!([
                {
                    "role": "user",
                    "content": "Description: Corner Shop\nAmount: -12.34 dollars (negative is money out)\n",
                },
                { "role": "assistant", "content": "{\"category\":\"Groceries\"}" },
            ])
        );

        let builds = f.builds();
        assert_eq!(builds.len(), 1);
        let build = &builds[0];
        assert_eq!(
            (build.id, build.name.as_str(), build.base_model.as_str()),
            (1, "zeni-1", "phi4-mini")
        );
        assert_eq!(build.example_count, 1);
        assert!(!build.active && !build.out_of_date);
        let stored: String =
            run(sqlx::query_scalar("SELECT sent FROM model_builds").fetch_one(&f.pool())).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), body);
    }

    #[test]
    fn a_failed_build_leaves_no_row() {
        let f = fixture("failed");
        let (port, _) = stub(500);
        f.port(port);
        f.exec("INSERT INTO app_meta (key, value) VALUES ('ollama_base_model', 'phi4-mini')");
        f.reviewed(1, "2026-10-01", "Fresh Mart", "Groceries");
        run(start(&f.state)).unwrap();
        let last = f.wait_until_idle().last.unwrap();
        assert_eq!(last.error.as_deref(), Some("Ollama said: boom"));
        assert!(f.builds().is_empty());
    }

    #[test]
    fn one_build_is_active_and_a_category_change_marks_it_out_of_date() {
        let f = fixture("activate");
        f.exec(
            "INSERT INTO model_builds (id, name, base_model, example_count, sent) \
             VALUES (1, 'zeni-1', 'phi4-mini', 1, '{}'), (2, 'zeni-2', 'phi4-mini', 1, '{}')",
        );
        run(activate(&f.state, BuildRequest { id: 1 })).unwrap();
        run(activate(&f.state, BuildRequest { id: 2 })).unwrap();
        run(activate(&f.state, BuildRequest { id: 2 })).unwrap();
        let active = |f: &Fixture| {
            f.builds()
                .into_iter()
                .filter(|b| b.active)
                .map(|b| b.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(active(&f), [2]);
        assert_eq!(
            error_json(run(activate(&f.state, BuildRequest { id: 9 })).unwrap_err()),
            json!({ "kind": "NotFound", "message": "That build no longer exists." })
        );
        assert_eq!(active(&f), [2]);

        f.exec("UPDATE categories SET sort_order = sort_order WHERE name = 'Groceries'");
        let builds = f.builds();
        assert!(builds.iter().all(|b| b.out_of_date));
        assert_eq!(active(&f), [2]);
        // Newest first.
        assert_eq!(builds.iter().map(|b| b.id).collect::<Vec<_>>(), [2, 1]);
    }

    #[test]
    fn delete_removes_the_build_from_ollama_and_the_list() {
        let f = fixture("delete");
        let (port, requests) = stub(200);
        f.port(port);
        f.exec(
            "INSERT INTO model_builds (id, name, base_model, example_count, active, sent) \
             VALUES (3, 'zeni-3', 'phi4-mini', 1, 1, '{}')",
        );
        assert_eq!(
            error_json(run(delete(&f.state, BuildRequest { id: 9 })).unwrap_err()),
            json!({ "kind": "NotFound", "message": "That build no longer exists." })
        );
        assert!(requests.lock().unwrap().is_empty());
        // `stub(200)` sets only the create status; it answers 404 to every delete, which delete accepts.
        run(delete(&f.state, BuildRequest { id: 3 })).unwrap();
        assert!(f.builds().is_empty());
        assert_eq!(
            requests.lock().unwrap()[0],
            (
                "DELETE /api/delete".to_string(),
                json!({ "model": "zeni-3" })
            )
        );
    }

    #[test]
    fn delete_keeps_the_build_when_ollama_is_unreachable() {
        let f = fixture("delete-down");
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        f.port(port);
        f.exec(
            "INSERT INTO model_builds (id, name, base_model, example_count, sent) \
             VALUES (1, 'zeni-1', 'phi4-mini', 1, '{}')",
        );
        assert!(matches!(
            run(delete(&f.state, BuildRequest { id: 1 })),
            Err(AppError::Ollama(_))
        ));
        assert_eq!(f.builds().len(), 1);
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
        assert!(matches!(run(list(&state)), Err(AppError::Database(_))));
        assert!(matches!(run(start(&state)), Err(AppError::Database(_))));
        let request = || BuildRequest { id: 1 };
        assert!(matches!(
            run(activate(&state, request())),
            Err(AppError::Database(_))
        ));
        assert!(matches!(
            run(delete(&state, request())),
            Err(AppError::Database(_))
        ));
    }
}
