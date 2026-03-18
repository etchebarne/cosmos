use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use cosmos_protocol::events::Event;
use cosmos_protocol::requests::Request;

use super::agent::RemoteAgent;
use super::connection::ConnectionType;

/// Routes requests to the appropriate backend: local cosmos-core or remote agent.
///
/// Each remote workspace has a `RemoteAgent` connection. Local workspaces use
/// cosmos-core directly. The router manages the lifecycle of agent connections.
pub struct BackendRouter {
    /// Active remote agent connections, keyed by workspace path.
    agents: Mutex<HashMap<String, Arc<RemoteAgent>>>,
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

    /// Connect to a remote workspace. Spawns a cosmos-agent process.
    /// If already connected to this workspace, skips.
    pub async fn connect(
        &self,
        workspace_path: &str,
        conn: ConnectionType,
    ) -> Result<(), String> {
        {
            let agents = self.agents.lock().await;
            if let Some(existing) = agents.get(workspace_path) {
                if existing.is_alive() {
                    return Ok(()); // Already connected
                }
            }
        }

        // Build a prefix like "wsl://distro" from the workspace path so we can
        // re-attach it to paths inside events coming from the remote agent.
        let prefix = Self::extract_prefix(workspace_path).unwrap_or_default();
        let on_event = self.on_event.clone();
        let prefixed_callback: Arc<dyn Fn(Event) + Send + Sync> = if prefix.is_empty() {
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
                    other => other,
                };
                on_event(event);
            })
        };

        let agent = RemoteAgent::spawn(conn, prefixed_callback).await?;
        self.agents
            .lock()
            .await
            .insert(workspace_path.to_string(), Arc::new(agent));
        Ok(())
    }

    /// Disconnect from a remote workspace.
    pub async fn disconnect(&self, workspace_path: &str) {
        self.agents.lock().await.remove(workspace_path);
    }

    /// Get the remote agent for a workspace, if connected.
    pub async fn get_agent(&self, workspace_path: &str) -> Option<Arc<RemoteAgent>> {
        self.agents.lock().await.get(workspace_path).cloned()
    }

    /// Send a request to a remote workspace's agent.
    pub async fn request(
        &self,
        workspace_path: &str,
        request: Request,
    ) -> Result<serde_json::Value, String> {
        let agent = self
            .get_agent(workspace_path)
            .await
            .ok_or_else(|| format!("No remote agent for workspace: {workspace_path}"))?;
        agent.request(request).await
    }

    /// Check if a workspace has an active remote connection.
    pub async fn is_remote(&self, workspace_path: &str) -> bool {
        self.agents.lock().await.contains_key(workspace_path)
    }

    /// Returns true if the path looks like a remote path (e.g. `wsl://...`).
    pub fn is_remote_path(path: &str) -> bool {
        path.starts_with("wsl://")
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
    /// Returns None for local paths.
    pub async fn resolve(&self, path: &str) -> Option<(Arc<RemoteAgent>, String)> {
        let rest = path.strip_prefix("wsl://")?;
        let slash = rest.find('/')?;
        let distro = &rest[..slash];
        let linux_path = &rest[slash..]; // includes leading /

        let mut agents = self.agents.lock().await;
        let prefix = format!("wsl://{distro}");

        // Find agent, removing dead ones
        let mut dead_key = None;
        for (key, agent) in agents.iter() {
            if key.starts_with(&prefix) {
                if agent.is_alive() {
                    return Some((agent.clone(), linux_path.to_string()));
                }
                dead_key = Some(key.clone());
                break;
            }
        }
        if let Some(key) = dead_key {
            agents.remove(&key);
        }
        None
    }

    /// Register a terminal ID as belonging to a remote agent.
    pub async fn register_remote_terminal(&self, id: String, agent: Arc<RemoteAgent>) {
        self.remote_terminals.lock().await.insert(id, agent);
    }

    /// Get the remote agent for a terminal ID, if it was spawned remotely.
    pub async fn get_remote_terminal(&self, id: &str) -> Option<Arc<RemoteAgent>> {
        self.remote_terminals.lock().await.get(id).cloned()
    }

    /// Remove a remote terminal registration.
    pub async fn remove_remote_terminal(&self, id: &str) {
        self.remote_terminals.lock().await.remove(id);
    }
}
