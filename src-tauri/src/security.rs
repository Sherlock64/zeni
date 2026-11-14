use std::sync::{MutexGuard, PoisonError};

use sqlx::{SqliteConnection, SqlitePool};
use zeroize::Zeroizing;

use crate::accounts;
use crate::crypto::{self, invalid_recovery_code};
#[cfg(not(test))]
use crate::crypto::{PASSWORD_KDF, RECOVERY_KDF};
#[cfg(test)]
use crate::crypto::{TEST_KDF as PASSWORD_KDF, TEST_KDF as RECOVERY_KDF};
use crate::keyring::Keyring;
use crate::types::{
    AppError, AppState, DataKey, KdfParams, KeyWrap, KeyWrapRow, KeyringLoad, LockReason,
    RecoverRequest, RecoveryCodes, SecurityStatus, Session, SetupRequest, SetupResponse,
    UnlockRequest,
};

const RECOVERY_CODE_COUNT: usize = 8;
const MIN_PASSWORD_CHARS: usize = 12;
const MAX_PASSWORD_CHARS: usize = 1024;

pub fn pool(state: &AppState) -> Result<&SqlitePool, AppError> {
    state
        .db
        .as_ref()
        .map(|database| &database.pool)
        .map_err(|error| AppError::Database(error.clone()))
}

fn session(state: &AppState) -> MutexGuard<'_, Option<Session>> {
    state.session.lock().unwrap_or_else(PoisonError::into_inner)
}

fn set_session(state: &AppState, key: DataKey, keyring_saved: bool) {
    *session(state) = Some(Session { key, keyring_saved });
}

fn unlock_first() -> AppError {
    AppError::Locked("Unlock Zeni first.".into())
}

fn wrong_password() -> AppError {
    AppError::WrongPassword("That master password is incorrect.".into())
}

/// A copy of the in-memory data key, so no lock is held across an await.
pub fn session_key(state: &AppState) -> Result<DataKey, AppError> {
    session(state)
        .as_ref()
        .map(|session| DataKey(Zeroizing::new(*session.key.0)))
        .ok_or_else(unlock_first)
}

fn is_unlocked(state: &AppState) -> bool {
    session(state).is_some()
}

fn validate_new_password(field: &str, password: &str) -> Result<(), AppError> {
    let chars = password.chars().count();
    if chars < MIN_PASSWORD_CHARS {
        return Err(AppError::Validation(format!(
            "{field} must be at least {MIN_PASSWORD_CHARS} characters"
        )));
    }
    if chars > MAX_PASSWORD_CHARS {
        return Err(AppError::Validation(format!(
            "{field} must be at most {MAX_PASSWORD_CHARS} characters"
        )));
    }
    Ok(())
}

fn require_password(password: &str) -> Result<(), AppError> {
    if password.is_empty() {
        return Err(AppError::Validation(
            "masterPassword must not be empty".into(),
        ));
    }
    Ok(())
}

async fn is_set_up(pool: &SqlitePool) -> Result<bool, AppError> {
    let exists =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM key_wraps WHERE kind = 'password')")
            .fetch_one(pool)
            .await?;
    Ok(exists)
}

/// For `unlock` and `recover`: setup is done and the key isn't loaded yet.
async fn require_locked(state: &AppState, pool: &SqlitePool) -> Result<(), AppError> {
    if !is_set_up(pool).await? {
        return Err(AppError::Locked("Set up Zeni first.".into()));
    }
    if is_unlocked(state) {
        return Err(AppError::Locked("Zeni is already unlocked.".into()));
    }
    Ok(())
}

async fn key_id(pool: &SqlitePool) -> Result<String, AppError> {
    let id = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'data_key_id'")
        .fetch_one(pool)
        .await?;
    Ok(id)
}

