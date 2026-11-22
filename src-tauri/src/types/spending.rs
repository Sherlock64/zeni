use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::CategoryKind;

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpendingQuery {
    /// Inclusive "YYYY-MM-DD".
    pub from: String,
    /// Inclusive "YYYY-MM-DD".
    pub to: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CategorySpending {
    #[ts(type = "number")]
    pub category_id: i64,
    pub name: String,
    pub kind: CategoryKind,
    pub count: u32,
    /// Minus the sum of amounts in a spending category; a refund reduces it.
    #[ts(type = "number")]
    pub spending_cents: i64,
    /// The sum of amounts in an income category.
    #[ts(type = "number")]
    pub income_cents: i64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SpendingSummary {
    pub categories: Vec<CategorySpending>,
    pub uncategorized_count: u32,
    /// The sum of amounts of uncategorized rows.
    #[ts(type = "number")]
    pub uncategorized_cents: i64,
}
