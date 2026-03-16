pub mod detection;
pub mod framing;
pub mod installer;
pub mod registry;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::BufReader;
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use detection::{
    check_availability, resolve_command, resolve_server_for_language, server_language_group,
    ServerAvailability,
};
use installer::InstalledServer;
use registry::RegistryEntry;

struct LspServer {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    #[allow(dead_code)]
    language_id: String,
}

/// Per-server locking: the outer Mutex guards the HashMap itself (held briefly
/// for lookups/inserts/removes), while each server has its own Arc<Mutex> so
/// that a slow stdin write on one server never blocks operations on others.
pub struct LspState {
    servers: Arc<Mutex<HashMap<String, Arc<Mutex<LspServer>>>>>,
}

impl Default for LspState {
    fn default() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn make_server_id(workspace_path: &str, language_id: &str) -> String {
    // Sanitize path for use in Tauri event names which only allow
    // alphanumeric, '-', '/', ':', '_' characters.
    let safe_path: String = workspace_path
        .chars()
        .map(|c| if c == '\\' { '/' } else { c })
        .collect();
    format!("{language_id}:{safe_path}")
}

fn spawn_server(command: &str, args: &[String], working_dir: &str) -> std::io::Result<Child> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        if command.ends_with(".cmd") || command.ends_with(".bat") {
            tokio::process::Command::new("cmd")
                .arg("/C")
                .arg(command)
                .args(args)
                .current_dir(working_dir)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        } else {
            tokio::process::Command::new(command)
                .args(args)
                .current_dir(working_dir)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        tokio::process::Command::new(command)
            .args(args)
            .current_dir(working_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
    }
}

// ── Status event payload ──

#[derive(serde::Serialize, Clone)]
struct StatusPayload {
    status: String,
    error: Option<String>,
}

// ── LSP lifecycle commands ──

#[derive(serde::Serialize)]
pub struct LspStartResult {
    pub server_id: String,
    pub server_name: String,
    pub server_language: String,
}

#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    state: State<'_, LspState>,
    workspace_path: String,
    language_id: String,
) -> Result<LspStartResult, String> {
    let group = server_language_group(&language_id);
    let server_id = make_server_id(&workspace_path, group);

    // Check if already running
    {
        let servers = state.servers.lock().await;
        if servers.contains_key(&server_id) {
            // Look up the server name for the response
            let server_name = detection::server_name_for_language(&language_id)
                .unwrap_or("unknown")
                .to_string();
            return Ok(LspStartResult {
                server_id,
                server_name,
                server_language: group.to_string(),
            });
        }
    }

    // Look up the server config from the language defaults table
    let config = resolve_server_for_language(&language_id)
        .ok_or_else(|| format!("No language server configured for {language_id}"))?;

    // Resolve command: check local installations first, then PATH
    let resolved_command = resolve_command(&app, &config.command);

    // Spawn the language server process
    let mut child = spawn_server(&resolved_command, &config.args, &workspace_path)
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
                Err(e) => {
                    let event = format!("lsp-status:{}", sid);
                    let _ = app_clone.emit(
                        &event,
                        &StatusPayload {
                            status: "stopped".into(),
                            error: if e == "EOF" { None } else { Some(e) },
                        },
                    );
                    break;
                }
            }
        }
    });

    let server = Arc::new(Mutex::new(LspServer {
        child,
        stdin,
        language_id: group.to_string(),
    }));

    state.servers.lock().await.insert(server_id.clone(), server);

    Ok(LspStartResult {
        server_id,
        server_name: config.server_name,
        server_language: group.to_string(),
    })
}

#[tauri::command]
pub async fn lsp_send(
    app: AppHandle,
    state: State<'_, LspState>,
    server_id: String,
    message: String,
) -> Result<(), String> {
    // Clone the Arc so we can drop the map lock before writing
    let server_arc = {
        let servers = state.servers.lock().await;
        servers
            .get(&server_id)
            .cloned()
            .ok_or_else(|| format!("Server {server_id} not found"))?
    };

    let result = {
        let mut server = server_arc.lock().await;
        framing::write_message(&mut server.stdin, &message).await
    };

    // If write failed, the server is likely dead — clean up and notify frontend
    if let Err(ref e) = result {
        state.servers.lock().await.remove(&server_id);
        let event = format!("lsp-status:{}", server_id);
        let _ = app.emit(
            &event,
            &StatusPayload {
                status: "stopped".into(),
                error: Some(e.clone()),
            },
        );
    }

    result
}

#[tauri::command]
pub async fn lsp_stop(state: State<'_, LspState>, server_id: String) -> Result<(), String> {
    let server_arc = {
        let mut servers = state.servers.lock().await;
        servers.remove(&server_id)
    };
    if let Some(arc) = server_arc {
        let mut server = arc.lock().await;
        let _ = server.child.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_stop_workspace(
    state: State<'_, LspState>,
    workspace_path: String,
) -> Result<(), String> {
    let removed: Vec<Arc<Mutex<LspServer>>> = {
        let mut servers = state.servers.lock().await;
        let safe_path = workspace_path.replace('\\', "/");
        let keys_to_remove: Vec<String> = servers
            .keys()
            .filter(|k| k.ends_with(&format!(":{safe_path}")))
            .cloned()
            .collect();
        keys_to_remove
            .into_iter()
            .filter_map(|key| servers.remove(&key))
            .collect()
    };

    for arc in removed {
        let mut server = arc.lock().await;
        let _ = server.child.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_check_availability(
    app: AppHandle,
    workspace_path: String,
) -> Result<Vec<ServerAvailability>, String> {
    Ok(check_availability(&app, &workspace_path))
}

// ── Language group command ──

#[tauri::command]
pub async fn lsp_language_groups() -> Result<HashMap<String, String>, String> {
    Ok(detection::language_groups())
}

// ── Registry commands ──

/// Load the full registry: embedded + user custom entries from config dir.
fn load_full_registry(app: &AppHandle) -> Vec<RegistryEntry> {
    let base = registry::load_registry();
    match app.path().app_config_dir() {
        Ok(config_dir) => {
            let custom_path = config_dir.join("custom-registry.json");
            let custom = registry::load_custom_entries(&custom_path);
            registry::merge_registries(base, custom)
        }
        Err(_) => base,
    }
}

#[tauri::command]
pub async fn lsp_registry_list(app: AppHandle) -> Result<Vec<RegistryEntry>, String> {
    Ok(load_full_registry(&app))
}

#[tauri::command]
pub async fn lsp_registry_search(app: AppHandle, query: String) -> Result<Vec<RegistryEntry>, String> {
    Ok(registry::search_in(load_full_registry(&app), &query))
}

// ── Server management commands ──

#[tauri::command]
pub async fn lsp_installed_list(app: AppHandle) -> Result<Vec<InstalledServer>, String> {
    Ok(installer::list_installed(&app))
}

#[tauri::command]
pub async fn lsp_install_server(app: AppHandle, name: String) -> Result<InstalledServer, String> {
    let entries = load_full_registry(&app);
    let entry = entries
        .iter()
        .find(|e| e.name == name)
        .or_else(|| entries.iter().find(|e| e.bin.as_deref() == Some(name.as_str())))
        .cloned()
        .ok_or_else(|| format!("Server '{name}' not found in registry"))?;

    installer::install_server(&app, &entry).await
}

#[tauri::command]
pub async fn lsp_uninstall_server(app: AppHandle, name: String) -> Result<(), String> {
    installer::uninstall_server(&app, &name)
}
