use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a category's rows count as in spending.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "camelCase")]
#[sqlx(rename_all = "lowercase")]
#[ts(export)]
pub enum CategoryKind {
    Spending,
    Income,
    /// Counts in neither spending nor income.
    Transfer,
}

/// Who set a row's effective category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS, sqlx::Type)]
#[serde(rename_all = "camelCase")]
#[sqlx(rename_all = "lowercase")]
#[ts(export)]
pub enum SetBy {
    Model,
    Nickname,
    User,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Category {
    #[ts(type = "number")]
    pub id: i64,
    /// Trimmed, 1..=40 chars, unique ignoring case.
    pub name: String,
    /// Trimmed, 0..=200 chars.
    pub description: String,
    pub kind: CategoryKind,
    pub sort_order: u32,
    /// Rows whose effective category is this one.
    pub row_count: u32,
    /// Nicknames defaulting to it.
    pub nickname_count: u32,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewCategory {
    pub name: String,
    pub description: String,
    pub kind: CategoryKind,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateCategoryRequest {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub description: String,
    pub kind: CategoryKind,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReorderCategoriesRequest {
    /// Every category id exactly once, in the new order.
    #[ts(type = "number[]")]
    pub ids: Vec<i64>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteCategoryRequest {
    #[ts(type = "number")]
    pub id: i64,
    /// Where its rows and nicknames move; `None` leaves them uncategorized.
    #[ts(type = "number | null")]
    pub replacement_id: Option<i64>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetTransactionCategoryRequest {
    #[ts(type = "number")]
    pub transaction_id: i64,
    /// The user's category; `None` clears it.
    #[ts(type = "number | null")]
    pub category_id: Option<i64>,
    /// 1..=500 chars after trimming; `None` clears it.
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetTransactionsCategoryRequest {
    #[ts(type = "number[]")]
    pub transaction_ids: Vec<i64>,
    /// The user's category for every row; `None` clears it. Notes stay as they are.
    #[ts(type = "number | null")]
    pub category_id: Option<i64>,
}
