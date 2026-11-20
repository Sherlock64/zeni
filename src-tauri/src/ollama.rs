//! Ollama settings, status, model download and the HTTP client the categorize and build jobs use.

use std::collections::HashMap;
use std::time::Duration;

use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::db::{meta, set_meta};
use crate::types::{
    AppError, AppState, InstalledModel, JobCtx, JobKind, JobOutcome, JobStatus, Ollama,
    OllamaSettings, OllamaStatus, RecommendedModel, SetAutoCategorizeRequest, SetBaseModelRequest,
    SetExamplesPerCategoryRequest, SetOllamaPortRequest, StartModelDownloadRequest,
};
use crate::{jobs, security};

const PORT_KEY: &str = "ollama_port";
const BASE_MODEL_KEY: &str = "ollama_base_model";
const AUTO_KEY: &str = "auto_categorize";
const EXAMPLES_KEY: &str = "build_examples";
const DEFAULT_PORT: u16 = 11434;
const DEFAULT_EXAMPLES: u32 = 5;
const MAX_EXAMPLES: u32 = 20;
/// Longest NDJSON line and largest unstreamed body read from Ollama.
const MAX_LINE: usize = 1 << 20;
const MAX_BODY: usize = 8 << 20;

/// Name, download size in bytes and note, in the order the UI shows them.
const RECOMMENDED: [(&str, u64, &str); 3] = [
    (
        "phi4-mini",
        2491876774,
        "Best pick: 51 of 52 sample rows right, about 0.4 s a row.",
    ),
    (
        "qwen2.5:3b",
        1929912432,
        "Smallest download: 46 of 52 right, about 0.4 s a row.",
    ),
    (
        "gemma3:4b",
        3350272403,
        "Slower alternative: 44 of 52 right, about 1.8 s a row.",
    ),
];

/// Ollama names a model without a tag `<name>:latest`.
fn same_model(a: &str, b: &str) -> bool {
    let bare = |name: &str| name.strip_suffix(":latest").unwrap_or(name).to_string();
    bare(a) == bare(b)
}

async fn load_settings(pool: &SqlitePool) -> Result<OllamaSettings, AppError> {
    // A missing or corrupt value falls back to the default on purpose, so Settings still loads.
    Ok(OllamaSettings {
        port: meta(pool, PORT_KEY)
            .await?
            .and_then(|value| value.parse().ok())
            .filter(|port| *port != 0)
            .unwrap_or(DEFAULT_PORT),
        base_model: meta(pool, BASE_MODEL_KEY).await?,
        auto_categorize: meta(pool, AUTO_KEY).await?.as_deref() != Some("0"),
        examples_per_category: meta(pool, EXAMPLES_KEY)
            .await?
            .and_then(|value| value.parse().ok())
            .filter(|count| (1..=MAX_EXAMPLES).contains(count))
            .unwrap_or(DEFAULT_EXAMPLES),
    })
}

/// Stores the base model and deactivates the active build, so the base model is used.
async fn save_base_model(pool: &SqlitePool, name: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
        .bind(BASE_MODEL_KEY)
        .bind(name)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE model_builds SET active = 0")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn settings(state: &AppState) -> Result<OllamaSettings, AppError> {
    load_settings(&security::pool(state)?).await
}

pub async fn set_port(
    state: &AppState,
    request: SetOllamaPortRequest,
) -> Result<OllamaSettings, AppError> {
    if !(1..=65535).contains(&request.port) {
        return Err(AppError::Validation("Enter a port from 1 to 65535.".into()));
    }
    let pool = security::pool(state)?;
    set_meta(&pool, PORT_KEY, &request.port.to_string()).await?;
    load_settings(&pool).await
}

/// Picks an installed model and deactivates the active build.
pub async fn set_base_model(
    state: &AppState,
    request: SetBaseModelRequest,
) -> Result<OllamaSettings, AppError> {
    let pool = security::pool(state)?;
    let installed = Ollama::from_settings(&pool).await?.installed().await?;
    let model = installed
        .into_iter()
        .find(|model| same_model(&model.name, request.name.trim()))
        .ok_or_else(|| AppError::NotFound("That model isn't installed.".into()))?;
    save_base_model(&pool, &model.name).await?;
    load_settings(&pool).await
}