/// The first `kind` row whose wrap `secret` opens, with the data key inside.
async fn find_key(
    pool: &SqlitePool,
    kind: &str,
    secret: &[u8],
) -> Result<Option<(i64, DataKey)>, AppError> {
    let rows: Vec<KeyWrapRow> = sqlx::query_as(
        "SELECT id, salt, kdf_m_kib, kdf_t, kdf_p, wrapped_key FROM key_wraps WHERE kind = ? ORDER BY id",
    )
    .bind(kind)
    .fetch_all(pool)
    .await?;
    for (id, salt, m_kib, t, p, wrapped) in rows {
        let params = KdfParams { m_kib, t, p };
        if let Some(key) = crypto::unwrap_key(secret, &salt, params, &wrapped)? {
            return Ok(Some((id, key)));
        }
    }
    Ok(None)
}

async fn insert_wrap(
    connection: &mut SqliteConnection,
    kind: &str,
    params: KdfParams,
    (salt, wrapped): &KeyWrap,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO key_wraps (kind, salt, kdf_m_kib, kdf_t, kdf_p, wrapped_key) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(kind)
    .bind(&salt[..])
    .bind(params.m_kib)
    .bind(params.t)
    .bind(params.p)
    .bind(wrapped)
    .execute(connection)
    .await?;
    Ok(())
}

/// 8 fresh codes (formatted for display) and their wraps. Derived before any transaction opens.
fn new_recovery_wraps(key: &DataKey) -> Result<(Vec<String>, Vec<KeyWrap>), AppError> {
    let mut codes = Vec::with_capacity(RECOVERY_CODE_COUNT);
    let mut wraps = Vec::with_capacity(RECOVERY_CODE_COUNT);
    for _ in 0..RECOVERY_CODE_COUNT {
        let code = Zeroizing::new(crypto::new_recovery_code()?);
        wraps.push(crypto::wrap_key(code.as_bytes(), RECOVERY_KDF, key)?);
        codes.push(crypto::format_recovery_code(&code));
    }
    Ok((codes, wraps))
}

async fn insert_recovery_wraps(
    connection: &mut SqliteConnection,
    wraps: &[KeyWrap],
) -> Result<(), AppError> {
    for wrap in wraps {
        insert_wrap(connection, "recovery", RECOVERY_KDF, wrap).await?;
    }
    Ok(())
}

/// After a password/code unlock: makes sure the keyring holds `key`, so the next launch skips the prompt.
async fn save_to_keyring(
    pool: &SqlitePool,
    keyring: &impl Keyring,
    key: &DataKey,
) -> Result<bool, AppError> {
    let key_id = key_id(pool).await?;
    Ok(match keyring.load(&key_id).await {
        KeyringLoad::Found(found) if *found.0 == *key.0 => true,
        KeyringLoad::Found(_) | KeyringLoad::Missing => keyring.store(&key_id, key).await,
        KeyringLoad::Locked | KeyringLoad::Unavailable => false,
    })
}

fn default_owner() -> String {
    std::env::var("USER")
        .ok()
        .filter(|user| !user.trim().is_empty())
        .unwrap_or_else(|| "Me".into())
}

pub async fn status(state: &AppState, keyring: &impl Keyring) -> Result<SecurityStatus, AppError> {
    let pool = pool(state)?;
    if !is_set_up(pool).await? {
        return Ok(SecurityStatus::NeedsSetup {
            default_owner: default_owner(),
        });
    }
    let cached = session(state).as_ref().map(|session| session.keyring_saved);
    let keyring_saved = match cached {
        Some(saved) => saved,
        None => {
            let reason = match keyring.load(&key_id(pool).await?).await {
                KeyringLoad::Found(key) => {
                    set_session(state, key, true);
                    None
                }
                KeyringLoad::Locked => Some(LockReason::KeyringLocked),
                KeyringLoad::Unavailable => Some(LockReason::KeyringUnavailable),
                KeyringLoad::Missing => Some(LockReason::KeyMissing),
            };
            if let Some(reason) = reason {
                return Ok(SecurityStatus::Locked { reason });
            }
            true
        }
    };
    let recovery_codes_left =
        sqlx::query_scalar("SELECT COUNT(*) FROM key_wraps WHERE kind = 'recovery'")
            .fetch_one(pool)
            .await?;
    Ok(SecurityStatus::Unlocked {
        keyring_saved,
        recovery_codes_left,
    })
}

