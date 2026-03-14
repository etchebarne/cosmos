use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::registry::{
    find_platform_asset, resolve_template, strip_exec_prefix, strip_subpath, RegistryEntry,
};

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct InstalledServer {
    pub name: String,
    pub version: String,
    pub source_type: String,
    pub bin_path: String, // relative to the server's install dir
}

fn servers_dir(app: &AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    data_dir.join("servers")
}

fn server_dir(app: &AppHandle, name: &str) -> PathBuf {
    servers_dir(app).join(name)
}

fn meta_path(app: &AppHandle, name: &str) -> PathBuf {
    server_dir(app, name).join(".cosmos-meta.json")
}

pub fn get_installed_meta(app: &AppHandle, name: &str) -> Option<InstalledServer> {
    let content = std::fs::read_to_string(meta_path(app, name)).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn list_installed(app: &AppHandle) -> Vec<InstalledServer> {
    let dir = servers_dir(app);
    if !dir.exists() {
        return vec![];
    }

    std::fs::read_dir(&dir)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    get_installed_meta(app, &name)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Find the absolute path to an installed server's binary by its command name.
/// Checks all installed servers for a binary matching the given command.
pub fn find_installed_binary(app: &AppHandle, command: &str) -> Option<PathBuf> {
    let dir = servers_dir(app);
    if !dir.exists() {
        return None;
    }

    for entry in std::fs::read_dir(&dir).ok()?.flatten() {
        let meta_file = entry.path().join(".cosmos-meta.json");
        if let Ok(content) = std::fs::read_to_string(&meta_file) {
            if let Ok(meta) = serde_json::from_str::<InstalledServer>(&content) {
                let bin = entry.path().join(&meta.bin_path);
                if let Some(stem) = bin.file_stem() {
                    if stem.to_string_lossy() == command && bin.exists() {
                        return Some(bin);
                    }
                }
            }
        }
    }
    None
}

pub async fn install_server(
    app: &AppHandle,
    entry: &RegistryEntry,
) -> Result<InstalledServer, String> {
    let source_type = entry.source_type.as_deref().ok_or("No source type")?;
    let version = entry.version.as_deref().ok_or("No version")?;
    let dir = server_dir(app, &entry.name);

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {e}"))?;

    let bin_path = match source_type {
        "github" => install_github(entry, &dir).await?,
        "npm" => install_npm(entry, &dir).await?,
        "pypi" => install_pypi(entry, &dir).await?,
        "cargo" => install_cargo(entry, &dir).await?,
        "golang" => install_golang(entry, &dir).await?,
        other => return Err(format!("Unsupported source type: {other}")),
    };

    let meta = InstalledServer {
        name: entry.name.clone(),
        version: version.to_string(),
        source_type: source_type.to_string(),
        bin_path,
    };

    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(meta_path(app, &entry.name), meta_json)
        .map_err(|e| format!("Failed to save metadata: {e}"))?;

    Ok(meta)
}

pub fn uninstall_server(app: &AppHandle, name: &str) -> Result<(), String> {
    let dir = server_dir(app, name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove server: {e}"))?;
    }
    Ok(())
}

// ── Shell command helper ──
// On Windows, tools like npm/python/go are .cmd/.bat scripts that need cmd.exe to execute.

fn shell_command(program: &str) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.args(["/C", program]);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        tokio::process::Command::new(program)
    }
}

// ── GitHub Release installer ──

