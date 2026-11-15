use std::sync::PoisonError;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::keyring::SecretService;
use crate::types::{
    Account, AccountNumbers, AppError, AppInfo, AppState, BackupFile, BackupSettings,
    CommitImportRequest, CsvLayout, CsvMapping, CsvPreviewRow, DeleteCsvLayoutRequest,
    ImportRecord, ImportStep, ImportSummary, RecoverRequest, RecoveryCodes, RestoreBackupRequest,
    RevealAccountNumbersRequest, RevertImportRequest, SampleErrorRequest, SaveCsvLayoutRequest,
    SecurityStatus, SetBackupRetentionRequest, SetupRequest, SetupResponse, TransactionPage,
    TransactionQuery, UnlockRequest, UpdateCsvLayoutRequest,
};
use crate::{accounts, backup, csv_layouts, db, imports, security, transactions};

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
    let db_path = match &*state.db.read().unwrap_or_else(PoisonError::into_inner) {
        Ok(database) => database.path.display().to_string(),
        Err(error) => return Err(AppError::Database(error.clone())),
    };
    let pool = security::pool(state)?;
    Ok(AppInfo {
        name,
        version,
        db_path,
        migrations_applied: db::applied_migrations(&pool).await?,
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
) -> Result<Option<ImportStep>, AppError> {
    // Fails before showing the picker when the database is unavailable.
    security::pool(&state)?;
    // The callback form never blocks a thread; the dialog answers through the channel.
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .add_filter("OFX, QFX or CSV files", &["ofx", "qfx", "csv"])
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
pub async fn preview_csv_mapping(
    state: State<'_, AppState>,
    request: CsvMapping,
) -> Result<Vec<CsvPreviewRow>, AppError> {
    imports::preview_csv_mapping(&state, request)
}

#[tauri::command]
pub async fn save_csv_layout(
    state: State<'_, AppState>,
    request: SaveCsvLayoutRequest,
) -> Result<ImportStep, AppError> {
    imports::save_csv_layout(&state, request).await
}

#[tauri::command]
pub async fn commit_import(
    state: State<'_, AppState>,
    request: CommitImportRequest,
) -> Result<ImportSummary, AppError> {
    imports::commit_import(&state, request).await
}

#[tauri::command]
pub fn cancel_import(state: State<'_, AppState>) {
    imports::cancel_import(&state);
}

#[tauri::command]
pub async fn list_csv_layouts(state: State<'_, AppState>) -> Result<Vec<CsvLayout>, AppError> {
    csv_layouts::list(&state).await
}

#[tauri::command]
pub async fn update_csv_layout(
    state: State<'_, AppState>,
    request: UpdateCsvLayoutRequest,
) -> Result<CsvLayout, AppError> {
    csv_layouts::update(&state, request).await
}

#[tauri::command]
pub async fn delete_csv_layout(
    state: State<'_, AppState>,
    request: DeleteCsvLayoutRequest,
) -> Result<(), AppError> {
    csv_layouts::delete(&state, request).await
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

#[tauri::command]
pub async fn backup_settings(state: State<'_, AppState>) -> Result<BackupSettings, AppError> {
    backup::settings(&state).await
}

/// Opens the native folder picker and stores the chosen folder. `None` when the user cancels.
#[tauri::command]
pub async fn choose_backup_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<BackupSettings>, AppError> {
    // Fails before showing the picker when locked or the database is unavailable.
    backup::settings(&state).await?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog().file().pick_folder(move |folder| {
        let _ = sender.try_send(folder);
    });
    let Some(folder) = receiver.recv().await.flatten() else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| AppError::Backup("Couldn't open the selected folder.".into()))?;
    backup::set_folder(&state, &path).await.map(Some)
}

#[tauri::command]
pub async fn set_backup_retention(
    state: State<'_, AppState>,
    request: SetBackupRetentionRequest,
) -> Result<BackupSettings, AppError> {
    backup::set_retention(&state, request).await
}

#[tauri::command]
pub async fn back_up_now(state: State<'_, AppState>) -> Result<BackupFile, AppError> {
    backup::back_up_now(&state).await
}

#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupFile>, AppError> {
    backup::list(&state).await
}

/// Opens the native file picker and remembers the chosen file for `restore_backup`. `None` on cancel.
#[tauri::command]
pub async fn pick_restore_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<BackupFile>, AppError> {
    backup::settings(&state).await?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .add_filter("Zeni backups", &["db"])
        .pick_file(move |file| {
            let _ = sender.try_send(file);
        });
    let Some(file) = receiver.recv().await.flatten() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| AppError::Backup("Couldn't open the selected file.".into()))?;
    backup::pick(&state, path).await.map(Some)
}

#[tauri::command]
pub async fn restore_backup(
    state: State<'_, AppState>,
    request: RestoreBackupRequest,
) -> Result<(), AppError> {
    backup::restore(&state, request).await
}

#[tauri::command]
pub async fn undo_restore(state: State<'_, AppState>) -> Result<(), AppError> {
    backup::undo_restore(&state).await
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
            db: std::sync::RwLock::new(tauri::async_runtime::block_on(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
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
            db: std::sync::RwLock::new(Err(
                "Couldn't open the database at /x/zeni.db: denied".into()
            )),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
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
            db: std::sync::RwLock::new(Ok(Database {
                pool,
                path: "memory".into(),
            })),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
        };
        assert!(matches!(app_info_for(&state), Err(AppError::Database(_))));
    }
}