pub async fn complete_setup(
    state: &AppState,
    keyring: &impl Keyring,
    request: SetupRequest,
) -> Result<SetupResponse, AppError> {
    validate_new_password("masterPassword", &request.master_password)?;
    let account = accounts::validate(request.account)?;
    let pool = pool(state)?;
    if is_set_up(pool).await? {
        return Err(AppError::Locked("Zeni is already set up.".into()));
    }

    let key = crypto::new_data_key()?;
    let key_id = crypto::new_key_id()?;
    let password_wrap = crypto::wrap_key(request.master_password.as_bytes(), PASSWORD_KDF, &key)?;
    let (recovery_codes, recovery_wraps) = new_recovery_wraps(&key)?;

    let mut transaction = pool.begin().await?;
    insert_wrap(&mut transaction, "password", PASSWORD_KDF, &password_wrap).await?;
    insert_recovery_wraps(&mut transaction, &recovery_wraps).await?;
    sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('data_key_id', ?)")
        .bind(&key_id)
        .execute(&mut *transaction)
        .await?;
    accounts::insert(&mut transaction, &key, &account).await?;
    transaction.commit().await?;

    let keyring_saved = keyring.store(&key_id, &key).await;
    set_session(state, key, keyring_saved);
    Ok(SetupResponse {
        recovery_codes,
        keyring_saved,
    })
}

pub async fn unlock(
    state: &AppState,
    keyring: &impl Keyring,
    request: UnlockRequest,
) -> Result<(), AppError> {
    require_password(&request.master_password)?;
    let pool = pool(state)?;
    require_locked(state, pool).await?;
    let (_, key) = find_key(pool, "password", request.master_password.as_bytes())
        .await?
        .ok_or_else(wrong_password)?;
    let keyring_saved = save_to_keyring(pool, keyring, &key).await?;
    set_session(state, key, keyring_saved);
    Ok(())
}

/// Opens with a recovery code (used up) and replaces the master password.
pub async fn recover(
    state: &AppState,
    keyring: &impl Keyring,
    request: RecoverRequest,
) -> Result<(), AppError> {
    let code = crypto::normalize_recovery_code(&request.recovery_code)?;
    validate_new_password("newMasterPassword", &request.new_master_password)?;
    let pool = pool(state)?;
    require_locked(state, pool).await?;
    let (code_id, key) = find_key(pool, "recovery", code.as_bytes())
        .await?
        .ok_or_else(invalid_recovery_code)?;
    let password_wrap =
        crypto::wrap_key(request.new_master_password.as_bytes(), PASSWORD_KDF, &key)?;

    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM key_wraps WHERE id = ? OR kind = 'password'")
        .bind(code_id)
        .execute(&mut *transaction)
        .await?;
    insert_wrap(&mut transaction, "password", PASSWORD_KDF, &password_wrap).await?;
    transaction.commit().await?;

    let keyring_saved = save_to_keyring(pool, keyring, &key).await?;
    set_session(state, key, keyring_saved);
    Ok(())
}

/// "Erase and set up again": only from the lock screen.
pub async fn reset(state: &AppState, keyring: &impl Keyring) -> Result<(), AppError> {
    let pool = pool(state)?;
    if !is_set_up(pool).await? {
        return Err(AppError::Validation("Zeni isn't set up yet.".into()));
    }
    if is_unlocked(state) {
        return Err(AppError::Locked(
            "Erasing is only possible while Zeni is locked.".into(),
        ));
    }
    let key_id: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'data_key_id'")
            .fetch_optional(pool)
            .await?;

    let mut transaction = pool.begin().await?;
    for statement in [
        "DELETE FROM key_wraps",
        "DELETE FROM app_meta WHERE key = 'data_key_id'",
        "DELETE FROM accounts",
    ] {
        sqlx::query(statement).execute(&mut *transaction).await?;
    }
    transaction.commit().await?;

    if let Some(key_id) = key_id {
        keyring.delete(&key_id).await;
    }
    Ok(())
}

