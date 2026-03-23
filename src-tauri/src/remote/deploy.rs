use std::path::PathBuf;

use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use kosmos_core::CREATE_NO_WINDOW;

/// Remote directory name — dev builds use a separate directory so they don't
/// kill the production daemon (pkill) or overwrite the production binary.
pub const REMOTE_DIR: &str = if cfg!(debug_assertions) {
    ".kosmos-agent-dev"
} else {
    ".kosmos-agent"
};

/// Locate the agent binary bundled with the app.
/// In development: src-tauri/resources/kosmos-agent
/// In production: bundled via Tauri resources
fn bundled_agent_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;

    let path = resource_dir.join("resources").join("kosmos-agent");
    if path.exists() {
        return Ok(path);
    }

    // Dev fallback: resource_dir is target/debug, resources is at src-tauri/resources
    let dev_path = resource_dir
        .parent()
        .and_then(|p| p.parent()) // target/debug -> target -> src-tauri
        .map(|p| p.join("resources").join("kosmos-agent"));

    if let Some(p) = dev_path {
        if p.exists() {
            return Ok(p);
        }
    }

    Err("Agent binary not found. Run: cargo build -p kosmos-agent --target x86_64-unknown-linux-musl, then copy to src-tauri/resources/".into())
}

/// Check the version of the installed agent in a WSL distro.
pub async fn check_remote_version(distro: &str) -> Option<String> {
    let bin = format!("~/{REMOTE_DIR}/kosmos-agent");
    let output = run_wsl(distro, &[&bin, "--version"])
        .await
        .ok()?;
    let trimmed = output.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Ensure a WSL distro is running. Starts it if stopped.
pub async fn ensure_wsl_running(distro: &str) -> Result<(), String> {
    // `wsl -d <distro> -- true` will start the distro if it's not running
    run_wsl(distro, &["true"]).await?;
    Ok(())
}

/// Check whether the local (bundled) and remote agent binaries are identical
/// by comparing SHA256 checksums. Runs both sha256sum commands in parallel.
async fn binaries_match(distro: &str, local_wsl_path: &str, remote_bin: &str) -> bool {
    let local_args = ["sha256sum", local_wsl_path];
    let remote_args = ["sha256sum", remote_bin];
    let (local_result, remote_result) = tokio::join!(
        run_wsl(distro, &local_args),
        run_wsl(distro, &remote_args),
    );

    let extract_hash = |r: Result<String, String>| -> Option<String> {
        r.ok()
            .and_then(|s| s.split_whitespace().next().map(|h| h.to_string()))
    };

    match (extract_hash(local_result), extract_hash(remote_result)) {
        (Some(local), Some(remote)) => local == remote,
        _ => false, // If either fails (e.g. remote doesn't exist), assume mismatch
    }
}

/// Deploy the kosmos-agent binary into a WSL distro.
/// Copies the pre-built Linux binary from the app bundle.
/// Skips the copy if the remote binary already matches (by SHA256).
pub async fn deploy_to_wsl(app: &AppHandle, distro: &str) -> Result<(), String> {
    let dir = format!("~/{REMOTE_DIR}");
    let bin = format!("~/{REMOTE_DIR}/kosmos-agent");

    run_wsl(distro, &["mkdir", "-p", &dir]).await?;

    let agent_src = bundled_agent_path(app)?;
    let wsl_path = windows_to_wsl_path(&agent_src.to_string_lossy());

    // Skip kill + copy if the remote binary is already identical
    if binaries_match(distro, &wsl_path, &bin).await {
        return Ok(());
    }

    // Binary differs (or doesn't exist) — full deploy
    // Kill only agents in THIS directory so dev/prod don't interfere
    let _ = run_wsl(distro, &["pkill", "-f", &bin]).await;
    run_wsl(distro, &["cp", &wsl_path, &bin]).await?;
    run_wsl(distro, &["chmod", "+x", &bin]).await?;

    Ok(())
}

/// Deploy the kosmos-agent binary to an SSH host.
/// Copies the pre-built agent binary via scp.
pub async fn deploy_to_ssh(
    app: &tauri::AppHandle,
    host: &str,
    user: Option<&str>,
) -> Result<(), String> {
    let target = match user {
        Some(u) => format!("{u}@{host}"),
        None => host.to_string(),
    };

    let dir = format!("~/{REMOTE_DIR}");
    let bin = format!("~/{REMOTE_DIR}/kosmos-agent");

    let output = tokio::process::Command::new("ssh")
        .args([&target, "mkdir", "-p", &dir])
        .output()
        .await
        .map_err(|e| format!("SSH failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create agent directory: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let agent_src = bundled_agent_path(app)?;
    let scp_dest = format!("{target}:{bin}");

    let output = tokio::process::Command::new("scp")
        .args([&agent_src.to_string_lossy().to_string(), &scp_dest])
        .output()
        .await
        .map_err(|e| format!("SCP failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to copy agent binary: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let output = tokio::process::Command::new("ssh")
        .args([&target, "chmod", "+x", &bin])
        .output()
        .await
        .map_err(|e| format!("SSH chmod failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to make agent executable: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Convert a Windows path to a WSL-accessible /mnt/ path.
fn windows_to_wsl_path(win_path: &str) -> String {
    // Strip \\?\ extended-length prefix that Windows APIs add
    let clean = win_path.strip_prefix(r"\\?\").unwrap_or(win_path);
    let normalized = clean.replace('\\', "/");
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let drive = (normalized.as_bytes()[0] as char).to_ascii_lowercase();
        format!("/mnt/{}/{}", drive, &normalized[3..])
    } else {
        normalized
    }
}

/// Run a command inside a WSL distro and return stdout.
async fn run_wsl(distro: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new("wsl.exe");
    cmd.args(["-d", distro, "--"]);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("WSL exec failed: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Resolve the home directory inside a WSL distro.
pub async fn wsl_resolve_home(distro: &str) -> Result<String, String> {
    let output = run_wsl(distro, &["sh", "-c", "echo $HOME"]).await?;
    let home = output.trim().to_string();
    if home.is_empty() {
        Ok("/root".to_string())
    } else {
        Ok(home)
    }
}

/// List directories inside a WSL distro path.
pub async fn wsl_list_dir(distro: &str, path: &str) -> Result<Vec<(String, bool)>, String> {
    let output = run_wsl(distro, &["ls", "-1ApL", path]).await?;
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.ends_with('/') {
            let name = line.trim_end_matches('/').to_string();
            if !name.is_empty() {
                dirs.push(name);
            }
        } else {
            files.push(line.to_string());
        }
    }

    dirs.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    files.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    let mut result: Vec<(String, bool)> = dirs.into_iter().map(|n| (n, true)).collect();
    result.extend(files.into_iter().map(|n| (n, false)));
    Ok(result)
}

/// List available WSL distributions.
pub async fn list_wsl_distros() -> Result<Vec<String>, String> {
    #[cfg(not(target_os = "windows"))]
    return Ok(vec![]);

    #[cfg(target_os = "windows")]
    {
        let mut cmd = tokio::process::Command::new("wsl.exe");
        cmd.args(["--list", "--quiet"]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("WSL list failed: {e}"))?;

        if !output.status.success() {
            return Ok(vec![]);
        }

        let u16s: Vec<u16> = output
            .stdout
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let text = String::from_utf16_lossy(&u16s);

        let distros: Vec<String> = text
            .lines()
            .map(|l| l.trim().trim_matches('\0').to_string())
            .filter(|l| !l.is_empty())
            .collect();

        Ok(distros)
    }
}
