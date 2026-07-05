#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use uniqent_studio::commands::{self, AppState};
use uniqent_studio::session::Session;

fn main() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(Session::new())))
        .invoke_handler(tauri::generate_handler![
            commands::state,
            commands::catalog,
            commands::set_meta,
            commands::set_targets,
            commands::set_persona,
            commands::set_readme,
            commands::set_avatar,
            commands::remove_avatar,
            commands::reset,
            commands::export,
            // MCP
            commands::add_mcp_catalog,
            commands::add_custom_mcp,
            commands::import_mcp_servers,
            commands::paste_mcp_preview,
            commands::remove_mcp,
            // Skill
            commands::add_skill_catalog,
            commands::add_custom_skill,
            commands::remove_skill,
            // Channel
            commands::add_channel_catalog,
            commands::remove_channel,
            // Task
            commands::add_task,
            commands::remove_task,
            // Memory
            commands::add_memory,
            commands::import_memory,
            commands::preview_memory,
            commands::memory_graph,
            // Profile
            commands::get_profile,
            commands::set_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running uniqent studio");
}
