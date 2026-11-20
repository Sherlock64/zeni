use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::keyring::SecretService;
use crate::types::{
    Account, AccountNumbers, AppError, AppInfo, AppState, BackupFile, BackupSettings, BuildPreview,
    BuildRequest, Category, CommitImportRequest, ContinueStartupRequest, CsvLayout, CsvMapping,
    CsvPreviewRow, DeleteCategoryRequest, DeleteCsvLayoutRequest, DeleteNicknameRequest,
    DeleteNicknameRuleRequest, ImportRecord, ImportStep, ImportSummary, JobStatus,
    MarkReviewedRequest, ModelBuild, NewCategory, Nickname, NicknameSettings, OllamaSettings,
    OllamaStatus, RecoverRequest, RecoveryCodes, ReleaseNotes, ReorderCategoriesRequest,
    RestoreBackupRequest, RevealAccountNumbersRequest, RevertImportRequest, ReviewGroup, RuleInput,
    SaveCsvLayoutRequest, SaveNicknameRuleRequest, SecurityStatus, SetAllowOverWindowRequest,
    SetAutoCategorizeRequest, SetBackupRetentionRequest, SetBaseModelRequest,
    SetExamplesPerCategoryRequest, SetOllamaPortRequest, SetTransactionCategoryRequest,
    SetTransactionsCategoryRequest, SetUpdateChecksRequest, SetupRequest, SetupResponse,
    SpendingQuery, SpendingSummary, StartCategorizeRequest, StartModelDownloadRequest, Startup,
    StartupStatus, TransactionPage, TransactionQuery, UnlockRequest, UpdateCategoryRequest,
    UpdateCsvLayoutRequest, UpdateNicknameRequest, UpdateNicknameRuleRequest, UpdateStatus,
};
use crate::{
    accounts, backup, builds, categories, categorize, csv_layouts, db, imports, jobs, nicknames,
    ollama, overlay, release_notes, review, security, spending, startup, transactions, updates,
};

/// Shows the dialog `show` opens and waits for the chosen path. `None` when the user cancels;
/// `unreadable` when the choice isn't a local path.
async fn picked(
    show: impl FnOnce(Box<dyn FnOnce(Option<FilePath>) + Send>),
    unreadable: AppError,
) -> Result<Option<PathBuf>, AppError> {
    // The callback form never blocks a thread; the dialog answers through the channel.
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    show(Box::new(move |file| {
        // Fails only when the command was dropped, so nobody is waiting for the answer.
        let _ = sender.try_send(file);
    }));
    let Some(file) = receiver.recv().await.flatten() else {
        return Ok(None);
    };
    file.into_path().map(Some).map_err(|_| unreadable)
}

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
    let (pool, db_path) = db::current(state)?;
    Ok(AppInfo {
        name,
        version,
        db_path: db_path.display().to_string(),
        migrations_applied: db::applied_migrations(&pool).await?,
    })
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
    let show = |answer| {
        app.dialog()
            .file()
            .add_filter("OFX, QFX or CSV files", &["ofx", "qfx", "csv"])
            .pick_file(answer)
    };
    let unreadable = AppError::Import("Couldn't open the selected file.".into());
    let Some(path) = picked(show, unreadable).await? else {
        return Ok(None);
    };
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
    categorize::commit_import(&state, request).await
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
    let show = |answer| app.dialog().file().pick_folder(answer);
    let unreadable = AppError::Backup("Couldn't open the selected folder.".into());
    let Some(path) = picked(show, unreadable).await? else {
        return Ok(None);
    };
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
    let show = |answer| {
        app.dialog()
            .file()
            .add_filter("Zeni backups", &["db"])
            .pick_file(answer)
    };
    let unreadable = AppError::Backup("Couldn't open the selected file.".into());
    let Some(path) = picked(show, unreadable).await? else {
        return Ok(None);
    };
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

#[tauri::command]
pub async fn list_nicknames(state: State<'_, AppState>) -> Result<Vec<Nickname>, AppError> {
    nicknames::list(&state).await
}

#[tauri::command]
pub async fn save_nickname_rule(
    state: State<'_, AppState>,
    request: SaveNicknameRuleRequest,
) -> Result<Nickname, AppError> {
    nicknames::save_rule(&state, request).await
}

#[tauri::command]
pub async fn count_rule_matches(
    state: State<'_, AppState>,
    request: RuleInput,
) -> Result<u32, AppError> {
    nicknames::count_matches(&state, request).await
}

#[tauri::command]
pub async fn update_nickname(
    state: State<'_, AppState>,
    request: UpdateNicknameRequest,
) -> Result<Nickname, AppError> {
    nicknames::update(&state, request).await
}

#[tauri::command]
pub async fn delete_nickname(
    state: State<'_, AppState>,
    request: DeleteNicknameRequest,
) -> Result<(), AppError> {
    nicknames::delete(&state, request).await
}

