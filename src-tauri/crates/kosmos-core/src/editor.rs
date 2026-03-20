use std::path::Path;

/// Validate that a path doesn't contain traversal components (`..`).
fn validate_no_traversal(path: &str) -> Result<(), String> {
    for component in Path::new(path).components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(format!("Path traversal not allowed: {path}"));
        }
    }
    Ok(())
}

/// Maximum file size we'll read into memory (50 MB).
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

pub fn read_file(path: &str) -> Result<String, String> {
    validate_no_traversal(path)?;
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File is too large ({:.1} MB). Maximum supported size is {:.0} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_FILE_SIZE as f64 / (1024.0 * 1024.0),
        ));
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    validate_no_traversal(path)?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}
