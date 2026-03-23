use crate::agent_data_dir;

#[cfg(unix)]
pub(crate) async fn client_main() {
    let data_dir = agent_data_dir();
    std::fs::create_dir_all(&data_dir).ok();
    crate::daemon::ensure_daemon(&data_dir);

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
