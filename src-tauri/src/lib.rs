use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State};

static TERMINAL_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

struct TerminalSession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummary {
    id: String,
    name: String,
    slug: String,
    path: String,
    status: String,
    change: String,
    count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTerminalPayload {
    workspace_path: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInputPayload {
    session_id: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResizePayload {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalClosePayload {
    session_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    session_id: String,
    data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCreated {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusPayload {
    workspace_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusResponse {
    branch: String,
    is_git_repo: bool,
    ahead: u32,
    changed_files: Vec<GitChangedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitChangedFile {
    id: String,
    name: String,
    path: String,
    kind: String,
    status: String,
    added: Option<u32>,
    removed: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitPayload {
    workspace_path: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitResponse {
    summary: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPushPayload {
    workspace_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitPushResponse {
    summary: String,
}

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStore {
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddWorkspacePayload {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFilesPayload {
    workspace_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileContentPayload {
    workspace_path: String,
    file_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveWorkspaceFilePayload {
    workspace_path: String,
    file_path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileEntry {
    id: String,
    name: String,
    path: String,
    kind: String,
    has_children: bool,
    children: Vec<WorkspaceFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileContent {
    path: String,
    content: String,
}

#[tauri::command]
fn list_workspaces(app: AppHandle) -> Result<Vec<WorkspaceSummary>, String> {
    let mut roots = vec![];

    if let Ok(current_dir) = env::current_dir() {
        if let Some(parent) = current_dir.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    if let Ok(home_dir) = env::var("HOME") {
        let code_dir = Path::new(&home_dir).join("code");
        if code_dir.is_dir() {
            roots.push(code_dir);
        }
    }

    for saved_path in read_workspace_store(&app)?.paths {
        roots.push(PathBuf::from(saved_path));
    }

    let mut seen = HashSet::new();
    let mut workspaces = vec![];

    for root in roots {
        let canonical_root = fs::canonicalize(&root).unwrap_or(root.clone());

        if canonical_root.join(".git").exists() || canonical_root.join("package.json").exists() {
            if let Some(workspace) = summarize_workspace_path(&canonical_root, &mut seen) {
                workspaces.push(workspace);
            }
            continue;
        }

        if !seen.insert(canonical_root.clone()) {
            continue;
        }

        let entries = fs::read_dir(&canonical_root)
            .map_err(|error| format!("failed to read {}: {}", canonical_root.display(), error))?;

        for entry in entries.flatten() {
            if let Some(workspace) = summarize_workspace_path(&entry.path(), &mut seen) {
                workspaces.push(workspace);
            }
        }
    }

    workspaces.sort_by(|left, right| left.name.cmp(&right.name));
    workspaces.truncate(12);

    Ok(workspaces)
}

#[tauri::command]
fn add_workspace(
    payload: AddWorkspacePayload,
    app: AppHandle,
) -> Result<WorkspaceSummary, String> {
    let path = PathBuf::from(payload.path.trim());
    if !path.is_absolute() {
        return Err("workspace path must be absolute".to_string());
    }

    let canonical_path =
        fs::canonicalize(&path).map_err(|error| format!("invalid workspace path: {error}"))?;
    if !canonical_path.is_dir() {
        return Err("workspace path must point to a directory".to_string());
    }

    let mut store = read_workspace_store(&app)?;
    let canonical_string = canonical_path.display().to_string();
    if !store.paths.iter().any(|existing| existing == &canonical_string) {
        store.paths.push(canonical_string);
        write_workspace_store(&app, &store)?;
    }

    let mut seen = HashSet::new();
    summarize_workspace_path(&canonical_path, &mut seen)
        .ok_or_else(|| "unable to summarize workspace".to_string())
}

#[tauri::command]
fn get_git_status(payload: GitStatusPayload) -> Result<GitStatusResponse, String> {
    let workspace_path = PathBuf::from(&payload.workspace_path);
    if !workspace_path.is_dir() {
        return Err("workspace path does not exist".to_string());
    }

    let repo_check = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;

    if !repo_check.status.success() {
        return Ok(GitStatusResponse {
            branch: "No repository".to_string(),
            is_git_repo: false,
            ahead: 0,
            changed_files: vec![],
        });
    }

    let branch_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .args(["branch", "--show-current"])
        .output()
        .map_err(|error| format!("failed to read branch: {error}"))?;
    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();

    let ahead_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .args(["status", "--porcelain=2", "--branch"])
        .output()
        .map_err(|error| format!("failed to read porcelain status: {error}"))?;
    let porcelain = String::from_utf8_lossy(&ahead_output.stdout);

    let ahead = porcelain
        .lines()
        .find_map(|line| {
            if let Some(rest) = line.strip_prefix("# branch.ab ") {
                let parts: Vec<_> = rest.split(' ').collect();
                for part in parts {
                    if let Some(value) = part.strip_prefix('+') {
                        return value.parse::<u32>().ok();
                    }
                }
            }
            None
        })
        .unwrap_or(0);

    let status_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .args(["status", "--porcelain", "--untracked-files=all"])
        .output()
        .map_err(|error| format!("failed to read git status: {error}"))?;
    let raw_status = String::from_utf8_lossy(&status_output.stdout);

    let changed_files = raw_status
        .lines()
        .filter_map(|line| parse_git_status_line(&workspace_path, line))
        .collect::<Vec<_>>();

    Ok(GitStatusResponse {
        branch: if branch.is_empty() {
            "detached".to_string()
        } else {
            branch
        },
        is_git_repo: true,
        ahead,
        changed_files,
    })
}

#[tauri::command]
fn list_workspace_files(payload: WorkspaceFilesPayload) -> Result<Vec<WorkspaceFileEntry>, String> {
    let workspace_path = PathBuf::from(&payload.workspace_path);
    if !workspace_path.is_dir() {
        return Err("workspace path does not exist".to_string());
    }

    read_workspace_tree(&workspace_path, &workspace_path, 0)
}

#[tauri::command]
fn read_workspace_file(payload: WorkspaceFileContentPayload) -> Result<WorkspaceFileContent, String> {
    let workspace_path = PathBuf::from(&payload.workspace_path);
    let file_path = safe_workspace_child(&workspace_path, &payload.file_path)?;

    let content = fs::read_to_string(&file_path)
        .map_err(|error| format!("failed to read file {}: {error}", file_path.display()))?;

    Ok(WorkspaceFileContent {
        path: payload.file_path,
        content,
    })
}

#[tauri::command]
fn save_workspace_file(payload: SaveWorkspaceFilePayload) -> Result<(), String> {
    let workspace_path = PathBuf::from(&payload.workspace_path);
    let file_path = safe_workspace_child(&workspace_path, &payload.file_path)?;

    fs::write(&file_path, payload.content)
        .map_err(|error| format!("failed to save file {}: {error}", file_path.display()))
}

#[tauri::command]
fn commit_git_changes(payload: GitCommitPayload) -> Result<GitCommitResponse, String> {
    let workspace_path = PathBuf::from(&payload.workspace_path);
    if !workspace_path.is_dir() {
        return Err("workspace path does not exist".to_string());
    }

    let message = payload.message.trim();
    if message.is_empty() {
        return Err("commit message is required".to_string());
    }

    let repo_check = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;

    if !repo_check.status.success() {
        return Err("current workspace is not a Git repository".to_string());
    }

    let status_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .args(["status", "--porcelain"])
        .output()
        .map_err(|error| format!("failed to inspect working tree: {error}"))?;

    if String::from_utf8_lossy(&status_output.stdout).trim().is_empty() {
        return Err("working tree is clean".to_string());
    }

    let add_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .args(["add", "-A"])
        .output()
        .map_err(|error| format!("failed to stage changes: {error}"))?;

    if !add_output.status.success() {
        return Err(stderr_or_default(
            &add_output.stderr,
            "failed to stage changes",
        ));
    }

    let commit_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .args(["commit", "-m", message])
        .output()
        .map_err(|error| format!("failed to create commit: {error}"))?;

    if !commit_output.status.success() {
        return Err(stderr_or_default(
            &commit_output.stderr,
            "failed to create commit",
        ));
    }

    let summary = String::from_utf8_lossy(&commit_output.stdout)
        .lines()
        .next()
        .unwrap_or("commit created")
        .trim()
        .to_string();

    Ok(GitCommitResponse { summary })
}

#[tauri::command]
fn push_git_changes(payload: GitPushPayload) -> Result<GitPushResponse, String> {
    let workspace_path = PathBuf::from(&payload.workspace_path);
    if !workspace_path.is_dir() {
        return Err("workspace path does not exist".to_string());
    }

    let repo_check = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;

    if !repo_check.status.success() {
        return Err("current workspace is not a Git repository".to_string());
    }

    let remote_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .arg("remote")
        .output()
        .map_err(|error| format!("failed to inspect git remotes: {error}"))?;

    if String::from_utf8_lossy(&remote_output.stdout).trim().is_empty() {
        return Err("current workspace has no Git remote configured".to_string());
    }

    let push_output = Command::new("git")
        .arg("-C")
        .arg(&workspace_path)
        .arg("push")
        .output()
        .map_err(|error| format!("failed to run git push: {error}"))?;

    if !push_output.status.success() {
        let stderr = stderr_or_default(&push_output.stderr, "git push failed");
        return Err(stderr);
    }

    let stdout = String::from_utf8_lossy(&push_output.stdout);
    let stderr = String::from_utf8_lossy(&push_output.stderr);
    let summary = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .or_else(|| stderr.lines().find(|line| !line.trim().is_empty()))
        .unwrap_or("push completed")
        .trim()
        .to_string();

    Ok(GitPushResponse { summary })
}

#[tauri::command]
fn create_terminal(
    payload: CreateTerminalPayload,
    app: AppHandle,
    state: State<TerminalState>,
) -> Result<TerminalCreated, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: payload.rows,
            cols: payload.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open PTY: {error}"))?;

    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = CommandBuilder::new(shell);
    command.cwd(payload.workspace_path);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to spawn shell: {error}"))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to create PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to create PTY writer: {error}"))?;

    let session_id = format!("term-{}", TERMINAL_ID.fetch_add(1, Ordering::Relaxed));
    let session = TerminalSession {
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        child: Arc::new(Mutex::new(child)),
    };

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to lock terminal state".to_string())?;
        sessions.insert(session_id.clone(), session);
    }

    spawn_reader_thread(app, session_id.clone(), reader);

    Ok(TerminalCreated { session_id })
}

#[tauri::command]
fn write_terminal(
    payload: TerminalInputPayload,
    state: State<TerminalState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock terminal state".to_string())?;
    let session = sessions
        .get(&payload.session_id)
        .ok_or_else(|| "terminal session not found".to_string())?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "failed to lock terminal writer".to_string())?;
    writer
        .write_all(payload.data.as_bytes())
        .map_err(|error| format!("failed to write to terminal: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush terminal input: {error}"))?;

    Ok(())
}

#[tauri::command]
fn resize_terminal(
    payload: TerminalResizePayload,
    state: State<TerminalState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock terminal state".to_string())?;
    let session = sessions
        .get(&payload.session_id)
        .ok_or_else(|| "terminal session not found".to_string())?;

    let master = session
        .master
        .lock()
        .map_err(|_| "failed to lock PTY master".to_string())?;
    master
        .resize(PtySize {
            rows: payload.rows,
            cols: payload.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize terminal: {error}"))?;

    Ok(())
}

#[tauri::command]
fn close_terminal(
    payload: TerminalClosePayload,
    state: State<TerminalState>,
) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to lock terminal state".to_string())?;
        sessions.remove(&payload.session_id)
    };

    if let Some(session) = session {
        let mut child = session
            .child
            .lock()
            .map_err(|_| "failed to lock terminal child".to_string())?;
        child
            .kill()
            .map_err(|error| format!("failed to close terminal: {error}"))?;
    }

    Ok(())
}

fn spawn_reader_thread(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = app.emit(
                        "terminal-output",
                        TerminalEvent {
                            session_id: session_id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.starts_with('.'))
        .unwrap_or(false)
}

fn prettify_name(name: &str) -> String {
    name.replace(['-', '_'], " ")
}

fn parse_git_status_line(workspace_path: &Path, line: &str) -> Option<GitChangedFile> {
    if line.len() < 4 {
        return None;
    }

    let status_code = line.get(0..2)?.trim().to_string();
    let raw_path = line.get(3..)?.trim();
    let path = raw_path.rsplit(" -> ").next().unwrap_or(raw_path).to_string();
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_string();
    let (added, removed) = file_change_stats(workspace_path, &path, &status_code);

    Some(GitChangedFile {
        id: path.replace('/', "-"),
        name,
        kind: "file".to_string(),
        path,
        status: if status_code.is_empty() {
            "M".to_string()
        } else {
            status_code
        },
        added,
        removed,
    })
}

fn file_change_stats(
    workspace_path: &Path,
    relative_path: &str,
    status_code: &str,
) -> (Option<u32>, Option<u32>) {
    if status_code == "??" {
        let full_path = workspace_path.join(relative_path);
        if let Ok(content) = fs::read_to_string(full_path) {
            let lines = content.lines().count() as u32;
            return (Some(lines.max(1)), None);
        }

        return (Some(1), None);
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(workspace_path)
        .args(["diff", "--numstat", "--", relative_path])
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(first_line) = stdout.lines().next() {
            let parts: Vec<_> = first_line.split('\t').collect();
            if parts.len() >= 2 {
                let added = parts[0].parse::<u32>().ok();
                let removed = parts[1].parse::<u32>().ok();
                return (added, removed);
            }
        }
    }

    (None, None)
}

fn stderr_or_default(stderr: &[u8], fallback: &str) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

fn summarize_workspace_path(
    path: &Path,
    seen: &mut HashSet<PathBuf>,
) -> Option<WorkspaceSummary> {
    if !path.is_dir() || is_hidden(path) {
        return None;
    }

    let canonical_path = fs::canonicalize(path).ok()?;
    if !seen.insert(canonical_path.clone()) {
        return None;
    }

    let name = canonical_path.file_name()?.to_str()?;
    let slug = name.to_lowercase().replace(' ', "-");
    let id = slug.clone();
    let is_git_repo = canonical_path.join(".git").exists();
    let status = if is_git_repo { "git-ready" } else { "folder" };

    Some(WorkspaceSummary {
        id,
        name: prettify_name(name),
        slug,
        path: canonical_path.display().to_string(),
        status: status.to_string(),
        change: if is_git_repo { "+0" } else { "·" }.to_string(),
        count: 0,
    })
}

fn workspace_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;
    Ok(app_data_dir.join("workspaces.json"))
}

fn read_workspace_store(app: &AppHandle) -> Result<WorkspaceStore, String> {
    let store_path = workspace_store_path(app)?;
    if !store_path.exists() {
        return Ok(WorkspaceStore::default());
    }

    let content = fs::read_to_string(&store_path)
        .map_err(|error| format!("failed to read workspace store: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse workspace store: {error}"))
}

fn write_workspace_store(app: &AppHandle, store: &WorkspaceStore) -> Result<(), String> {
    let store_path = workspace_store_path(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize workspace store: {error}"))?;
    fs::write(&store_path, content)
        .map_err(|error| format!("failed to write workspace store: {error}"))
}

fn read_workspace_tree(
    root: &Path,
    current: &Path,
    depth: usize,
) -> Result<Vec<WorkspaceFileEntry>, String> {
    if depth > 4 {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(current)
        .map_err(|error| format!("failed to read {}: {error}", current.display()))?;
    let mut results = vec![];

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if should_skip_file_entry(name) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .display()
            .to_string();

        if path.is_dir() {
            let should_lazy_load = should_lazy_load_dir(name);
            let children = if should_lazy_load {
                vec![]
            } else {
                read_workspace_tree(root, &path, depth + 1)?
            };
            results.push(WorkspaceFileEntry {
                id: relative_path.replace('/', "-"),
                name: name.to_string(),
                path: relative_path,
                kind: "directory".to_string(),
                has_children: should_lazy_load || !children.is_empty(),
                children,
            });
        } else {
            results.push(WorkspaceFileEntry {
                id: relative_path.replace('/', "-"),
                name: name.to_string(),
                path: relative_path,
                kind: "file".to_string(),
                has_children: false,
                children: vec![],
            });
        }
    }

    results.sort_by(|left, right| match (left.kind.as_str(), right.kind.as_str()) {
        ("directory", "file") => std::cmp::Ordering::Less,
        ("file", "directory") => std::cmp::Ordering::Greater,
        _ => left.name.cmp(&right.name),
    });

    Ok(results)
}

fn should_skip_file_entry(name: &str) -> bool {
    matches!(name, ".DS_Store" | ".idea" | ".vscode")
}

fn safe_workspace_child(workspace_path: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let canonical_workspace = fs::canonicalize(workspace_path)
        .map_err(|error| format!("invalid workspace path: {error}"))?;
    let candidate = canonical_workspace.join(relative_path);
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| format!("invalid file path {}: {error}", candidate.display()))?;

    if !canonical_candidate.starts_with(&canonical_workspace) {
        return Err("file path escapes workspace".to_string());
    }

    Ok(canonical_candidate)
}

fn should_lazy_load_dir(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "dist" | "target" | "gen")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            list_workspaces,
            add_workspace,
            list_workspace_files,
            read_workspace_file,
            save_workspace_file,
            get_git_status,
            commit_git_changes,
            push_git_changes,
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
