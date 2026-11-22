use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How a nickname rule compares its pattern with a transaction field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[ts(export)]
pub enum MatchMode {
    /// Case-insensitive whole text after trimming.
    Exact,
    /// Case-insensitive substring.
    Contains,
    /// Rust regex, case-insensitive by default.
    Regex,
}

/// Which raw transaction field a nickname rule reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[ts(export)]
pub enum MatchField {
    Description,
    /// A row with no memo never matches.
    Memo,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NicknameRule {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub nickname_id: i64,
    pub mode: MatchMode,
    pub field: MatchField,
    pub pattern: String,
    /// Rows where this rule won.
    pub match_count: u32,
    /// "YYYY-MM-DD", newest posted date where this rule won.
    pub last_matched: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Nickname {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub enabled: bool,
    pub stale_exempt: bool,
    /// Sum over its rules.
    pub match_count: u32,
    /// "YYYY-MM-DD", newest over its rules.
    pub last_matched: Option<String>,
    pub stale: bool,
    /// Ordered by id ascending; never empty.
    pub rules: Vec<NicknameRule>,
    #[ts(type = "number | null")]
    pub default_category_id: Option<i64>,
}

/// A rule as the user typed it; shared by the nickname requests.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuleInput {
    pub mode: MatchMode,
    pub field: MatchField,
    /// Trimmed, 1..=500 chars; a regex must compile.
    pub pattern: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SaveNicknameRuleRequest {
    /// Trimmed, 1..=100 chars; an existing name (case-insensitive) gets the rule added.
    pub name: String,
    pub rule: RuleInput,
    /// Always applied, also to an existing nickname: `None` clears it.
    #[serde(default)]
    #[ts(optional, type = "number")]
    pub default_category_id: Option<i64>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateNicknameRequest {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub enabled: bool,
    pub stale_exempt: bool,
    /// Always applied: `None` clears it.
    #[serde(default)]
    #[ts(optional, type = "number")]
    pub default_category_id: Option<i64>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteNicknameRequest {
    #[ts(type = "number")]
    pub id: i64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateNicknameRuleRequest {
    #[ts(type = "number")]
    pub id: i64,
    pub rule: RuleInput,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteNicknameRuleRequest {
    #[ts(type = "number")]
    pub id: i64,
}

/// Also the `set_nickname_stale_days` request.
#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NicknameSettings {
    /// 1..=3650; stored as `app_meta` `nickname_stale_days`, absent means 90.
    pub stale_days: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nickname_types_match_contract_json() {
        for (text, mode) in [
            ("exact", MatchMode::Exact),
            ("contains", MatchMode::Contains),
            ("regex", MatchMode::Regex),
        ] {
            assert_eq!(serde_json::to_value(mode).unwrap(), text);
            assert_eq!(
                serde_json::from_value::<MatchMode>(text.into()).unwrap(),
                mode
            );
        }
        for (text, field) in [
            ("description", MatchField::Description),
            ("memo", MatchField::Memo),
        ] {
            assert_eq!(serde_json::to_value(field).unwrap(), text);
            assert_eq!(
                serde_json::from_value::<MatchField>(text.into()).unwrap(),
                field
            );
        }

        let save: SaveNicknameRuleRequest = serde_json::from_value(serde_json::json!({
            "name": "Coffee",
            "rule": { "mode": "contains", "field": "memo", "pattern": "corner" }
        }))
        .unwrap();
        assert_eq!(save.name, "Coffee");
        assert_eq!(
            (save.rule.mode, save.rule.field, save.rule.pattern.as_str()),
            (MatchMode::Contains, MatchField::Memo, "corner")
        );
        let update: UpdateNicknameRequest = serde_json::from_value(serde_json::json!({
            "id": 3, "name": "Cafe", "enabled": false, "staleExempt": true
        }))
        .unwrap();
        assert_eq!(
            (update.id, update.enabled, update.stale_exempt),
            (3, false, true)
        );
        assert_eq!(
            serde_json::to_value(NicknameSettings { stale_days: 90 }).unwrap(),
            serde_json::json!({ "staleDays": 90 })
        );

        assert_eq!(
            serde_json::to_value(Nickname {
                id: 1,
                name: "Coffee".into(),
                enabled: true,
                stale_exempt: false,
                match_count: 2,
                last_matched: Some("2026-10-31".into()),
                stale: false,
                rules: vec![NicknameRule {
                    id: 4,
                    nickname_id: 1,
                    mode: MatchMode::Exact,
                    field: MatchField::Description,
                    pattern: "corner coffee".into(),
                    match_count: 2,
                    last_matched: Some("2026-10-31".into()),
                }],
                default_category_id: None,
            })
            .unwrap(),
            serde_json::json!({
                "id": 1,
                "name": "Coffee",
                "enabled": true,
                "staleExempt": false,
                "matchCount": 2,
                "lastMatched": "2026-10-31",
                "stale": false,
                "rules": [{
                    "id": 4,
                    "nicknameId": 1,
                    "mode": "exact",
                    "field": "description",
                    "pattern": "corner coffee",
                    "matchCount": 2,
                    "lastMatched": "2026-10-31"
                }],
                "defaultCategoryId": null
            })
        );
    }
}
