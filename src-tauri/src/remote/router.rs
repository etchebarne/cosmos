use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use kosmos_core::EventSink;
use kosmos_protocol::events::Event;
use kosmos_protocol::requests::Request;

use super::agent::RemoteAgent;
use super::connection::ConnectionType;

/// An agent entry in the router, storing both the agent and its connection info
/// so we can reconnect if the agent dies.
struct AgentEntry {
    agent: Arc<RemoteAgent>,
    connection: ConnectionType,
    reconnect_attempts: u32,
    last_reconnect: Option<std::time::Instant>,
}

/// An EventSink that prepends a workspace prefix to path-based events.
struct PrefixedEventSink {
    prefix: String,
    inner: Arc<dyn EventSink>,
}

impl EventSink for PrefixedEventSink {
    fn emit(&self, event: Event) {
        let event = match event {
            Event::FileTreeChanged { dirs } => Event::FileTreeChanged {
                dirs: dirs.into_iter().map(|d| format!("{}{}", self.prefix, d)).collect(),
            },
            Event::FileContentChanged { files } => Event::FileContentChanged {
                files: files.into_iter().map(|f| format!("{}{}", self.prefix, f)).collect(),
            },
            other => other,
        };
        self.inner.emit(event);
    }
}

/// Routes requests to the appropriate backend: local kosmos-core or remote agent.
///
/// Each remote workspace has a `RemoteAgent` connection. Local workspaces use
/// kosmos-core directly. The router manages the lifecycle of agent connections
/// and automatically reconnects dead agents.
pub struct BackendRouter {
    /// Active remote agent connections, keyed by workspace path.
    agents: Mutex<HashMap<String, AgentEntry>>,
    /// Maps terminal IDs to their remote agent (for routing write/resize/close).
    remote_terminals: Mutex<HashMap<String, Arc<RemoteAgent>>>,
    /// Event sink for delivering events from remote agents to the host.
    events: Arc<dyn EventSink>,
}

impl BackendRouter {
    pub fn new(events: Arc<dyn EventSink>) -> Self {
        Self {
            agents: Mutex::new(HashMap::new()),
            remote_terminals: Mutex::new(HashMap::new()),
            events,
        }
    }

    /// Build the event sink that prepends workspace prefix to path-based events.
    fn make_event_sink(&self, workspace_path: &str) -> Arc<dyn EventSink> {
        let prefix = Self::extract_prefix(workspace_path).unwrap_or_default();
        if prefix.is_empty() {
            self.events.clone()
        } else {
            Arc::new(PrefixedEventSink { prefix, inner: self.events.clone() })
        }
    }

    /// Connect to a remote workspace. Spawns a kosmos-agent process.
    /// If already connected to this workspace, skips.
    pub async fn connect(
        &self,
        workspace_path: &str,
        conn: ConnectionType,
    ) -> Result<(), String> {
        // Quick check under lock — skip if already alive.
        {
            let agents = self.agents.lock().await;
            if let Some(entry) = agents.get(workspace_path) {
                if entry.agent.is_alive() {
                    return Ok(());
                }
            }
        }

        // Spawn without holding the lock — this can take seconds for WSL startup.
        let sink = self.make_event_sink(workspace_path);
        let agent = Arc::new(RemoteAgent::spawn(conn.clone(), sink).await?);

        // Re-register existing terminals from the daemon. On first connect this
        // returns an empty list; on reconnect it returns terminals that survived
        // the connection drop, enabling seamless session resumption.
        if let Ok(val) = agent.request(Request::TerminalList).await {
            if let Ok(ids) = serde_json::from_value::<Vec<String>>(val) {
                let mut terminals = self.remote_terminals.lock().await;
                for id in ids {
                    terminals.insert(id, agent.clone());
                }
            }
        }

        // Re-acquire lock and insert.
        self.agents.lock().await.insert(
            workspace_path.to_string(),
            AgentEntry {
                agent,
                connection: conn,
                reconnect_attempts: 0,
                last_reconnect: None,
            },
        );
        Ok(())
    }

    /// Disconnect from a remote workspace. Cleans up associated terminal mappings.
    pub async fn disconnect(&self, workspace_path: &str) {
        let removed = self.agents.lock().await.remove(workspace_path);
        if removed.is_some() {
            // Clean up terminal mappings that pointed to this workspace's agent
            let mut terminals = self.remote_terminals.lock().await;
            terminals.retain(|_, agent| agent.is_alive());
        }
    }

