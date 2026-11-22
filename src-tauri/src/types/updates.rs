use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum UpdateResult {
    UpToDate,
    Newer { version: String, url: String },
    Failed { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateCheck {
    /// Local `YYYY-MM-DD`.
    pub date: String,
    pub result: UpdateResult,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateStatus {
    pub checks_enabled: bool,
    /// A check is in flight (launch or Check now).
    pub checking: bool,
    pub last: Option<UpdateCheck>,
    /// `Some` only for a `Newer` result whose version isn't dismissed.
    pub banner: Option<NewerRelease>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewerRelease {
    pub version: String,
    pub url: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetUpdateChecksRequest {
    pub enabled: bool,
}

/// One `CHANGELOG.md` section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReleaseNote {
    pub version: String,
    /// The section body's lines, trimmed; empty lines dropped.
    pub lines: Vec<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReleaseNotes {
    /// Sections not yet acknowledged since the upgrade, newest first.
    pub pending: Vec<ReleaseNote>,
    /// Every section up to this version, newest first.
    pub all: Vec<ReleaseNote>,
}
