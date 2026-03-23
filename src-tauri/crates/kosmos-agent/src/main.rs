use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use kosmos_core::EventSink;
use kosmos_protocol::events::Event;
use kosmos_protocol::framing;
use kosmos_protocol::requests::{Request, RequestMessage, ResponseMessage};
use kosmos_protocol::ToStringErr;
use tokio::sync::broadcast;

struct AgentState {
    watcher: kosmos_core::watcher::WatcherManager,
    terminals: kosmos_core::terminal::TerminalManager,
    lsp: kosmos_core::lsp::LspManager,
}

// ── Helpers ──

fn agent_data_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".kosmos-agent")
}

/// If `node` isn't available but an alternative JS runtime (bun) is,
/// create a symlink so npm-installed scripts with `#!/usr/bin/env node` work.
fn ensure_node_runtime(data_dir: &Path) {
    if which::which("node").is_ok() {
        return;
    }

    let alt = which::which("bun");
    if let Ok(runtime_path) = alt {
        let bin_dir = data_dir.join("bin");
        std::fs::create_dir_all(&bin_dir).ok();
        let node_shim = bin_dir.join("node");
        if !node_shim.exists() {
            #[cfg(unix)]
            {
                let _: Result<(), _> = std::os::unix::fs::symlink(&runtime_path, &node_shim);
            }
            #[cfg(not(unix))]
            {
                let _ = std::fs::copy(&runtime_path, &node_shim);
            }
        }
        if let Ok(path) = std::env::var("PATH") {
            std::env::set_var("PATH", format!("{}:{}", bin_dir.display(), path));
        }
    }
}

fn to_json(val: impl serde::Serialize) -> Result<serde_json::Value, String> {
    serde_json::to_value(val).map_err(|e| format!("Serialization error: {e}"))
}

use kosmos_protocol::framing::{async_read_message, async_write_message};

// ── Request dispatcher (shared between daemon and inline modes) ──

