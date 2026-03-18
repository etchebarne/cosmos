use std::path::Path;

use cosmos_protocol::requests::Request;
use cosmos_protocol::types::DirEntry;
use tauri::AppHandle;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::remote::router::BackendRouter;

/// Extract the `wsl://distro` prefix from a full remote path.
fn remote_prefix<'a>(full_path: &'a str, linux_path: &str) -> &'a str {
    &full_path[..full_path.len() - linux_path.len()]
}

/// Return an error when a remote path has no connected agent.
fn no_agent_error(path: &str) -> String {
    format!("Remote agent not connected for path: {path}")
}

#[tauri::command]
pub async fn read_dir(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        let val = agent
            .request(Request::ReadDir {
                path: remote_path.clone(),
            })
            .await?;
        let mut entries: Vec<DirEntry> =
            serde_json::from_value(val).map_err(|e| e.to_string())?;
        let prefix = remote_prefix(&path, &remote_path);
        for entry in &mut entries {
            entry.path = format!("{}{}", prefix, entry.path);
        }
        Ok(entries)
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        cosmos_core::file_tree::read_dir(&path)
    }
}

#[tauri::command]
pub async fn move_file(
    router: State<'_, BackendRouter>,
    source: String,
    dest_dir: String,
) -> Result<String, String> {
    if let Some((agent, remote_source)) = router.resolve(&source).await {
        let prefix = remote_prefix(&source, &remote_source).to_string();
        let remote_dest = router
            .resolve(&dest_dir)
            .await
            .map(|(_, p)| p)
            .unwrap_or(dest_dir);
        let val = agent
            .request(Request::MoveFile {
                source: remote_source,
                dest_dir: remote_dest,
            })
            .await?;
        let linux_path: String = serde_json::from_value(val).map_err(|e| e.to_string())?;
        Ok(format!("{}{}", prefix, linux_path))
    } else if BackendRouter::is_remote_path(&source) {
        Err(no_agent_error(&source))
    } else {
        cosmos_core::file_tree::move_file(&source, &dest_dir)
    }
}

#[tauri::command]
pub async fn create_file(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::CreateFile { path: remote_path })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        cosmos_core::file_tree::create_file(&path)
    }
}

#[tauri::command]
pub async fn create_dir(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::CreateDir { path: remote_path })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        cosmos_core::file_tree::create_dir(&path)
    }
}

#[tauri::command]
pub async fn rename_entry(
    router: State<'_, BackendRouter>,
    path: String,
    new_name: String,
) -> Result<String, String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        let prefix = remote_prefix(&path, &remote_path).to_string();
        let val = agent
            .request(Request::RenameEntry {
                path: remote_path,
                new_name,
            })
            .await?;
        let linux_path: String = serde_json::from_value(val).map_err(|e| e.to_string())?;
        Ok(format!("{}{}", prefix, linux_path))
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        cosmos_core::file_tree::rename_entry(&path, &new_name)
    }
}

#[tauri::command]
pub async fn copy_entry(
    router: State<'_, BackendRouter>,
    source: String,
    dest_dir: String,
) -> Result<String, String> {
    if let Some((agent, remote_source)) = router.resolve(&source).await {
        let prefix = remote_prefix(&source, &remote_source).to_string();
        let remote_dest = router
            .resolve(&dest_dir)
            .await
            .map(|(_, p)| p)
            .unwrap_or(dest_dir);
        let val = agent
            .request(Request::CopyEntry {
                source: remote_source,
                dest_dir: remote_dest,
            })
            .await?;
        let linux_path: String = serde_json::from_value(val).map_err(|e| e.to_string())?;
        Ok(format!("{}{}", prefix, linux_path))
    } else if BackendRouter::is_remote_path(&source) {
        Err(no_agent_error(&source))
    } else {
        cosmos_core::file_tree::copy_entry(&source, &dest_dir)
    }
}

#[tauri::command]
pub async fn trash_entry(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::TrashEntry { path: remote_path })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        cosmos_core::file_tree::trash_entry(&path)
    }
}

#[tauri::command]
pub async fn delete_entry(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::DeleteEntry { path: remote_path })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        cosmos_core::file_tree::delete_entry(&path)
    }
}

#[tauri::command]
pub fn reveal_in_explorer(app: AppHandle, path: &str) -> Result<(), String> {
    if BackendRouter::is_remote_path(path) {
        return Err("Cannot reveal remote files in the local file explorer".into());
    }
    app.opener()
        .reveal_item_in_dir(Path::new(path))
        .map_err(|e| e.to_string())
}
