use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};

/// Maximum allowed LSP message size (64 MB). Prevents OOM from a misbehaving
/// server sending an enormous Content-Length value.
const MAX_MESSAGE_SIZE: usize = 64 * 1024 * 1024;

/// Read one LSP message from a Content-Length framed stream.
pub async fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<String, String> {
    let mut content_length: Option<usize> = None;

    // Read headers until empty line
    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            return Err("EOF".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }

        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|e| format!("Invalid Content-Length: {e}"))?,
            );
        }
        // Skip other headers (e.g. Content-Type)
    }

    let length = content_length.ok_or("Missing Content-Length header")?;
    if length > MAX_MESSAGE_SIZE {
        return Err(format!(
            "Message size {length} bytes exceeds maximum of {MAX_MESSAGE_SIZE} bytes"
        ));
    }
    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|e| e.to_string())?;

    String::from_utf8(body).map_err(|e| e.to_string())
}

/// Frame a JSON string with Content-Length header for LSP stdin.
pub fn frame_message(json: &str) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", json.len());
    let mut buf = Vec::with_capacity(header.len() + json.len());
    buf.extend_from_slice(header.as_bytes());
    buf.extend_from_slice(json.as_bytes());
    buf
}

/// Write a framed LSP message to stdin.
pub async fn write_message(stdin: &mut ChildStdin, json: &str) -> Result<(), String> {
    let data = frame_message(json);
    stdin.write_all(&data).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}
