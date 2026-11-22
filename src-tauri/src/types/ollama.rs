use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OllamaSettings {
    /// `app_meta` `ollama_port`, absent means 11434.
    pub port: u16,
    /// `app_meta` `ollama_base_model`; `None` until one is picked.
    pub base_model: Option<String>,
    /// `app_meta` `auto_categorize`, absent means on.
    pub auto_categorize: bool,
    /// `app_meta` `build_examples`, 1..=20, absent means 5.
    pub examples_per_category: u32,
    /// `app_meta` `build_over_window`, "1" or "0", absent means off: builds use every example.
    pub allow_over_window: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetOllamaPortRequest {
    /// 1..=65535.
    pub port: u32,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetBaseModelRequest {
    /// An installed model; ":latest" equals no tag.
    pub name: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetAutoCategorizeRequest {
    pub enabled: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetExamplesPerCategoryRequest {
    /// 1..=20.
    pub count: u32,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetAllowOverWindowRequest {
    pub enabled: bool,
}

/// How many of the next build's examples fit the base model's context window.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildPreview {
    /// The base model's `num_ctx` in Ollama, else 4096.
    pub window_tokens: u32,
    /// Examples that fit, whatever the override says.
    pub fit: u32,
    /// Every candidate: up to examples per category.
    pub total: u32,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InstalledModel {
    pub name: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecommendedModel {
    pub name: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub note: String,
    pub installed: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OllamaStatus {
    pub reachable: bool,
    pub version: Option<String>,
    pub installed: Vec<InstalledModel>,
    pub recommended: Vec<RecommendedModel>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StartModelDownloadRequest {
    /// One of the recommended names.
    pub name: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelBuild {
    #[ts(type = "number")]
    pub id: i64,
    /// `zeni-<id>`.
    pub name: String,
    pub base_model: String,
    /// SQLite `CURRENT_TIMESTAMP`, UTC "YYYY-MM-DD HH:MM:SS".
    pub created_at: String,
    pub example_count: u32,
    pub active: bool,
    /// A category changed since it was built.
    pub out_of_date: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildRequest {
    #[ts(type = "number")]
    pub id: i64,
}

/// The local Ollama at `http://127.0.0.1:<port>`.
pub(crate) struct Ollama {
    pub(crate) port: u16,
}

/// What the next model build would send.
pub(crate) struct BuildPlan {
    pub(crate) base: String,
    pub(crate) system: String,
    /// `(user, assistant)` message contents of every candidate, in category order.
    pub(crate) candidates: Vec<(String, String)>,
    /// Indexes into `candidates` that fit the window.
    pub(crate) fit: Vec<usize>,
    pub(crate) window: u32,
}
