use notify_debouncer_mini::new_debouncer;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct FsWatcherState {
    pub watcher: Mutex<Option<(notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>, PathBuf)>>,
}

fn run_git(path: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8_lossy(&output.stdout).trim_end().to_string();
    if text.is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

fn run_git_strict(path: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(stderr);
    }
    Ok(())
}

fn parse_numstat(output: &str) -> HashMap<String, (i32, i32)> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let additions = parts[0].parse::<i32>().unwrap_or(0);
            let deletions = parts[1].parse::<i32>().unwrap_or(0);
            let path = parts[2..].join("\t");
            map.insert(path, (additions, deletions));
        }
    }
    map
}

#[tauri::command]
pub fn get_git_branch(path: &str) -> Result<Option<String>, String> {
    let dir = Path::new(path);
    if !dir.exists() {
        return Ok(None);
    }
    run_git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    path: String,
    status: String,
    staged: bool,
    additions: i32,
    deletions: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusInfo {
    changes: Vec<GitFileChange>,
    branch: Option<String>,
    remote_branch: Option<String>,
    last_commit_message: Option<String>,
}

#[tauri::command]
pub fn get_git_status(path: &str) -> Result<GitStatusInfo, String> {
    let dir = Path::new(path);
    if !dir.exists() {
        return Err("Directory does not exist".to_string());
    }

    let branch = run_git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let remote_branch = run_git(dir, &["rev-parse", "--abbrev-ref", "@{upstream}"])?;
    let last_commit_message = run_git(dir, &["log", "-1", "--pretty=%s"])?;

    let status_output = run_git(dir, &["status", "--porcelain", "-uall"])?;

    let staged_stats = run_git(dir, &["diff", "--cached", "--numstat"])?
        .map(|s| parse_numstat(&s))
        .unwrap_or_default();

    let unstaged_stats = run_git(dir, &["diff", "--numstat"])?
        .map(|s| parse_numstat(&s))
        .unwrap_or_default();

    let mut changes = Vec::new();

    if let Some(status) = status_output {
        for line in status.lines() {
            if line.len() < 4 {
                continue;
            }

            let bytes = line.as_bytes();
            let x = bytes[0] as char;
            let y = bytes[1] as char;
            let file_path = &line[3..];

            // Strip trailing slash (untracked directories)
            let file_path = file_path.trim_end_matches('/');
            if file_path.is_empty() {
                continue;
            }

            // Handle renames: "old -> new"
            let file_path = if file_path.contains(" -> ") {
                file_path.split(" -> ").last().unwrap_or(file_path)
            } else {
                file_path
            };

            let staged = x != ' ' && x != '?';

            let status_str = match (x, y) {
                ('?', '?') => "untracked",
                ('A', _) => "added",
                (_, 'D') if x == ' ' => "deleted",
                ('D', _) => "deleted",
                ('R', _) => "renamed",
                _ => "modified",
            };

            let (additions, deletions) = if x == '?' && y == '?' {
                // Untracked files: count lines as additions
                let full_path = dir.join(file_path);
                let count = std::fs::read_to_string(&full_path)
                    .map(|s| s.lines().count() as i32)
                    .unwrap_or(0);
                (count, 0)
            } else if staged {
                staged_stats.get(file_path).copied().unwrap_or((0, 0))
            } else {
                unstaged_stats.get(file_path).copied().unwrap_or((0, 0))
            };

            changes.push(GitFileChange {
                path: file_path.to_string(),
                status: status_str.to_string(),
                staged,
                additions,
                deletions,
            });
        }
    }

    changes.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(GitStatusInfo {
        changes,
        branch,
        remote_branch,
        last_commit_message,
    })
}

#[tauri::command]
pub fn git_stage(path: &str, files: Vec<String>) -> Result<(), String> {
    let dir = Path::new(path);
    let mut args: Vec<&str> = vec!["add", "--"];
    let refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(refs);
    run_git_strict(dir, &args)
}

#[tauri::command]
pub fn git_unstage(path: &str, files: Vec<String>) -> Result<(), String> {
    let dir = Path::new(path);
    let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
    let refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(refs);
    run_git_strict(dir, &args)
}

#[tauri::command]
pub fn git_stage_all(path: &str) -> Result<(), String> {
    let dir = Path::new(path);
    run_git_strict(dir, &["add", "-A"])
}

#[tauri::command]
pub fn git_commit(path: &str, message: &str) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    let dir = Path::new(path);
    run_git_strict(dir, &["commit", "-m", message])
}

#[tauri::command]
pub fn git_fetch(path: &str) -> Result<(), String> {
    let dir = Path::new(path);
    run_git_strict(dir, &["fetch"])
}

#[tauri::command]
pub fn watch_workspace(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<FsWatcherState>();
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;

    // If already watching this path, do nothing
    if let Some((_, ref current)) = *guard {
        if current == Path::new(&path) {
            return Ok(());
        }
    }

    // Drop old watcher
    *guard = None;

    let app_handle = app.clone();
    let watch_path = PathBuf::from(&path);

    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(_events) = result {
                let _ = app_handle.emit("git-changed", ());
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(
            Path::new(&path),
            notify::RecursiveMode::Recursive,
        )
        .map_err(|e| e.to_string())?;

    *guard = Some((debouncer, watch_path));
    Ok(())
}

#[tauri::command]
pub fn unwatch_workspace(app: AppHandle) -> Result<(), String> {
    let state = app.state::<FsWatcherState>();
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}
