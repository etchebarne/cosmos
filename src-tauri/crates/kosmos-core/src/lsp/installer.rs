use std::path::{Path, PathBuf};

use kosmos_protocol::types::{InstalledServer, RegistryEntry};

use super::registry::{find_platform_asset, resolve_template, strip_exec_prefix, strip_subpath};

fn meta_path(servers_dir: &Path, name: &str) -> PathBuf {
    servers_dir.join(name).join(".kosmos-meta.json")
}

pub fn get_installed_meta(servers_dir: &Path, name: &str) -> Option<InstalledServer> {
    let content = std::fs::read_to_string(meta_path(servers_dir, name)).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn list_installed(servers_dir: &Path) -> Vec<InstalledServer> {
    if !servers_dir.exists() {
        return vec![];
    }

    std::fs::read_dir(servers_dir)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    get_installed_meta(servers_dir, &name)
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn find_installed_binary(servers_dir: &Path, command: &str) -> Option<PathBuf> {
    if !servers_dir.exists() {
        return None;
    }

    for entry in std::fs::read_dir(servers_dir).ok()?.flatten() {
        let meta_file = entry.path().join(".kosmos-meta.json");
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
    servers_dir: &Path,
    entry: &RegistryEntry,
) -> Result<InstalledServer, String> {
    let source_type = entry.source_type.as_deref().ok_or("No source type")?;
    let version = entry.version.as_deref().ok_or("No version")?;
    let dir = servers_dir.join(&entry.name);

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
    std::fs::write(meta_path(servers_dir, &entry.name), meta_json)
        .map_err(|e| format!("Failed to save metadata: {e}"))?;

    Ok(meta)
}

pub fn uninstall_server(servers_dir: &Path, name: &str) -> Result<(), String> {
    let dir = servers_dir.join(name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove server: {e}"))?;
    }
    Ok(())
}

// ── Shell command helper ──

fn shell_command(program: &str) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.args(["/C", program]);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = tokio::process::Command::new(program);
        #[cfg(target_os = "linux")]
        crate::sanitize_child_env(&mut cmd);
        cmd
    }
}

// ── GitHub Release installer ──

async fn install_github(entry: &RegistryEntry, install_dir: &Path) -> Result<String, String> {
    let assets = entry.assets.as_ref().ok_or("No assets defined")?;
    let (_platform, asset) =
        find_platform_asset(assets).ok_or("No asset available for this platform")?;

    let source = entry
        .source_id
        .strip_prefix("pkg:github/")
        .ok_or("Invalid github source")?;
    let (repo_path, version) = source
        .split_once('@')
        .ok_or("No version in github source")?;

    let file_template = strip_subpath(&asset.file);
    let file_name = resolve_template(file_template, version);

    let url = format!("https://github.com/{repo_path}/releases/download/{version}/{file_name}");

    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("kosmos-lsp-{}.tmp", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));

    let output = shell_command("curl")
        .args(["-sSL", "-o", temp_file.to_str().unwrap(), &url])
        .output()
        .await
        .map_err(|e| format!("Download failed to execute curl: {}", e))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&temp_file);
        return Err(format!("Download failed: curl returned {}", output.status));
    }

    let bytes = std::fs::read(&temp_file).map_err(|e| {
        let _ = std::fs::remove_file(&temp_file);
        format!("Failed to read downloaded file: {}", e)
    })?;
    let _ = std::fs::remove_file(&temp_file);

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

    let package = package_encoded.replace("%40", "@");

    // Create a package.json so npm install works reliably in this directory
    // (--prefix can fail to create .bin symlinks on some npm versions)
    let pkg_json = r#"{"private":true}"#;
    std::fs::write(install_dir.join("package.json"), pkg_json)
        .map_err(|e| format!("Failed to create package.json: {e}"))?;

    let mut args = vec![
        "install".to_string(),
        format!("{package}@{version}"),
    ];

    if let Some(extras) = &entry.extra_packages {
        args.extend(extras.iter().cloned());
    }

    let output = shell_command("npm")
        .args(&args)
        .current_dir(install_dir)
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

    // Ensure the binary is executable (npm doesn't always set this)
    #[cfg(unix)]
    {
        let full_bin = install_dir.join(&bin_path);
        if full_bin.exists() {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&full_bin, std::fs::Permissions::from_mode(0o755)).ok();
        }
    }

    Ok(bin_path)
}

// ── PyPI installer ──

async fn install_pypi(entry: &RegistryEntry, install_dir: &Path) -> Result<String, String> {
    let source = entry
        .source_id
        .strip_prefix("pkg:pypi/")
        .ok_or("Invalid pypi source")?;

    let (main_part, extras_query) = source.split_once('?').unwrap_or((source, ""));
    let (package, version) = main_part
        .split_once('@')
        .ok_or("No version in pypi source")?;

    let extras: Vec<&str> = extras_query
        .split('&')
        .filter_map(|param| param.strip_prefix("extra="))
        .collect();

    let venv_dir = install_dir.join("venv");

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

    let mut cmd = tokio::process::Command::new(&pip);
    cmd.args(["install", &pkg_spec]);
    #[cfg(target_os = "linux")]
    crate::sanitize_child_env(&mut cmd);
    let output = cmd.output()
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

    let bin_name = entry
        .bin
        .as_deref()
        .unwrap_or_else(|| module.rsplit('/').next().unwrap_or(module));
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

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {e}"))?;
    }

    Ok(())
}
