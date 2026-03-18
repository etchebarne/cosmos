use serde::{Deserialize, Serialize};

/// How a workspace connects to its backend.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectionType {
    /// Local filesystem — uses cosmos-core directly.
    Local,
    /// WSL distro — spawns cosmos-agent via `wsl.exe -d <distro>`.
    Wsl { distro: String },
    /// SSH host — spawns cosmos-agent via `ssh <host>`.
    Ssh { host: String, user: Option<String> },
}
