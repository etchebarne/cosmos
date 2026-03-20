use kosmos_core::terminal::TerminalManager;
use kosmos_protocol::requests::Request;
use kosmos_protocol::types::ShellInfo;
use tauri::State;

use crate::remote::router::BackendRouter;

#[tauri::command]
pub async fn terminal_list_shells(
    router: State<'_, BackendRouter>,
    workspace_path: Option<String>,
) -> Result<Vec<ShellInfo>, String> {
    if let Some(ref path) = workspace_path {
        if let Some((agent, _)) = router.resolve(path).await {
            let val = agent.request(Request::TerminalListShells).await?;
            return serde_json::from_value(val).map_err(|e| e.to_string());
        }
    }
    Ok(kosmos_core::terminal::list_shells())
}

#[tauri::command]
pub async fn terminal_spawn(
    router: State<'_, BackendRouter>,
    state: State<'_, TerminalManager>,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if let Some((agent, remote_cwd)) = router.resolve(&cwd).await {
        // Register before spawning so writes arriving immediately after spawn
        // are routed correctly (avoids race with terminal_write).
        router
            .register_remote_terminal(id.clone(), agent.clone())
            .await;
        if let Err(e) = agent
            .request(Request::TerminalSpawn {
                id: id.clone(),
                program,
                args,
                cwd: remote_cwd,
                cols,
                rows,
            })
            .await
        {
            router.remove_remote_terminal(&id).await;
            return Err(e);
        }
        Ok(())
    } else if BackendRouter::is_remote_path(&cwd) {
        Err(format!("Remote agent not connected for path: {cwd}"))
    } else {
        state.spawn(id, &program, &args, &cwd, cols, rows)
    }
}

#[tauri::command]
pub async fn terminal_write(
    router: State<'_, BackendRouter>,
    state: State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    if let Some(agent) = router.get_remote_terminal(&id).await {
        agent
            .request(Request::TerminalWrite {
                id,
                data,
            })
            .await?;
        Ok(())
    } else {
        state.write(&id, &data)
    }
}

#[tauri::command]
pub async fn terminal_resize(
    router: State<'_, BackendRouter>,
    state: State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if let Some(agent) = router.get_remote_terminal(&id).await {
        agent
            .request(Request::TerminalResize {
                id,
                cols,
                rows,
            })
            .await?;
        Ok(())
    } else {
        state.resize(&id, cols, rows)
    }
}

#[tauri::command]
pub async fn terminal_close(
    router: State<'_, BackendRouter>,
    state: State<'_, TerminalManager>,
    id: String,
) -> Result<(), String> {
    if let Some(agent) = router.get_remote_terminal(&id).await {
        agent
            .request(Request::TerminalClose { id: id.clone() })
            .await?;
        router.remove_remote_terminal(&id).await;
        Ok(())
    } else {
        state.close(&id)
    }
}
