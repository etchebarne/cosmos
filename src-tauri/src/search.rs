use std::io::{BufRead, BufReader};

use ignore::WalkBuilder;
use serde::Serialize;

struct RootPrefix {
    forward: String,
    back: String,
}

impl RootPrefix {
    fn new(root: &str) -> Self {
        let forward = if root.ends_with('/') || root.ends_with('\\') {
            root.replace('\\', "/")
        } else {
            format!("{}/", root.replace('\\', "/"))
        };
        let back = forward.replace('/', "\\");
        Self { forward, back }
    }

    fn make_relative(&self, full: &str) -> String {
        let stripped = if full.starts_with(&self.forward) {
            &full[self.forward.len()..]
        } else if full.starts_with(&self.back) {
            &full[self.back.len()..]
        } else {
            full
        };
        stripped.replace('\\', "/")
    }
}

fn build_walker(root: &str) -> ignore::Walk {
    WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .max_depth(Some(20))
        .build()
}

/// Walk the workspace and return all file paths (respects .gitignore).
#[tauri::command]
pub async fn list_workspace_files(path: String) -> Result<Vec<String>, String> {
    let root = path.clone();
    tokio::task::spawn_blocking(move || {
        let prefix = RootPrefix::new(&root);
        let mut files = Vec::new();

        for entry in build_walker(&root).flatten() {
            if entry.file_type().map_or(true, |ft| !ft.is_file()) {
                continue;
            }
            let full = entry.path().to_string_lossy();
            files.push(prefix.make_relative(&full));
        }
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
pub struct ContentMatch {
    pub path: String,
    pub line: u32,
    pub col: u32,
    pub text: String,
}

/// Search file contents for a query string (case-insensitive).
#[tauri::command]
pub async fn search_in_files(
    path: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<ContentMatch>, String> {
    let root = path.clone();
    let max = max_results.unwrap_or(100);

    tokio::task::spawn_blocking(move || {
        let query_lower = query.to_lowercase();
        let prefix = RootPrefix::new(&root);
        let mut results = Vec::new();

        for entry in build_walker(&root).flatten() {
            if results.len() >= max {
                break;
            }
            if entry.file_type().map_or(true, |ft| !ft.is_file()) {
                continue;
            }

            let file_path = entry.path();
            let file = match std::fs::File::open(file_path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let relative = prefix.make_relative(&file_path.to_string_lossy());

            let reader = BufReader::new(file);
            for (line_num, line_result) in reader.lines().enumerate() {
                if results.len() >= max {
                    break;
                }
                let line = match line_result {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let line_lower = line.to_lowercase();
                if let Some(col_pos) = line_lower.find(&query_lower) {
                    results.push(ContentMatch {
                        path: relative.clone(),
                        line: (line_num + 1) as u32,
                        col: (col_pos + 1) as u32,
                        text: if line.len() > 300 {
                            format!("{}...", &line[..300])
                        } else {
                            line
                        },
                    });
                }
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}
