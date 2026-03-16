use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::installer;

// ── Server config loaded from servers.json ──

#[derive(Deserialize)]
struct ServerEntry {
    languages: Vec<String>,
    server: String,
    bin: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    markers: Vec<String>,
}

const SERVERS_JSON: &str = include_str!("servers.json");

/// Parsed server configs, loaded once at startup.
static SERVERS: LazyLock<Vec<ServerEntry>> = LazyLock::new(|| {
    serde_json::from_str(SERVERS_JSON).expect("Failed to parse servers.json")
});

// ── Public types ──

pub struct ServerConfig {
    pub language_id: String,
    pub server_name: String,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ServerAvailability {
    pub language_id: String,
    pub server_name: String,
    pub available: bool,
}

#[derive(Serialize, Clone)]
pub struct DetectedProject {
    pub language_id: String,
    pub server_name: String,
    pub project_root: String,
    pub available: bool,
}

// ── Lookups (all derived from servers.json) ──

/// Find the server entry that handles a given Monaco language ID.
fn find_entry(language_id: &str) -> Option<&'static ServerEntry> {
    SERVERS.iter().find(|e| e.languages.iter().any(|l| l == language_id))
}

/// Resolve the server config for a given Monaco language ID.
pub fn resolve_server_for_language(language_id: &str) -> Option<ServerConfig> {
    let entry = find_entry(language_id)?;
    Some(ServerConfig {
        language_id: entry.languages[0].clone(),
        server_name: entry.server.clone(),
        command: entry.bin.clone(),
        args: entry.args.clone(),
    })
}

/// Get the server name for a given language (for display purposes).
pub fn server_name_for_language(language_id: &str) -> Option<&'static str> {
    find_entry(language_id).map(|e| e.server.as_str())
}

/// Map a language to its server group (the first language in the entry).
/// Languages that share a server share a group, e.g. javascript → typescript.
pub fn server_language_group(language_id: &str) -> &str {
    match find_entry(language_id) {
        Some(entry) => &entry.languages[0],
        None => language_id,
    }
}

/// Return the language → group mapping for all non-identity entries.
/// Used by the frontend as the single source of truth for language grouping.
pub fn language_groups() -> HashMap<String, String> {
    let mut groups = HashMap::new();
    for entry in SERVERS.iter() {
        let group = &entry.languages[0];
        for lang in &entry.languages[1..] {
            groups.insert(lang.clone(), group.clone());
        }
    }
    groups
}

// ── Binary availability ──

pub fn is_server_available(app: &AppHandle, command: &str) -> bool {
    installer::find_installed_binary(app, command).is_some() || which::which(command).is_ok()
}

pub fn resolve_command(app: &AppHandle, command: &str) -> String {
    if let Some(local_path) = installer::find_installed_binary(app, command) {
        local_path.to_string_lossy().to_string()
    } else {
        command.to_string()
    }
}

// ── Root-level availability check ──

pub fn check_availability(app: &AppHandle, workspace_path: &str) -> Vec<ServerAvailability> {
    detect_workspace_languages(workspace_path)
        .into_iter()
        .filter_map(|lang| {
            let config = resolve_server_for_language(&lang)?;
            Some(ServerAvailability {
                available: is_server_available(app, &config.command),
                server_name: config.server_name,
                language_id: config.language_id,
            })
        })
        .collect()
}

// ── Deep workspace scanning ──

const MAX_SCAN_DEPTH: usize = 5;
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", "vendor", ".next",
    "__pycache__", ".venv", "venv", ".tox", "out", ".output", ".nuxt",
    ".svelte-kit", "coverage", ".cache", "tmp", ".tmp",
];

/// Scan the workspace tree for project marker files and return all detected
/// projects with their resolved roots.
pub fn scan_workspace_projects(app: &AppHandle, workspace_path: &str) -> Vec<DetectedProject> {
    // Build (markers, group) pairs, deduplicated by group
    let mut marker_groups: Vec<(&[String], &str)> = Vec::new();
    let mut seen_groups = HashSet::new();
    for entry in SERVERS.iter() {
        if entry.markers.is_empty() {
            continue;
        }
        let group = entry.languages[0].as_str();
        if seen_groups.insert(group) {
            marker_groups.push((&entry.markers, group));
        }
    }

    // Walk the tree, keeping only the shallowest root per language group
    let mut found: HashMap<String, String> = HashMap::new();
    let mut stack: Vec<(std::path::PathBuf, usize)> =
        vec![(Path::new(workspace_path).to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        for (markers, group) in &marker_groups {
            if markers.iter().any(|m| dir.join(m).exists()) {
                let group = group.to_string();
                let dir_str = dir.to_string_lossy().to_string();
                found
                    .entry(group)
                    .and_modify(|existing| {
                        if dir_str.len() < existing.len() {
                            *existing = dir_str.clone();
                        }
                    })
                    .or_insert(dir_str);
            }
        }

        if depth >= MAX_SCAN_DEPTH {
            continue;
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if SKIP_DIRS.contains(&name_str.as_ref()) || name_str.starts_with('.') {
                continue;
            }
            stack.push((path, depth + 1));
        }
    }

    found
        .into_iter()
        .filter_map(|(group, project_root)| {
            let config = resolve_server_for_language(&group)?;
            Some(DetectedProject {
                available: is_server_available(app, &config.command),
                server_name: config.server_name,
                language_id: group,
                project_root,
            })
        })
        .collect()
}

// ── Project root resolution (walk-up from file) ──

/// Find the nearest project root for a language by walking up from `file_path`.
/// Stops at `workspace_root` (won't go above it). Falls back to `workspace_root`.
pub fn find_project_root(file_path: &str, language_id: &str, workspace_root: &str) -> String {
    let markers = match find_entry(language_id) {
        Some(entry) if !entry.markers.is_empty() => &entry.markers,
        _ => return workspace_root.to_string(),
    };

    let root = Path::new(workspace_root);
    let mut dir = Path::new(file_path).parent().unwrap_or(root);

    loop {
        if markers.iter().any(|m| dir.join(m).exists()) {
            return dir.to_string_lossy().to_string();
        }
        if dir == root {
            break;
        }
        match dir.parent() {
            Some(parent) if parent != dir => dir = parent,
            _ => break,
        }
    }

    workspace_root.to_string()
}

// ── Root-level language detection (used by check_availability) ──

fn detect_workspace_languages(workspace_path: &str) -> Vec<String> {
    let root = Path::new(workspace_path);
    let mut languages = Vec::new();
    let mut seen = HashSet::new();

    for entry in SERVERS.iter() {
        if entry.markers.is_empty() {
            continue;
        }
        let group = &entry.languages[0];
        if entry.markers.iter().any(|m| root.join(m).exists()) && seen.insert(group) {
            languages.push(group.clone());
        }
    }

    languages
}
