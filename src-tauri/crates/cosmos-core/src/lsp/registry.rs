use std::collections::HashMap;
use std::path::Path;

use cosmos_protocol::types::{PlatformAsset, RegistryEntry};

const REGISTRY_JSON: &str = include_str!("registry.json");

pub fn load_registry() -> Vec<RegistryEntry> {
    serde_json::from_str(REGISTRY_JSON).expect("Failed to parse embedded registry")
}

pub fn search_in(entries: Vec<RegistryEntry>, query: &str) -> Vec<RegistryEntry> {
    let q = query.to_lowercase();
    entries
        .into_iter()
        .filter(|e| {
            e.name.to_lowercase().contains(&q)
                || e.languages.iter().any(|l| l.to_lowercase().contains(&q))
                || e.description.to_lowercase().contains(&q)
        })
        .collect()
}

pub fn load_custom_entries(path: &Path) -> Vec<RegistryEntry> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn merge_registries(
    mut base: Vec<RegistryEntry>,
    custom: Vec<RegistryEntry>,
) -> Vec<RegistryEntry> {
    for entry in custom {
        if let Some(existing) = base.iter_mut().find(|e| e.name == entry.name) {
            *existing = entry;
        } else {
            base.push(entry);
        }
    }
    base
}

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

pub fn resolve_template(template: &str, version: &str) -> String {
    let result = template.replace("{{version}}", version);
    let result = result.replace("{{ version }}", version);
    let stripped = version.strip_prefix('v').unwrap_or(version);
    result.replace("{{ version | strip_prefix \"v\" }}", stripped)
}

pub fn strip_subpath(file_template: &str) -> &str {
    if let Some(idx) = file_template.rfind(".gz:").or(file_template.rfind(".zip:")) {
        let colon_pos = file_template[idx..].find(':').unwrap() + idx;
        &file_template[..colon_pos]
    } else {
        file_template
    }
}

pub fn strip_exec_prefix(bin: &str) -> &str {
    bin.strip_prefix("exec:").unwrap_or(bin)
}
