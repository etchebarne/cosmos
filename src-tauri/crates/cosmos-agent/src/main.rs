use std::io::{self, Stdout};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use cosmos_core::EventSink;
use cosmos_protocol::events::Event;
use cosmos_protocol::framing;
use cosmos_protocol::requests::{Request, RequestMessage, ResponseMessage};

/// Shared stdout writer — used by both the event sink and the main request loop
/// to prevent interleaved writes that would corrupt Content-Length framing.
type SharedWriter = Arc<Mutex<Stdout>>;

/// Event sink that writes Content-Length framed JSON notifications to stdout.
struct StdoutEventSink {
    writer: SharedWriter,
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

struct AgentState {
    watcher: cosmos_core::watcher::WatcherManager,
    terminals: cosmos_core::terminal::TerminalManager,
    lsp: cosmos_core::lsp::LspManager,
}

fn agent_data_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".cosmos-agent")
}

/// If `node` isn't available but an alternative JS runtime (bun) is,
/// create a symlink so npm-installed scripts with `#!/usr/bin/env node` work.
fn ensure_node_runtime(data_dir: &std::path::Path) {
    if which::which("node").is_ok() {
        return;
    }

    // Check for alternative runtimes
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
        // Prepend to PATH
        if let Ok(path) = std::env::var("PATH") {
            std::env::set_var("PATH", format!("{}:{}", bin_dir.display(), path));
        }
    }
}

/// Write a response to the shared stdout writer.
fn send_response(writer: &SharedWriter, response: &ResponseMessage) {
    let json = match serde_json::to_string(response) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("[cosmos-agent] failed to serialize response: {e}");
            return;
        }
    };
    if let Ok(mut w) = writer.lock() {
        let _ = framing::write_message(&mut *w, &json);
    }
}

/// Serialize a value to JSON, converting errors to strings.
fn to_json(val: impl serde::Serialize) -> Result<serde_json::Value, String> {
    serde_json::to_value(val).map_err(|e| format!("Serialization error: {e}"))
}

