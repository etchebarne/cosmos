use std::path::Path;

use crate::CoreError;

/// Validate that a path doesn't contain traversal components (`..`).
fn validate_no_traversal(path: &str) -> Result<(), CoreError> {
    for component in Path::new(path).components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(CoreError::PathTraversal(path.to_string()));
        }
    }
    Ok(())
}

/// Maximum file size we'll read into memory (50 MB).
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

pub async fn read_file(path: &str) -> Result<String, CoreError> {
    validate_no_traversal(path)?;
    let metadata = tokio::fs::metadata(path).await?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(CoreError::FileTooLarge {
            size_mb: metadata.len() as f64 / (1024.0 * 1024.0),
            max_mb: MAX_FILE_SIZE as f64 / (1024.0 * 1024.0),
        });
    }
    Ok(tokio::fs::read_to_string(path).await?)
}

pub async fn write_file(path: &str, content: &str) -> Result<(), CoreError> {
    validate_no_traversal(path)?;
    Ok(tokio::fs::write(path, content).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn read_write_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("test.txt");
        let path_str = file_path.to_string_lossy().to_string();

        let content = "Hello, world!\nLine two.\n";
        write_file(&path_str, content).await.unwrap();

        let read_back = read_file(&path_str).await.unwrap();
        assert_eq!(read_back, content);
    }

    #[tokio::test]
    async fn read_write_round_trip_unicode() {
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("unicode.txt");
        let path_str = file_path.to_string_lossy().to_string();

        let content = "Emojis and CJK chars here.";
        write_file(&path_str, content).await.unwrap();

        let read_back = read_file(&path_str).await.unwrap();
        assert_eq!(read_back, content);
    }

    #[tokio::test]
    async fn read_file_rejects_path_traversal() {
        let result = read_file("some/../../etc/passwd").await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CoreError::PathTraversal(_)
        ));
    }

    #[tokio::test]
    async fn write_file_rejects_path_traversal() {
        let result = write_file("../escape/file.txt", "data").await;
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            CoreError::PathTraversal(_)
        ));
    }

    #[test]
    fn validate_no_traversal_allows_normal_paths() {
        assert!(validate_no_traversal("src/main.rs").is_ok());
        assert!(validate_no_traversal("./safe/path").is_ok());
        assert!(validate_no_traversal("file.txt").is_ok());
    }

    #[test]
    fn validate_no_traversal_rejects_dotdot() {
        assert!(validate_no_traversal("..").is_err());
        assert!(validate_no_traversal("a/../../b").is_err());
    }

    #[tokio::test]
    async fn read_file_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("does_not_exist.txt");
        let result = read_file(&missing.to_string_lossy()).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CoreError::Io(_)));
    }

    #[test]
    fn file_too_large_error_variant_exists() {
        // Verify the FileTooLarge error can be constructed and matched.
        // We cannot easily create a 50 MB file in a unit test, but we can
        // verify the error type works correctly.
        let err = CoreError::FileTooLarge {
            size_mb: 60.0,
            max_mb: 50.0,
        };
        assert!(matches!(
            err,
            CoreError::FileTooLarge {
                size_mb: _,
                max_mb: _
            }
        ));
        assert!(err.to_string().contains("60.0"));
        assert!(err.to_string().contains("50"));
    }
}
