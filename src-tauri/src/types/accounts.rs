use serde::{Deserialize, Serialize};
use ts_rs::TS;

// Secret-holding types below (account/routing numbers) deliberately don't derive Debug.

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewAccount {
    pub name: String,
    pub owner: String,
    pub bank_name: String,
    pub account_number: String,
    pub routing_number: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Account {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub owner: String,
    pub bank_name: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RevealAccountNumbersRequest {
    #[ts(type = "number")]
    pub account_id: i64,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AccountNumbers {
    pub account_number: String,
    pub routing_number: String,
}
