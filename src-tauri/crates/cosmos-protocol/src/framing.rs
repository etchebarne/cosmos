use std::io::{self, BufRead, Write};

/// Maximum allowed message size (64 MB).
const MAX_MESSAGE_SIZE: usize = 64 * 1024 * 1024;

/// Read one Content-Length framed message from a buffered reader.
pub fn read_message(reader: &mut impl BufRead) -> io::Result<String> {
    let mut content_length: Option<usize> = None;

    // Read headers until empty line
    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "EOF"));
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }

        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(value.trim().parse::<usize>().map_err(|e| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Invalid Content-Length: {e}"),
                )
            })?);
        }
    }

    let length = content_length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Missing Content-Length"))?;

    if length > MAX_MESSAGE_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Message size {length} exceeds maximum of {MAX_MESSAGE_SIZE}"),
        ));
    }

    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;

    String::from_utf8(body)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("Invalid UTF-8: {e}")))
}

/// Write a Content-Length framed message to a writer.
pub fn write_message(writer: &mut impl Write, json: &str) -> io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", json.len())?;
    writer.write_all(json.as_bytes())?;
    writer.flush()
}
