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
mod release_notes;
mod review;
mod security;
mod spending;
mod startup;
mod transactions;
mod types;
mod updates;
mod version;

use tauri::Manager;

use types::{AppState, Startup, StartupProblem};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Never fail startup over the database: the UI explains the problem instead.
            let prepared = match app.path().app_data_dir() {
                Ok(dir) => {
                    tauri::async_runtime::block_on(startup::prepare(&db::data_dir(dir), false))
                }
                Err(error) => Err(StartupProblem::Failed(format!(
                    "Couldn't find Zeni's data folder: {error}"
                ))),
            };
            let (db, blocked) = match prepared {
                Ok(database) => (Ok(database), None),
                Err(StartupProblem::Blocked(status)) => {
                    (Err(startup::blocked_text(&status)), Some(status))
                }
                Err(StartupProblem::Failed(error)) => (Err(error), None),
            };
            if let Err(error) = &db {
                eprintln!("{error}");
            }
            let ready = db.is_ok();
            app.manage(AppState {
                db: std::sync::RwLock::new(db),
                session: Default::default(),
                backup: Default::default(),
                pending_import: Default::default(),
                jobs: Default::default(),
            });
            app.manage(Startup(std::sync::Mutex::new(blocked)));
            if ready {
                spawn_ready_tasks(app.handle());
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
            commands::clear_job_outcome,
            commands::startup_status,
            commands::continue_startup,
            commands::update_status,
            commands::check_for_updates,
            commands::dismiss_update,
            commands::set_update_checks,
            commands::release_notes,
            commands::acknowledge_release_notes
        ])
        .build(tauri::generate_context!())
        .expect("error while running Zeni")
        .run(|handle, event| {
            if let (tauri::RunEvent::Exit, Some(state)) = (event, handle.try_state::<AppState>()) {
                jobs::cancel(&state.jobs);
            }
        });
}

/// Once the database is ready: the daily backup and the launch update check, off the setup thread.
fn spawn_ready_tasks(handle: &tauri::AppHandle) {
    let backup_handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        backup::daily_backup(&backup_handle.state::<AppState>()).await;
    });
    let update_handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        updates::launch_check(&update_handle.state::<AppState>()).await;
    });
}
