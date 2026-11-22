use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::SetBy;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TransactionSort {
    Date,
    Amount,
    Description,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TransactionQuery {
    /// Inclusive "YYYY-MM-DD".
    pub from: Option<String>,
    /// Inclusive "YYYY-MM-DD".
    pub to: Option<String>,
    /// Case-insensitive substring of nickname, description, memo or note; trimmed, empty means none, at most 200 chars.
    pub search: Option<String>,
    /// Only rows whose effective category is this one.
    #[serde(default)]
    #[ts(optional, type = "number")]
    pub category_id: Option<i64>,
    /// `true`: only rows with no effective category. Not together with `category_id`.
    #[serde(default)]
    #[ts(optional)]
    pub uncategorized: Option<bool>,
    pub sort: TransactionSort,
    pub direction: SortDirection,
    /// 0-based.
    pub page: u32,
    /// 1..=200.
    pub page_size: u32,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Transaction {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub import_id: i64,
    /// "YYYY-MM-DD".
    pub posted_date: String,
    /// Negative means money out.
    #[ts(type = "number")]
    pub amount_cents: i64,
    /// The raw description.
    pub description: String,
    pub memo: Option<String>,
    pub transaction_type: Option<String>,
    #[ts(type = "number | null")]
    pub running_balance_cents: Option<i64>,
    /// The winning rule's nickname name; `None` when unmapped.
    pub nickname: Option<String>,
    /// The effective category; `None` when uncategorized.
    #[ts(type = "number | null")]
    pub category_id: Option<i64>,
    /// The effective category's name.
    pub category: Option<String>,
    pub set_by: Option<SetBy>,
    /// Set by the user or a nickname, or a model answer marked reviewed.
    pub reviewed: bool,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TransactionPage {
    pub rows: Vec<Transaction>,
    pub total: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transaction_types_match_contract_json() {
        let query: TransactionQuery = serde_json::from_value(serde_json::json!({
            "from": "2026-10-01",
            "to": null,
            "search": "coffee",
            "sort": "amount",
            "direction": "asc",
            "page": 2,
            "pageSize": 50
        }))
        .unwrap();
        assert_eq!(query.from.as_deref(), Some("2026-10-01"));
        assert_eq!(query.to, None);
        assert_eq!(query.search.as_deref(), Some("coffee"));
        assert_eq!(query.sort, TransactionSort::Amount);
        assert_eq!(query.direction, SortDirection::Asc);
        assert_eq!((query.page, query.page_size), (2, 50));
        for (text, sort) in [
            ("date", TransactionSort::Date),
            ("description", TransactionSort::Description),
        ] {
            assert_eq!(
                serde_json::from_value::<TransactionSort>(text.into()).unwrap(),
                sort
            );
        }
        assert_eq!(
            serde_json::from_value::<SortDirection>("desc".into()).unwrap(),
            SortDirection::Desc
        );

        assert_eq!(
            serde_json::to_value(TransactionPage {
                rows: vec![Transaction {
                    id: 5,
                    import_id: 2,
                    posted_date: "2026-10-03".into(),
                    amount_cents: -1299,
                    description: "CORNER COFFEE".into(),
                    memo: None,
                    transaction_type: Some("DEBIT".into()),
                    running_balance_cents: None,
                    nickname: Some("Coffee".into()),
                    category_id: None,
                    category: None,
                    set_by: None,
                    reviewed: false,
                    note: None,
                }],
                total: 57,
            })
            .unwrap(),
            serde_json::json!({
                "rows": [{
                    "id": 5,
                    "importId": 2,
                    "postedDate": "2026-10-03",
                    "amountCents": -1299,
                    "description": "CORNER COFFEE",
                    "memo": null,
                    "transactionType": "DEBIT",
                    "runningBalanceCents": null,
                    "nickname": "Coffee",
                    "categoryId": null,
                    "category": null,
                    "setBy": null,
                    "reviewed": false,
                    "note": null
                }],
                "total": 57
            })
        );
    }
}