    /// Check if a workspace has an active remote connection.
    pub async fn is_remote(&self, workspace_path: &str) -> bool {
        self.agents.lock().await.contains_key(workspace_path)
    }

    /// Returns true if the path looks like a remote path (e.g. `wsl://...` or `ssh://...`).
    pub fn is_remote_path(path: &str) -> bool {
        path.starts_with("wsl://") || path.starts_with("ssh://")
    }

    /// Extract the remote prefix (e.g. `wsl://distro`) from a workspace path.
    fn extract_prefix(path: &str) -> Option<String> {
        let rest = path.strip_prefix("wsl://")?;
        let slash = rest.find('/')?;
        Some(format!("wsl://{}", &rest[..slash]))
    }

    /// Resolve a path that may be remote.
    /// If the path starts with `wsl://distro/...`, finds the agent for that
    /// distro and returns `(agent, linux_path)`.
    /// If the agent is dead, attempts automatic reconnection.
    /// Returns None for local paths.
    pub async fn resolve(&self, path: &str) -> Option<(Arc<RemoteAgent>, String)> {
        let rest = path.strip_prefix("wsl://")?;
        let slash = rest.find('/')?;
        let distro = &rest[..slash];
        let linux_path = &rest[slash..]; // includes leading /

        let prefix = format!("wsl://{distro}");

        // First pass: check if agent is alive and read backoff info in one lock.
        let reconnect_info = {
            let agents = self.agents.lock().await;
            let mut found = None;
            for (key, entry) in agents.iter() {
                if key.starts_with(&prefix) {
                    if entry.agent.is_alive() {
                        return Some((entry.agent.clone(), linux_path.to_string()));
                    }
                    // Agent is dead — check backoff before attempting reconnect
                    let backoff_secs = std::cmp::min(1u64 << entry.reconnect_attempts, 60);
                    let should_skip = entry
                        .last_reconnect
                        .map(|t| t.elapsed().as_secs() < backoff_secs)
                        .unwrap_or(false);
                    if !should_skip {
                        found = Some((key.clone(), entry.connection.clone()));
                    }
                    break;
                }
            }
            found
        };

        // Agent is dead — attempt transparent reconnection.
        if let Some((workspace_key, conn)) = reconnect_info {

            tracing::warn!(workspace = %workspace_key, "Agent dead, reconnecting...");
            match self.connect(&workspace_key, conn).await {
                Ok(()) => {
                    tracing::info!(workspace = %workspace_key, "Reconnected");
                    // Reset backoff and return the new agent in one lock.
                    let mut agents = self.agents.lock().await;
                    if let Some(entry) = agents.get_mut(&workspace_key) {
                        entry.reconnect_attempts = 0;
                        entry.last_reconnect = None;
                        if entry.agent.is_alive() {
                            return Some((entry.agent.clone(), linux_path.to_string()));
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(workspace = %workspace_key, "Reconnection failed: {e}");
                    // Increment backoff counter
                    let mut agents = self.agents.lock().await;
                    if let Some(entry) = agents.get_mut(&workspace_key) {
                        entry.reconnect_attempts = entry.reconnect_attempts.saturating_add(1);
                        entry.last_reconnect = Some(std::time::Instant::now());
                    } else {
                        agents.remove(&workspace_key);
                    }
                }
            }
        }

        None
    }

    /// Register a terminal ID as belonging to a remote agent.
    pub async fn register_remote_terminal(&self, id: String, agent: Arc<RemoteAgent>) {
        self.remote_terminals.lock().await.insert(id, agent);
    }

    /// Get the remote agent for a terminal ID, if it was spawned remotely.
    /// Returns None and cleans up if the agent is dead.
    pub async fn get_remote_terminal(&self, id: &str) -> Option<Arc<RemoteAgent>> {
        let mut terminals = self.remote_terminals.lock().await;
        if let Some(agent) = terminals.get(id) {
            if agent.is_alive() {
                return Some(agent.clone());
            }
            // Agent is dead — clean up this mapping
            terminals.remove(id);
        }
        None
    }

    /// Remove a remote terminal registration.
    pub async fn remove_remote_terminal(&self, id: &str) {
        self.remote_terminals.lock().await.remove(id);
    }
}
