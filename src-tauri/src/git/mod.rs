use kosmos_core::watcher::WatcherManager;
use kosmos_protocol::requests::Request;
use kosmos_protocol::types::*;
use tauri::State;

use crate::remote::router::BackendRouter;

fn no_agent_error(path: &str) -> String {
    format!("Remote agent not connected for path: {path}")
}

/// Route a command through the remote agent if available, else run locally.
/// Use `route_val!` when the remote response needs deserialization,
/// and `route_void!` when the response can be discarded.
macro_rules! route_val {
    ($router:expr, $path:expr, $request:expr, $local:expr) => {
        if let Some((agent, remote_path)) = $router.resolve(&$path).await {
            let val = agent.request($request(remote_path)).await?;
            serde_json::from_value(val).map_err(|e| e.to_string())
        } else if BackendRouter::is_remote_path(&$path) {
            Err(no_agent_error(&$path))
        } else {
            $local(&$path).await.map_err(|e| e.to_string())
        }
    };
}

macro_rules! route_void {
    ($router:expr, $path:expr, $request:expr, $local:expr) => {
        if let Some((agent, remote_path)) = $router.resolve(&$path).await {
            agent.request($request(remote_path)).await?;
            Ok(())
        } else if BackendRouter::is_remote_path(&$path) {
            Err(no_agent_error(&$path))
        } else {
            $local(&$path).await.map_err(|e| e.to_string())
        }
    };
}

/// Route a void command with extra args forwarded to both remote and local.
macro_rules! route_void_extra {
    ($router:expr, $path:expr, $request:expr, $local:expr) => {
        if let Some((agent, remote_path)) = $router.resolve(&$path).await {
            agent.request($request(remote_path)).await?;
            Ok(())
        } else if BackendRouter::is_remote_path(&$path) {
            Err(no_agent_error(&$path))
        } else {
            $local.map_err(|e| e.to_string())
        }
    };
}

macro_rules! route_val_extra {
    ($router:expr, $path:expr, $request:expr, $local:expr) => {
        if let Some((agent, remote_path)) = $router.resolve(&$path).await {
            let val = agent.request($request(remote_path)).await?;
            serde_json::from_value(val).map_err(|e| e.to_string())
        } else if BackendRouter::is_remote_path(&$path) {
            Err(no_agent_error(&$path))
        } else {
            $local.map_err(|e| e.to_string())
        }
    };
}

#[tauri::command]
pub async fn get_git_branch(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Option<String>, String> {
    route_val!(
        router, path,
        |p: String| Request::GetGitBranch { path: p },
        kosmos_core::git::get_git_branch
    )
}

#[tauri::command]
pub async fn get_git_status(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<GitStatusInfo, String> {
    route_val!(
        router, path,
        |p: String| Request::GetGitStatus { path: p },
        kosmos_core::git::get_git_status
    )
}

#[tauri::command]
pub async fn git_stage(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitStage { path: p, files: files.clone() },
        kosmos_core::git::git_stage(&path, files).await
    )
}

#[tauri::command]
pub async fn git_unstage(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitUnstage { path: p, files: files.clone() },
        kosmos_core::git::git_unstage(&path, files).await
    )
}

#[tauri::command]
pub async fn git_stage_all(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitStageAll { path: p },
        kosmos_core::git::git_stage_all
    )
}

#[tauri::command]
pub async fn git_commit(
    router: State<'_, BackendRouter>,
    path: String,
    message: String,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitCommit { path: p, message: message.clone() },
        kosmos_core::git::git_commit(&path, &message).await
    )
}

#[tauri::command]
pub async fn git_list_branches(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Vec<GitBranchInfo>, String> {
    route_val!(
        router, path,
        |p: String| Request::GitListBranches { path: p },
        kosmos_core::git::git_list_branches
    )
}

#[tauri::command]
pub async fn git_checkout(
    router: State<'_, BackendRouter>,
    path: String,
    branch: String,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitCheckout { path: p, branch: branch.clone() },
        kosmos_core::git::git_checkout(&path, &branch).await
    )
}

#[tauri::command]
pub async fn git_delete_branch(
    router: State<'_, BackendRouter>,
    path: String,
    branch: String,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitDeleteBranch { path: p, branch: branch.clone() },
        kosmos_core::git::git_delete_branch(&path, &branch).await
    )
}

