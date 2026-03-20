use thiserror::Error;

#[derive(Error, Debug)]
pub enum CoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Git error: {message}")]
    Git { message: String },

    #[error("Path traversal not allowed: {0}")]
    PathTraversal(String),

    #[error("File too large ({size_mb:.1} MB, max {max_mb:.0} MB)")]
    FileTooLarge { size_mb: f64, max_mb: f64 },

    #[error("Entry already exists: {0}")]
    AlreadyExists(String),

    #[error("LSP error: {0}")]
    Lsp(String),

    #[error("Terminal error: {0}")]
    Terminal(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for CoreError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
