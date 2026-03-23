use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};

pub use kosmos_protocol::framing::frame_message;

/// Read one Content-Length framed message from the LSP server's stdout.
/// Wraps the protocol's async implementation, mapping `io::Error` → `String`.
pub async fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<String, String> {
    kosmos_protocol::framing::async_read_message(reader)
        .await
        .map_err(|e| e.to_string())
}

/// Write a Content-Length framed message to the LSP server's stdin.
/// Wraps the protocol's async implementation, mapping `io::Error` → `String`.
pub async fn write_message(stdin: &mut ChildStdin, json: &str) -> Result<(), String> {
    let data = frame_message(json);
    stdin.write_all(&data).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    /// Python one-liner that copies stdin to stdout as raw bytes.
    const PASSTHROUGH_SCRIPT: &str =
        "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())";

    #[test]
    fn frame_message_produces_correct_header() {
        let json = r#"{"jsonrpc":"2.0","method":"initialize"}"#;
        let framed = frame_message(json);
        let framed_str = String::from_utf8(framed).unwrap();

        let expected_header = format!("Content-Length: {}\r\n\r\n", json.len());
        assert!(framed_str.starts_with(&expected_header));
        assert!(framed_str.ends_with(json));
        assert_eq!(framed_str, format!("{}{}", expected_header, json));
    }

    #[test]
    fn frame_message_empty_body() {
        let framed = frame_message("");
        let framed_str = String::from_utf8(framed).unwrap();
        assert_eq!(framed_str, "Content-Length: 0\r\n\r\n");
    }

    /// Spawn a child process that pipes stdin to stdout verbatim (raw bytes).
    /// Returns (child, stdin, BufReader<ChildStdout>).
    async fn spawn_passthrough() -> (
        tokio::process::Child,
        ChildStdin,
        BufReader<ChildStdout>,
    ) {
        let mut child = tokio::process::Command::new("python")
            .args(["-c", PASSTHROUGH_SCRIPT])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("python must be available to run framing tests");

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        (child, stdin, reader)
    }

    #[tokio::test]
    async fn read_message_valid_input() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":null}"#;
        let frame = frame_message(body);

        let (_child, mut stdin, mut reader) = spawn_passthrough().await;

        stdin.write_all(&frame).await.unwrap();
        drop(stdin); // close stdin so the child flushes and exits

        let result = read_message(&mut reader).await.unwrap();
        assert_eq!(result, body);
    }

    #[tokio::test]
    async fn read_message_missing_content_length() {
        // Send a header line without Content-Length, then the blank separator
        let data = b"Some-Header: value\r\n\r\n";

        let (_child, mut stdin, mut reader) = spawn_passthrough().await;

        stdin.write_all(data).await.unwrap();
        drop(stdin);

        let result = read_message(&mut reader).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Missing Content-Length"),
            "Expected 'Missing Content-Length' but got: {err}"
        );
    }

    #[tokio::test]
    async fn read_message_truncated_body() {
        // Claim body is 100 bytes but only provide 5
        let data = b"Content-Length: 100\r\n\r\nhello";

        let (_child, mut stdin, mut reader) = spawn_passthrough().await;

        stdin.write_all(data).await.unwrap();
        drop(stdin);

        let result = read_message(&mut reader).await;
        assert!(result.is_err(), "Expected error for truncated body");
    }
}
