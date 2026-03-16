use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

const REGISTRY_JSON: &str = include_str!("registry.json");

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct RegistryEntry {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub languages: Vec<String>,
    pub source_id: String,
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub bin: Option<String>,
    #[serde(default)]
    pub extra_packages: Option<Vec<String>>,
    #[serde(default)]
    pub assets: Option<HashMap<String, PlatformAsset>>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct PlatformAsset {
    pub file: String,
    pub bin: Option<String>,
}

pub fn load_registry() -> Vec<RegistryEntry> {
    serde_json::from_str(REGISTRY_JSON).expect("Failed to parse embedded registry")
}

/// Search a list of registry entries by query (matches name, language, or description).
pub fn search_in(entries: Vec<RegistryEntry>, query: &str) -> Vec<RegistryEntry> {
    let q = query.to_lowercase();
    entries
        .into_iter()
        .filter(|e| {
            e.name.to_lowercase().contains(&q)
                || e.languages
                    .iter()
                    .any(|l| l.to_lowercase().contains(&q))
                || e.description.to_lowercase().contains(&q)
        })
        .collect()
}

/// Load custom registry entries from a JSON file, if it exists.
pub fn load_custom_entries(path: &Path) -> Vec<RegistryEntry> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// Merge custom entries into a base registry. Custom entries with matching names override.
pub fn merge_registries(mut base: Vec<RegistryEntry>, custom: Vec<RegistryEntry>) -> Vec<RegistryEntry> {
    for entry in custom {
        if let Some(existing) = base.iter_mut().find(|e| e.name == entry.name) {
            *existing = entry;
        } else {
            base.push(entry);
        }
    }
    base
}

/// Return platform target candidates for the current system, in priority order.
pub fn platform_candidates() -> Vec<&'static str> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return vec!["win_x64", "win", "any"];

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return vec!["win_arm64", "win", "any"];

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return vec!["darwin_x64", "darwin", "unix", "any"];

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return vec!["darwin_arm64", "darwin", "unix", "any"];

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return vec!["linux_x64_gnu", "linux_x64", "linux", "unix", "any"];

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return vec!["linux_arm64_gnu", "linux_arm64", "linux", "unix", "any"];

    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    return vec!["any"];
}

/// Find the best matching platform asset for the current system.
pub fn find_platform_asset(
    assets: &HashMap<String, PlatformAsset>,
) -> Option<(&String, &PlatformAsset)> {
    for candidate in platform_candidates() {
        if let Some((k, v)) = assets.get_key_value(candidate) {
            return Some((k, v));
        }
    }
    None
}

/// Resolve template variables in a file name.
/// Handles: {{version}}, {{ version }}, {{ version | strip_prefix "v" }}
pub fn resolve_template(template: &str, version: &str) -> String {
    let result = template.replace("{{version}}", version);
    let result = result.replace("{{ version }}", version);
    let stripped = version.strip_prefix('v').unwrap_or(version);
    result.replace("{{ version | strip_prefix \"v\" }}", stripped)
}

/// Strip the Mason-specific :subpath suffix from a file template.
/// e.g., "foo.tar.gz:libexec/" → "foo.tar.gz"
pub fn strip_subpath(file_template: &str) -> &str {
    // Only split if the colon is after the file extension
    // (avoid splitting on Windows drive letters, though these shouldn't appear here)
    if let Some(idx) = file_template.rfind(".gz:").or(file_template.rfind(".zip:")) {
        let colon_pos = file_template[idx..].find(':').unwrap() + idx;
        &file_template[..colon_pos]
    } else {
        file_template
    }
}

/// Strip the Mason-specific exec: prefix from a bin path.
pub fn strip_exec_prefix(bin: &str) -> &str {
    bin.strip_prefix("exec:").unwrap_or(bin)
}
