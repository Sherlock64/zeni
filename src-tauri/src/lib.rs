mod commands;
mod db;
mod types;

use tauri::Manager;

use types::AppState;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Never fail startup over the database: the UI explains the problem instead.
            let db = match app.path().app_data_dir() {
                Ok(dir) => tauri::async_runtime::block_on(db::connect(&dir)),
                Err(error) => Err(format!("Couldn't find Zeni's data folder: {error}")),
            };
            if let Err(error) = &db {
                eprintln!("{error}");
            }
            app.manage(AppState { db });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::sample_error
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zeni");
}
