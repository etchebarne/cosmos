use std::path::Path;

use kosmos_protocol::types::*;

use crate::CoreError;

use crate::git::run_git;
use crate::git::run_git_strict;

pub async fn git_stash_all(path: &str) -> Result<(), CoreError> {
    let dir = Path::new(path);
    run_git_strict(dir, &["stash", "--include-untracked"]).await
}

pub async fn git_stash_files(path: &str, files: Vec<String>) -> Result<(), CoreError> {
    let dir = Path::new(path);
    let mut args: Vec<&str> = vec!["stash", "push", "--"];
    let refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(refs);
    run_git_strict(dir, &args).await
}

pub async fn git_stash_list(path: &str) -> Result<Vec<GitStashEntry>, CoreError> {
    let dir = Path::new(path);
    let output = run_git(dir, &["stash", "list", "--format=%gs"]).await?;
    let mut entries = Vec::new();
    if let Some(text) = output {
        for (i, line) in text.lines().enumerate() {
            entries.push(GitStashEntry {
                index: i,
                message: line.to_string(),
            });
        }
    }
    Ok(entries)
}

pub async fn git_stash_pop(path: &str, index: usize) -> Result<(), CoreError> {
    let dir = Path::new(path);
    let ref_str = format!("stash@{{{}}}", index);
    run_git_strict(dir, &["stash", "pop", &ref_str]).await
}

pub async fn git_stash_show(path: &str, index: usize) -> Result<Vec<GitStashFile>, CoreError> {
    let dir = Path::new(path);
    let ref_str = format!("stash@{{{}}}", index);
    let output = run_git(dir, &["stash", "show", "--name-status", &ref_str]).await?;
    let mut files = Vec::new();
    if let Some(text) = output {
        for line in text.lines() {
            let parts: Vec<&str> = line.splitn(2, '\t').collect();
            if parts.len() < 2 {
                continue;
            }
            let status = match parts[0].trim() {
                "A" => "added",
                "D" => "deleted",
                "R" => "renamed",
                _ => "modified",
            };
            files.push(GitStashFile {
                path: parts[1].trim().to_string(),
                status: status.to_string(),
            });
        }
    }
    Ok(files)
}

pub async fn git_stash_drop(path: &str, index: usize) -> Result<(), CoreError> {
    let dir = Path::new(path);
    let ref_str = format!("stash@{{{}}}", index);
    run_git_strict(dir, &["stash", "drop", &ref_str]).await
}
