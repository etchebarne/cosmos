use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

/// Find a specific registry entry by name.
pub fn find_by_name(name: &str) -> Option<RegistryEntry> {
    load_registry().into_iter().find(|e| e.name == name)
}

/// Find a registry entry by its binary/command name.
pub fn find_by_bin(bin_name: &str) -> Option<RegistryEntry> {
    load_registry()
        .into_iter()
        .find(|e| e.bin.as_deref() == Some(bin_name))
}

/// Search registry entries by query (matches name, language, or description).
pub fn search(query: &str) -> Vec<RegistryEntry> {
    let q = query.to_lowercase();
    load_registry()
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
