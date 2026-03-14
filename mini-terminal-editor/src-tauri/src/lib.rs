// Minimal terminal backend: PTY with Tauri Channel for output streaming.
// Based on dispatcher pattern: Channel instead of emit, UTF-8 safety.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{ipc::Channel, Manager, State};

#[derive(Clone, serde::Serialize)]
struct TerminalOutput {
    terminal_id: String,
    data: String,
}

/// Find split point so bytes before are complete UTF-8; avoid corrupting multi-byte chars.
fn utf8_split_point(bytes: &[u8]) -> usize {
    let len = bytes.len();
    if len == 0 {
        return 0;
    }
    let check = std::cmp::min(3, len);
    for back in 1..=check {
        let i = len - back;
        let b = bytes[i];
        if b & 0x80 == 0 {
            return len;
        }
        if b & 0xC0 != 0x80 {
            let expected = if b & 0xF8 == 0xF0 {
                4
            } else if b & 0xF0 == 0xE0 {
                3
            } else {
                2
            };
            let actual = len - i;
            if actual >= expected {
                return len;
            }
            return i;
        }
    }
    len
}

#[derive(Default)]
struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
}

#[tauri::command]
fn create_terminal(
    state: State<TerminalState>,
    terminal_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_output: Channel<TerminalOutput>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open PTY: {e}"))?;

    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let cwd_path = cwd
        .filter(|d| !d.is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("/"));

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(&cwd_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.arg("-i");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn shell: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to create PTY writer: {e}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to create PTY reader: {e}"))?;

    let child_arc = Arc::new(Mutex::new(Some(child)));

    let session = TerminalSession {
        writer,
        master: pair.master,
        child: Arc::clone(&child_arc),
    };

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to lock".to_string())?;
        sessions.insert(terminal_id.clone(), session);
    }

    let tid = terminal_id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut carry: Vec<u8> = Vec::new();

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let split = utf8_split_point(&carry);
                    if split > 0 {
                        let data = String::from_utf8_lossy(&carry[..split]).to_string();
                        let _ = on_output.send(TerminalOutput {
                            terminal_id: tid.clone(),
                            data,
                        });
                    }
                    carry.drain(..split);
                }
                Err(_) => break,
            }
        }

        if !carry.is_empty() {
            let data = String::from_utf8_lossy(&carry).to_string();
            let _ = on_output.send(TerminalOutput {
                terminal_id: tid.clone(),
                data,
            });
        }
    });

    Ok(())
}

#[tauri::command]
fn write_terminal(
    state: State<TerminalState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock".to_string())?;
    let session = sessions
        .get_mut(&terminal_id)
        .ok_or_else(|| "terminal not found".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn resize_terminal(
    state: State<TerminalState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock".to_string())?;
    let session = sessions
        .get(&terminal_id)
        .ok_or_else(|| "terminal not found".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn close_terminal(
    state: State<TerminalState>,
    terminal_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock".to_string())?;
    if let Some(session) = sessions.remove(&terminal_id) {
        let mut guard = session.child.lock().map_err(|_| "lock failed")?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal
        ])
        .setup(|app| {
            // Set window background to dark so title bar matches terminal theme (macOS transparent titlebar)
            if let Some(win) = app.get_webview_window("main") {
                use tauri::window::Color;
                let color = Color(2, 7, 12, 255);
                let _ = win.set_background_color(Some(color));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
