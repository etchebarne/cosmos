use kosmos_protocol::requests::Request;
use tauri::State;

use crate::remote::router::BackendRouter;

fn no_agent_error(path: &str) -> String {
    format!("Remote agent not connected for path: {path}")
}

#[tauri::command]
pub async fn read_file(
    router: State<'_, BackendRouter>,
    path: String,
) -> Result<String, String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        let val = agent.request(Request::ReadFile { path: remote_path }).await?;
        serde_json::from_value(val).map_err(|e| e.to_string())
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        kosmos_core::editor::read_file(&path).await.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn write_file(
    router: State<'_, BackendRouter>,
    path: String,
    content: String,
) -> Result<(), String> {
    if let Some((agent, remote_path)) = router.resolve(&path).await {
        agent
            .request(Request::WriteFile {
                path: remote_path,
                content,
            })
            .await?;
        Ok(())
    } else if BackendRouter::is_remote_path(&path) {
        Err(no_agent_error(&path))
    } else {
        kosmos_core::editor::write_file(&path, &content).await.map_err(|e| e.to_string())
    }
}
