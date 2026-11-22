use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{CategoryKind, Ollama, Transaction};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CategorizeScope {
    /// Rows with no effective category.
    Uncategorized,
    /// Rows not set by the user or a nickname.
    NotUserSet,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StartCategorizeRequest {
    pub scope: CategorizeScope,
}

/// Which rows a categorize run takes (Rust only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunTarget {
    /// Rows with no effective category.
    Uncategorized,
    /// Rows not set by the user or a nickname.
    NotUserSet,
    /// The uncategorized rows of this import.
    Import(i64),
}

/// One row as the model sees it (Rust only).
#[derive(Debug, sqlx::FromRow)]
pub struct PromptRow {
    pub id: i64,
    pub nickname: Option<String>,
    pub description: String,
    pub memo: Option<String>,
    /// Negative means money out.
    pub amount_cents: i64,
    pub bank_category: Option<String>,
}

/// One category as the model sees it (Rust only).
#[derive(Debug, sqlx::FromRow)]
pub struct PromptCategory {
    pub id: i64,
    pub name: String,
    pub kind: CategoryKind,
    pub description: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReviewGroup {
    #[ts(type = "number")]
    pub category_id: i64,
    pub category: String,
    /// Newest first.
    pub rows: Vec<Transaction>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MarkReviewedRequest {
    #[ts(type = "number[]")]
    pub transaction_ids: Vec<i64>,
}

/// The real categorizer: the active build, or the base model.
pub struct OllamaCategorizer {
    pub ollama: Ollama,
    pub model: String,
    pub build_id: Option<i64>,
}