async fn install_github(entry: &RegistryEntry, install_dir: &Path) -> Result<String, String> {
    let assets = entry.assets.as_ref().ok_or("No assets defined")?;
    let (_platform, asset) =
        find_platform_asset(assets).ok_or("No asset available for this platform")?;

    // Parse source_id: "pkg:github/owner/repo@version"
    let source = entry
        .source_id
        .strip_prefix("pkg:github/")
        .ok_or("Invalid github source")?;
    let (repo_path, version) = source
        .split_once('@')
        .ok_or("No version in github source")?;

    // Resolve file name: strip :subpath, resolve {{version}} template
    let file_template = strip_subpath(&asset.file);
    let file_name = resolve_template(file_template, version);

    let url = format!("https://github.com/{repo_path}/releases/download/{version}/{file_name}");

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Download failed: HTTP {}",
            response.status()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    // Determine bin path from asset or entry
    let raw_bin = asset
        .bin
        .as_deref()
        .unwrap_or(entry.bin.as_deref().unwrap_or(&entry.name));
    let bin_name = strip_exec_prefix(raw_bin);

    if file_name.ends_with(".tar.gz") || file_name.ends_with(".tgz") {
        extract_tar_gz(&bytes, install_dir)?;
        Ok(bin_name.to_string())
    } else if file_name.ends_with(".zip") {
        extract_zip(&bytes, install_dir)?;
        Ok(bin_name.to_string())
    } else if file_name.ends_with(".gz") {
        // Single gzipped binary — write with the standard bin name
        let standard_name = entry.bin.as_deref().unwrap_or(&entry.name);
        #[cfg(target_os = "windows")]
        let out_name = if standard_name.ends_with(".exe") {
            standard_name.to_string()
        } else {
            format!("{standard_name}.exe")
        };
        #[cfg(not(target_os = "windows"))]
        let out_name = standard_name.to_string();

        extract_gz(&bytes, install_dir, &out_name)?;
        Ok(out_name)
    } else if file_name.ends_with(".exe") || !file_name.contains('.') {
        // Bare binary (e.g. marksman.exe on Windows, or extensionless on Unix)
        let standard_name = entry.bin.as_deref().unwrap_or(&entry.name);
        #[cfg(target_os = "windows")]
        let out_name = if standard_name.ends_with(".exe") {
            standard_name.to_string()
        } else {
            format!("{standard_name}.exe")
        };
        #[cfg(not(target_os = "windows"))]
        let out_name = standard_name.to_string();

        let out_path = install_dir.join(&out_name);
        std::fs::write(&out_path, &bytes)
            .map_err(|e| format!("Failed to write binary: {e}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Failed to set permissions: {e}"))?;
        }

        Ok(out_name)
    } else {
        Err(format!("Unsupported archive format: {file_name}"))
    }
}

// ── npm installer ──

async fn install_npm(entry: &RegistryEntry, install_dir: &Path) -> Result<String, String> {
    let source = entry
        .source_id
        .strip_prefix("pkg:npm/")
        .ok_or("Invalid npm source")?;
    let (package_encoded, version) = source
        .split_once('@')
        .ok_or("No version in npm source")?;

    // URL decode: %40 → @
    let package = package_encoded.replace("%40", "@");

    let mut args = vec![
        "install".to_string(),
        "--prefix".to_string(),
        install_dir.to_string_lossy().to_string(),
        format!("{package}@{version}"),
    ];

    if let Some(extras) = &entry.extra_packages {
        args.extend(extras.iter().cloned());
    }

    let output = shell_command("npm")
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run npm: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "npm install failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let bin_name = entry.bin.as_deref().unwrap_or(&entry.name);
    #[cfg(target_os = "windows")]
    let bin_path = format!("node_modules/.bin/{bin_name}.cmd");
    #[cfg(not(target_os = "windows"))]
    let bin_path = format!("node_modules/.bin/{bin_name}");

    Ok(bin_path)
}

// ── PyPI installer ──

