mod accounts;
mod backup;
mod builds;
mod categories;
mod categorize;
mod commands;
mod crypto;
mod csv_import;
mod csv_layouts;
mod db;
#[cfg(test)]
mod import_acceptance_tests;
mod imports;
mod jobs;
mod keyring;
mod nicknames;
mod ofx;
mod ollama;
mod overlay;
mod review;
mod security;
mod spending;
mod transactions;
mod types;

use tauri::Manager;

use types::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Never fail startup over the database: the UI explains the problem instead.
            let db = match app.path().app_data_dir() {
                Ok(dir) => tauri::async_runtime::block_on(db::connect(&db::data_dir(dir))),
                Err(error) => Err(format!("Couldn't find Zeni's data folder: {error}")),
            };
            if let Err(error) = &db {
                eprintln!("{error}");
            }
            let daily_due = db.is_ok();
            app.manage(AppState {
                db: std::sync::RwLock::new(db),
                session: Default::default(),
                backup: Default::default(),
                pending_import: Default::default(),
                jobs: Default::default(),
            });
            if daily_due {
                // Off the setup thread, so the window isn't blocked by the copy.
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    backup::daily_backup(&handle.state::<AppState>()).await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::sample_error,
            commands::security_status,
            commands::complete_setup,
            commands::unlock,
            commands::recover,
            commands::reset_security,
            commands::regenerate_recovery_codes,
            commands::list_accounts,
            commands::reveal_account_numbers,
            commands::import_file,
            commands::preview_csv_mapping,
            commands::save_csv_layout,
            commands::commit_import,
            commands::cancel_import,
            commands::list_csv_layouts,
            commands::update_csv_layout,
            commands::delete_csv_layout,
            commands::list_imports,
            commands::revert_import,
            commands::list_transactions,
            commands::backup_settings,
            commands::choose_backup_folder,
            commands::set_backup_retention,
            commands::back_up_now,
            commands::list_backups,
            commands::pick_restore_file,
            commands::restore_backup,
            commands::undo_restore,
            commands::list_nicknames,
            commands::save_nickname_rule,
            commands::count_rule_matches,
            commands::update_nickname,
            commands::delete_nickname,
            commands::update_nickname_rule,
            commands::delete_nickname_rule,
            commands::nickname_settings,
            commands::set_nickname_stale_days,
            commands::list_categories,
            commands::add_category,
            commands::update_category,
            commands::reorder_categories,
            commands::delete_category,
            commands::set_transaction_category,
            commands::set_transactions_category,
            commands::ollama_settings,
            commands::set_ollama_port,
            commands::set_base_model,
            commands::set_auto_categorize,
            commands::set_examples_per_category,
            commands::ollama_status,
            commands::start_model_download,
            commands::start_categorize,
            commands::review_groups,
            commands::unreviewed_count,
            commands::mark_reviewed,
            commands::list_builds,
            commands::start_build,
            commands::activate_build,
            commands::delete_build,
            commands::spending_summary,
            commands::job_status,
            commands::cancel_job,
            commands::clear_job_outcome
        ])
        .build(tauri::generate_context!())
        .expect("error while running Zeni")
        .run(|handle, event| {
            if let (tauri::RunEvent::Exit, Some(state)) = (event, handle.try_state::<AppState>()) {
                jobs::cancel(&state.jobs);
            }
        });
}