async fn dispatch(state: &AgentState, request: Request) -> Result<serde_json::Value, String> {
    match request {
        // ── File tree ──
        Request::ReadDir { path } => {
            let r = kosmos_core::file_tree::read_dir(&path).str_err()?;
            Ok(to_json(r)?)
        }
        Request::MoveFile { source, dest_dir } => {
            let r = kosmos_core::file_tree::move_file(&source, &dest_dir).str_err()?;
            Ok(to_json(r)?)
        }
        Request::CreateFile { path } => {
            kosmos_core::file_tree::create_file(&path).str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::CreateDir { path } => {
            kosmos_core::file_tree::create_dir(&path).str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::RenameEntry { path, new_name } => {
            let r = kosmos_core::file_tree::rename_entry(&path, &new_name).str_err()?;
            Ok(to_json(r)?)
        }
        Request::CopyEntry { source, dest_dir } => {
            let r = kosmos_core::file_tree::copy_entry(&source, &dest_dir).str_err()?;
            Ok(to_json(r)?)
        }
        Request::TrashEntry { path } => {
            kosmos_core::file_tree::trash_entry(&path).str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::DeleteEntry { path } => {
            kosmos_core::file_tree::delete_entry(&path).str_err()?;
            Ok(serde_json::Value::Null)
        }

        // ── Editor ──
        Request::ReadFile { path } => {
            let r = kosmos_core::editor::read_file(&path).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::WriteFile { path, content } => {
            kosmos_core::editor::write_file(&path, &content).await.str_err()?;
            Ok(serde_json::Value::Null)
        }

        // ── Git ──
        Request::GetGitBranch { path } => {
            let r = kosmos_core::git::get_git_branch(&path).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GetGitRemoteOwner { path } => {
            let r = kosmos_core::git::get_git_remote_owner(&path).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GetGitStatus { path } => {
            let r = kosmos_core::git::get_git_status(&path).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GitStage { path, files } => {
            kosmos_core::git::git_stage(&path, files).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitUnstage { path, files } => {
            kosmos_core::git::git_unstage(&path, files).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStageAll { path } => {
            kosmos_core::git::git_stage_all(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitCommit { path, message } => {
            kosmos_core::git::git_commit(&path, &message).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitListBranches { path } => {
            let r = kosmos_core::git::git_list_branches(&path).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GitCheckout { path, branch } => {
            kosmos_core::git::git_checkout(&path, &branch).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDeleteBranch { path, branch } => {
            kosmos_core::git::git_delete_branch(&path, &branch).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDiscard { path, files } => {
            kosmos_core::git::git_discard(&path, files).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitTrashUntracked { path, files } => {
            kosmos_core::git::git_trash_untracked(&path, files).str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashAll { path } => {
            kosmos_core::git::git_stash_all(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashFiles { path, files } => {
            kosmos_core::git::git_stash_files(&path, files).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashList { path } => {
            let r = kosmos_core::git::git_stash_list(&path).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GitStashShow { path, index } => {
            let r = kosmos_core::git::git_stash_show(&path, index).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GitStashPop { path, index } => {
            kosmos_core::git::git_stash_pop(&path, index).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashDrop { path, index } => {
            kosmos_core::git::git_stash_drop(&path, index).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDiscardAllTracked { path } => {
            kosmos_core::git::git_discard_all_tracked(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitTrashAllUntracked { path } => {
            kosmos_core::git::git_trash_all_untracked(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDiff { path, file } => {
            let r = kosmos_core::git::git_diff(&path, &file).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GitDiffUntracked { path, file } => {
            let r = kosmos_core::git::git_diff_untracked(&path, &file).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::GitInit { path } => {
            kosmos_core::git::git_init(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitFetch { path } => {
            kosmos_core::git::git_fetch(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitPull { path } => {
            kosmos_core::git::git_pull(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitPullRebase { path } => {
            kosmos_core::git::git_pull_rebase(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitPush { path } => {
            kosmos_core::git::git_push(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::GitForcePush { path } => {
            kosmos_core::git::git_force_push(&path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }

        // ── Watcher ──
        Request::WatchWorkspace { path } => {
            state.watcher.watch(&path).str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::UnwatchWorkspace => {
            state.watcher.unwatch().str_err()?;
            Ok(serde_json::Value::Null)
        }

        // ── Terminal ──
        Request::TerminalListShells => {
            let r = kosmos_core::terminal::list_shells();
            Ok(to_json(r)?)
        }
        Request::TerminalList => {
            let ids = state.terminals.list();
            Ok(to_json(ids)?)
        }
        Request::TerminalSpawn {
            id,
            program,
            args,
            cwd,
            cols,
            rows,
        } => {
            state
                .terminals
                .spawn(id, &program, &args, &cwd, cols, rows)
                .str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::TerminalWrite { id, data } => {
            state.terminals.write(&id, &data).str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::TerminalResize { id, cols, rows } => {
            state.terminals.resize(&id, cols, rows).str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::TerminalClose { id } => {
            state.terminals.close(&id).str_err()?;
            Ok(serde_json::Value::Null)
        }

        // ── LSP ──
        Request::LspStart {
            workspace_path,
            language_id,
        } => {
            let r = state.lsp.start(&workspace_path, &language_id).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::LspSend { server_id, message } => {
            state.lsp.send(&server_id, &message).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::LspStop { server_id } => {
            state.lsp.stop(&server_id).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::LspStopWorkspace { workspace_path } => {
            state.lsp.stop_workspace(&workspace_path).await.str_err()?;
            Ok(serde_json::Value::Null)
        }
        Request::LspCheckAvailability { workspace_path } => {
            let r = state.lsp.check_availability(&workspace_path);
            Ok(to_json(r)?)
        }
        Request::LspScanProjects { workspace_path } => {
            let r = state.lsp.scan_projects(&workspace_path);
            Ok(to_json(r)?)
        }
        Request::LspResolveRoot {
            file_path,
            language_id,
            workspace_path,
        } => {
            let r = kosmos_core::lsp::LspManager::resolve_root(
                &file_path,
                &language_id,
                &workspace_path,
            );
            Ok(to_json(r)?)
        }
        Request::LspLanguageGroups => {
            let r = kosmos_core::lsp::LspManager::language_groups();
            Ok(to_json(r)?)
        }
        Request::LspInstalledList => {
            let r = state.lsp.installed_list();
            Ok(to_json(r)?)
        }
        Request::LspInstallServer { name } => {
            let r = state.lsp.install_server(&name).await.str_err()?;
            Ok(to_json(r)?)
        }
        Request::LspUninstallServer { name } => {
            state.lsp.uninstall_server(&name).str_err()?;
            Ok(serde_json::Value::Null)
        }

        // ── Keepalive ──
        Request::Ping => Ok(serde_json::Value::Null),
    }
}

/// Run dispatch on the blocking thread pool and convert the result to a ResponseMessage.
async fn run_dispatch(state: Arc<AgentState>, id: u64, request: Request) -> ResponseMessage {
    let handle = tokio::runtime::Handle::current();
    match tokio::task::spawn_blocking(move || handle.block_on(dispatch(&state, request))).await {
        Ok(Ok(result)) => ResponseMessage::ok(id, result),
        Ok(Err(error)) => ResponseMessage::err(id, error),
        Err(e) => ResponseMessage::err(id, format!("Task panicked: {e}")),
    }
}


// ═══════════════════════════════════════════════════════════════
//  DAEMON MODE
//  Runs as a background process, listens on a Unix domain socket.
//  Terminals and other state survive client disconnections.
// ═══════════════════════════════════════════════════════════════

/// Event sink that broadcasts JSON-serialized events to all connected clients
/// via a tokio broadcast channel. Called from background threads (terminal
/// reader, file watcher), so it must be non-blocking.
struct BroadcastEventSink {
    tx: broadcast::Sender<String>,
}

impl EventSink for BroadcastEventSink {
    fn emit(&self, event: Event) {
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = self.tx.send(json);
        }
    }
}

/// Handle a single client connection on the daemon's Unix socket.
/// Reads requests, dispatches them, and forwards broadcast events.
async fn handle_client(
    stream: tokio::net::UnixStream,
    state: Arc<AgentState>,
    event_tx: broadcast::Sender<String>,
) {
    let (read_half, write_half) = stream.into_split();
    let write = Arc::new(tokio::sync::Mutex::new(write_half));

    // Forward broadcast events to this client's socket
    let mut event_rx = event_tx.subscribe();
    let write_for_events = write.clone();
    let event_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(json) => {
                    let mut w = write_for_events.lock().await;
                    if async_write_message(&mut *w, &json).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Read requests from this client
    let mut reader = tokio::io::BufReader::new(read_half);
    loop {
        let msg = match async_read_message(&mut reader).await {
            Ok(m) => m,
            Err(_) => break, // Client disconnected
        };

        let req_msg: RequestMessage = match serde_json::from_str(&msg) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Parse error: {e}");
                continue;
            }
        };

        let state = state.clone();
        let write = write.clone();
        tokio::spawn(async move {
            let response = run_dispatch(state, req_msg.id, req_msg.request).await;
            if let Ok(json) = serde_json::to_string(&response) {
                let mut w = write.lock().await;
                let _ = async_write_message(&mut *w, &json).await;
            }
        });
    }

    event_task.abort();
    tracing::info!("Client disconnected");
}

async fn daemon_main() {
    // Detach from the controlling terminal so the daemon survives when
    // the SSH/WSL session ends.
    #[cfg(unix)]
    unsafe {
        libc::setsid();
    }

    let data_dir = agent_data_dir();
    let sock_path = data_dir.join("agent.sock");

    // Remove stale socket from a previous daemon
    let _ = std::fs::remove_file(&sock_path);

    // Bind the socket FIRST so the relay client can connect immediately
    // while we finish the heavier initialization below. Connections queue
    // in the kernel until we call accept().
    let listener = match tokio::net::UnixListener::bind(&sock_path) {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("Failed to bind socket: {e}");
            return;
        }
    };

    // Now do the heavier setup — relay is already able to connect.
    ensure_node_runtime(&data_dir);
    let servers_dir = data_dir.join("servers");
    std::fs::create_dir_all(&servers_dir).ok();

    let (event_tx, _) = broadcast::channel::<String>(8192);

    let events: Arc<dyn EventSink> = Arc::new(BroadcastEventSink {
        tx: event_tx.clone(),
    });

    let state = Arc::new(AgentState {
        watcher: kosmos_core::watcher::WatcherManager::new(events.clone()),
        terminals: kosmos_core::terminal::TerminalManager::new(events.clone()),
        lsp: kosmos_core::lsp::LspManager::new(events, servers_dir, None),
    });

    tracing::info!("Listening on {}", sock_path.display());

    // Clean up socket on exit
    struct SocketCleanup(PathBuf);
    impl Drop for SocketCleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _guard = SocketCleanup(sock_path.clone());

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tracing::info!("Client connected");
                let state = state.clone();
                let event_tx = event_tx.clone();
                tokio::spawn(async move {
                    handle_client(stream, state, event_tx).await;
                });
            }
            Err(e) => {
                tracing::warn!("Accept error: {e}");
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  CLIENT / RELAY MODE (default)
//  Ensures the daemon is running, then relays stdin/stdout ↔ UDS.
//  Dies when the SSH/WSL connection drops — daemon survives.
// ═══════════════════════════════════════════════════════════════

fn is_daemon_running(sock_path: &Path) -> bool {
    std::os::unix::net::UnixStream::connect(sock_path).is_ok()
}

fn ensure_daemon(data_dir: &Path) {
    let sock_path = data_dir.join("agent.sock");
    if is_daemon_running(&sock_path) {
        return;
    }

    // Remove stale socket
    let _ = std::fs::remove_file(&sock_path);

    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(e) => {
            tracing::error!("Failed to get current exe: {e}");
            std::process::exit(1);
        }
    };

    // Open a log file for the daemon's stderr
    let log_path = data_dir.join("daemon.log");
    let stderr_target = std::fs::File::create(&log_path)
        .map(std::process::Stdio::from)
        .unwrap_or_else(|_| std::process::Stdio::null());

    if let Err(e) = std::process::Command::new(exe)
        .arg("--daemon")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(stderr_target)
        .spawn()
    {
        tracing::error!("Failed to start daemon: {e}");
        std::process::exit(1);
    }

    // Wait for the daemon socket to appear. Use fast polling initially
    // (the socket binds early in daemon startup), then back off.
    for i in 0..100 {
        let delay = if i < 20 { 10 } else { 50 };
        std::thread::sleep(std::time::Duration::from_millis(delay));
        if is_daemon_running(&sock_path) {
            return;
        }
    }

    tracing::error!("Daemon did not start within 5s");
    std::process::exit(1);
}

async fn client_main() {
    let data_dir = agent_data_dir();
    std::fs::create_dir_all(&data_dir).ok();
    ensure_daemon(&data_dir);

    let sock_path = data_dir.join("agent.sock");
    let stream = match tokio::net::UnixStream::connect(&sock_path).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to connect to daemon: {e}");
            std::process::exit(1);
        }
    };

    let (mut sock_read, mut sock_write) = stream.into_split();

    // stdin → daemon socket
    let write_task = tokio::spawn(async move {
        let mut stdin = tokio::io::stdin();
        let _ = tokio::io::copy(&mut stdin, &mut sock_write).await;
    });

    // daemon socket → stdout
    let read_task = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        let _ = tokio::io::copy(&mut sock_read, &mut stdout).await;
    });

    // Exit when either direction closes (SSH died or daemon closed socket)
    tokio::select! {
        _ = write_task => {},
        _ = read_task => {},
    }
}

// ── Inline mode (no daemon, for backwards compat / non-Unix) ──

#[cfg(not(unix))]
async fn inline_main() {
    use std::io::Stdout;
    use std::sync::Mutex;

    struct StdoutEventSink {
        writer: Arc<Mutex<Stdout>>,
    }

    impl EventSink for StdoutEventSink {
        fn emit(&self, event: Event) {
            if let Ok(json) = serde_json::to_string(&event) {
                if let Ok(mut w) = self.writer.lock() {
                    let _ = framing::write_message(&mut *w, &json);
                }
            }
        }
    }

    fn send_response(writer: &Arc<Mutex<Stdout>>, response: &ResponseMessage) {
        if let Ok(json) = serde_json::to_string(response) {
            if let Ok(mut w) = writer.lock() {
                let _ = framing::write_message(&mut *w, &json);
            }
        }
    }

    let data_dir = agent_data_dir();
    ensure_node_runtime(&data_dir);
    let servers_dir = data_dir.join("servers");
    std::fs::create_dir_all(&servers_dir).ok();

    let stdout_writer: Arc<Mutex<Stdout>> = Arc::new(Mutex::new(io::stdout()));

    let events: Arc<dyn EventSink> = Arc::new(StdoutEventSink {
        writer: stdout_writer.clone(),
    });

    let state = Arc::new(AgentState {
        watcher: kosmos_core::watcher::WatcherManager::new(events.clone()),
        terminals: kosmos_core::terminal::TerminalManager::new(events.clone()),
        lsp: kosmos_core::lsp::LspManager::new(events, servers_dir, None),
    });

    let writer = stdout_writer.clone();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(u64, Request)>();

    tokio::task::spawn_blocking(move || {
        let stdin = io::stdin();
        let mut reader = stdin.lock();
        loop {
            let msg = match framing::read_message(&mut reader) {
                Ok(msg) => msg,
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(e) => {
                    tracing::warn!("Read error: {e}");
                    break;
                }
            };
            let req_msg: RequestMessage = match serde_json::from_str(&msg) {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!("Parse error: {e}");
                    continue;
                }
            };
            if tx.send((req_msg.id, req_msg.request)).is_err() {
                break;
            }
        }
    });

    while let Some((id, request)) = rx.recv().await {
        let state = state.clone();
        let writer = writer.clone();
        tokio::spawn(async move {
            let response = run_dispatch(state, id, request).await;
            send_response(&writer, &response);
        });
    }
}

// ── Entry point ──

#[tokio::main]
async fn main() {
    if std::env::args().any(|a| a == "--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }

    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new("kosmos_agent=info,kosmos_core=info,warn")
    });
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .init();

    #[cfg(unix)]
    {
        if std::env::args().any(|a| a == "--daemon") {
            daemon_main().await;
        } else {
            client_main().await;
        }
    }

    #[cfg(not(unix))]
    {
        inline_main().await;
    }
}
