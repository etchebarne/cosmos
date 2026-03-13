pub mod detection;
pub mod framing;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::BufReader;
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;

use detection::{
    check_availability, detect_servers, resolve_language_id, server_handles_language,
    ServerAvailability,
};

struct LspServer {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    language_id: String,
}

pub struct LspState {
    servers: Arc<Mutex<HashMap<String, LspServer>>>,
}

impl Default for LspState {
    fn default() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn make_server_id(workspace_path: &str, language_id: &str) -> String {
    format!("{language_id}:{workspace_path}")
}

#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    state: State<'_, LspState>,
    workspace_path: String,
    language_id: String,
) -> Result<String, String> {
    let resolved = resolve_language_id(&language_id);
    let server_id = make_server_id(&workspace_path, resolved);

    // Check if already running
    {
        let servers = state.servers.lock().await;
        if servers.contains_key(&server_id) {
            return Ok(server_id);
        }
    }

    // Find the server config for this language
    let configs = detect_servers(&workspace_path);
    let config = configs
        .into_iter()
        .find(|c| server_handles_language(&c.language_id, &language_id))
        .ok_or_else(|| format!("No language server found for {language_id}"))?;

    // Spawn the language server process
    let mut child = tokio::process::Command::new(&config.command)
        .args(&config.args)
        .current_dir(&workspace_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start {}: {e}", config.command))?;

    let stdin = child.stdin.take().ok_or("Failed to take stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to take stdout")?;

    // Spawn background task to read stdout and emit messages to frontend
    let app_clone = app.clone();
    let sid = server_id.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            match framing::read_message(&mut reader).await {
                Ok(msg) => {
                    let event = format!("lsp-message:{}", sid);
                    let _ = app_clone.emit(&event, &msg);
                }
                Err(_) => {
                    let event = format!("lsp-status:{}", sid);
                    let _ = app_clone.emit(&event, "stopped");
                    break;
                }
            }
        }
    });

    let server = LspServer {
        child,
        stdin,
        language_id: resolved.to_string(),
    };

    state.servers.lock().await.insert(server_id.clone(), server);

    Ok(server_id)
}

#[tauri::command]
pub async fn lsp_send(
    state: State<'_, LspState>,
    server_id: String,
    message: String,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    let server = servers
        .get_mut(&server_id)
        .ok_or_else(|| format!("Server {server_id} not found"))?;

    framing::write_message(&mut server.stdin, &message).await
}

#[tauri::command]
pub async fn lsp_stop(state: State<'_, LspState>, server_id: String) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    if let Some(mut server) = servers.remove(&server_id) {
        let _ = server.child.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_stop_workspace(
    state: State<'_, LspState>,
    workspace_path: String,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    let keys_to_remove: Vec<String> = servers
        .keys()
        .filter(|k| k.ends_with(&format!(":{workspace_path}")))
        .cloned()
        .collect();

    for key in keys_to_remove {
        if let Some(mut server) = servers.remove(&key) {
            let _ = server.child.kill().await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_check_availability(
    workspace_path: String,
) -> Result<Vec<ServerAvailability>, String> {
    Ok(check_availability(&workspace_path))
}