pub async fn set_auto_categorize(
    state: &AppState,
    request: SetAutoCategorizeRequest,
) -> Result<OllamaSettings, AppError> {
    let pool = security::pool(state)?;
    set_meta(&pool, AUTO_KEY, if request.enabled { "1" } else { "0" }).await?;
    load_settings(&pool).await
}

pub async fn set_examples_per_category(
    state: &AppState,
    request: SetExamplesPerCategoryRequest,
) -> Result<OllamaSettings, AppError> {
    if !(1..=MAX_EXAMPLES).contains(&request.count) {
        return Err(AppError::Validation("Enter a number from 1 to 20.".into()));
    }
    let pool = security::pool(state)?;
    set_meta(&pool, EXAMPLES_KEY, &request.count.to_string()).await?;
    load_settings(&pool).await
}

/// Never fails for an unreachable Ollama: that is `reachable: false`.
pub async fn status(state: &AppState) -> Result<OllamaStatus, AppError> {
    let ollama = Ollama::from_settings(&security::pool(state)?).await?;
    let (version, installed) = match ollama.version().await {
        Ok(version) => (Some(version), ollama.installed().await?),
        Err(_) => (None, Vec::new()),
    };
    let recommended = RECOMMENDED
        .iter()
        .map(|(name, size_bytes, note)| RecommendedModel {
            name: (*name).into(),
            size_bytes: *size_bytes,
            note: (*note).into(),
            installed: installed.iter().any(|model| same_model(&model.name, name)),
        })
        .collect();
    Ok(OllamaStatus {
        reachable: version.is_some(),
        version,
        installed,
        recommended,
    })
}

/// Starts the `Download` job for a recommended model.
pub async fn start_download(
    state: &AppState,
    request: StartModelDownloadRequest,
) -> Result<JobStatus, AppError> {
    if !RECOMMENDED.iter().any(|(name, ..)| *name == request.name) {
        return Err(AppError::Validation("Pick a recommended model.".into()));
    }
    let pool = security::pool(state)?;
    let ollama = Ollama::from_settings(&pool).await?;
    let label = format!("Download {}", request.name);
    jobs::start(
        &state.jobs,
        JobKind::Download,
        label.clone(),
        |ctx| async move {
            let result = match ollama.pull(&request.name, &ctx).await {
                Ok(true) => save_base_model(&pool, &request.name).await,
                Ok(false) => Ok(()),
                Err(error) => Err(error),
            };
            JobOutcome {
                kind: JobKind::Download,
                label,
                cancelled: ctx.cancelled(),
                error: result.err().map(|error| error.to_string()),
                summary: None,
            }
        },
    )
}

impl Ollama {
    /// From the `ollama_port` setting.
    pub(crate) async fn from_settings(pool: &SqlitePool) -> Result<Ollama, AppError> {
        Ok(Ollama {
            port: load_settings(pool).await?.port,
        })
    }

    fn url(&self, path: &str) -> String {
        // Loopback only: there is no host setting anywhere.
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// `timeout` bounds the whole request; streams set a per-read timeout instead.
    fn client(&self, timeout: Option<Duration>) -> Result<reqwest::Client, AppError> {
        let builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            // A system proxy would send row data off this machine; reqwest does not skip loopback.
            .no_proxy()
            .connect_timeout(Duration::from_secs(2));
        let builder = match timeout {
            Some(timeout) => builder.timeout(timeout),
            // A stalled stream must still end, so a cancel or app exit is seen.
            None => builder.read_timeout(Duration::from_secs(30)),
        };
        builder.build().map_err(|error| self.error(error))
    }

    fn error(&self, error: reqwest::Error) -> AppError {
        if error.is_connect() {
            AppError::Ollama(format!(
                "Ollama isn't running on port {}. Start it with `ollama serve`.",
                self.port
            ))
        } else {
            AppError::Ollama(format!("Ollama said: {}", error.without_url()))
        }
    }

    /// The response, or Ollama's `{"error": ...}` for a non-2xx status.
    async fn check(&self, response: reqwest::Response) -> Result<reqwest::Response, AppError> {
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let body = self.json(response).await.unwrap_or(Value::Null);
        let message = body["error"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| status.to_string());
        Err(AppError::Ollama(format!("Ollama said: {message}")))
    }

    /// The whole body as JSON, refused past `MAX_BODY`.
    async fn json(&self, mut response: reqwest::Response) -> Result<Value, AppError> {
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| self.error(error))? {
            body.extend_from_slice(&chunk);
            if body.len() > MAX_BODY {
                return Err(AppError::Ollama(
                    "Ollama said: a reply too large to read.".into(),
                ));
            }
        }
        serde_json::from_slice(&body)
            .map_err(|_| AppError::Ollama("Ollama said: a reply Zeni can't read.".into()))
    }

