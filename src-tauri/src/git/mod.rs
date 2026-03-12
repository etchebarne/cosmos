use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn get_git_branch(path: &str) -> Result<Option<String>, String> {
    let dir = Path::new(path);
    if !dir.exists() {
        return Ok(None);
    }

    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        Ok(None)
    } else {
        Ok(Some(branch))
    }
}