#[tauri::command]
pub async fn git_discard(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitDiscard { path: p, files: files.clone() },
        kosmos_core::git::git_discard(&path, files).await
    )
}

#[tauri::command]
pub async fn git_trash_untracked(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitTrashUntracked { path: p, files: files.clone() },
        kosmos_core::git::git_trash_untracked(&path, files)
    )
}

#[tauri::command]
pub async fn git_stash_all(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitStashAll { path: p },
        kosmos_core::git::git_stash_all
    )
}

#[tauri::command]
pub async fn git_stash_files(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitStashFiles { path: p, files: files.clone() },
        kosmos_core::git::git_stash_files(&path, files).await
    )
}

#[tauri::command]
pub async fn git_stash_list(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Vec<GitStashEntry>, String> {
    route_val!(
        router, path,
        |p: String| Request::GitStashList { path: p },
        kosmos_core::git::git_stash_list
    )
}

#[tauri::command]
pub async fn git_stash_show(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<Vec<GitStashFile>, String> {
    route_val_extra!(
        router, path,
        |p: String| Request::GitStashShow { path: p, index },
        kosmos_core::git::git_stash_show(&path, index).await
    )
}

#[tauri::command]
pub async fn git_stash_pop(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitStashPop { path: p, index },
        kosmos_core::git::git_stash_pop(&path, index).await
    )
}

#[tauri::command]
pub async fn git_stash_drop(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<(), String> {
    route_void_extra!(
        router, path,
        |p: String| Request::GitStashDrop { path: p, index },
        kosmos_core::git::git_stash_drop(&path, index).await
    )
}

#[tauri::command]
pub async fn git_discard_all_tracked(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitDiscardAllTracked { path: p },
        kosmos_core::git::git_discard_all_tracked
    )
}

#[tauri::command]
pub async fn git_trash_all_untracked(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitTrashAllUntracked { path: p },
        kosmos_core::git::git_trash_all_untracked
    )
}

#[tauri::command]
pub async fn git_diff(
    router: State<'_, BackendRouter>,
    path: String,
    file: String,
) -> Result<String, String> {
    route_val_extra!(
        router, path,
        |p: String| Request::GitDiff { path: p, file: file.clone() },
        kosmos_core::git::git_diff(&path, &file).await
    )
}

#[tauri::command]
pub async fn git_diff_untracked(
    router: State<'_, BackendRouter>,
    path: String,
    file: String,
) -> Result<String, String> {
    route_val_extra!(
        router, path,
        |p: String| Request::GitDiffUntracked { path: p, file: file.clone() },
        kosmos_core::git::git_diff_untracked(&path, &file).await
    )
}

#[tauri::command]
pub async fn git_init(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitInit { path: p },
        kosmos_core::git::git_init
    )
}

#[tauri::command]
pub async fn git_fetch(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitFetch { path: p },
        kosmos_core::git::git_fetch
    )
}

#[tauri::command]
pub async fn git_pull(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitPull { path: p },
        kosmos_core::git::git_pull
    )
}

#[tauri::command]
pub async fn git_pull_rebase(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitPullRebase { path: p },
        kosmos_core::git::git_pull_rebase
    )
}

#[tauri::command]
pub async fn git_push(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitPush { path: p },
        kosmos_core::git::git_push
    )
}

#[tauri::command]
pub async fn git_force_push(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void!(
        router, path,
        |p: String| Request::GitForcePush { path: p },
        kosmos_core::git::git_force_push
    )
}

#[tauri::command]
pub async fn get_git_remote_owner(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Option<String>, String> {
    route_val!(
        router, path,
        |p: String| Request::GetGitRemoteOwner { path: p },
        kosmos_core::git::get_git_remote_owner
    )
}

#[tauri::command]
pub async fn watch_workspace(
    router: State<'_, BackendRouter>,
    watcher: State<'_, WatcherManager>,
    path: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::WatchWorkspace { path: remote_path })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        watcher.watch(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn unwatch_workspace(
    router: State<'_, BackendRouter>,
    watcher: State<'_, WatcherManager>,
    path: Option<String>,
) -> Result<(), String> {
    if let Some(ref p) = path {
        if let Some((agent, _)) = router.resolve(p).await {
            let _ = agent.request(Request::UnwatchWorkspace).await;
            return Ok(());
        }
    }
    watcher.unwatch().map_err(|e| e.to_string())
}
