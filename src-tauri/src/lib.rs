mod git;
mod tabs;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(git::FsWatcherState {
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            tabs::file_tree::read_dir,
            git::get_git_branch,
            git::get_git_status,
            git::git_stage,
            git::git_unstage,
            git::git_stage_all,
            git::git_commit,
            git::git_list_branches,
            git::git_checkout,
            git::git_delete_branch,
            git::git_init,
            git::git_fetch,
            git::git_pull,
            git::git_pull_rebase,
            git::git_push,
            git::git_force_push,
            git::watch_workspace,
            git::unwatch_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
