pub mod editor;
pub mod error;
pub mod file_tree;
pub mod git;
pub mod git_stash;
pub mod lsp;
pub mod terminal;
pub mod watcher;

use std::path::Path;

pub use error::CoreError;
pub use kosmos_protocol;

/// Validate that a path doesn't contain traversal components (`..`).
/// This prevents escaping workspace boundaries on the remote agent.
pub fn validate_no_traversal(path: &str) -> Result<(), CoreError> {
    for component in Path::new(path).components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(CoreError::PathTraversal(path.to_string()));
        }
    }
    Ok(())
}

/// Windows process creation flag to suppress console windows for background processes.
#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Trait for delivering events from core modules to the host or agent.
/// The Tauri host implements this to emit Tauri events.
/// The remote agent implements this to write JSON-RPC notifications to stdout.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: kosmos_protocol::events::Event);
}