#[tauri::command]
pub async fn update_nickname_rule(
    state: State<'_, AppState>,
    request: UpdateNicknameRuleRequest,
) -> Result<Nickname, AppError> {
    nicknames::update_rule(&state, request).await
}

#[tauri::command]
pub async fn delete_nickname_rule(
    state: State<'_, AppState>,
    request: DeleteNicknameRuleRequest,
) -> Result<(), AppError> {
    nicknames::delete_rule(&state, request).await
}

#[tauri::command]
pub async fn nickname_settings(state: State<'_, AppState>) -> Result<NicknameSettings, AppError> {
    nicknames::settings(&state).await
}

#[tauri::command]
pub async fn set_nickname_stale_days(
    state: State<'_, AppState>,
    request: NicknameSettings,
) -> Result<NicknameSettings, AppError> {
    nicknames::set_stale_days(&state, request).await
}

#[tauri::command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, AppError> {
    categories::list(&state).await
}

#[tauri::command]
pub async fn add_category(
    state: State<'_, AppState>,
    request: NewCategory,
) -> Result<Category, AppError> {
    categories::add(&state, request).await
}

#[tauri::command]
pub async fn update_category(
    state: State<'_, AppState>,
    request: UpdateCategoryRequest,
) -> Result<Category, AppError> {
    categories::update(&state, request).await
}

#[tauri::command]
pub async fn reorder_categories(
    state: State<'_, AppState>,
    request: ReorderCategoriesRequest,
) -> Result<Vec<Category>, AppError> {
    categories::reorder(&state, request).await
}

#[tauri::command]
pub async fn delete_category(
    state: State<'_, AppState>,
    request: DeleteCategoryRequest,
) -> Result<(), AppError> {
    categories::delete(&state, request).await
}

#[tauri::command]
pub async fn set_transaction_category(
    state: State<'_, AppState>,
    request: SetTransactionCategoryRequest,
) -> Result<(), AppError> {
    overlay::set_category(&state, request).await
}

#[tauri::command]
pub async fn set_transactions_category(
    state: State<'_, AppState>,
    request: SetTransactionsCategoryRequest,
) -> Result<u32, AppError> {
    overlay::set_many(&state, request).await
}

#[tauri::command]
pub async fn ollama_settings(state: State<'_, AppState>) -> Result<OllamaSettings, AppError> {
    ollama::settings(&state).await
}

#[tauri::command]
pub async fn set_ollama_port(
    state: State<'_, AppState>,
    request: SetOllamaPortRequest,
) -> Result<OllamaSettings, AppError> {
    ollama::set_port(&state, request).await
}

#[tauri::command]
pub async fn set_base_model(
    state: State<'_, AppState>,
    request: SetBaseModelRequest,
) -> Result<OllamaSettings, AppError> {
    ollama::set_base_model(&state, request).await
}

#[tauri::command]
pub async fn set_auto_categorize(
    state: State<'_, AppState>,
    request: SetAutoCategorizeRequest,
) -> Result<OllamaSettings, AppError> {
    ollama::set_auto_categorize(&state, request).await
}

#[tauri::command]
pub async fn set_examples_per_category(
    state: State<'_, AppState>,
    request: SetExamplesPerCategoryRequest,
) -> Result<OllamaSettings, AppError> {
    ollama::set_examples_per_category(&state, request).await
}

#[tauri::command]
pub async fn set_allow_over_window(
    state: State<'_, AppState>,
    request: SetAllowOverWindowRequest,
) -> Result<OllamaSettings, AppError> {
    ollama::set_allow_over_window(&state, request).await
}

#[tauri::command]
pub async fn ollama_status(state: State<'_, AppState>) -> Result<OllamaStatus, AppError> {
    ollama::status(&state).await
}

#[tauri::command]
pub async fn start_model_download(
    state: State<'_, AppState>,
    request: StartModelDownloadRequest,
) -> Result<JobStatus, AppError> {
    ollama::start_download(&state, request).await
}

#[tauri::command]
pub async fn start_categorize(
    state: State<'_, AppState>,
    request: StartCategorizeRequest,
) -> Result<JobStatus, AppError> {
    categorize::start(&state, request).await
}

#[tauri::command]
pub async fn review_groups(state: State<'_, AppState>) -> Result<Vec<ReviewGroup>, AppError> {
    review::groups(&state).await
}

#[tauri::command]
pub async fn unreviewed_count(state: State<'_, AppState>) -> Result<u32, AppError> {
    review::unreviewed_count(&state).await
}

#[tauri::command]
pub async fn mark_reviewed(
    state: State<'_, AppState>,
    request: MarkReviewedRequest,
) -> Result<(), AppError> {
    review::mark_reviewed(&state, request).await
}

#[tauri::command]
pub async fn list_builds(state: State<'_, AppState>) -> Result<Vec<ModelBuild>, AppError> {
    builds::list(&state).await
}

