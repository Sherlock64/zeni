use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zeroize::Zeroizing;

use super::NewAccount;

/// The 256-bit data key that encrypts account fields. Zeroized on drop; never Debug-printed.
pub struct DataKey(pub Zeroizing<[u8; 32]>);

/// The unlocked state. `keyring_saved` is cached at unlock time for `security_status`.
pub struct Session {
    pub key: DataKey,
    pub keyring_saved: bool,
}

/// Argon2id parameters, stored per `key_wraps` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

/// Result of reading the data key from the Secret Service.
pub enum KeyringLoad {
    Found(DataKey),
    /// No item, or one with a different key id.
    Missing,
    Locked,
    /// No D-Bus service, an error, or a timeout.
    Unavailable,
}

/// A `key_wraps` value pair: `(salt, wrapped_key)`.
pub type KeyWrap = ([u8; 16], Vec<u8>);

/// A `key_wraps` row: `(id, salt, kdf_m_kib, kdf_t, kdf_p, wrapped_key)`.
pub type KeyWrapRow = (i64, Vec<u8>, u32, u32, u32, Vec<u8>);

#[derive(Debug, Serialize, TS)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum SecurityStatus {
    NeedsSetup {
        default_owner: String,
    },
    Locked {
        reason: LockReason,
        /// True while the last restore can be undone.
        can_undo_restore: bool,
    },
    Unlocked {
        keyring_saved: bool,
        recovery_codes_left: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LockReason {
    KeyringLocked,
    KeyringUnavailable,
    KeyMissing,
}

// Secret-holding types below (passwords, codes) deliberately don't derive Debug.

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetupRequest {
    pub master_password: String,
    pub account: NewAccount,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetupResponse {
    pub recovery_codes: Vec<String>,
    pub keyring_saved: bool,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UnlockRequest {
    pub master_password: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecoverRequest {
    pub recovery_code: String,
    pub new_master_password: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecoveryCodes {
    pub codes: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn security_types_match_contract_json() {
        let json = |status| serde_json::to_value(status).unwrap();
        assert_eq!(
            json(SecurityStatus::NeedsSetup {
                default_owner: "sherlock".into()
            }),
            serde_json::json!({ "state": "needsSetup", "defaultOwner": "sherlock" })
        );
        assert_eq!(
            json(SecurityStatus::Locked {
                reason: LockReason::KeyringLocked,
                can_undo_restore: true,
            }),
            serde_json::json!({ "state": "locked", "reason": "keyringLocked", "canUndoRestore": true })
        );
        assert_eq!(
            json(SecurityStatus::Unlocked {
                keyring_saved: true,
                recovery_codes_left: 8
            }),
            serde_json::json!({ "state": "unlocked", "keyringSaved": true, "recoveryCodesLeft": 8 })
        );
        assert_eq!(
            serde_json::to_value(LockReason::KeyringUnavailable).unwrap(),
            "keyringUnavailable"
        );
        assert_eq!(
            serde_json::to_value(LockReason::KeyMissing).unwrap(),
            "keyMissing"
        );

        let request: RecoverRequest = serde_json::from_value(serde_json::json!({
            "recoveryCode": "ABCDE-FGHJK-MNPQR-STVWX",
            "newMasterPassword": "correct horse battery"
        }))
        .unwrap();
        assert_eq!(request.recovery_code, "ABCDE-FGHJK-MNPQR-STVWX");
        assert_eq!(request.new_master_password, "correct horse battery");
    }
}
