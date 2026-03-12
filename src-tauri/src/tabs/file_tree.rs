use serde::Serialize;
use std::fs;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    extension: Option<String>,
}

#[tauri::command]
pub fn read_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<DirEntry> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        if name == ".git" {
            continue;
        }

        let path_str = entry.path().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();
        let extension = if !is_dir {
            entry
                .path()
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        } else {
            None
        };

        let dir_entry = DirEntry {
            name,
            path: path_str,
            is_dir,
            extension,
        };

        if is_dir {
            dirs.push(dir_entry);
        } else {
            files.push(dir_entry);
        }
    }

    // Sort alphabetically, dirs first
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.append(&mut files);

    Ok(dirs)
}
