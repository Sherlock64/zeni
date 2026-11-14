mod accounts;
mod commands;
mod crypto;
mod db;
#[cfg(test)]
mod import_acceptance_tests;
mod imports;
mod keyring;
mod ofx;
mod security;
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
                Ok(dir) => tauri::async_runtime::block_on(db::connect(&dir)),
                Err(error) => Err(format!("Couldn't find Zeni's data folder: {error}")),
            };
            if let Err(error) = &db {
                eprintln!("{error}");
            }
            app.manage(AppState {
                db,
                session: Default::default(),
            });
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
            commands::list_imports,
            commands::revert_import,
            commands::list_transactions
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zeni");
}