async fn install_pypi(entry: &RegistryEntry, install_dir: &Path) -> Result<String, String> {
    let source = entry
        .source_id
        .strip_prefix("pkg:pypi/")
        .ok_or("Invalid pypi source")?;

    // Handle extras in the URL: package@version?extra=all
    let (main_part, extras_query) = source.split_once('?').unwrap_or((source, ""));
    let (package, version) = main_part
        .split_once('@')
        .ok_or("No version in pypi source")?;

    let extras: Vec<&str> = extras_query
        .split('&')
        .filter_map(|param| param.strip_prefix("extra="))
        .collect();

    let venv_dir = install_dir.join("venv");

    // Create venv
    let output = shell_command("python")
        .args(["-m", "venv", &venv_dir.to_string_lossy()])
        .output()
        .await
        .map_err(|e| format!("Failed to create venv: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "venv creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    #[cfg(target_os = "windows")]
    let pip = venv_dir.join("Scripts").join("pip.exe");
    #[cfg(not(target_os = "windows"))]
    let pip = venv_dir.join("bin").join("pip");

    let pkg_spec = if extras.is_empty() {
        format!("{package}=={version}")
    } else {
        format!("{package}[{}]=={version}", extras.join(","))
    };

    let output = tokio::process::Command::new(&pip)
        .args(["install", &pkg_spec])
        .output()
        .await
        .map_err(|e| format!("Failed to run pip: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pip install failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let bin_name = entry.bin.as_deref().unwrap_or(&entry.name);
    #[cfg(target_os = "windows")]
    let bin_path = format!("venv/Scripts/{bin_name}.exe");
    #[cfg(not(target_os = "windows"))]
    let bin_path = format!("venv/bin/{bin_name}");

    Ok(bin_path)
}

// ── Cargo installer ──

async fn install_cargo(entry: &RegistryEntry, install_dir: &Path) -> Result<String, String> {
    let source = entry
        .source_id
        .strip_prefix("pkg:cargo/")
        .ok_or("Invalid cargo source")?;
    let (crate_name, version) = source
        .split_once('@')
        .ok_or("No version in cargo source")?;

    let output = shell_command("cargo")
        .args([
            "install",
            crate_name,
            "--version",
            version,
            "--root",
            &install_dir.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run cargo: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "cargo install failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let bin_name = entry.bin.as_deref().unwrap_or(crate_name);
    #[cfg(target_os = "windows")]
    let bin_path = format!("bin/{bin_name}.exe");
    #[cfg(not(target_os = "windows"))]
    let bin_path = format!("bin/{bin_name}");

    Ok(bin_path)
}

// ── Go installer ──

async fn install_golang(entry: &RegistryEntry, install_dir: &Path) -> Result<String, String> {
    let source = entry
        .source_id
        .strip_prefix("pkg:golang/")
        .ok_or("Invalid golang source")?;
    let (module, version) = source
        .split_once('@')
        .ok_or("No version in golang source")?;

    let output = shell_command("go")
        .args(["install", &format!("{module}@{version}")])
        .env("GOBIN", install_dir.join("bin"))
        .output()
        .await
        .map_err(|e| format!("Failed to run go: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "go install failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let bin_name = entry.bin.as_deref().unwrap_or_else(|| {
        module.rsplit('/').next().unwrap_or(module)
    });
    #[cfg(target_os = "windows")]
    let bin_path = format!("bin/{bin_name}.exe");
    #[cfg(not(target_os = "windows"))]
    let bin_path = format!("bin/{bin_name}");

    Ok(bin_path)
}

// ── Archive extraction helpers ──

fn extract_zip(data: &[u8], dest: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open zip: {e}"))?;
    archive
        .extract(dest)
        .map_err(|e| format!("Failed to extract zip: {e}"))?;
    Ok(())
}

fn extract_tar_gz(data: &[u8], dest: &Path) -> Result<(), String> {
    let cursor = std::io::Cursor::new(data);
    let gz = flate2::read::GzDecoder::new(cursor);
    let mut archive = tar::Archive::new(gz);
    archive
        .unpack(dest)
        .map_err(|e| format!("Failed to extract tar.gz: {e}"))?;
    Ok(())
}

fn extract_gz(data: &[u8], dest: &Path, bin_name: &str) -> Result<(), String> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(data);
    let mut gz = flate2::read::GzDecoder::new(cursor);
    let mut decompressed = Vec::new();
    gz.read_to_end(&mut decompressed)
        .map_err(|e| format!("Failed to decompress gz: {e}"))?;

    let out_path = dest.join(bin_name);
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&out_path, &decompressed)
        .map_err(|e| format!("Failed to write binary: {e}"))?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {e}"))?;
    }

    Ok(())
}
