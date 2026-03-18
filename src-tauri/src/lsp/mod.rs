use std::collections::HashMap;
use std::sync::Arc;

use cosmos_core::lsp::LspManager;
use cosmos_protocol::requests::Request;
use cosmos_protocol::types::*;
use tauri::State;
use tokio::sync::Mutex;

use crate::remote::router::BackendRouter;

/// Tracks which server IDs belong to remote agents, mapping server_id -> workspace_path.
/// This allows lsp_send and lsp_stop (which only receive a server_id) to route correctly.
pub struct RemoteServerMap(pub Mutex<HashMap<String, String>>);

impl RemoteServerMap {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Extract the WSL prefix (e.g. "wsl://Ubuntu") from a full workspace path.
fn wsl_prefix(full_path: &str) -> Option<&str> {
    let rest = full_path.strip_prefix("wsl://")?;
    let slash = rest.find('/')?;
    Some(&full_path[..("wsl://".len() + slash)])
}

#[tauri::command]
pub async fn lsp_start(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    remote_servers: State<'_, RemoteServerMap>,
    workspace_path: String,
    language_id: String,
) -> Result<LspStartResult, String> {
    if let Some((agent, linux_path)) = router.resolve(&workspace_path).await {
        let result = agent
            .request(Request::LspStart {
                workspace_path: linux_path,
                language_id,
            })
            .await?;
        let start_result: LspStartResult =
            serde_json::from_value(result).map_err(|e| e.to_string())?;
        remote_servers
            .0
            .lock()
            .await
            .insert(start_result.server_id.clone(), workspace_path);
        return Ok(start_result);
    }
    if BackendRouter::is_remote_path(&workspace_path) {
        return Err(format!("Remote agent not connected for path: {workspace_path}"));
    }
    state.start(&workspace_path, &language_id).await
}

#[tauri::command]
pub async fn lsp_send(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    remote_servers: State<'_, RemoteServerMap>,
    server_id: String,
    message: String,
) -> Result<(), String> {
    let wp = remote_servers.0.lock().await.get(&server_id).cloned();
    if let Some(wp) = wp {
        if let Some((agent, _)) = router.resolve(&wp).await {
            // Fire-and-forget: the LSP response comes back via events, not
            // the agent response. Waiting would just cause timeouts.
            agent
                .notify(Request::LspSend {
                    server_id,
                    message,
                })
                .await?;
            return Ok(());
        }
    }
    state.send(&server_id, &message).await
}

#[tauri::command]
pub async fn lsp_stop(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    remote_servers: State<'_, RemoteServerMap>,
    server_id: String,
) -> Result<(), String> {
    let wp = remote_servers.0.lock().await.remove(&server_id);
    if let Some(wp) = wp {
        if let Some((agent, _)) = router.resolve(&wp).await {
            agent.request(Request::LspStop { server_id }).await?;
            return Ok(());
        }
    }
    state.stop(&server_id).await
}

#[tauri::command]
pub async fn lsp_stop_workspace(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    remote_servers: State<'_, RemoteServerMap>,
    workspace_path: String,
) -> Result<(), String> {
    if let Some((agent, linux_path)) = router.resolve(&workspace_path).await {
        let mut map = remote_servers.0.lock().await;
        map.retain(|_, wp| wp != &workspace_path);
        drop(map);

        agent
            .request(Request::LspStopWorkspace {
                workspace_path: linux_path,
            })
            .await?;
        return Ok(());
    }
    if BackendRouter::is_remote_path(&workspace_path) {
        return Err(format!("Remote agent not connected for path: {workspace_path}"));
    }
    state.stop_workspace(&workspace_path).await
}

#[tauri::command]
pub async fn lsp_check_availability(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    workspace_path: String,
) -> Result<Vec<ServerAvailability>, String> {
    if let Some((agent, linux_path)) = router.resolve(&workspace_path).await {
        let result = agent
            .request(Request::LspCheckAvailability {
                workspace_path: linux_path,
            })
            .await?;
        return serde_json::from_value(result).map_err(|e| e.to_string());
    }
    if BackendRouter::is_remote_path(&workspace_path) {
        return Err(format!("Remote agent not connected for path: {workspace_path}"));
    }
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || mgr.check_availability(&workspace_path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_language_groups() -> Result<HashMap<String, String>, String> {
    Ok(LspManager::language_groups())
}

#[tauri::command]
pub async fn lsp_scan_projects(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    workspace_path: String,
) -> Result<Vec<DetectedProject>, String> {
    if let Some((agent, linux_path)) = router.resolve(&workspace_path).await {
        let result = agent
            .request(Request::LspScanProjects {
                workspace_path: linux_path,
            })
            .await?;
        let mut projects: Vec<DetectedProject> =
            serde_json::from_value(result).map_err(|e| e.to_string())?;
        // Prepend wsl prefix to project_root so the frontend can route lsp_start correctly
        if let Some(prefix) = wsl_prefix(&workspace_path) {
            for project in &mut projects {
                project.project_root = format!("{}{}", prefix, project.project_root);
            }
        }
        return Ok(projects);
    }
    if BackendRouter::is_remote_path(&workspace_path) {
        return Err(format!("Remote agent not connected for path: {workspace_path}"));
    }
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || mgr.scan_projects(&workspace_path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_resolve_root(
    router: State<'_, BackendRouter>,
    file_path: String,
    language_id: String,
    workspace_path: String,
) -> Result<String, String> {
    if let Some((agent, linux_wp)) = router.resolve(&workspace_path).await {
        let prefix = wsl_prefix(&workspace_path).unwrap_or_default();
        let linux_fp = file_path
            .strip_prefix(prefix)
            .unwrap_or(&file_path)
            .to_string();
        let result = agent
            .request(Request::LspResolveRoot {
                file_path: linux_fp,
                language_id,
                workspace_path: linux_wp,
            })
            .await?;
        let root: String = serde_json::from_value(result).map_err(|e| e.to_string())?;
        return Ok(format!("{}{}", prefix, root));
    }
    if BackendRouter::is_remote_path(&workspace_path) {
        return Err(format!("Remote agent not connected for path: {workspace_path}"));
    }
    tokio::task::spawn_blocking(move || {
        LspManager::resolve_root(&file_path, &language_id, &workspace_path)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_registry_list(
    state: State<'_, Arc<LspManager>>,
) -> Result<Vec<RegistryEntry>, String> {
    Ok(state.registry_list())
}

#[tauri::command]
pub async fn lsp_registry_search(
    state: State<'_, Arc<LspManager>>,
    query: String,
) -> Result<Vec<RegistryEntry>, String> {
    Ok(state.registry_search(&query))
}

#[tauri::command]
pub async fn lsp_installed_list(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    workspace_path: Option<String>,
) -> Result<Vec<InstalledServer>, String> {
    if let Some(wp) = &workspace_path {
        if let Some((agent, _)) = router.resolve(wp).await {
            let result = agent.request(Request::LspInstalledList).await?;
            return serde_json::from_value(result).map_err(|e| e.to_string());
        }
    }
    Ok(state.installed_list())
}

#[tauri::command]
pub async fn lsp_install_server(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    name: String,
    workspace_path: Option<String>,
) -> Result<InstalledServer, String> {
    if let Some(wp) = &workspace_path {
        if let Some((agent, _)) = router.resolve(wp).await {
            let result = agent
                .request_with_timeout(
                    Request::LspInstallServer { name },
                    std::time::Duration::from_secs(300),
                )
                .await?;
            return serde_json::from_value(result).map_err(|e| e.to_string());
        }
    }
    state.install_server(&name).await
}

#[tauri::command]
pub async fn lsp_uninstall_server(
    state: State<'_, Arc<LspManager>>,
    router: State<'_, BackendRouter>,
    name: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(wp) = &workspace_path {
        if let Some((agent, _)) = router.resolve(wp).await {
            agent
                .request(Request::LspUninstallServer { name })
                .await?;
            return Ok(());
        }
    }
    state.uninstall_server(&name)
}