#[tauri::command]
pub async fn build_preview(state: State<'_, AppState>) -> Result<BuildPreview, AppError> {
    builds::preview(&state).await
}

#[tauri::command]
pub async fn start_build(state: State<'_, AppState>) -> Result<JobStatus, AppError> {
    builds::start(&state).await
}

#[tauri::command]
pub async fn activate_build(
    state: State<'_, AppState>,
    request: BuildRequest,
) -> Result<(), AppError> {
    builds::activate(&state, request).await
}

#[tauri::command]
pub async fn delete_build(
    state: State<'_, AppState>,
    request: BuildRequest,
) -> Result<(), AppError> {
    builds::delete(&state, request).await
}

#[tauri::command]
pub async fn spending_summary(
    state: State<'_, AppState>,
    request: SpendingQuery,
) -> Result<SpendingSummary, AppError> {
    spending::summary(&state, request).await
}

#[tauri::command]
pub fn job_status(state: State<'_, AppState>) -> JobStatus {
    jobs::status(&state.jobs)
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>) {
    jobs::cancel(&state.jobs);
}

#[tauri::command]
pub fn clear_job_outcome(state: State<'_, AppState>) {
    jobs::clear_outcome(&state.jobs);
}

/// `Ready` unless startup is blocked; works without a database.
#[tauri::command]
pub fn startup_status(startup: State<'_, Startup>) -> StartupStatus {
    startup::current(&startup)
}

/// Retries startup after a failed pre-update backup, optionally without the backup.
#[tauri::command]
pub async fn continue_startup(
    app: AppHandle,
    state: State<'_, AppState>,
    startup: State<'_, Startup>,
    request: ContinueStartupRequest,
) -> Result<StartupStatus, AppError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        AppError::Database(format!("Couldn't find Zeni's data folder: {error}"))
    })?;
    let status = startup::continue_prepare(&state, &startup, &db::data_dir(dir), request).await?;
    if status == StartupStatus::Ready {
        crate::spawn_ready_tasks(&app);
    }
    Ok(status)
}

#[tauri::command]
pub async fn update_status(state: State<'_, AppState>) -> Result<UpdateStatus, AppError> {
    updates::status(&state).await
}

#[tauri::command]
pub async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateStatus, AppError> {
    updates::check_now(&state).await
}

#[tauri::command]
pub async fn dismiss_update(state: State<'_, AppState>) -> Result<UpdateStatus, AppError> {
    updates::dismiss(&state).await
}

#[tauri::command]
pub async fn set_update_checks(
    state: State<'_, AppState>,
    request: SetUpdateChecksRequest,
) -> Result<UpdateStatus, AppError> {
    updates::set_enabled(&state, request).await
}

#[tauri::command]
pub async fn release_notes(state: State<'_, AppState>) -> Result<ReleaseNotes, AppError> {
    release_notes::notes(&state).await
}

#[tauri::command]
pub async fn acknowledge_release_notes(state: State<'_, AppState>) -> Result<(), AppError> {
    release_notes::acknowledge(&state).await
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    use super::*;
    use crate::types::Database;

    fn app_info_for(state: &AppState) -> Result<AppInfo, AppError> {
        let version = env!("CARGO_PKG_VERSION").to_string();
        tauri::async_runtime::block_on(load_app_info(state, "Zeni".into(), version))
    }

    #[test]
    fn app_info_reports_db_and_migrations() {
        let dir = db::temp_dir("app-info");
        let state = AppState {
            db: std::sync::RwLock::new(tauri::async_runtime::block_on(db::connect(&dir))),
            session: Default::default(),
            backup: Default::default(),
            pending_import: Default::default(),
            jobs: Default::default(),
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
            jobs: Default::default(),
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
            jobs: Default::default(),
        };
        assert!(matches!(app_info_for(&state), Err(AppError::Database(_))));
    }

    fn picked_with(file: Option<FilePath>) -> Result<Option<PathBuf>, AppError> {
        let unreadable = AppError::Import("unreadable".into());
        tauri::async_runtime::block_on(picked(move |answer| answer(file), unreadable))
    }

    #[test]
    fn picked_returns_none_on_cancel() {
        assert!(matches!(picked_with(None), Ok(None)));
    }

    #[test]
    fn picked_returns_the_chosen_path() {
        let path = PathBuf::from("/tmp/statement.ofx");
        let result = picked_with(Some(FilePath::Path(path.clone())));
        assert!(matches!(result, Ok(Some(p)) if p == path));
    }

    #[test]
    fn picked_returns_the_given_error_for_a_non_file_url() {
        let url = tauri::Url::parse("https://example.com/statement.ofx").unwrap();
        let result = picked_with(Some(FilePath::Url(url)));
        assert!(matches!(result, Err(AppError::Import(m)) if m == "unreadable"));
    }
}
