mod git;
mod lsp;
mod settings;
mod tabs;
mod terminal;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(git::FsWatcherState {
            watcher: Mutex::new(None),
        })
        .manage(lsp::LspState::default())
        .manage(terminal::TerminalState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
