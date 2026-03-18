// Minimal terminal backend: PTY with Tauri Channel for output streaming.
// Based on dispatcher pattern: Channel instead of emit, UTF-8 safety.
// File operations: read_file, write_file, list_dir, path-constrained to workspace.

mod git_backend;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use git_backend::{
    git_commit, git_discard_all, git_discard_file, git_get_capability, git_get_diff_contents,
    git_get_status, git_init_repository, git_stage_all, git_stage_file, git_unstage_all,
    git_unstage_file,
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectRootPayload {
    parent_path: String,
    project_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameEntryPayload {
    workspace_path: String,
    old_path: String,
    new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteEntryPayload {
    workspace_path: String,
    path: String,
    is_dir: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveEntryPayload {
    workspace_path: String,
    source_path: String,
    destination_dir_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevealInFileManagerPayload {
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

fn image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
fn read_image_data_url(payload: ReadFilePayload) -> Result<String, String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let file_path = safe_workspace_child(&workspace, &payload.path)?;
    if !file_path.is_file() {
        return Err("path is not a file".to_string());
    }

    let bytes = fs::read(&file_path).map_err(|e| format!("failed to read file: {e}"))?;
    let mime = image_mime_type(&file_path);
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
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

#[tauri::command]
fn create_project_root(payload: CreateProjectRootPayload) -> Result<String, String> {
    if payload.project_name.trim().is_empty() {
        return Err("project name cannot be empty".to_string());
    }
    if payload.project_name.contains('/') || payload.project_name.contains('\\') {
        return Err("project name cannot contain slashes".to_string());
    }

    let parent_path = PathBuf::from(&payload.parent_path);
    let canonical_parent = fs::canonicalize(&parent_path)
        .map_err(|e| format!("invalid parent path: {e}"))?;
    if !canonical_parent.is_dir() {
        return Err("parent path is not a directory".to_string());
    }

    let project_path = canonical_parent.join(payload.project_name.trim());
    if project_path.exists() {
        return Err("project already exists".to_string());
    }

    fs::create_dir_all(&project_path)
        .map_err(|e| format!("failed to create project directory: {e}"))?;

    Ok(project_path.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_entry(payload: RenameEntryPayload) -> Result<(), String> {
    if payload.new_name.contains('/') || payload.new_name.contains('\\') {
        return Err("invalid new name".to_string());
    }
    let workspace = PathBuf::from(&payload.workspace_path);
    let old_path = safe_workspace_child(&workspace, &payload.old_path)?;
    let parent = old_path
        .parent()
        .ok_or_else(|| "invalid parent path".to_string())?;
    let parent_rel = parent
        .strip_prefix(&workspace)
        .map_err(|_| "invalid parent path".to_string())?;
    let new_rel = parent_rel.join(&payload.new_name);
    let new_path =
        safe_workspace_path_for_create(&workspace, new_rel.to_string_lossy().as_ref())?;
    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("failed to rename entry: {e}"))
}

#[tauri::command]
fn delete_entry(payload: DeleteEntryPayload) -> Result<(), String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let path = safe_workspace_child(&workspace, &payload.path)?;
    if payload.is_dir {
        fs::remove_dir_all(&path).map_err(|e| format!("failed to delete directory: {e}"))
    } else {
        fs::remove_file(&path).map_err(|e| format!("failed to delete file: {e}"))
    }
}

#[tauri::command]
fn move_entry(payload: MoveEntryPayload) -> Result<(), String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let source = safe_workspace_child(&workspace, &payload.source_path)?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "invalid source path".to_string())?;
    let dest_rel = if payload.destination_dir_path.is_empty() {
        file_name.to_string_lossy().to_string()
    } else {
        format!(
            "{}/{}",
            payload.destination_dir_path,
            file_name.to_string_lossy()
        )
    };
    let destination = safe_workspace_path_for_create(&workspace, &dest_rel)?;
    if source == destination {
        return Ok(());
    }
    if destination.exists() {
        return Err("destination already exists".to_string());
    }
    fs::rename(&source, &destination).map_err(|e| format!("failed to move entry: {e}"))
}

#[tauri::command]
fn reveal_in_file_manager(payload: RevealInFileManagerPayload) -> Result<(), String> {
    let workspace = PathBuf::from(&payload.workspace_path);
    let path = safe_workspace_child(&workspace, &payload.path)?;

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(|e| format!("failed to open in Finder: {e}"))?;
        if !status.success() {
            return Err("failed to reveal in Finder".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let target = format!("/select,{}", path.display());
        let status = Command::new("explorer")
            .arg(target)
            .status()
            .map_err(|e| format!("failed to open in Explorer: {e}"))?;
        if !status.success() {
            return Err("failed to reveal in Explorer".to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(&path);
        let status = Command::new("xdg-open")
            .arg(parent)
            .status()
            .map_err(|e| format!("failed to open in file manager: {e}"))?;
        if !status.success() {
            return Err("failed to reveal in file manager".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("unsupported URL scheme".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(&url)
            .status()
            .map_err(|e| format!("failed to open URL: {e}"))?;
        if !status.success() {
            return Err("failed to open URL".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", &url])
            .status()
            .map_err(|e| format!("failed to open URL: {e}"))?;
        if !status.success() {
            return Err("failed to open URL".to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        let status = Command::new("xdg-open")
            .arg(&url)
            .status()
            .map_err(|e| format!("failed to open URL: {e}"))?;
        if !status.success() {
            return Err("failed to open URL".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
fn toggle_window_zoom(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::{
            appkit::NSWindow,
            base::{id, nil},
        };

        let ns_window = window
            .ns_window()
            .map_err(|e| format!("failed to access native window: {e}"))?;
        let ns_window = ns_window as id;
        unsafe {
            ns_window.performZoom_(nil);
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let is_maximized = window
            .is_maximized()
            .map_err(|e| format!("failed to query window state: {e}"))?;
        if is_maximized {
            window
                .unmaximize()
                .map_err(|e| format!("failed to restore window: {e}"))?;
        } else {
            window
                .maximize()
                .map_err(|e| format!("failed to maximize window: {e}"))?;
        }
        Ok(())
    }
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
    cmd.env("TERM_PROGRAM", "Subset");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    cmd.env("CLICOLOR", "1");
    cmd.env("CLICOLOR_FORCE", "1");
    cmd.env("LSCOLORS", "ExFxCxDxBxegedabagacad");
    cmd.env(
        "LS_COLORS",
        "di=1;36:ln=1;35:so=1;32:pi=33:ex=1;32:bd=1;33:cd=1;33:su=37;41:sg=30;43:tw=30;42:ow=34;42",
    );
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
            read_image_data_url,
            write_file,
            list_dir,
            create_file,
            create_dir,
            create_project_root,
            rename_entry,
            delete_entry,
            move_entry,
            reveal_in_file_manager,
            toggle_window_zoom,
            open_external_url,
            git_get_capability,
            git_init_repository,
            git_get_status,
            git_get_diff_contents,
            git_stage_file,
            git_unstage_file,
            git_stage_all,
            git_unstage_all,
            git_discard_file,
            git_discard_all,
            git_commit
        ])
        .setup(|app| {
            // Set window background to dark so title bar matches terminal theme (macOS transparent titlebar)
            if let Some(win) = app.get_webview_window("main") {
                use tauri::window::Color;
                let color = Color(9, 9, 9, 255);
                let _ = win.set_background_color(Some(color));

                #[cfg(target_os = "macos")]
                {
                    use cocoa::{
                        appkit::{NSWindow, NSWindowTitleVisibility},
                        base::{id, NO, YES},
                    };

                    if let Ok(ns_window) = win.ns_window() {
                        let ns_window = ns_window as id;
                        unsafe {
                            ns_window.setTitlebarAppearsTransparent_(YES);
                            ns_window
                                .setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
                            // Only our explicit drag regions should move the window.
                            ns_window.setMovableByWindowBackground_(NO);
                        }
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
