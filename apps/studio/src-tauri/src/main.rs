#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use uniqent_studio::commands::{self, AppState};
use uniqent_studio::session::Session;

fn main() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(Session::new())))
        .invoke_handler(tauri::generate_handler![
            commands::state, commands::catalog, commands::set_meta, commands::set_targets,
            commands::set_persona, commands::set_readme, commands::set_avatar,
            commands::remove_avatar, commands::reset
        ])
        .run(tauri::generate_context!())
        .expect("error while running uniqent studio");
}
