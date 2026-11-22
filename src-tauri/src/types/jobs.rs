use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum JobKind {
    CategorizeNow,
    RecategorizeAll,
    AfterImport,
    Download,
    Build,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunningJob {
    pub kind: JobKind,
    /// For example "Categorize now" or "Download phi4-mini".
    pub label: String,
    /// Rows, or bytes for a download.
    #[ts(type = "number")]
    pub done: u64,
    /// 0 means unknown.
    #[ts(type = "number")]
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RunSummary {
    pub categorized: u32,
    pub couldnt_categorize: u32,
    pub not_reached: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobOutcome {
    pub kind: JobKind,
    pub label: String,
    pub cancelled: bool,
    pub error: Option<String>,
    /// Categorize runs only.
    pub summary: Option<RunSummary>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobStatus {
    pub running: Option<RunningJob>,
    /// The last finished job, until `clear_job_outcome`.
    pub last: Option<JobOutcome>,
}

/// The one Ollama job slot (Rust only); clones share it. Never hold its lock across an await.
#[derive(Clone, Default)]
pub struct Jobs(pub std::sync::Arc<std::sync::Mutex<JobSlot>>);

/// What `Jobs` guards (Rust only).
#[derive(Default)]
pub struct JobSlot {
    pub running: Option<RunningJob>,
    /// The running job's cancel signal (`true` once cancelled); each job gets a fresh one.
    pub cancel: std::sync::Arc<tokio::sync::watch::Sender<bool>>,
    /// The running job's task, until it ends or `stop_and_wait` takes it.
    pub handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub last: Option<JobOutcome>,
}

/// Handed to a job's work: reports progress and reads or awaits the cancel signal (Rust only).
#[derive(Clone)]
pub struct JobCtx {
    pub jobs: Jobs,
    pub cancel: std::sync::Arc<tokio::sync::watch::Sender<bool>>,
}
