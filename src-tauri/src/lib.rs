mod git;
mod lsp;
mod remote;
mod settings;
mod tabs;
mod terminal;

use std::sync::Arc;

use kosmos_core::EventSink;
use kosmos_protocol::events::Event;
use tauri::{AppHandle, Emitter, Manager};

struct TauriEventSink(AppHandle);

impl EventSink for TauriEventSink {
    fn emit(&self, event: Event) {
        match event {
            Event::GitChanged => {
                let _ = self.0.emit("git-changed", ());
            }
            Event::FileTreeChanged { dirs } => {
                let _ = self.0.emit("file-tree-changed", dirs);
            }
            Event::FileContentChanged { files } => {
                let _ = self.0.emit("file-content-changed", files);
            }
            Event::TerminalData { id, data } => {
                let _ = self.0.emit(&format!("terminal-data-{}", id), data);
            }
            Event::TerminalExit { id } => {
                let _ = self.0.emit(&format!("terminal-exit-{}", id), ());
            }
            Event::LspMessage { server_id, message } => {
                let _ = self.0.emit(&format!("lsp-message:{}", server_id), &message);
            }
            Event::LspStopped { server_id, error } => {
                let _ = self.0.emit(
                    &format!("lsp-status:{}", server_id),
                    &serde_json::json!({
                        "status": "stopped",
                        "error": error,
                    }),
                );
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Set high-res window icon to avoid blurry taskbar icon on Windows
            // (Tauri's codegen only reads the first ICO entry, which may be low-res)
            if let Some(window) = app.get_webview_window("main") {
                let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
                    .expect("Failed to load window icon");
                let _ = window.set_icon(icon);
            }

            let events: Arc<dyn EventSink> = Arc::new(TauriEventSink(handle.clone()));

            // Watcher
            app.manage(kosmos_core::watcher::WatcherManager::new(events.clone()));

            // Terminal
            app.manage(kosmos_core::terminal::TerminalManager::new(events.clone()));

            // LSP
            let servers_dir = handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir")
                .join("servers");
            let custom_registry = handle
                .path()
                .app_config_dir()
                .ok()
                .map(|d| d.join("custom-registry.json"));
            app.manage(std::sync::Arc::new(kosmos_core::lsp::LspManager::new(
                events.clone(),
                servers_dir,
                custom_registry,
            )));

            // Remote LSP server tracking (server_id -> workspace_path)
            app.manage(lsp::RemoteServerMap::new());

            // Backend router for remote workspaces
            let event_callback: Arc<dyn Fn(Event) + Send + Sync> = {
                let sink = events.clone();
                Arc::new(move |event| sink.emit(event))
            };
            app.manage(remote::router::BackendRouter::new(event_callback));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tabs::file_tree::read_dir,
            tabs::file_tree::move_file,
            tabs::file_tree::create_file,
            tabs::file_tree::create_dir,
            tabs::file_tree::rename_entry,
            tabs::file_tree::copy_entry,
            tabs::file_tree::trash_entry,
            tabs::file_tree::delete_entry,
            tabs::file_tree::reveal_in_explorer,
            tabs::editor::read_file,
            tabs::editor::write_file,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            lsp::lsp_stop_workspace,
            lsp::lsp_check_availability,
            lsp::lsp_language_groups,
            lsp::lsp_scan_projects,
            lsp::lsp_resolve_root,
            lsp::lsp_registry_list,
            lsp::lsp_registry_search,
            lsp::lsp_installed_list,
            lsp::lsp_install_server,
            lsp::lsp_uninstall_server,
            git::get_git_branch,
            git::get_git_status,
            git::git_stage,
            git::git_unstage,
            git::git_stage_all,
            git::git_commit,
            git::git_list_branches,
            git::git_checkout,
            git::git_delete_branch,
            git::git_discard,
            git::git_trash_untracked,
            git::git_stash_all,
            git::git_stash_files,
            git::git_stash_list,
            git::git_stash_show,
            git::git_stash_pop,
            git::git_stash_drop,
            git::git_discard_all_tracked,
            git::git_trash_all_untracked,
            git::git_diff,
            git::git_diff_untracked,
            git::git_init,
            git::git_fetch,
            git::git_pull,
            git::git_pull_rebase,
            git::git_push,
            git::git_force_push,
            git::watch_workspace,
            git::unwatch_workspace,
            terminal::terminal_list_shells,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            settings::get_settings_schema,
            remote::commands::list_wsl_distros,
            remote::commands::deploy_agent_wsl,
            remote::commands::check_agent_version,
            remote::commands::wsl_resolve_home,
            remote::commands::wsl_list_dir,
            remote::commands::remote_connect,
            remote::commands::remote_disconnect,
            remote::commands::remote_is_connected,
            remote::commands::remote_ensure_connected,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
