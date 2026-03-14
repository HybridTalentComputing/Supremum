// Minimal terminal backend: PTY with Tauri Channel for output streaming.
// Based on dispatcher pattern: Channel instead of emit, UTF-8 safety.
// File operations: read_file, write_file, list_dir, path-constrained to workspace.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{ipc::Channel, Manager, State};

// ----- File operations (path-constrained to workspace) -----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadFilePayload {
    workspace_path: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteFilePayload {
    workspace_path: String,
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListDirPayload {
    workspace_path: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFilePayload {
    workspace_path: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDirPayload {
    workspace_path: String,
    path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ListDirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

fn safe_workspace_child(workspace_path: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let canonical_workspace =
        fs::canonicalize(workspace_path).map_err(|e| format!("invalid workspace path: {e}"))?;
    let candidate = canonical_workspace.join(relative_path);
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|e| format!("invalid file path {}: {e}", candidate.display()))?;
    if !canonical_candidate.starts_with(&canonical_workspace) {
        return Err("file path escapes workspace".to_string());
    }
    Ok(canonical_candidate)
}

/// Validate path is within workspace; allows non-existent paths (for create operations).
fn safe_workspace_path_for_create(
    workspace_path: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    use std::path::Component;
    let canonical_workspace =
        fs::canonicalize(workspace_path).map_err(|e| format!("invalid workspace path: {e}"))?;
    let mut resolved = canonical_workspace.clone();
    for component in Path::new(relative_path).components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err("invalid path".to_string());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
                if !resolved.starts_with(&canonical_workspace) {
                    return Err("file path escapes workspace".to_string());
                }
            }
            Component::Normal(name) => resolved.push(name),
        }
    }
    if !resolved.starts_with(&canonical_workspace) {
        return Err("file path escapes workspace".to_string());
    }
    Ok(resolved)
}

#[tauri::command]
fn read_file(payload: ReadFilePayload) -> Result<String, String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let file_path = safe_workspace_child(&workspace, &payload.path)?;
    if !file_path.is_file() {
        return Err("path is not a file".to_string());
    }
    fs::read_to_string(&file_path).map_err(|e| format!("failed to read file: {e}"))
}

#[tauri::command]
fn write_file(payload: WriteFilePayload) -> Result<(), String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let file_path = safe_workspace_child(&workspace, &payload.path)?;
    fs::write(&file_path, payload.content).map_err(|e| format!("failed to write file: {e}"))
}

#[tauri::command]
fn list_dir(payload: ListDirPayload) -> Result<Vec<ListDirEntry>, String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let dir_path = if payload.path.is_empty() {
        workspace.clone()
    } else {
        safe_workspace_child(&workspace, &payload.path)?
    };
    if !dir_path.is_dir() {
        return Err("path is not a directory".to_string());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir_path).map_err(|e| format!("failed to list dir: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let path = entry.path();
        let is_dir = path.is_dir();
        let rel = path
            .strip_prefix(&workspace)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string());
        entries.push(ListDirEntry {
            name,
            path: rel,
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            return a.is_dir.cmp(&b.is_dir).reverse();
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(entries)
}

#[tauri::command]
fn create_file(payload: CreateFilePayload) -> Result<(), String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let file_path = safe_workspace_path_for_create(&workspace, &payload.path)?;
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create parent dir: {e}"))?;
    }
    fs::File::create(&file_path)
        .map_err(|e| format!("failed to create file: {e}"))?;
    Ok(())
}

#[tauri::command]
fn create_dir(payload: CreateDirPayload) -> Result<(), String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let dir_path = safe_workspace_path_for_create(&workspace, &payload.path)?;
    fs::create_dir_all(&dir_path)
        .map_err(|e| format!("failed to create directory: {e}"))
}

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
fn close_terminal(state: State<TerminalState>, terminal_id: String) -> Result<(), String> {
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
        .plugin(tauri_plugin_dialog::init())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            read_file,
            write_file,
            list_dir,
            create_file,
            create_dir
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
