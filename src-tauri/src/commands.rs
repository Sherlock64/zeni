use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::keyring::SecretService;
use crate::types::{
    Account, AccountNumbers, AppError, AppInfo, AppState, ImportRecord, ImportSummary,
    RecoverRequest, RecoveryCodes, RevealAccountNumbersRequest, RevertImportRequest,
    SampleErrorRequest, SecurityStatus, SetupRequest, SetupResponse, TransactionPage,
    TransactionQuery, UnlockRequest,
};
use crate::{accounts, db, imports, security, transactions};

const MAX_REASON_CHARS: usize = 200;

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> Result<AppInfo, AppError> {
    let package = app.package_info();
    load_app_info(&state, package.name.clone(), package.version.to_string()).await
}

/// `app_info` without Tauri, so it can be tested directly.
async fn load_app_info(
    state: &AppState,
    name: String,
    version: String,
) -> Result<AppInfo, AppError> {
    let database = state
        .db
        .as_ref()
        .map_err(|error| AppError::Database(error.clone()))?;
    Ok(AppInfo {
        name,
        version,
        db_path: database.path.display().to_string(),
        migrations_applied: db::applied_migrations(&database.pool).await?,
    })
}

/// Always fails, so the UI can show a typed error from Rust.
#[tauri::command]
pub fn sample_error(request: SampleErrorRequest) -> Result<(), AppError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation("reason must not be empty".into()));
    }
    if reason.chars().count() > MAX_REASON_CHARS {
        return Err(AppError::Validation(format!(
            "reason must be at most {MAX_REASON_CHARS} characters"
        )));
    }
    Err(AppError::Sample(format!("Sample error: {reason}")))
}

#[tauri::command]
pub async fn security_status(state: State<'_, AppState>) -> Result<SecurityStatus, AppError> {
    security::status(&state, &SecretService).await
}

#[tauri::command]
pub async fn complete_setup(
    state: State<'_, AppState>,
    request: SetupRequest,
) -> Result<SetupResponse, AppError> {
    security::complete_setup(&state, &SecretService, request).await
}

#[tauri::command]
pub async fn unlock(state: State<'_, AppState>, request: UnlockRequest) -> Result<(), AppError> {
    security::unlock(&state, &SecretService, request).await
}

#[tauri::command]
pub async fn recover(state: State<'_, AppState>, request: RecoverRequest) -> Result<(), AppError> {
    security::recover(&state, &SecretService, request).await
}

#[tauri::command]
pub async fn reset_security(state: State<'_, AppState>) -> Result<(), AppError> {
    security::reset(&state, &SecretService).await
}

#[tauri::command]
pub async fn regenerate_recovery_codes(
    state: State<'_, AppState>,
    request: UnlockRequest,
) -> Result<RecoveryCodes, AppError> {
    security::regenerate_recovery_codes(&state, request).await
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, AppError> {
    accounts::list(&state).await
}

#[tauri::command]
pub async fn reveal_account_numbers(
    state: State<'_, AppState>,
    request: RevealAccountNumbersRequest,
) -> Result<AccountNumbers, AppError> {
    accounts::reveal(&state, request).await
}

/// Opens the native file picker and imports the chosen file. `None` when the user cancels.
#[tauri::command]
pub async fn import_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ImportSummary>, AppError> {
    // Fails before showing the picker when the database is unavailable.
    security::pool(&state)?;
    // The callback form never blocks a thread; the dialog answers through the channel.
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .add_filter("OFX or QFX files", &["ofx", "qfx"])
        .pick_file(move |file| {
            // Fails only when the command was dropped, so nobody is waiting for the answer.
            let _ = sender.try_send(file);
        });
    let Some(file) = receiver.recv().await.flatten() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| AppError::Import("Couldn't open the selected file.".into()))?;
    imports::import_path(&state, &path).await.map(Some)
}

#[tauri::command]
pub async fn list_imports(state: State<'_, AppState>) -> Result<Vec<ImportRecord>, AppError> {
    imports::list(&state).await
}

#[tauri::command]
pub async fn revert_import(
    state: State<'_, AppState>,
    request: RevertImportRequest,
) -> Result<(), AppError> {
    imports::revert(&state, request).await
}

#[tauri::command]
pub async fn list_transactions(
    state: State<'_, AppState>,
    request: TransactionQuery,
) -> Result<TransactionPage, AppError> {
    transactions::list(&state, request).await
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    use super::*;
    use crate::types::Database;

    fn sample(reason: &str) -> serde_json::Value {
        let request = SampleErrorRequest {
            reason: reason.into(),
        };
        serde_json::to_value(sample_error(request).unwrap_err()).unwrap()
    }

    fn app_info_for(state: &AppState) -> Result<AppInfo, AppError> {
        let version = env!("CARGO_PKG_VERSION").to_string();
        tauri::async_runtime::block_on(load_app_info(state, "Zeni".into(), version))
    }

    #[test]
    fn sample_error_returns_typed_error() {
        assert_eq!(
            sample("x"),
            serde_json::json!({ "kind": "Sample", "message": "Sample error: x" })
        );
    }

    #[test]
    fn sample_error_rejects_empty_reason() {
        let expected =
            serde_json::json!({ "kind": "Validation", "message": "reason must not be empty" });
        assert_eq!(sample(""), expected);
        assert_eq!(sample("  "), expected);
    }

    #[test]
    fn sample_error_limits_reason_to_200_chars() {
        assert_eq!(
            sample(&"a".repeat(201)),
            serde_json::json!({
                "kind": "Validation",
                "message": "reason must be at most 200 characters"
            })
        );
        assert_eq!(sample(&"a".repeat(200))["kind"], "Sample");
        // Counted in characters, not bytes, and after trimming.
        assert_eq!(sample(&"é".repeat(200))["kind"], "Sample");
        assert_eq!(sample(&format!(" {} ", "a".repeat(200)))["kind"], "Sample");
    }

    #[test]
    fn app_info_reports_db_and_migrations() {
        let dir = db::temp_dir("app-info");
        let state = AppState {
            db: tauri::async_runtime::block_on(db::connect(&dir)),
            session: Default::default(),
        };
        let info = app_info_for(&state).unwrap();
        assert_eq!(
            info.migrations_applied as usize,
            sqlx::migrate!("./migrations").migrations.len()
        );
        assert_eq!(info.name, "Zeni");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.db_path, dir.join("zeni.db").display().to_string());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app_info_fails_while_db_unavailable() {
        let state = AppState {
            db: Err("Couldn't open the database at /x/zeni.db: denied".into()),
            session: Default::default(),
        };
        let error = serde_json::to_value(app_info_for(&state).unwrap_err()).unwrap();
        assert_eq!(
            error,
            serde_json::json!({
                "kind": "Database",
                "message": "Couldn't open the database at /x/zeni.db: denied"
            })
        );
    }

    #[test]
    fn app_info_maps_query_failure_to_database_error() {
        // A database without migrations has no `_sqlx_migrations` table.
        let pool = tauri::async_runtime::block_on(SqlitePool::connect("sqlite::memory:")).unwrap();
        let state = AppState {
            db: Ok(Database {
                pool,
                path: "memory".into(),
            }),
            session: Default::default(),
        };
        assert!(matches!(app_info_for(&state), Err(AppError::Database(_))));
    }
}
