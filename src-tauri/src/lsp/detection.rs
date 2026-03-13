use serde::Serialize;
use std::path::Path;

pub struct ServerConfig {
    pub language_id: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ServerAvailability {
    pub language_id: String,
    pub server_name: String,
    pub available: bool,
}

/// Check if a binary is available on PATH.
pub fn check_binary_available(command: &str) -> bool {
    which::which(command).is_ok()
}

/// Check which language servers are available for a workspace.
pub fn check_availability(workspace_path: &str) -> Vec<ServerAvailability> {
    detect_servers(workspace_path)
        .into_iter()
        .map(|config| ServerAvailability {
            available: check_binary_available(&config.command),
            server_name: config.command,
            language_id: config.language_id,
        })
        .collect()
}

/// Detect which language servers are needed for a workspace.
pub fn detect_servers(workspace_path: &str) -> Vec<ServerConfig> {
    let root = Path::new(workspace_path);
    let mut servers = Vec::new();

    if root.join("Cargo.toml").exists() {
        servers.push(ServerConfig {
            language_id: "rust".to_string(),
            command: "rust-analyzer".to_string(),
            args: vec![],
        });
    }

    if root.join("package.json").exists()
        || root.join("tsconfig.json").exists()
        || root.join("jsconfig.json").exists()
    {
        servers.push(ServerConfig {
            language_id: "typescript".to_string(),
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
        });
    }

    if root.join("pyproject.toml").exists()
        || root.join("setup.py").exists()
        || root.join("requirements.txt").exists()
    {
        servers.push(ServerConfig {
            language_id: "python".to_string(),
            command: "pylsp".to_string(),
            args: vec![],
        });
    }

    if root.join("go.mod").exists() {
        servers.push(ServerConfig {
            language_id: "go".to_string(),
            command: "gopls".to_string(),
            args: vec![],
        });
    }

    servers
}

/// Map a Monaco language ID to the LSP language ID that the server expects.
pub fn resolve_language_id(language_id: &str) -> &str {
    match language_id {
        // typescript-language-server handles all JS/TS variants
        "javascript" | "typescript" => "typescript",
        other => other,
    }
}

/// Check if a given language can be served by a server with the given language_id.
pub fn server_handles_language(server_language_id: &str, file_language_id: &str) -> bool {
    match server_language_id {
        "typescript" => matches!(
            file_language_id,
            "typescript" | "javascript" | "typescriptreact" | "javascriptreact"
        ),
        other => other == file_language_id,
    }
}
