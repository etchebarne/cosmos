use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use cosmos_protocol::events::Event;
use cosmos_protocol::requests::Request;

use super::agent::RemoteAgent;
use super::connection::ConnectionType;

/// An agent entry in the router, storing both the agent and its connection info
/// so we can reconnect if the agent dies.
struct AgentEntry {
    agent: Arc<RemoteAgent>,
    connection: ConnectionType,
}

/// Routes requests to the appropriate backend: local cosmos-core or remote agent.
///
/// Each remote workspace has a `RemoteAgent` connection. Local workspaces use
/// cosmos-core directly. The router manages the lifecycle of agent connections
/// and automatically reconnects dead agents.
pub struct BackendRouter {
    /// Active remote agent connections, keyed by workspace path.
    agents: Mutex<HashMap<String, AgentEntry>>,
    /// Maps terminal IDs to their remote agent (for routing write/resize/close).
    remote_terminals: Mutex<HashMap<String, Arc<RemoteAgent>>>,
    /// Callback for delivering events from remote agents to the host.
    on_event: Arc<dyn Fn(Event) + Send + Sync>,
}

impl BackendRouter {
    pub fn new(on_event: Arc<dyn Fn(Event) + Send + Sync>) -> Self {
        Self {
            agents: Mutex::new(HashMap::new()),
            remote_terminals: Mutex::new(HashMap::new()),
            on_event,
        }
    }

    /// Build the event callback that prepends workspace prefix to path-based events.
    fn make_event_callback(
        &self,
        workspace_path: &str,
    ) -> Arc<dyn Fn(Event) + Send + Sync> {
        let prefix = Self::extract_prefix(workspace_path).unwrap_or_default();
        let on_event = self.on_event.clone();
        if prefix.is_empty() {
            on_event
        } else {
            Arc::new(move |event| {
                let event = match event {
                    Event::FileTreeChanged { dirs } => Event::FileTreeChanged {
                        dirs: dirs
                            .into_iter()
                            .map(|d| format!("{}{}", prefix, d))
                            .collect(),
                    },
                    Event::FileContentChanged { files } => Event::FileContentChanged {
                        files: files
                            .into_iter()
                            .map(|f| format!("{}{}", prefix, f))
                            .collect(),
                    },
                    // Terminal and LSP events don't carry paths — they use IDs
                    // that are already routed via remote_terminals / RemoteServerMap.
                    other => other,
                };
                on_event(event);
            })
        }
    }

    /// Connect to a remote workspace. Spawns a cosmos-agent process.
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
        let callback = self.make_event_callback(workspace_path);
        let agent = Arc::new(RemoteAgent::spawn(conn.clone(), callback).await?);

        // Re-register existing terminals from the daemon. On first connect this
        // returns an empty list; on reconnect it returns terminals that survived
        // the connection drop, enabling seamless session resumption.
        if let Ok(val) = agent.request(Request::TerminalList).await {
            if let Ok(ids) = serde_json::from_value::<Vec<String>>(val) {
                let mut terminals = self.remote_terminals.lock().await;
                for id in ids {
                    agent.register_terminal(id.clone()).await;
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

        // First pass: check if agent is alive.
        let reconnect_info = {
            let agents = self.agents.lock().await;
            let mut found = None;
            for (key, entry) in agents.iter() {
                if key.starts_with(&prefix) {
                    if entry.agent.is_alive() {
                        return Some((entry.agent.clone(), linux_path.to_string()));
                    }
                    // Agent is dead — grab info for reconnection
                    found = Some((key.clone(), entry.connection.clone()));
                    break;
                }
            }
            found
        };

        // Agent is dead — attempt transparent reconnection.
        if let Some((workspace_key, conn)) = reconnect_info {
            eprintln!("[cosmos-remote] Agent dead for {workspace_key}, attempting reconnection...");
            match self.connect(&workspace_key, conn).await {
                Ok(()) => {
                    eprintln!("[cosmos-remote] Reconnected to {workspace_key}");
                    // Retry lookup with the new agent.
                    let agents = self.agents.lock().await;
                    if let Some(entry) = agents.get(&workspace_key) {
                        if entry.agent.is_alive() {
                            return Some((entry.agent.clone(), linux_path.to_string()));
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[cosmos-remote] Reconnection failed for {workspace_key}: {e}");
                    // Remove the dead entry so is_remote_path check triggers the right error
                    self.agents.lock().await.remove(&workspace_key);
                }
            }
        }

        None
    }

    /// Register a terminal ID as belonging to a remote agent.
    pub async fn register_remote_terminal(&self, id: String, agent: Arc<RemoteAgent>) {
        agent.register_terminal(id.clone()).await;
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
        if let Some(agent) = self.remote_terminals.lock().await.remove(id) {
            agent.unregister_terminal(id).await;
        }
    }
}
