use std::fs;
use std::path::Path;

use kosmos_protocol::types::DirEntry;

use crate::{CoreError, validate_no_traversal};

pub fn read_dir(path: &str) -> Result<Vec<DirEntry>, CoreError> {
    validate_no_traversal(path)?;
    let entries = fs::read_dir(path)?;

    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<DirEntry> = Vec::new();

    for entry in entries {
        let entry = entry?;
        let metadata = entry.metadata()?;
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

pub fn move_file(source: &str, dest_dir: &str) -> Result<String, CoreError> {
    validate_no_traversal(source)?;
    validate_no_traversal(dest_dir)?;
    let source_path = Path::new(source);
    let dest_path = Path::new(dest_dir);

    let file_name = source_path
        .file_name()
        .ok_or_else(|| CoreError::Other("Invalid source path".into()))?;

    if source_path.parent() == Some(dest_path) {
        return Ok(source.to_string());
    }

    let new_path = dest_path.join(file_name);

    if new_path.exists() {
        return Err(CoreError::AlreadyExists(
            file_name.to_string_lossy().to_string(),
        ));
    }

    fs::rename(source_path, &new_path)?;

    Ok(new_path.to_string_lossy().to_string())
}

pub fn create_file(path: &str) -> Result<(), CoreError> {
    validate_no_traversal(path)?;
    let p = Path::new(path);
    if p.exists() {
        return Err(CoreError::AlreadyExists(
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        ));
    }
    fs::File::create(p)?;
    Ok(())
}

pub fn create_dir(path: &str) -> Result<(), CoreError> {
    validate_no_traversal(path)?;
    let p = Path::new(path);
    if p.exists() {
        return Err(CoreError::AlreadyExists(
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        ));
    }
    fs::create_dir(p)?;
    Ok(())
}

pub fn rename_entry(path: &str, new_name: &str) -> Result<String, CoreError> {
    validate_no_traversal(path)?;
    if new_name.contains("..") || new_name.contains('/') || new_name.contains('\\') {
        return Err(CoreError::Other(format!("Invalid file name: {new_name}")));
    }
    let p = Path::new(path);
    let parent = p
        .parent()
        .ok_or_else(|| CoreError::Other("No parent directory".into()))?;
    let new_path = parent.join(new_name);
    if new_path.exists() {
        return Err(CoreError::AlreadyExists(new_name.to_string()));
    }
    fs::rename(p, &new_path)?;
    Ok(new_path.to_string_lossy().to_string())
}

pub fn copy_entry(source: &str, dest_dir: &str) -> Result<String, CoreError> {
    validate_no_traversal(source)?;
    validate_no_traversal(dest_dir)?;
    let src = Path::new(source);
    let dest = Path::new(dest_dir);
    let file_name = src
        .file_name()
        .ok_or_else(|| CoreError::Other("Invalid source path".into()))?
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
        fs::copy(src, &new_path)?;
    }

    Ok(new_path.to_string_lossy().to_string())
}

/// Maximum directory nesting depth for recursive copy to prevent stack overflow.
const MAX_COPY_DEPTH: u32 = 64;

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), CoreError> {
    copy_dir_recursive_inner(src, dst, 0)
}

fn copy_dir_recursive_inner(src: &Path, dst: &Path, depth: u32) -> Result<(), CoreError> {
    if depth > MAX_COPY_DEPTH {
        return Err(CoreError::Other(format!(
            "Directory nesting too deep (>{MAX_COPY_DEPTH} levels): {}",
            src.display()
        )));
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let dest_entry = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive_inner(&entry.path(), &dest_entry, depth + 1)?;
        } else {
            fs::copy(entry.path(), &dest_entry)?;
        }
    }
    Ok(())
}

pub fn trash_entry(path: &str) -> Result<(), CoreError> {
    validate_no_traversal(path)?;
    trash::delete(path).map_err(|e| CoreError::Other(e.to_string()))
}

pub fn delete_entry(path: &str) -> Result<(), CoreError> {
    validate_no_traversal(path)?;
    let p = Path::new(path);
    if p.is_dir() {
        fs::remove_dir_all(p)?;
    } else {
        fs::remove_file(p)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_no_traversal_rejects_dotdot() {
        let result = validate_no_traversal("..");
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CoreError::PathTraversal(_)
        ));
    }

    #[test]
    fn validate_no_traversal_rejects_nested_dotdot() {
        let result = validate_no_traversal("a/../../b");
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CoreError::PathTraversal(_)
        ));
    }

    #[test]
    fn validate_no_traversal_allows_dot_safe() {
        assert!(validate_no_traversal("./safe").is_ok());
    }

    #[test]
    fn validate_no_traversal_allows_normal_paths() {
        assert!(validate_no_traversal("src/main.rs").is_ok());
        assert!(validate_no_traversal("a/b/c").is_ok());
        assert!(validate_no_traversal("file.txt").is_ok());
    }

    #[test]
    fn read_dir_with_tempdir() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();

        // Create subdirectories
        fs::create_dir(base.join("alpha_dir")).unwrap();
        fs::create_dir(base.join("beta_dir")).unwrap();
        // Create a .git directory that should be excluded
        fs::create_dir(base.join(".git")).unwrap();

        // Create files (including a hidden file)
        fs::write(base.join("zebra.txt"), "content").unwrap();
        fs::write(base.join(".hidden"), "secret").unwrap();
        fs::write(base.join("aardvark.rs"), "fn main() {}").unwrap();

        let entries = read_dir(&base.to_string_lossy()).unwrap();

        // .git should be excluded
        assert!(
            !entries.iter().any(|e| e.name == ".git"),
            ".git directory should be excluded"
        );

        // Directories come first
        let first_file_idx = entries.iter().position(|e| !e.is_dir);
        let last_dir_idx = entries.iter().rposition(|e| e.is_dir);
        if let (Some(first_file), Some(last_dir)) = (first_file_idx, last_dir_idx) {
            assert!(
                last_dir < first_file,
                "All directories should appear before files"
            );
        }

        // Verify directories are sorted case-insensitively
        let dir_names: Vec<&str> = entries
            .iter()
            .filter(|e| e.is_dir)
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(dir_names, vec!["alpha_dir", "beta_dir"]);

        // Verify files are sorted case-insensitively and hidden files are included
        let file_names: Vec<&str> = entries
            .iter()
            .filter(|e| !e.is_dir)
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(file_names, vec![".hidden", "aardvark.rs", "zebra.txt"]);

        // Total count: 2 dirs + 3 files = 5 (.git excluded)
        assert_eq!(entries.len(), 5);
    }
}
