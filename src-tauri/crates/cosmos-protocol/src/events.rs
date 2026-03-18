use serde::{Deserialize, Serialize};

/// Events pushed from the remote agent to the host as notifications.
///
/// Wire format:
/// ```json
/// { "event": "GitChanged" }
/// { "event": "TerminalData", "id": "term-1", "data": "hello" }
/// ```
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "event")]
pub enum Event {
    GitChanged,
    FileTreeChanged {
        dirs: Vec<String>,
    },
    FileContentChanged {
        files: Vec<String>,
    },
    TerminalData {
        id: String,
        data: String,
    },
    TerminalExit {
        id: String,
    },
    LspMessage {
        server_id: String,
        message: String,
    },
    LspStopped {
        server_id: String,
        error: Option<String>,
    },
}
