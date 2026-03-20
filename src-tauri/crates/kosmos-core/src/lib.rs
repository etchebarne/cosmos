pub mod editor;
pub mod file_tree;
pub mod git;
pub mod lsp;
pub mod terminal;
pub mod watcher;

pub use kosmos_protocol;

/// Trait for delivering events from core modules to the host or agent.
/// The Tauri host implements this to emit Tauri events.
/// The remote agent implements this to write JSON-RPC notifications to stdout.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: kosmos_protocol::events::Event);
}
