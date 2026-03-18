use cosmos_core::watcher::WatcherManager;
use cosmos_protocol::requests::Request;
use cosmos_protocol::types::*;
use tauri::State;

use crate::remote::router::BackendRouter;

// Helper: route a git command that takes path and returns T
macro_rules! git_route {
    ($router:expr, $path:expr, $request:expr, $local:expr) => {
        if let Some((agent, remote_path)) = $router.resolve(&$path).await {
            let req = $request(remote_path);
            let val = agent.request(req).await?;
            serde_json::from_value(val).map_err(|e| e.to_string())
        } else if BackendRouter::is_remote_path(&$path) {
            Err(format!("Remote agent not connected for path: {}", $path))
        } else {
            $local(&$path)
        }
    };
}

// Helper: route a git command that takes path and returns ()
macro_rules! git_route_void {
    ($router:expr, $path:expr, $request:expr, $local:expr) => {
        if let Some((agent, remote_path)) = $router.resolve(&$path).await {
            let req = $request(remote_path);
            agent.request(req).await?;
            Ok(())
        } else if BackendRouter::is_remote_path(&$path) {
            Err(format!("Remote agent not connected for path: {}", $path))
        } else {
            $local(&$path)
        }
    };
}

#[tauri::command]
pub async fn get_git_branch(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Option<String>, String> {
    git_route!(
        router,
        path,
        |p: String| Request::GetGitBranch { path: p },
        cosmos_core::git::get_git_branch
    )
}

#[tauri::command]
pub async fn get_git_status(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<GitStatusInfo, String> {
    git_route!(
        router,
        path,
        |p: String| Request::GetGitStatus { path: p },
        cosmos_core::git::get_git_status
    )
}

#[tauri::command]
pub async fn git_stage(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitStage {
                path: remote_path,
                files,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_stage(&path, files)
    }
}

#[tauri::command]
pub async fn git_unstage(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitUnstage {
                path: remote_path,
                files,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_unstage(&path, files)
    }
}

#[tauri::command]
pub async fn git_stage_all(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitStageAll { path: p },
        cosmos_core::git::git_stage_all
    )
}

#[tauri::command]
pub async fn git_commit(
    router: State<'_, BackendRouter>,
    path: String,
    message: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitCommit {
                path: remote_path,
                message,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_commit(&path, &message)
    }
}

#[tauri::command]
pub async fn git_list_branches(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Vec<GitBranchInfo>, String> {
    git_route!(
        router,
        path,
        |p: String| Request::GitListBranches { path: p },
        cosmos_core::git::git_list_branches
    )
}

#[tauri::command]
pub async fn git_checkout(
    router: State<'_, BackendRouter>,
    path: String,
    branch: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitCheckout {
                path: remote_path,
                branch,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_checkout(&path, &branch)
    }
}

#[tauri::command]
pub async fn git_delete_branch(
    router: State<'_, BackendRouter>,
    path: String,
    branch: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitDeleteBranch {
                path: remote_path,
                branch,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_delete_branch(&path, &branch)
    }
}

#[tauri::command]
pub async fn git_discard(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitDiscard {
                path: remote_path,
                files,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_discard(&path, files)
    }
}

#[tauri::command]
pub async fn git_trash_untracked(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitTrashUntracked {
                path: remote_path,
                files,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_trash_untracked(&path, files)
    }
}

#[tauri::command]
pub async fn git_stash_all(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitStashAll { path: p },
        cosmos_core::git::git_stash_all
    )
}

#[tauri::command]
pub async fn git_stash_files(
    router: State<'_, BackendRouter>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitStashFiles {
                path: remote_path,
                files,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_stash_files(&path, files)
    }
}

#[tauri::command]
pub async fn git_stash_list(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Vec<GitStashEntry>, String> {
    git_route!(
        router,
        path,
        |p: String| Request::GitStashList { path: p },
        cosmos_core::git::git_stash_list
    )
}

#[tauri::command]
pub async fn git_stash_show(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<Vec<GitStashFile>, String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        let val = agent
            .request(Request::GitStashShow {
                path: remote_path,
                index,
            })
            .await?;
        serde_json::from_value(val).map_err(|e| e.to_string())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_stash_show(&path, index)
    }
}

#[tauri::command]
pub async fn git_stash_pop(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitStashPop {
                path: remote_path,
                index,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_stash_pop(&path, index)
    }
}

#[tauri::command]
pub async fn git_stash_drop(
    router: State<'_, BackendRouter>,
    path: String,
    index: usize,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::GitStashDrop {
                path: remote_path,
                index,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_stash_drop(&path, index)
    }
}

#[tauri::command]
pub async fn git_discard_all_tracked(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitDiscardAllTracked { path: p },
        cosmos_core::git::git_discard_all_tracked
    )
}

#[tauri::command]
pub async fn git_trash_all_untracked(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitTrashAllUntracked { path: p },
        cosmos_core::git::git_trash_all_untracked
    )
}

#[tauri::command]
pub async fn git_diff(
    router: State<'_, BackendRouter>,
    path: String,
    file: String,
) -> Result<String, String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        let val = agent
            .request(Request::GitDiff {
                path: remote_path,
                file,
            })
            .await?;
        serde_json::from_value(val).map_err(|e| e.to_string())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_diff(&path, &file)
    }
}

#[tauri::command]
pub async fn git_diff_untracked(
    router: State<'_, BackendRouter>,
    path: String,
    file: String,
) -> Result<String, String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        let val = agent
            .request(Request::GitDiffUntracked {
                path: remote_path,
                file,
            })
            .await?;
        serde_json::from_value(val).map_err(|e| e.to_string())
    } else if BackendRouter::is_remote_path(&path) {
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        cosmos_core::git::git_diff_untracked(&path, &file)
    }
}

#[tauri::command]
pub async fn git_init(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitInit { path: p },
        cosmos_core::git::git_init
    )
}

#[tauri::command]
pub async fn git_fetch(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitFetch { path: p },
        cosmos_core::git::git_fetch
    )
}

#[tauri::command]
pub async fn git_pull(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitPull { path: p },
        cosmos_core::git::git_pull
    )
}

#[tauri::command]
pub async fn git_pull_rebase(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitPullRebase { path: p },
        cosmos_core::git::git_pull_rebase
    )
}

#[tauri::command]
pub async fn git_push(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitPush { path: p },
        cosmos_core::git::git_push
    )
}

#[tauri::command]
pub async fn git_force_push(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    git_route_void!(
        router,
        path,
        |p: String| Request::GitForcePush { path: p },
        cosmos_core::git::git_force_push
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
        Err(format!("Remote agent not connected for path: {path}"))
    } else {
        watcher.watch(&path)
    }
}

#[tauri::command]
pub async fn unwatch_workspace(
    watcher: State<'_, WatcherManager>,
) -> Result<(), String> {
    // TODO: also unwatch remote if applicable
    watcher.unwatch()
}
