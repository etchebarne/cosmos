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

pub fn read_file(path: &str) -> Result<String, String> {
    validate_no_traversal(path)?;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    validate_no_traversal(path)?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}