/// Replaces all recovery codes with 8 new ones, after re-checking the master password.
pub async fn regenerate_recovery_codes(
    state: &AppState,
    request: UnlockRequest,
) -> Result<RecoveryCodes, AppError> {
    require_password(&request.master_password)?;
    let pool = pool(state)?;
    if !is_unlocked(state) {
        return Err(unlock_first());
    }
    let (_, key) = find_key(pool, "password", request.master_password.as_bytes())
        .await?
        .ok_or_else(wrong_password)?;
    let (codes, wraps) = new_recovery_wraps(&key)?;

    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM key_wraps WHERE kind = 'recovery'")
        .execute(&mut *transaction)
        .await?;
    insert_recovery_wraps(&mut transaction, &wraps).await?;
    transaction.commit().await?;
    Ok(RecoveryCodes { codes })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::*;
    use crate::accounts::sample_account;
    use crate::db;
    use crate::types::{Account, AccountNumbers, NewAccount, RevealAccountNumbersRequest};

    const PASSWORD: &str = "correct horse battery";

    /// In-memory Secret Service. `blocked` simulates a locked or unreachable keyring.
    #[derive(Default)]
    struct FakeKeyring {
        blocked: Mutex<Option<LockReason>>,
        items: Mutex<HashMap<String, [u8; 32]>>,
    }

    impl FakeKeyring {
        fn block(&self, reason: Option<LockReason>) {
            *self.blocked.lock().unwrap() = reason;
        }
    }

    impl Keyring for FakeKeyring {
        async fn load(&self, key_id: &str) -> KeyringLoad {
            match *self.blocked.lock().unwrap() {
                Some(LockReason::KeyringLocked) => KeyringLoad::Locked,
                Some(_) => KeyringLoad::Unavailable,
                None => match self.items.lock().unwrap().get(key_id) {
                    Some(key) => KeyringLoad::Found(DataKey(Zeroizing::new(*key))),
                    None => KeyringLoad::Missing,
                },
            }
        }

        async fn store(&self, key_id: &str, key: &DataKey) -> bool {
            let open = self.blocked.lock().unwrap().is_none();
            if open {
                self.items.lock().unwrap().insert(key_id.into(), *key.0);
            }
            open
        }

        async fn delete(&self, key_id: &str) {
            if self.blocked.lock().unwrap().is_none() {
                self.items.lock().unwrap().remove(key_id);
            }
        }
    }

    struct Fixture {
        state: AppState,
        keyring: FakeKeyring,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn fixture(name: &str) -> Fixture {
        let dir = db::temp_dir(&format!("security-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        Fixture {
            state: AppState {
                db: run(db::connect(&dir)),
                session: Default::default(),
            },
            keyring: FakeKeyring::default(),
            dir,
        }
    }

    impl Fixture {
        fn pool(&self) -> &SqlitePool {
            pool(&self.state).unwrap()
        }
        fn status(&self) -> SecurityStatus {
            run(status(&self.state, &self.keyring)).unwrap()
        }
        fn status_json(&self) -> serde_json::Value {
            serde_json::to_value(self.status()).unwrap()
        }
        fn setup(&self) -> SetupResponse {
            run(complete_setup(
                &self.state,
                &self.keyring,
                setup_request(PASSWORD),
            ))
            .unwrap()
        }
        /// Forgets the in-memory key, like a fresh launch.
        fn relaunch(&self) {
            *session(&self.state) = None;
        }
        fn unlock(&self, password: &str) -> Result<(), AppError> {
            let request = UnlockRequest {
                master_password: password.into(),
            };
            run(unlock(&self.state, &self.keyring, request))
        }
        fn recover(&self, code: &str, new_password: &str) -> Result<(), AppError> {
            let request = RecoverRequest {
                recovery_code: code.into(),
                new_master_password: new_password.into(),
            };
            run(recover(&self.state, &self.keyring, request))
        }
        fn regenerate(&self, password: &str) -> Result<RecoveryCodes, AppError> {
            let request = UnlockRequest {
                master_password: password.into(),
            };
            run(regenerate_recovery_codes(&self.state, request))
        }
        fn reset(&self) -> Result<(), AppError> {
            run(reset(&self.state, &self.keyring))
        }
        fn accounts(&self) -> Vec<Account> {
            run(accounts::list(&self.state)).unwrap()
        }
        fn reveal(&self, account_id: i64) -> Result<AccountNumbers, AppError> {
            run(accounts::reveal(
                &self.state,
                RevealAccountNumbersRequest { account_id },
            ))
        }
        fn count(&self, sql: &'static str) -> i64 {
            run(sqlx::query_scalar(sql).fetch_one(self.pool())).unwrap()
        }
    }

    fn setup_request(password: &str) -> SetupRequest {
        SetupRequest {
            master_password: password.into(),
            account: sample_account(),
        }
    }

    fn kind<T>(result: Result<T, AppError>) -> String {
        let error = result.err().expect("expected an error");
        serde_json::to_value(error).unwrap()["kind"]
            .as_str()
            .unwrap()
            .into()
    }

    #[test]
    fn migration_creates_key_wraps_and_accounts() {
        let f = fixture("schema");
        let insert = |kind: &str| {
            run(sqlx::query(
                "INSERT INTO key_wraps (kind, salt, kdf_m_kib, kdf_t, kdf_p, wrapped_key)
                 VALUES (?, x'00', 1, 1, 1, x'00')",
            )
            .bind(kind)
            .execute(f.pool()))
        };
        insert("password").unwrap();
        insert("recovery").unwrap();
        insert("recovery").unwrap();
        assert!(insert("password").is_err(), "only one password row");
        assert!(insert("other").is_err(), "kind is checked");
        assert_eq!(
            f.count("SELECT COUNT(*) FROM key_wraps WHERE created_at IS NOT NULL"),
            3
        );
        run(sqlx::query(
            "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number)
             VALUES ('a', 'b', 'c', x'01', x'02')",
        )
        .execute(f.pool()))
        .unwrap();
        assert_eq!(f.count("SELECT COUNT(*) FROM accounts"), 1);
    }

    #[test]
    fn setup_stores_encrypted_account_codes_and_keyring_item() {
        let f = fixture("setup");
        assert!(matches!(
            f.status(),
            SecurityStatus::NeedsSetup { default_owner } if !default_owner.is_empty()
        ));

        let response = f.setup();
        assert!(response.keyring_saved);
        assert_eq!(response.recovery_codes.len(), 8);
        for code in &response.recovery_codes {
            assert_eq!(code.len(), 23);
            assert!(crypto::normalize_recovery_code(code).is_ok());
        }
        assert_eq!(
            f.status_json(),
            serde_json::json!({ "state": "unlocked", "keyringSaved": true, "recoveryCodesLeft": 8 })
        );
        assert_eq!(
            f.count("SELECT COUNT(*) FROM key_wraps WHERE kind = 'password'"),
            1
        );
        let key_id = run(key_id(f.pool())).unwrap();
        assert!(f.keyring.items.lock().unwrap().contains_key(&key_id));

        let accounts = f.accounts();
        assert_eq!(accounts.len(), 1);
        assert_eq!(
            (
                accounts[0].name.as_str(),
                accounts[0].owner.as_str(),
                accounts[0].bank_name.as_str()
            ),
            ("Checking", "Sherlock", "First Bank")
        );
        let numbers = f.reveal(accounts[0].id).unwrap();
        assert_eq!(numbers.account_number, "123456789012");
        assert_eq!(numbers.routing_number, "011000015");

        // AC2: the stored blobs never contain the plaintext digits.
        let (account_number, routing_number): (Vec<u8>, Vec<u8>) = run(sqlx::query_as(
            "SELECT account_number, routing_number FROM accounts",
        )
        .fetch_one(f.pool()))
        .unwrap();
        let contains = |haystack: &[u8], needle: &[u8]| {
            haystack
                .windows(needle.len())
                .any(|window| window == needle)
        };
        for blob in [&account_number, &routing_number] {
            assert!(!contains(blob, b"123456789012"));
            assert!(!contains(blob, b"011000015"));
        }
    }

    #[test]
    fn setup_runs_once_and_survives_an_unreachable_keyring() {
        let f = fixture("setup-once");
        f.keyring.block(Some(LockReason::KeyringUnavailable));
        assert!(!f.setup().keyring_saved);
        assert_eq!(
            f.status_json(),
            serde_json::json!({ "state": "unlocked", "keyringSaved": false, "recoveryCodesLeft": 8 })
        );
        let again = run(complete_setup(
            &f.state,
            &f.keyring,
            setup_request(PASSWORD),
        ));
        assert_eq!(kind(again), "Locked");
        assert_eq!(f.accounts().len(), 1);
    }

    #[test]
    fn setup_validates_before_touching_the_db() {
        let state = AppState {
            db: Err("no database".into()),
            session: Default::default(),
        };
        let keyring = FakeKeyring::default();
        let setup = |password: &str, account: NewAccount| {
            let request = SetupRequest {
                master_password: password.into(),
                account,
            };
            kind(run(complete_setup(&state, &keyring, request)))
        };
        assert_eq!(setup(&"a".repeat(11), sample_account()), "Validation");
        assert_eq!(setup(&"a".repeat(1025), sample_account()), "Validation");
        // Not trimmed: 11 chars plus spaces is long enough.
        assert_eq!(setup(" aaaaaaaaaaa", sample_account()), "Database");
        assert_eq!(setup(&"a".repeat(12), sample_account()), "Database");
        assert_eq!(setup(&"é".repeat(1024), sample_account()), "Database");
        let mut bad = sample_account();
        bad.routing_number = "011000016".into();
        assert_eq!(setup(PASSWORD, bad), "Validation");
        assert_eq!(kind(run(status(&state, &keyring))), "Database");
    }

    #[test]
    fn every_command_reports_a_missing_database() {
        let state = AppState {
            db: Err("no database".into()),
            session: Default::default(),
        };
        let keyring = FakeKeyring::default();
        let password = || UnlockRequest {
            master_password: PASSWORD.into(),
        };
        let recover_request = RecoverRequest {
            recovery_code: crypto::new_recovery_code().unwrap(),
            new_master_password: PASSWORD.into(),
        };
        let reveal_request = RevealAccountNumbersRequest { account_id: 1 };
        assert_eq!(kind(run(unlock(&state, &keyring, password()))), "Database");
        assert_eq!(
            kind(run(recover(&state, &keyring, recover_request))),
            "Database"
        );
        assert_eq!(kind(run(reset(&state, &keyring))), "Database");
        assert_eq!(
            kind(run(regenerate_recovery_codes(&state, password()))),
            "Database"
        );
        assert_eq!(kind(run(accounts::list(&state))), "Database");
        // Locked with no database: the database error wins.
        assert_eq!(
            kind(run(accounts::reveal(&state, reveal_request))),
            "Database"
        );
    }

    #[test]
    fn status_reports_each_lock_reason_and_reads_the_keyring() {
        let f = fixture("status");
        f.setup();
        f.relaunch();

        let locked = |reason: &str| serde_json::json!({ "state": "locked", "reason": reason });
        f.keyring.block(Some(LockReason::KeyringLocked));
        assert_eq!(f.status_json(), locked("keyringLocked"));
        f.keyring.block(Some(LockReason::KeyringUnavailable));
        assert_eq!(f.status_json(), locked("keyringUnavailable"));
        assert_eq!(kind(f.reveal(1)), "Locked");

        f.keyring.block(None);
        let key = f.keyring.items.lock().unwrap().drain().next().unwrap().1;
        assert_eq!(f.status_json(), locked("keyMissing"));
        // An item under another key id (a stale install) counts as missing.
        f.keyring.items.lock().unwrap().insert("stale".into(), key);
        assert_eq!(f.status_json(), locked("keyMissing"));

        let key_id = run(key_id(f.pool())).unwrap();
        f.keyring.items.lock().unwrap().insert(key_id, key);
        assert!(matches!(
            f.status(),
            SecurityStatus::Unlocked {
                keyring_saved: true,
                ..
            }
        ));
        // Now cached: a keyring outage mid-session changes nothing.
        f.keyring.block(Some(LockReason::KeyringUnavailable));
        assert!(matches!(f.status(), SecurityStatus::Unlocked { .. }));
        assert_eq!(f.reveal(1).unwrap().account_number, "123456789012");
    }

    #[test]
    fn unlock_checks_the_password_and_restores_the_keyring_item() {
        let f = fixture("unlock");
        assert_eq!(kind(f.unlock(PASSWORD)), "Locked"); // not set up
        f.setup();
        assert_eq!(kind(f.unlock(PASSWORD)), "Locked"); // already unlocked
        f.relaunch();
        f.keyring.items.lock().unwrap().clear();

        assert_eq!(kind(f.unlock("")), "Validation");
        assert_eq!(kind(f.unlock("short")), "WrongPassword"); // only empty is a validation error
        assert_eq!(kind(f.unlock(&format!("{PASSWORD}!"))), "WrongPassword");
        assert!(session_key(&f.state).is_err(), "nothing decrypted");
        assert_eq!(kind(f.reveal(1)), "Locked");

        f.unlock(PASSWORD).unwrap();
        assert!(matches!(
            f.status(),
            SecurityStatus::Unlocked {
                keyring_saved: true,
                ..
            }
        ));
        assert_eq!(
            f.keyring.items.lock().unwrap().len(),
            1,
            "stored for the next launch"
        );
        assert_eq!(f.reveal(1).unwrap().routing_number, "011000015");

        // With the keyring locked the unlock still works but isn't saved.
        f.relaunch();
        f.keyring.block(Some(LockReason::KeyringLocked));
        f.unlock(PASSWORD).unwrap();
        assert!(matches!(
            f.status(),
            SecurityStatus::Unlocked {
                keyring_saved: false,
                ..
            }
        ));
    }

    #[test]
    fn recover_uses_up_a_code_and_replaces_the_password() {
        let f = fixture("recover");
        let codes = f.setup().recovery_codes;
        assert_eq!(kind(f.recover(&codes[0], "new password 1")), "Locked"); // unlocked
        f.relaunch();
        f.keyring.items.lock().unwrap().clear();

        assert_eq!(
            kind(f.recover("not a code", "new password 1")),
            "InvalidRecoveryCode"
        );
        assert_eq!(
            kind(f.recover("00000-00000-00000-00000", "new password 1")),
            "InvalidRecoveryCode"
        );
        assert!(session_key(&f.state).is_err(), "nothing decrypted");
        assert_eq!(kind(f.recover(&codes[2], &"a".repeat(11))), "Validation");

        // Lowercase, spaces instead of dashes.
        let typed = codes[2].to_lowercase().replace('-', " ");
        f.recover(&typed, &"a".repeat(12)).unwrap();
        assert!(matches!(
            f.status(),
            SecurityStatus::Unlocked {
                keyring_saved: true,
                recovery_codes_left: 7
            }
        ));
        assert_eq!(f.reveal(1).unwrap().account_number, "123456789012");

        f.relaunch();
        f.keyring.items.lock().unwrap().clear();
        assert_eq!(
            kind(f.recover(&codes[2], "another password")),
            "InvalidRecoveryCode"
        );
        assert_eq!(kind(f.unlock(PASSWORD)), "WrongPassword");
        f.unlock(&"a".repeat(12)).unwrap();
    }

    #[test]
    fn regenerate_replaces_all_codes() {
        let f = fixture("regenerate");
        let old = f.setup().recovery_codes;
        assert_eq!(kind(f.regenerate("")), "Validation");
        assert_eq!(kind(f.regenerate("wrong password")), "WrongPassword");
        let new = f.regenerate(PASSWORD).unwrap().codes;
        assert_eq!(new.len(), 8);
        assert!(new.iter().all(|code| !old.contains(code)));
        assert_eq!(
            f.count("SELECT COUNT(*) FROM key_wraps WHERE kind = 'recovery'"),
            8
        );

        f.relaunch();
        assert_eq!(kind(f.regenerate(PASSWORD)), "Locked");
        f.keyring.items.lock().unwrap().clear();
        for code in &old {
            assert_eq!(
                kind(f.recover(code, "new password 1")),
                "InvalidRecoveryCode"
            );
        }
        f.recover(&new[7], "new password 1").unwrap();
    }

    #[test]
    fn reset_erases_everything_and_returns_to_setup() {
        let f = fixture("reset");
        assert_eq!(kind(f.reset()), "Validation"); // needs setup
        f.setup();
        assert_eq!(kind(f.reset()), "Locked"); // unlocked
        f.relaunch();
        f.keyring.block(Some(LockReason::KeyringLocked));
        assert!(matches!(f.status(), SecurityStatus::Locked { .. }));
        f.keyring.block(None);

        f.reset().unwrap();
        assert!(matches!(f.status(), SecurityStatus::NeedsSetup { .. }));
        assert_eq!(f.count("SELECT COUNT(*) FROM key_wraps"), 0);
        assert_eq!(f.count("SELECT COUNT(*) FROM accounts"), 0);
        assert_eq!(
            f.count("SELECT COUNT(*) FROM app_meta WHERE key = 'data_key_id'"),
            0
        );
        assert!(f.keyring.items.lock().unwrap().is_empty());

        // Setting up again works.
        f.setup();
        assert_eq!(f.accounts().len(), 1);
    }

    #[test]
    fn reveal_reports_unknown_ids_and_tampering() {
        let f = fixture("reveal");
        f.setup();
        assert_eq!(kind(f.reveal(999)), "NotFound");
        run(sqlx::query("UPDATE accounts SET routing_number = account_number").execute(f.pool()))
            .unwrap();
        // Same key, wrong AAD: the swapped blob doesn't decrypt.
        assert_eq!(kind(f.reveal(1)), "Crypto");
    }

    #[test]
    fn secret_types_do_not_implement_debug() {
        // Inherent consts win over the trait fallback only when `T: Debug`.
        trait NotDebug {
            const IS_DEBUG: bool = false;
        }
        struct Probe<T>(std::marker::PhantomData<T>);
        impl<T> NotDebug for Probe<T> {}
        impl<T: std::fmt::Debug> Probe<T> {
            #[allow(dead_code)]
            const IS_DEBUG: bool = true;
        }
        const { assert!(Probe::<Vec<u8>>::IS_DEBUG, "the probe detects Debug") };
        const { assert!(!Probe::<DataKey>::IS_DEBUG) };
        const { assert!(!Probe::<Session>::IS_DEBUG) };
        const { assert!(!Probe::<KeyringLoad>::IS_DEBUG) };
        const { assert!(!Probe::<NewAccount>::IS_DEBUG) };
        const { assert!(!Probe::<SetupRequest>::IS_DEBUG) };
        const { assert!(!Probe::<SetupResponse>::IS_DEBUG) };
        const { assert!(!Probe::<UnlockRequest>::IS_DEBUG) };
        const { assert!(!Probe::<RecoverRequest>::IS_DEBUG) };
        const { assert!(!Probe::<RecoveryCodes>::IS_DEBUG) };
        const { assert!(!Probe::<AccountNumbers>::IS_DEBUG) };
    }
}
