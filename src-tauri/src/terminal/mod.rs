use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize, Child};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub struct TerminalInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct TerminalState {
    pub terminals: Mutex<HashMap<String, TerminalInstance>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct ShellInfo {
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
}

#[cfg(target_os = "windows")]
fn decode_utf16le(bytes: &[u8]) -> String {
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&u16s)
}

#[tauri::command]
pub fn terminal_list_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // PowerShell 7+ (pwsh.exe)
        if which::which("pwsh").is_ok() {
            shells.push(ShellInfo {
                name: "PowerShell".into(),
                program: "pwsh.exe".into(),
                args: vec![],
            });
        }

        // Windows PowerShell 5.1
        shells.push(ShellInfo {
            name: "Windows PowerShell".into(),
            program: "powershell.exe".into(),
            args: vec![],
        });

        // Command Prompt
        shells.push(ShellInfo {
            name: "Command Prompt".into(),
            program: "cmd.exe".into(),
            args: vec![],
        });

        // WSL distributions
        if let Ok(output) = std::process::Command::new("wsl")
            .args(["--list", "--quiet"])
            .output()
        {
            if output.status.success() {
                let stdout = decode_utf16le(&output.stdout);
                for line in stdout.lines() {
                    let distro = line.trim().trim_matches('\0');
                    if !distro.is_empty() {
                        shells.push(ShellInfo {
                            name: format!("WSL: {}", distro),
                            program: "wsl.exe".into(),
                            args: vec!["-d".into(), distro.to_string()],
                        });
                    }
                }
            }
        }

        // Git Bash
        let git_bash_paths = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        for path in &git_bash_paths {
            if std::path::Path::new(path).exists() {
                shells.push(ShellInfo {
                    name: "Git Bash".into(),
                    program: path.to_string(),
                    args: vec!["--login".into()],
                });
                break;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(content) = std::fs::read_to_string("/etc/shells") {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let name = std::path::Path::new(line)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| line.to_string());
                shells.push(ShellInfo {
                    name,
                    program: line.to_string(),
                    args: vec![],
                });
            }
        }

        // Fallback
        if shells.is_empty() {
            for (name, path) in [("bash", "/bin/bash"), ("sh", "/bin/sh")] {
                if std::path::Path::new(path).exists() {
                    shells.push(ShellInfo {
                        name: name.to_string(),
                        program: path.to_string(),
                        args: vec![],
                    });
                }
            }
        }
    }

    shells
}

#[tauri::command]
pub fn terminal_spawn(
    id: String,
    program: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
    app: AppHandle,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&program);
    for arg in &args {
        cmd.arg(arg);
    }
    cmd.cwd(&cwd);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    // Drop slave — we only need the master side
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        terminals.insert(
            id.clone(),
            TerminalInstance {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    // Background reader thread — emits terminal output as events
    let event_id = id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    eprintln!("[terminal-{}] reader got EOF", event_id);
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(&format!("terminal-data-{}", event_id), data);
                }
                Err(e) => {
                    eprintln!("[terminal-{}] reader error: {}", event_id, e);
                    break;
                }
            }
        }
        let _ = app.emit(&format!("terminal-exit-{}", event_id), ());
    });

    Ok(())
}

#[tauri::command]
pub fn terminal_write(
    id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let terminal = terminals.get_mut(&id).ok_or("Terminal not found")?;
    terminal
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    terminal.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let terminal = terminals.get(&id).ok_or("Terminal not found")?;
    terminal
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_close(
    id: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    if let Some(mut terminal) = terminals.remove(&id) {
        let _ = terminal.child.kill();
    }
    Ok(())
}
