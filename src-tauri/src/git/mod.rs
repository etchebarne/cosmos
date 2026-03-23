use kosmos_core::watcher::WatcherManager;
use kosmos_protocol::requests::Request;
use kosmos_protocol::types::*;
use kosmos_protocol::ToStringErr;
use tauri::State;

use crate::remote::router::BackendRouter;

fn no_agent_error(path: &str) -> String {
    format!("Remote agent not connected for path: {path}")
}

async fn route_val<T, E, F, Fut>(
    router: &State<'_, BackendRouter>, path: &str,
    request: impl FnOnce(String) -> Request, local: F,
) -> Result<T, String>
where F: FnOnce() -> Fut, Fut: std::future::Future<Output = Result<T, E>>, T: serde::de::DeserializeOwned, E: std::fmt::Display,
{
    if let Some((agent, remote_path)) = router.resolve(path).await {
        let val = agent.request(request(remote_path)).await?;
        serde_json::from_value(val).str_err()
    } else if BackendRouter::is_remote_path(path) { Err(no_agent_error(path)) }
    else { local().await.str_err() }
}

async fn route_void<E, F, Fut>(
    router: &State<'_, BackendRouter>, path: &str,
    request: impl FnOnce(String) -> Request, local: F,
) -> Result<(), String>
where F: FnOnce() -> Fut, Fut: std::future::Future<Output = Result<(), E>>, E: std::fmt::Display,
{
    if let Some((agent, remote_path)) = router.resolve(path).await {
        agent.request(request(remote_path)).await?; Ok(())
    } else if BackendRouter::is_remote_path(path) { Err(no_agent_error(path)) }
    else { local().await.str_err() }
}

#[tauri::command]
pub async fn get_git_branch(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Option<String>, String> {
    route_val(&router, &path, |p| Request::GetGitBranch { path: p }, || kosmos_core::git::get_git_branch(&path)).await
}

#[tauri::command]
pub async fn get_git_status(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<GitStatusInfo, String> {
    route_val(&router, &path, |p| Request::GetGitStatus { path: p }, || kosmos_core::git::get_git_status(&path)).await
}

#[tauri::command]
pub async fn git_stage(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    { let f = files.clone(); route_void(&router, &path, |p| Request::GitStage { path: p, files: f }, || kosmos_core::git::git_stage(&path, files)).await }
}

#[tauri::command]
pub async fn git_unstage(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    { let f = files.clone(); route_void(&router, &path, |p| Request::GitUnstage { path: p, files: f }, || kosmos_core::git::git_unstage(&path, files)).await }
}

#[tauri::command]
pub async fn git_stage_all(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitStageAll { path: p }, || kosmos_core::git::git_stage_all(&path)).await
}

#[tauri::command]
pub async fn git_commit(
    router: State<'_, BackendRouter>,
    path: String,
    message: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitCommit { path: p, message: message.clone() }, || kosmos_core::git::git_commit(&path, &message)).await
}

#[tauri::command]
pub async fn git_list_branches(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Vec<GitBranchInfo>, String> {
    route_val(&router, &path, |p| Request::GitListBranches { path: p }, || kosmos_core::git::git_list_branches(&path)).await
}

#[tauri::command]
pub async fn git_checkout(
    router: State<'_, BackendRouter>,
    path: String,
    branch: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitCheckout { path: p, branch: branch.clone() }, || kosmos_core::git::git_checkout(&path, &branch)).await
}

#[tauri::command]
pub async fn git_delete_branch(
    router: State<'_, BackendRouter>,
    path: String,
    branch: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitDeleteBranch { path: p, branch: branch.clone() }, || kosmos_core::git::git_delete_branch(&path, &branch)).await
}

#[tauri::command]
pub async fn git_discard(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    { let f = files.clone(); route_void(&router, &path, |p| Request::GitDiscard { path: p, files: f }, || kosmos_core::git::git_discard(&path, files)).await }
}

#[tauri::command]
pub async fn git_trash_untracked(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    { let f = files.clone(); route_void(&router, &path, |p| Request::GitTrashUntracked { path: p, files: f }, || async { kosmos_core::git::git_trash_untracked(&path, files) }).await }
}

#[tauri::command]
pub async fn git_stash_all(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitStashAll { path: p }, || kosmos_core::git::git_stash_all(&path)).await
}

#[tauri::command]
pub async fn git_stash_files(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    { let f = files.clone(); route_void(&router, &path, |p| Request::GitStashFiles { path: p, files: f }, || kosmos_core::git::git_stash_files(&path, files)).await }
}

#[tauri::command]
pub async fn git_stash_list(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Vec<GitStashEntry>, String> {
    route_val(&router, &path, |p| Request::GitStashList { path: p }, || kosmos_core::git::git_stash_list(&path)).await
}

#[tauri::command]
pub async fn git_stash_show(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<Vec<GitStashFile>, String> {
    route_val(&router, &path, |p| Request::GitStashShow { path: p, index }, || kosmos_core::git::git_stash_show(&path, index)).await
}

#[tauri::command]
pub async fn git_stash_pop(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitStashPop { path: p, index }, || kosmos_core::git::git_stash_pop(&path, index)).await
}

#[tauri::command]
pub async fn git_stash_drop(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitStashDrop { path: p, index }, || kosmos_core::git::git_stash_drop(&path, index)).await
}

#[tauri::command]
pub async fn git_discard_all_tracked(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitDiscardAllTracked { path: p }, || kosmos_core::git::git_discard_all_tracked(&path)).await
}

#[tauri::command]
pub async fn git_trash_all_untracked(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitTrashAllUntracked { path: p }, || kosmos_core::git::git_trash_all_untracked(&path)).await
}

#[tauri::command]
pub async fn git_diff(
    router: State<'_, BackendRouter>,
    path: String,
    file: String,
) -> Result<String, String> {
    route_val(&router, &path, |p| Request::GitDiff { path: p, file: file.clone() }, || kosmos_core::git::git_diff(&path, &file)).await
}

#[tauri::command]
pub async fn git_diff_untracked(
    router: State<'_, BackendRouter>,
    path: String,
    file: String,
) -> Result<String, String> {
    route_val(&router, &path, |p| Request::GitDiffUntracked { path: p, file: file.clone() }, || kosmos_core::git::git_diff_untracked(&path, &file)).await
}

#[tauri::command]
pub async fn git_init(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitInit { path: p }, || kosmos_core::git::git_init(&path)).await
}

#[tauri::command]
pub async fn git_fetch(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitFetch { path: p }, || kosmos_core::git::git_fetch(&path)).await
}

#[tauri::command]
pub async fn git_pull(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitPull { path: p }, || kosmos_core::git::git_pull(&path)).await
}

#[tauri::command]
pub async fn git_pull_rebase(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitPullRebase { path: p }, || kosmos_core::git::git_pull_rebase(&path)).await
}

#[tauri::command]
pub async fn git_push(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitPush { path: p }, || kosmos_core::git::git_push(&path)).await
}

#[tauri::command]
pub async fn git_force_push(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    route_void(&router, &path, |p| Request::GitForcePush { path: p }, || kosmos_core::git::git_force_push(&path)).await
}

#[tauri::command]
pub async fn get_git_remote_owner(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Option<String>, String> {
    route_val(&router, &path, |p| Request::GetGitRemoteOwner { path: p }, || kosmos_core::git::get_git_remote_owner(&path)).await
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
        watcher.watch(&path).str_err()
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
    watcher.unwatch().str_err()
}