/// Dispatch a request to the appropriate handler and return the JSON result.
async fn dispatch(state: &AgentState, request: Request) -> Result<serde_json::Value, String> {
    match request {
        // ── File tree ──
        Request::ReadDir { path } => {
            let r = cosmos_core::file_tree::read_dir(&path)?;
            Ok(to_json(r)?)
        }
        Request::MoveFile { source, dest_dir } => {
            let r = cosmos_core::file_tree::move_file(&source, &dest_dir)?;
            Ok(to_json(r)?)
        }
        Request::CreateFile { path } => {
            cosmos_core::file_tree::create_file(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::CreateDir { path } => {
            cosmos_core::file_tree::create_dir(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::RenameEntry { path, new_name } => {
            let r = cosmos_core::file_tree::rename_entry(&path, &new_name)?;
            Ok(to_json(r)?)
        }
        Request::CopyEntry { source, dest_dir } => {
            let r = cosmos_core::file_tree::copy_entry(&source, &dest_dir)?;
            Ok(to_json(r)?)
        }
        Request::TrashEntry { path } => {
            cosmos_core::file_tree::trash_entry(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::DeleteEntry { path } => {
            cosmos_core::file_tree::delete_entry(&path)?;
            Ok(serde_json::Value::Null)
        }

        // ── Editor ──
        Request::ReadFile { path } => {
            let r = cosmos_core::editor::read_file(&path)?;
            Ok(to_json(r)?)
        }
        Request::WriteFile { path, content } => {
            cosmos_core::editor::write_file(&path, &content)?;
            Ok(serde_json::Value::Null)
        }

        // ── Git ──
        Request::GetGitBranch { path } => {
            let r = cosmos_core::git::get_git_branch(&path)?;
            Ok(to_json(r)?)
        }
        Request::GetGitStatus { path } => {
            let r = cosmos_core::git::get_git_status(&path)?;
            Ok(to_json(r)?)
        }
        Request::GitStage { path, files } => {
            cosmos_core::git::git_stage(&path, files)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitUnstage { path, files } => {
            cosmos_core::git::git_unstage(&path, files)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStageAll { path } => {
            cosmos_core::git::git_stage_all(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitCommit { path, message } => {
            cosmos_core::git::git_commit(&path, &message)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitListBranches { path } => {
            let r = cosmos_core::git::git_list_branches(&path)?;
            Ok(to_json(r)?)
        }
        Request::GitCheckout { path, branch } => {
            cosmos_core::git::git_checkout(&path, &branch)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDeleteBranch { path, branch } => {
            cosmos_core::git::git_delete_branch(&path, &branch)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDiscard { path, files } => {
            cosmos_core::git::git_discard(&path, files)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitTrashUntracked { path, files } => {
            cosmos_core::git::git_trash_untracked(&path, files)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashAll { path } => {
            cosmos_core::git::git_stash_all(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashFiles { path, files } => {
            cosmos_core::git::git_stash_files(&path, files)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashList { path } => {
            let r = cosmos_core::git::git_stash_list(&path)?;
            Ok(to_json(r)?)
        }
        Request::GitStashShow { path, index } => {
            let r = cosmos_core::git::git_stash_show(&path, index)?;
            Ok(to_json(r)?)
        }
        Request::GitStashPop { path, index } => {
            cosmos_core::git::git_stash_pop(&path, index)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitStashDrop { path, index } => {
            cosmos_core::git::git_stash_drop(&path, index)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDiscardAllTracked { path } => {
            cosmos_core::git::git_discard_all_tracked(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitTrashAllUntracked { path } => {
            cosmos_core::git::git_trash_all_untracked(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitDiff { path, file } => {
            let r = cosmos_core::git::git_diff(&path, &file)?;
            Ok(to_json(r)?)
        }
        Request::GitDiffUntracked { path, file } => {
            let r = cosmos_core::git::git_diff_untracked(&path, &file)?;
            Ok(to_json(r)?)
        }
        Request::GitInit { path } => {
            cosmos_core::git::git_init(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitFetch { path } => {
            cosmos_core::git::git_fetch(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitPull { path } => {
            cosmos_core::git::git_pull(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitPullRebase { path } => {
            cosmos_core::git::git_pull_rebase(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitPush { path } => {
            cosmos_core::git::git_push(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::GitForcePush { path } => {
            cosmos_core::git::git_force_push(&path)?;
            Ok(serde_json::Value::Null)
        }

        // ── Watcher ──
        Request::WatchWorkspace { path } => {
            state.watcher.watch(&path)?;
            Ok(serde_json::Value::Null)
        }
        Request::UnwatchWorkspace => {
            state.watcher.unwatch()?;
            Ok(serde_json::Value::Null)
        }

        // ── Terminal ──
        Request::TerminalListShells => {
            let r = cosmos_core::terminal::list_shells();
            Ok(to_json(r)?)
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
                .spawn(id, &program, &args, &cwd, cols, rows)?;
            Ok(serde_json::Value::Null)
        }
        Request::TerminalWrite { id, data } => {
            state.terminals.write(&id, &data)?;
            Ok(serde_json::Value::Null)
        }
        Request::TerminalResize { id, cols, rows } => {
            state.terminals.resize(&id, cols, rows)?;
            Ok(serde_json::Value::Null)
        }
        Request::TerminalClose { id } => {
            state.terminals.close(&id)?;
            Ok(serde_json::Value::Null)
        }

        // ── LSP ──
        Request::LspStart {
            workspace_path,
            language_id,
        } => {
            let r = state.lsp.start(&workspace_path, &language_id).await?;
            Ok(to_json(r)?)
        }
        Request::LspSend { server_id, message } => {
            state.lsp.send(&server_id, &message).await?;
            Ok(serde_json::Value::Null)
        }
        Request::LspStop { server_id } => {
            state.lsp.stop(&server_id).await?;
            Ok(serde_json::Value::Null)
        }
        Request::LspStopWorkspace { workspace_path } => {
            state.lsp.stop_workspace(&workspace_path).await?;
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
            let r = cosmos_core::lsp::LspManager::resolve_root(
                &file_path,
                &language_id,
                &workspace_path,
            );
            Ok(to_json(r)?)
        }
        Request::LspLanguageGroups => {
            let r = cosmos_core::lsp::LspManager::language_groups();
            Ok(to_json(r)?)
        }
        Request::LspInstalledList => {
            let r = state.lsp.installed_list();
            Ok(to_json(r)?)
        }
        Request::LspInstallServer { name } => {
            let r = state.lsp.install_server(&name).await?;
            Ok(to_json(r)?)
        }
        Request::LspUninstallServer { name } => {
            state.lsp.uninstall_server(&name)?;
            Ok(serde_json::Value::Null)
        }

        // ── Keepalive ──
        Request::Ping => Ok(serde_json::Value::Null),
    }
}

#[tokio::main]
async fn main() {
    // Handle --version before anything else
    if std::env::args().any(|a| a == "--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }

    let data_dir = agent_data_dir();

    // If `node` isn't on PATH but `bun` is, create a shim so npm-installed
    // scripts (which use #!/usr/bin/env node shebangs) can run.
    ensure_node_runtime(&data_dir);
    let servers_dir = data_dir.join("servers");
    std::fs::create_dir_all(&servers_dir).ok();

    // Single shared stdout writer for both events and responses
    let stdout_writer: SharedWriter = Arc::new(Mutex::new(io::stdout()));

    let events: Arc<dyn EventSink> = Arc::new(StdoutEventSink {
        writer: stdout_writer.clone(),
    });

    let state = Arc::new(AgentState {
        watcher: cosmos_core::watcher::WatcherManager::new(events.clone()),
        terminals: cosmos_core::terminal::TerminalManager::new(events.clone()),
        lsp: cosmos_core::lsp::LspManager::new(events, servers_dir, None),
    });

    let writer = stdout_writer.clone();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(u64, Request)>();

    // Stdin reader thread — reads framed messages and sends to the channel
    tokio::task::spawn_blocking(move || {
        let stdin = io::stdin();
        let mut reader = stdin.lock();

        loop {
            let msg = match framing::read_message(&mut reader) {
                Ok(msg) => msg,
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(e) => {
                    eprintln!("[cosmos-agent] read error: {e}");
                    break;
                }
            };

            let req_msg: RequestMessage = match serde_json::from_str(&msg) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[cosmos-agent] parse error: {e}");
                    continue;
                }
            };

            if tx.send((req_msg.id, req_msg.request)).is_err() {
                break;
            }
        }
    });

    // Dispatch loop — spawns each request concurrently so slow operations
    // (like recursive file watching) don't block other requests.
    while let Some((id, request)) = rx.recv().await {
        let state = state.clone();
        let writer = writer.clone();
        tokio::spawn(async move {
            let response = match dispatch(&state, request).await {
                Ok(result) => ResponseMessage::ok(id, result),
                Err(error) => ResponseMessage::err(id, error),
            };
            send_response(&writer, &response);
        });
    }
}