    async fn get(&self, path: &str) -> Result<Value, AppError> {
        let response = self
            .client(Some(Duration::from_secs(10)))?
            .get(self.url(path))
            .send()
            .await
            .map_err(|error| self.error(error))?;
        self.json(self.check(response).await?).await
    }

    pub(crate) async fn version(&self) -> Result<String, AppError> {
        let body = self.get("/api/version").await?;
        Ok(body["version"].as_str().unwrap_or_default().to_string())
    }

    pub(crate) async fn installed(&self) -> Result<Vec<InstalledModel>, AppError> {
        let body = self.get("/api/tags").await?;
        Ok(body["models"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|model| {
                Some(InstalledModel {
                    name: model["name"].as_str()?.to_string(),
                    size_bytes: model["size"].as_u64().unwrap_or(0),
                })
            })
            .collect())
    }

    /// `/api/chat` with `format = schema`; returns the message content.
    pub(crate) async fn chat(
        &self,
        model: &str,
        system: &str,
        user: &str,
        schema: Value,
    ) -> Result<String, AppError> {
        let body = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
            "stream": false,
            "format": schema,
            "options": { "temperature": 0 },
        });
        let response = self
            .client(Some(Duration::from_secs(120)))?
            .post(self.url("/api/chat"))
            .json(&body)
            .send()
            .await
            .map_err(|error| self.error(error))?;
        let reply = self.json(self.check(response).await?).await?;
        reply["message"]["content"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| AppError::Ollama("Ollama said: no message in its reply.".into()))
    }

    /// Posts `body` and reads the NDJSON reply line by line until `{"status": "success"}`.
    /// `Ok(false)` when cancelled first; an `{"error": ...}` line is an error.
    async fn stream(
        &self,
        path: &str,
        body: &Value,
        ctx: &JobCtx,
        mut on_line: impl FnMut(&Value),
    ) -> Result<bool, AppError> {
        let response = self
            .client(None)?
            .post(self.url(path))
            .json(body)
            .send()
            .await
            .map_err(|error| self.error(error))?;
        let mut response = self.check(response).await?;
        let mut buffer = Vec::new();
        loop {
            if ctx.cancelled() {
                return Ok(false);
            }
            let chunk = tokio::select! {
                chunk = response.chunk() => chunk,
                () = ctx.until_cancelled() => return Ok(false),
            };
            let Some(chunk) = chunk.map_err(|error| self.error(error))? else {
                break;
            };
            buffer.extend_from_slice(&chunk);
            while let Some(end) = buffer.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = buffer.drain(..=end).collect();
                if line.iter().all(u8::is_ascii_whitespace) {
                    continue;
                }
                let line: Value = serde_json::from_slice(&line).map_err(|_| {
                    AppError::Ollama("Ollama said: a reply Zeni can't read.".into())
                })?;
                if let Some(error) = line["error"].as_str() {
                    return Err(AppError::Ollama(format!("Ollama said: {error}")));
                }
                if line["status"] == "success" {
                    return Ok(true);
                }
                on_line(&line);
            }
            if buffer.len() > MAX_LINE {
                return Err(AppError::Ollama(
                    "Ollama said: a line too long to read.".into(),
                ));
            }
        }
        if ctx.cancelled() {
            return Ok(false);
        }
        Err(AppError::Ollama(
            "Ollama said: it stopped before finishing.".into(),
        ))
    }

    /// Streamed `/api/create`.
    pub(crate) async fn create(&self, body: &Value, ctx: &JobCtx) -> Result<(), AppError> {
        self.stream("/api/create", body, ctx, |_| {}).await?;
        Ok(())
    }

    /// `/api/delete`; a 404 is ok.
    pub(crate) async fn delete_model(&self, name: &str) -> Result<(), AppError> {
        let response = self
            .client(Some(Duration::from_secs(30)))?
            .delete(self.url("/api/delete"))
            .json(&json!({ "model": name }))
            .send()
            .await
            .map_err(|error| self.error(error))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }
        self.check(response).await?;
        Ok(())
    }

    /// Streamed `/api/pull`; `false` when cancelled before it completed.
    pub(crate) async fn pull(&self, name: &str, ctx: &JobCtx) -> Result<bool, AppError> {
        // Each layer reports its own completed/total; the job shows their sums.
        let mut layers: HashMap<String, (u64, u64)> = HashMap::new();
        self.stream(
            "/api/pull",
            &json!({ "model": name, "stream": true }),
            ctx,
            |line| {
                if let (Some(digest), Some(total)) =
                    (line["digest"].as_str(), line["total"].as_u64())
                {
                    let completed = line["completed"].as_u64().unwrap_or(0);
                    layers.insert(digest.to_string(), (completed, total));
                    let (done, total) = layers
                        .values()
                        .fold((0, 0), |(done, all), (c, t)| (done + c, all + t));
                    ctx.progress(done, total);
                }
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    use super::*;
    use crate::db;
    use crate::types::Jobs;

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    /// What the stub answers: a status, NDJSON lines (written one at a time), and whether to keep
    /// repeating the last line, or to go silent with the connection open, until the client hangs up.
    struct Reply {
        status: u16,
        lines: Vec<String>,
        forever: bool,
        silent: bool,
    }

    fn reply(status: u16, lines: &[Value]) -> Reply {
        Reply {
            status,
            lines: lines.iter().map(Value::to_string).collect(),
            forever: false,
            silent: false,
        }
    }

    /// A tiny HTTP/1.1 server on 127.0.0.1 standing in for Ollama. Records `(method path, body)`.
    struct Stub {
        port: u16,
        requests: Arc<Mutex<Vec<(String, Value)>>>,
    }

    fn stub(answer: impl Fn(&str) -> Reply + Send + Sync + 'static) -> Stub {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        let answer = Arc::new(answer);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let (seen, answer) = (seen.clone(), answer.clone());
                std::thread::spawn(move || serve(stream.unwrap(), &seen, &*answer));
            }
        });
        Stub { port, requests }
    }

    fn serve(
        mut stream: TcpStream,
        seen: &Mutex<Vec<(String, Value)>>,
        answer: &dyn Fn(&str) -> Reply,
    ) {
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
        let reply = answer(&target);
        seen.lock()
            .unwrap()
            .push((target, serde_json::from_slice(&body).unwrap_or(Value::Null)));
        // No Content-Length: the body ends when the connection closes.
        let head = format!(
            "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
            reply.status
        );
        let _ = stream.write_all(head.as_bytes());
        for line in &reply.lines {
            if stream.write_all(format!("{line}\n").as_bytes()).is_err() {
                return;
            }
            let _ = stream.flush();
            std::thread::sleep(Duration::from_millis(5));
        }
        if reply.silent {
            // Blocks until the client hangs up.
            let _ = reader.read(&mut [0; 1]);
            return;
        }
        if !reply.forever {
            return;
        }
        let last = reply.lines.last().unwrap();
        // Until the client hangs up.
        while stream.write_all(format!("{last}\n").as_bytes()).is_ok() {
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// A port nothing listens on.
    fn closed_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn ctx() -> JobCtx {
        JobCtx {
            jobs: Jobs::default(),
            cancel: Default::default(),
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

    impl Fixture {
        fn pool(&self) -> SqlitePool {
            security::pool(&self.state).unwrap()
        }

        fn port(&self, port: u16) {
            run(set_port(
                &self.state,
                SetOllamaPortRequest { port: port.into() },
            ))
            .unwrap();
        }

        fn active_builds(&self) -> i64 {
            run(
                sqlx::query_scalar("SELECT COUNT(*) FROM model_builds WHERE active = 1")
                    .fetch_one(&self.pool()),
            )
            .unwrap()
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
    }

    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("ollama-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState {
            db: std::sync::RwLock::new(run(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let fixture = Fixture { state, dir };
        run(sqlx::query(
            "INSERT INTO model_builds (name, base_model, example_count, active, sent) \
             VALUES ('zeni-1', 'qwen2.5:3b', 3, 1, '{}')",
        )
        .execute(&fixture.pool()))
        .unwrap();
        fixture
    }

    fn error_json(error: AppError) -> Value {
        serde_json::to_value(error).unwrap()
    }

    fn tags_stub() -> Stub {
        stub(|target| match target {
            "GET /api/version" => reply(200, &[json!({ "version": "0.12.0" })]),
            "GET /api/tags" => reply(
                200,
                &[json!({ "models": [
                    { "name": "phi4-mini:latest", "size": 2491876774u64 },
                    { "name": "llama3:8b", "size": 7 },
                ] })],
            ),
            _ => reply(404, &[json!({ "error": "not found" })]),
        })
    }

    #[test]
    fn settings_default_then_save_and_validate() {
        let f = fixture("settings");
        let defaults = run(settings(&f.state)).unwrap();
        assert_eq!(
            (
                defaults.port,
                defaults.base_model,
                defaults.auto_categorize,
                defaults.examples_per_category
            ),
            (11434, None, true, 5)
        );

        for port in [0, 65536] {
            let error = run(set_port(&f.state, SetOllamaPortRequest { port })).unwrap_err();
            assert_eq!(
                error_json(error),
                json!({ "kind": "Validation", "message": "Enter a port from 1 to 65535." })
            );
        }
        for count in [0, 21] {
            let error = run(set_examples_per_category(
                &f.state,
                SetExamplesPerCategoryRequest { count },
            ))
            .unwrap_err();
            assert_eq!(
                error_json(error),
                json!({ "kind": "Validation", "message": "Enter a number from 1 to 20." })
            );
        }

        assert_eq!(
            run(set_port(&f.state, SetOllamaPortRequest { port: 65535 }))
                .unwrap()
                .port,
            65535
        );
        assert!(
            !run(set_auto_categorize(
                &f.state,
                SetAutoCategorizeRequest { enabled: false }
            ))
            .unwrap()
            .auto_categorize
        );
        let saved = run(set_examples_per_category(
            &f.state,
            SetExamplesPerCategoryRequest { count: 20 },
        ))
        .unwrap();
        assert_eq!(
            (
                saved.port,
                saved.auto_categorize,
                saved.examples_per_category
            ),
            (65535, false, 20)
        );
        assert!(
            run(set_auto_categorize(
                &f.state,
                SetAutoCategorizeRequest { enabled: true }
            ))
            .unwrap()
            .auto_categorize
        );
    }

    #[test]
    fn status_reports_version_installed_and_recommended_when_reachable() {
        let f = fixture("status-up");
        let server = tags_stub();
        f.port(server.port);
        let status = run(status(&f.state)).unwrap();
        assert!(status.reachable);
        assert_eq!(status.version.as_deref(), Some("0.12.0"));
        let installed: Vec<_> = status
            .installed
            .iter()
            .map(|model| (model.name.as_str(), model.size_bytes))
            .collect();
        assert_eq!(
            installed,
            [("phi4-mini:latest", 2491876774), ("llama3:8b", 7)]
        );
        let recommended: Vec<_> = status
            .recommended
            .iter()
            .map(|model| (model.name.as_str(), model.size_bytes, model.installed))
            .collect();
        assert_eq!(
            recommended,
            [
                ("phi4-mini", 2491876774, true),
                ("qwen2.5:3b", 1929912432, false),
                ("gemma3:4b", 3350272403, false),
            ]
        );
        assert_eq!(
            status.recommended[0].note,
            "Best pick: 51 of 52 sample rows right, about 0.4 s a row."
        );
    }

    #[test]
    fn with_ollama_stopped_status_is_unreachable_and_settings_still_work() {
        let f = fixture("status-down");
        let port = closed_port();
        f.port(port);
        let status = run(status(&f.state)).unwrap();
        assert!(!status.reachable);
        assert!(status.version.is_none() && status.installed.is_empty());
        assert_eq!(status.recommended.len(), 3);
        assert!(status.recommended.iter().all(|model| !model.installed));

        assert_eq!(run(settings(&f.state)).unwrap().port, port);
        let error = run(set_base_model(
            &f.state,
            SetBaseModelRequest {
                name: "phi4-mini".into(),
            },
        ))
        .unwrap_err();
        assert_eq!(
            error_json(error),
            json!({
                "kind": "Ollama",
                "message": format!("Ollama isn't running on port {port}. Start it with `ollama serve`.")
            })
        );
        assert_eq!(f.active_builds(), 1);
    }

    #[test]
    fn set_base_model_needs_an_installed_model_and_deactivates_the_build() {
        let f = fixture("base-model");
        let server = tags_stub();
        f.port(server.port);
        let error = run(set_base_model(
            &f.state,
            SetBaseModelRequest {
                name: "gemma3:4b".into(),
            },
        ))
        .unwrap_err();
        assert_eq!(
            error_json(error),
            json!({ "kind": "NotFound", "message": "That model isn't installed." })
        );
        assert_eq!(f.active_builds(), 1);

        // `phi4-mini` is installed as `phi4-mini:latest`; `llama3:8b` is not `llama3`.
        let saved = run(set_base_model(
            &f.state,
            SetBaseModelRequest {
                name: "phi4-mini".into(),
            },
        ))
        .unwrap();
        assert_eq!(saved.base_model.as_deref(), Some("phi4-mini:latest"));
        assert_eq!(f.active_builds(), 0);
        assert!(
            run(set_base_model(
                &f.state,
                SetBaseModelRequest {
                    name: "llama3".into()
                }
            ))
            .is_err()
        );
        let saved = run(set_base_model(
            &f.state,
            SetBaseModelRequest {
                name: "llama3:8b".into(),
            },
        ))
        .unwrap();
        assert_eq!(saved.base_model.as_deref(), Some("llama3:8b"));
    }

    #[test]
    fn download_accepts_only_recommended_names() {
        let f = fixture("download-name");
        f.port(closed_port());
        let error = run(start_download(
            &f.state,
            StartModelDownloadRequest {
                name: "llama3:8b".into(),
            },
        ))
        .unwrap_err();
        assert_eq!(
            error_json(error),
            json!({ "kind": "Validation", "message": "Pick a recommended model." })
        );
        assert!(jobs::status(&f.state.jobs).running.is_none());
    }

    #[test]
    fn a_finished_download_becomes_the_base_model() {
        let f = fixture("download-done");
        let server = stub(|_| {
            reply(
                200,
                &[
                    json!({ "status": "pulling manifest" }),
                    json!({ "status": "pulling a", "digest": "a", "total": 100, "completed": 100 }),
                    json!({ "status": "success" }),
                ],
            )
        });
        f.port(server.port);
        run(start_download(
            &f.state,
            StartModelDownloadRequest {
                name: "qwen2.5:3b".into(),
            },
        ))
        .unwrap();
        let last = f.wait_until_idle().last.unwrap();
        assert_eq!(
            (last.label.as_str(), last.cancelled, last.error),
            ("Download qwen2.5:3b", false, None)
        );
        assert_eq!(
            run(settings(&f.state)).unwrap().base_model.as_deref(),
            Some("qwen2.5:3b")
        );
        assert_eq!(f.active_builds(), 0);
        assert_eq!(
            server.requests.lock().unwrap()[0],
            (
                "POST /api/pull".to_string(),
                json!({ "model": "qwen2.5:3b", "stream": true })
            )
        );
    }

    #[test]
    fn cancel_drops_a_stalled_download_at_once() {
        let f = fixture("download-stalled");
        let server = stub(|_| Reply {
            silent: true,
            ..reply(
                200,
                &[json!({ "status": "pulling a", "digest": "a", "total": 1000, "completed": 400 })],
            )
        });
        f.port(server.port);
        run(start_download(
            &f.state,
            StartModelDownloadRequest {
                name: "phi4-mini".into(),
            },
        ))
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while jobs::status(&f.state.jobs).running.unwrap().done != 400 {
            assert!(Instant::now() < deadline, "no progress");
            std::thread::sleep(Duration::from_millis(5));
        }
        // The stub now sends nothing; only the cancel signal can end the 30 s read wait.
        let cancelled = Instant::now();
        jobs::cancel(&f.state.jobs);
        let last = f.wait_until_idle().last.unwrap();
        assert!(cancelled.elapsed() < Duration::from_secs(2));
        assert!(last.cancelled);
        assert_eq!(last.error, None);
    }

    #[test]
    fn a_download_reports_summed_bytes_refuses_a_second_job_and_stops_on_cancel() {
        let f = fixture("download-cancel");
        let server = stub(|_| Reply {
            forever: true,
            ..reply(
                200,
                &[
                    json!({ "status": "pulling manifest" }),
                    json!({ "status": "pulling a", "digest": "a", "total": 1000, "completed": 1000 }),
                    json!({ "status": "pulling b", "digest": "b", "total": 500, "completed": 200 }),
                ],
            )
        });
        f.port(server.port);
        let request = || StartModelDownloadRequest {
            name: "phi4-mini".into(),
        };
        run(start_download(&f.state, request())).unwrap();

        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let running = jobs::status(&f.state.jobs).running.unwrap();
            if (running.done, running.total) == (1200, 1500) {
                assert_eq!(running.label, "Download phi4-mini");
                break;
            }
            assert!(Instant::now() < deadline, "no progress");
            std::thread::sleep(Duration::from_millis(5));
        }

        let error = run(start_download(&f.state, request())).unwrap_err();
        assert_eq!(
            error_json(error),
            json!({
                "kind": "Busy",
                "message": "Download phi4-mini is running. Wait for it to finish or cancel it."
            })
        );

        jobs::cancel(&f.state.jobs);
        let last = f.wait_until_idle().last.unwrap();
        assert!(last.cancelled);
        assert_eq!(last.error, None);
        assert_eq!(run(settings(&f.state)).unwrap().base_model, None);
        assert_eq!(f.active_builds(), 1);
    }

    #[test]
    fn an_error_line_or_status_becomes_ollama_said() {
        let server = stub(|target| match target {
            "POST /api/pull" => reply(
                200,
                &[
                    json!({ "status": "pulling manifest" }),
                    json!({ "error": "pull model manifest: file does not exist" }),
                ],
            ),
            "POST /api/create" => reply(400, &[json!({ "error": "invalid model name" })]),
            _ => reply(500, &[json!({ "error": "boom" })]),
        });
        let ollama = Ollama { port: server.port };
        assert_eq!(
            error_json(run(ollama.pull("phi4-mini", &ctx())).unwrap_err()),
            json!({ "kind": "Ollama", "message": "Ollama said: pull model manifest: file does not exist" })
        );
        assert_eq!(
            error_json(run(ollama.create(&json!({ "model": "zeni-1" }), &ctx())).unwrap_err()),
            json!({ "kind": "Ollama", "message": "Ollama said: invalid model name" })
        );
        assert_eq!(
            error_json(run(ollama.chat("m", "s", "u", json!({}))).unwrap_err()),
            json!({ "kind": "Ollama", "message": "Ollama said: boom" })
        );
    }

    #[test]
    fn create_streams_until_success_and_delete_accepts_404() {
        let server = stub(|target| match target {
            "POST /api/create" => reply(
                200,
                &[
                    json!({ "status": "using existing layer" }),
                    json!({ "status": "success" }),
                ],
            ),
            "DELETE /api/delete" => reply(404, &[json!({ "error": "model not found" })]),
            _ => reply(500, &[json!({ "error": "boom" })]),
        });
        let ollama = Ollama { port: server.port };
        let body = json!({ "model": "zeni-1", "from": "phi4-mini", "stream": true });
        run(ollama.create(&body, &ctx())).unwrap();
        run(ollama.delete_model("zeni-1")).unwrap();
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests[0], ("POST /api/create".to_string(), body));
        assert_eq!(
            requests[1],
            (
                "DELETE /api/delete".to_string(),
                json!({ "model": "zeni-1" })
            )
        );
    }

    #[test]
    fn chat_sends_schema_temperature_zero_unstreamed_and_returns_the_content() {
        let server = stub(|_| {
            reply(
                200,
                &[
                    json!({ "message": { "role": "assistant", "content": "{\"category\":\"Groceries\"}" } }),
                ],
            )
        });
        let ollama = Ollama { port: server.port };
        let schema = json!({ "type": "object", "required": ["category"] });
        let content =
            run(ollama.chat("phi4-mini", "Pick one.", "Fresh Mart", schema.clone())).unwrap();
        assert_eq!(content, "{\"category\":\"Groceries\"}");
        assert_eq!(
            server.requests.lock().unwrap()[0],
            (
                "POST /api/chat".to_string(),
                json!({
                    "model": "phi4-mini",
                    "messages": [
                        { "role": "system", "content": "Pick one." },
                        { "role": "user", "content": "Fresh Mart" },
                    ],
                    "stream": false,
                    "format": schema,
                    "options": { "temperature": 0 },
                })
            )
        );
    }

    #[test]
    fn lowest_values_are_accepted_and_corrupt_settings_fall_back_to_defaults() {
        let f = fixture("settings-edges");
        assert_eq!(
            run(set_port(&f.state, SetOllamaPortRequest { port: 1 }))
                .unwrap()
                .port,
            1
        );
        assert_eq!(
            run(set_examples_per_category(
                &f.state,
                SetExamplesPerCategoryRequest { count: 1 },
            ))
            .unwrap()
            .examples_per_category,
            1
        );
        for (port, examples) in [("abc", "x"), ("0", "0"), ("65536", "21")] {
            run(set_meta(&f.pool(), PORT_KEY, port)).unwrap();
            run(set_meta(&f.pool(), EXAMPLES_KEY, examples)).unwrap();
            run(set_meta(&f.pool(), AUTO_KEY, "garbage")).unwrap();
            let loaded = run(settings(&f.state)).unwrap();
            assert_eq!(
                (
                    loaded.port,
                    loaded.auto_categorize,
                    loaded.examples_per_category
                ),
                (11434, true, 5)
            );
        }
    }

    #[test]
    fn every_setting_and_status_call_reports_a_missing_database() {
        let state = AppState {
            db: std::sync::RwLock::new(Err("no database".into())),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
        };
        let database = |result: Result<OllamaSettings, AppError>| {
            assert!(matches!(result, Err(AppError::Database(_))));
        };
        database(run(settings(&state)));
        database(run(set_port(&state, SetOllamaPortRequest { port: 11434 })));
        database(run(set_base_model(
            &state,
            SetBaseModelRequest {
                name: "phi4-mini".into(),
            },
        )));
        database(run(set_auto_categorize(
            &state,
            SetAutoCategorizeRequest { enabled: true },
        )));
        database(run(set_examples_per_category(
            &state,
            SetExamplesPerCategoryRequest { count: 5 },
        )));
        assert!(matches!(run(status(&state)), Err(AppError::Database(_))));
        assert!(matches!(
            run(start_download(
                &state,
                StartModelDownloadRequest {
                    name: "phi4-mini".into(),
                },
            )),
            Err(AppError::Database(_))
        ));
        assert!(jobs::status(&state.jobs).running.is_none());
    }

    /// The child re-runs only this test with proxy variables set, since changing the
    /// environment in-process races other tests' reads.
    #[test]
    fn a_proxy_in_the_environment_is_never_used() {
        if std::env::var_os("ZENI_PROXY_CHILD").is_some() {
            let server = tags_stub();
            let ollama = Ollama { port: server.port };
            assert_eq!(run(ollama.version()).unwrap(), "0.12.0");
            assert_eq!(server.requests.lock().unwrap()[0].0, "GET /api/version");
            return;
        }
        let proxy = format!("http://127.0.0.1:{}", closed_port());
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ollama::tests::a_proxy_in_the_environment_is_never_used",
                "--nocapture",
            ])
            .env("ZENI_PROXY_CHILD", "1")
            .env("HTTP_PROXY", &proxy)
            .env("http_proxy", &proxy)
            .env("ALL_PROXY", &proxy)
            .env("all_proxy", &proxy)
            .env_remove("NO_PROXY")
            .env_remove("no_proxy")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success() && stdout.contains("1 passed"),
            "{stdout}{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn an_endless_line_or_an_oversized_body_is_refused() {
        let huge = "x".repeat(MAX_LINE * 2);
        let body = "x".repeat(MAX_BODY + 1);
        let server = stub(move |target| match target {
            "POST /api/pull" => Reply {
                status: 200,
                lines: vec![huge.clone()],
                forever: false,
                silent: false,
            },
            _ => reply(200, &[json!({ "version": body })]),
        });
        let ollama = Ollama { port: server.port };
        assert_eq!(
            error_json(run(ollama.pull("phi4-mini", &ctx())).unwrap_err()),
            json!({ "kind": "Ollama", "message": "Ollama said: a line too long to read." })
        );
        assert_eq!(
            error_json(run(ollama.version()).unwrap_err()),
            json!({ "kind": "Ollama", "message": "Ollama said: a reply too large to read." })
        );
    }
}
