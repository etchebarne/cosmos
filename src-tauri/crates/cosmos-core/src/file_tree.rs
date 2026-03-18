use std::fs;
use std::path::Path;

use cosmos_protocol::types::DirEntry;

/// Validate that a path doesn't contain traversal components (`..`).
/// This prevents escaping workspace boundaries on the remote agent.
fn validate_no_traversal(path: &str) -> Result<(), String> {
    for component in Path::new(path).components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(format!("Path traversal not allowed: {path}"));
        }
    }
    Ok(())
}

pub fn read_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    validate_no_traversal(path)?;
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

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.append(&mut files);

    Ok(dirs)
}

pub fn move_file(source: &str, dest_dir: &str) -> Result<String, String> {
    validate_no_traversal(source)?;
    validate_no_traversal(dest_dir)?;
    let source_path = Path::new(source);
    let dest_path = Path::new(dest_dir);

    let file_name = source_path.file_name().ok_or("Invalid source path")?;

    if source_path.parent() == Some(dest_path) {
        return Ok(source.to_string());
    }

    let new_path = dest_path.join(file_name);

    if new_path.exists() {
        return Err(format!(
            "A file named '{}' already exists in the destination",
            file_name.to_string_lossy()
        ));
    }

    fs::rename(source_path, &new_path).map_err(|e| e.to_string())?;

    Ok(new_path.to_string_lossy().to_string())
}

pub fn create_file(path: &str) -> Result<(), String> {
    validate_no_traversal(path)?;
    let p = Path::new(path);
    if p.exists() {
        return Err(format!(
            "'{}' already exists",
            p.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    fs::File::create(p).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_dir(path: &str) -> Result<(), String> {
    validate_no_traversal(path)?;
    let p = Path::new(path);
    if p.exists() {
        return Err(format!(
            "'{}' already exists",
            p.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    fs::create_dir(p).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rename_entry(path: &str, new_name: &str) -> Result<String, String> {
    validate_no_traversal(path)?;
    if new_name.contains("..") || new_name.contains('/') || new_name.contains('\\') {
        return Err(format!("Invalid file name: {new_name}"));
    }
    let p = Path::new(path);
    let parent = p.parent().ok_or("No parent directory")?;
    let new_path = parent.join(new_name);
    if new_path.exists() {
        return Err(format!("'{}' already exists", new_name));
    }
    fs::rename(p, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

pub fn copy_entry(source: &str, dest_dir: &str) -> Result<String, String> {
    validate_no_traversal(source)?;
    validate_no_traversal(dest_dir)?;
    let src = Path::new(source);
    let dest = Path::new(dest_dir);
    let file_name = src
        .file_name()
        .ok_or("Invalid source path")?
        .to_string_lossy()
        .to_string();

    let new_path = if dest.join(&file_name).exists() {
        let stem = src
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = src
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()));
        let is_dir = src.is_dir();
        let ext_suffix = if is_dir {
            String::new()
        } else {
            ext.unwrap_or_default()
        };

        let candidate = dest.join(format!("{} - Copy{}", stem, ext_suffix));
        if !candidate.exists() {
            candidate
        } else {
            let mut n = 2u32;
            loop {
                let candidate = dest.join(format!("{} - Copy {}{}", stem, n, ext_suffix));
                if !candidate.exists() {
                    break candidate;
                }
                n += 1;
            }
        }
    } else {
        dest.join(&file_name)
    };

    if src.is_dir() {
        copy_dir_recursive(src, &new_path)?;
    } else {
        fs::copy(src, &new_path).map_err(|e| e.to_string())?;
    }

    Ok(new_path.to_string_lossy().to_string())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dest_entry = dst.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_entry)?;
        } else {
            fs::copy(entry.path(), &dest_entry).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn trash_entry(path: &str) -> Result<(), String> {
    validate_no_traversal(path)?;
    trash::delete(path).map_err(|e| e.to_string())
}

pub fn delete_entry(path: &str) -> Result<(), String> {
    validate_no_traversal(path)?;
    let p = Path::new(path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}
