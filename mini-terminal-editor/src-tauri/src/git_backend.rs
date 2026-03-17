use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    fs,
    io,
    path::{Path, PathBuf},
    process::{Command, Output},
};

const MAX_DIFF_BYTES: usize = 1_500_000;
const MAX_UNTRACKED_LINE_COUNT_BYTES: u64 = 512 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspacePayload {
    pub workspace_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffPayload {
    pub workspace_path: String,
    pub path: String,
    pub old_path: Option<String>,
    pub category: GitDiffCategory,
    pub status: GitFileStatus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFilePayload {
    pub workspace_path: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitPayload {
    pub workspace_path: String,
    pub message: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitDiffCategory {
    Staged,
    Unstaged,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GitCapabilityStatus {
    Available,
    MissingGit,
    NotRepository,
    UnsafeRepository,
    GitError,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: GitFileStatus,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCapabilityResponse {
    pub status: GitCapabilityStatus,
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangesStatus {
    pub branch: String,
    pub staged: Vec<GitChangedFile>,
    pub unstaged: Vec<GitChangedFile>,
    pub untracked: Vec<GitChangedFile>,
    pub has_changes: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffContents {
    pub original: String,
    pub modified: String,
    pub language: String,
    pub is_binary: bool,
    pub is_too_large: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub hash: String,
    pub summary: String,
}

#[derive(Clone, Copy)]
enum GitPathSource {
    Head,
    Index,
}

#[tauri::command]
pub fn git_get_capability(payload: GitWorkspacePayload) -> Result<GitCapabilityResponse, String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    Ok(detect_git_capability(&workspace))
}

#[tauri::command]
pub fn git_init_repository(payload: GitWorkspacePayload) -> Result<GitCapabilityResponse, String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_is_installed()?;
    run_git_checked(&workspace, ["init"])?;
    Ok(detect_git_capability(&workspace))
}

#[tauri::command]
pub fn git_get_status(payload: GitWorkspacePayload) -> Result<GitChangesStatus, String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;

    let output = run_git_checked(&workspace, ["status", "--porcelain=v1", "-z", "-b"])?;
    let mut branch = "HEAD".to_string();
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut parts = output.stdout.split(|byte| *byte == 0).peekable();

    while let Some(raw_part) = parts.next() {
        if raw_part.is_empty() {
            continue;
        }

        let part = String::from_utf8_lossy(raw_part).to_string();
        if let Some(next_branch) = parse_branch_header(&part) {
            branch = next_branch;
            continue;
        }

        if part.len() < 4 {
            continue;
        }

        let status_bytes = part.as_bytes();
        let index_status = status_bytes[0] as char;
        let worktree_status = status_bytes[1] as char;
        let path = part[3..].to_string();
        let rename_or_copy = matches!(index_status, 'R' | 'C') || matches!(worktree_status, 'R' | 'C');
        let old_path = if rename_or_copy {
            parts
                .next()
                .filter(|value| !value.is_empty())
                .map(|value| String::from_utf8_lossy(value).to_string())
        } else {
            None
        };

        if index_status == '?' && worktree_status == '?' {
            continue;
        }

        if index_status != ' ' && index_status != '?' {
            staged.push(GitChangedFile {
                path: path.clone(),
                old_path: old_path.clone(),
                status: map_status(index_status),
                additions: 0,
                deletions: 0,
            });
        }

        if worktree_status != ' ' && worktree_status != '?' {
            unstaged.push(GitChangedFile {
                path,
                old_path,
                status: map_status(worktree_status),
                additions: 0,
                deletions: 0,
            });
        }
    }

    let staged_stats = parse_numstat_output(run_git_checked(
        &workspace,
        ["diff", "--cached", "--numstat", "--no-ext-diff"],
    )?);
    let unstaged_stats = parse_numstat_output(run_git_checked(
        &workspace,
        ["diff", "--numstat", "--no-ext-diff"],
    )?);

    apply_stats(&mut staged, &staged_stats);
    apply_stats(&mut unstaged, &unstaged_stats);
    let mut untracked = list_untracked_files(&workspace)?;
    apply_untracked_line_counts(&workspace, &mut untracked);

    let has_changes = !(staged.is_empty() && unstaged.is_empty() && untracked.is_empty());
    Ok(GitChangesStatus {
        branch,
        staged,
        unstaged,
        untracked,
        has_changes,
    })
}

#[tauri::command]
pub fn git_get_diff_contents(payload: GitDiffPayload) -> Result<GitDiffContents, String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    validate_git_relative_path(&workspace, &payload.path)?;
    if let Some(old_path) = payload.old_path.as_deref() {
        validate_git_relative_path(&workspace, old_path)?;
    }

    let language = detect_language(&payload.path);
    let file = GitChangedFile {
        path: payload.path.clone(),
        old_path: payload.old_path.clone(),
        status: payload.status,
        additions: 0,
        deletions: 0,
    };

    let original_path = payload
        .old_path
        .or(file.old_path.clone())
        .unwrap_or_else(|| payload.path.clone());
    let original_bytes = match payload.category {
        GitDiffCategory::Staged => read_original_for_staged(&workspace, &file, &original_path)?,
        GitDiffCategory::Unstaged => read_original_for_unstaged(&workspace, &file, &original_path)?,
    };
    let modified_bytes = match payload.category {
        GitDiffCategory::Staged => read_modified_for_staged(&workspace, &file)?,
        GitDiffCategory::Unstaged => read_modified_for_unstaged(&workspace, &file)?,
    };

    let is_binary = original_bytes
        .as_ref()
        .is_some_and(|bytes| contains_nul(bytes))
        || modified_bytes
            .as_ref()
            .is_some_and(|bytes| contains_nul(bytes));
    let is_too_large = original_bytes
        .as_ref()
        .is_some_and(|bytes| bytes.len() > MAX_DIFF_BYTES)
        || modified_bytes
            .as_ref()
            .is_some_and(|bytes| bytes.len() > MAX_DIFF_BYTES);

    if is_binary || is_too_large {
        return Ok(GitDiffContents {
            original: String::new(),
            modified: String::new(),
            language,
            is_binary,
            is_too_large,
        });
    }

    Ok(GitDiffContents {
        original: bytes_to_text(original_bytes.as_deref()),
        modified: bytes_to_text(modified_bytes.as_deref()),
        language,
        is_binary: false,
        is_too_large: false,
    })
}

#[tauri::command]
pub fn git_stage_file(payload: GitFilePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    validate_git_relative_path(&workspace, &payload.path)?;
    run_git_checked(&workspace, ["add", "--", payload.path.as_str()]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage_file(payload: GitFilePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    validate_git_relative_path(&workspace, &payload.path)?;
    unstage_paths(&workspace, &[payload.path])
}

#[tauri::command]
pub fn git_stage_all(payload: GitWorkspacePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    run_git_checked(&workspace, ["add", "-A"]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage_all(payload: GitWorkspacePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    let status = git_get_status(GitWorkspacePayload {
        workspace_path: payload.workspace_path,
    })?;
    let staged_paths: Vec<String> = status.staged.into_iter().map(|file| file.path).collect();
    if staged_paths.is_empty() {
        return Ok(());
    }
    unstage_paths(&workspace, &staged_paths)
}

#[tauri::command]
pub fn git_discard_file(payload: GitFilePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    validate_git_relative_path(&workspace, &payload.path)?;

    let status = git_get_status(GitWorkspacePayload {
        workspace_path: payload.workspace_path,
    })?;
    if status.untracked.iter().any(|file| file.path == payload.path) {
        let absolute = workspace.join(&payload.path);
        if absolute.is_dir() {
            fs::remove_dir_all(&absolute)
                .map_err(|error| format!("failed to delete {}: {error}", payload.path))?;
        } else if absolute.exists() {
            fs::remove_file(&absolute)
                .map_err(|error| format!("failed to delete {}: {error}", payload.path))?;
        }
        return Ok(());
    }

    if run_git_checked(
        &workspace,
        ["restore", "--worktree", "--source=HEAD", "--", payload.path.as_str()],
    )
    .is_err()
    {
        run_git_checked(&workspace, ["checkout", "--", payload.path.as_str()])?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_discard_all(payload: GitWorkspacePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    let status = git_get_status(GitWorkspacePayload {
        workspace_path: payload.workspace_path,
    })?;

    for file in status.untracked {
        let absolute = workspace.join(&file.path);
        if absolute.is_dir() {
            let _ = fs::remove_dir_all(&absolute);
        } else {
            let _ = fs::remove_file(&absolute);
        }
    }

    if run_git_checked(&workspace, ["restore", "--worktree", "--source=HEAD", "--", "."]).is_err()
    {
        run_git_checked(&workspace, ["checkout", "--", "."])?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(payload: GitCommitPayload) -> Result<GitCommitResult, String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    let message = payload.message.trim();
    if message.is_empty() {
        return Err("Commit message is required".to_string());
    }

    run_git_checked(&workspace, ["commit", "-m", message])?;
    let output = run_git_checked(&workspace, ["rev-parse", "HEAD"])?;
    let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(GitCommitResult {
        hash,
        summary: message.to_string(),
    })
}

fn canonical_workspace(workspace_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(workspace_path);
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("invalid workspace path {}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err("workspace path is not a directory".to_string());
    }
    Ok(canonical)
}

fn detect_git_capability(workspace: &Path) -> GitCapabilityResponse {
    if let Err(error) = ensure_git_binary() {
        return GitCapabilityResponse {
            status: GitCapabilityStatus::MissingGit,
            message: Some(error),
        };
    }

    match run_git(&workspace, ["rev-parse", "--show-toplevel"]) {
        Ok(output) if output.status.success() => GitCapabilityResponse {
            status: GitCapabilityStatus::Available,
            message: None,
        },
        Ok(output) => {
            let stderr = preferred_git_error(&output);
            if is_not_repository_error(&stderr) {
                GitCapabilityResponse {
                    status: GitCapabilityStatus::NotRepository,
                    message: Some(stderr),
                }
            } else if is_unsafe_repository_error(&stderr) {
                GitCapabilityResponse {
                    status: GitCapabilityStatus::UnsafeRepository,
                    message: Some(stderr),
                }
            } else {
                GitCapabilityResponse {
                    status: GitCapabilityStatus::GitError,
                    message: Some(stderr),
                }
            }
        }
        Err(error) => GitCapabilityResponse {
            status: GitCapabilityStatus::GitError,
            message: Some(error.to_string()),
        },
    }
}

fn ensure_git_is_installed() -> Result<(), String> {
    ensure_git_binary().map(|_| ())
}

fn ensure_git_binary() -> Result<Output, String> {
    Command::new("git")
        .arg("--version")
        .output()
        .map_err(|_| "Git is not installed or not available in PATH.".to_string())
}

fn ensure_git_repo_ready(workspace: &Path) -> Result<(), String> {
    match detect_git_capability(workspace).status {
        GitCapabilityStatus::Available => Ok(()),
        GitCapabilityStatus::MissingGit => Err("Git is not installed or not available in PATH.".to_string()),
        GitCapabilityStatus::NotRepository => Err("The selected workspace is not a Git repository.".to_string()),
        GitCapabilityStatus::UnsafeRepository => Err("Git blocked this repository because it is not marked as a safe.directory.".to_string()),
        GitCapabilityStatus::GitError => Err("Failed to access this Git repository.".to_string()),
    }
}

fn validate_git_relative_path(workspace: &Path, relative_path: &str) -> Result<(), String> {
    let _ = super::safe_workspace_path_for_create(workspace, relative_path)?;
    Ok(())
}

fn run_git<I, S>(workspace: &Path, args: I) -> io::Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    Command::new("git")
        .current_dir(workspace)
        .args(args)
        .output()
}

fn run_git_checked<I, S>(workspace: &Path, args: I) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_git(workspace, args).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            "Git is not installed or not available in PATH.".to_string()
        } else {
            format!("Failed to run git: {error}")
        }
    })?;
    if output.status.success() {
        return Ok(output);
    }
    Err(preferred_git_error(&output))
}

fn preferred_git_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    "Git command failed.".to_string()
}

fn is_not_repository_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("not a git repository")
}

fn is_unsafe_repository_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("detected dubious ownership") || lower.contains("safe.directory")
}

fn parse_branch_header(header: &str) -> Option<String> {
    if !header.starts_with("## ") {
        return None;
    }
    let branch_info = header.trim_start_matches("## ").trim();
    let branch = branch_info
        .strip_prefix("No commits yet on ")
        .or_else(|| branch_info.strip_prefix("Initial commit on "))
        .unwrap_or(branch_info)
        .split("...")
        .next()
        .unwrap_or("HEAD")
        .trim();
    if branch.is_empty() || branch == "HEAD (no branch)" {
        Some("HEAD".to_string())
    } else {
        Some(branch.to_string())
    }
}

fn map_status(status: char) -> GitFileStatus {
    match status {
        'A' => GitFileStatus::Added,
        'D' => GitFileStatus::Deleted,
        'R' => GitFileStatus::Renamed,
        'C' => GitFileStatus::Copied,
        '?' => GitFileStatus::Untracked,
        _ => GitFileStatus::Modified,
    }
}

fn parse_numstat_output(output: Output) -> std::collections::HashMap<String, (u32, u32)> {
    let mut stats = std::collections::HashMap::new();
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let mut parts = line.split('\t');
        let additions = parse_numstat_number(parts.next());
        let deletions = parse_numstat_number(parts.next());
        let raw_path = match parts.next() {
            Some(value) if !value.is_empty() => value,
            _ => continue,
        };

        for path in expand_numstat_paths(raw_path) {
            stats.insert(path, (additions, deletions));
        }
    }
    stats
}

fn parse_numstat_number(value: Option<&str>) -> u32 {
    match value.unwrap_or_default() {
        "-" => 0,
        other => other.parse::<u32>().unwrap_or(0),
    }
}

fn expand_numstat_paths(raw_path: &str) -> Vec<String> {
    if !raw_path.contains(" => ") {
        return vec![raw_path.to_string()];
    }

    if let (Some(start), Some(end)) = (raw_path.find('{'), raw_path.find('}')) {
        let prefix = &raw_path[..start];
        let suffix = &raw_path[end + 1..];
        let middle = &raw_path[start + 1..end];
        let mut parts = middle.splitn(2, " => ");
        if let (Some(from), Some(to)) = (parts.next(), parts.next()) {
            return vec![format!("{prefix}{from}{suffix}"), format!("{prefix}{to}{suffix}")];
        }
    }

    let mut parts = raw_path.splitn(2, " => ");
    if let (Some(from), Some(to)) = (parts.next(), parts.next()) {
        return vec![from.to_string(), to.to_string()];
    }

    vec![raw_path.to_string()]
}

fn apply_stats(
    files: &mut [GitChangedFile],
    stats: &std::collections::HashMap<String, (u32, u32)>,
) {
    for file in files {
        if let Some((additions, deletions)) = stats.get(&file.path) {
            file.additions = *additions;
            file.deletions = *deletions;
            continue;
        }
        if let Some(old_path) = file.old_path.as_ref() {
            if let Some((additions, deletions)) = stats.get(old_path) {
                file.additions = *additions;
                file.deletions = *deletions;
            }
        }
    }
}

fn apply_untracked_line_counts(workspace: &Path, files: &mut [GitChangedFile]) {
    for file in files {
        let absolute = workspace.join(&file.path);
        let Ok(metadata) = fs::metadata(&absolute) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_UNTRACKED_LINE_COUNT_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&absolute) else {
            continue;
        };
        if contains_nul(&bytes) {
            continue;
        }
        file.additions = count_lines(&bytes);
        file.deletions = 0;
    }
}

fn list_untracked_files(workspace: &Path) -> Result<Vec<GitChangedFile>, String> {
    let output = run_git_checked(workspace, ["ls-files", "--others", "--exclude-standard", "-z"])?;
    let mut files = Vec::new();

    for raw_part in output.stdout.split(|byte| *byte == 0) {
        if raw_part.is_empty() {
            continue;
        }

        let path = String::from_utf8_lossy(raw_part).to_string();
        files.push(GitChangedFile {
            path,
            old_path: None,
            status: GitFileStatus::Untracked,
            additions: 0,
            deletions: 0,
        });
    }

    Ok(files)
}

fn count_lines(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        return 0;
    }
    let text = String::from_utf8_lossy(bytes);
    let count = text.lines().count() as u32;
    if text.ends_with('\n') {
        count
    } else {
        count.max(1)
    }
}

fn read_original_for_staged(
    workspace: &Path,
    file: &GitChangedFile,
    original_path: &str,
) -> Result<Option<Vec<u8>>, String> {
    match file.status {
        GitFileStatus::Added | GitFileStatus::Untracked => Ok(None),
        _ => git_path_contents(workspace, GitPathSource::Head, original_path),
    }
}

fn read_modified_for_staged(
    workspace: &Path,
    file: &GitChangedFile,
) -> Result<Option<Vec<u8>>, String> {
    match file.status {
        GitFileStatus::Deleted => Ok(None),
        _ => git_path_contents(workspace, GitPathSource::Index, &file.path),
    }
}

fn read_original_for_unstaged(
    workspace: &Path,
    file: &GitChangedFile,
    original_path: &str,
) -> Result<Option<Vec<u8>>, String> {
    match file.status {
        GitFileStatus::Added | GitFileStatus::Untracked => Ok(None),
        _ => {
            let index_bytes = git_path_contents(workspace, GitPathSource::Index, original_path)?;
            if index_bytes.is_some() {
                Ok(index_bytes)
            } else {
                git_path_contents(workspace, GitPathSource::Head, original_path)
            }
        }
    }
}

fn read_modified_for_unstaged(
    workspace: &Path,
    file: &GitChangedFile,
) -> Result<Option<Vec<u8>>, String> {
    match file.status {
        GitFileStatus::Deleted => Ok(None),
        _ => {
            let absolute = workspace.join(&file.path);
            if !absolute.exists() {
                return Ok(None);
            }
            fs::read(&absolute)
                .map(Some)
                .map_err(|error| format!("failed to read {}: {error}", file.path))
        }
    }
}

fn git_path_contents(
    workspace: &Path,
    source: GitPathSource,
    path: &str,
) -> Result<Option<Vec<u8>>, String> {
    let spec = match source {
        GitPathSource::Head => format!("HEAD:{path}"),
        GitPathSource::Index => format!(":{path}"),
    };
    let output = run_git(workspace, ["show", spec.as_str()]).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            "Git is not installed or not available in PATH.".to_string()
        } else {
            format!("Failed to run git show: {error}")
        }
    })?;
    if output.status.success() {
        return Ok(Some(output.stdout));
    }

    let error = preferred_git_error(&output);
    if is_missing_git_object_error(&error) {
        return Ok(None);
    }
    Err(error)
}

fn is_missing_git_object_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("does not exist in")
        || lower.contains("exists on disk, but not in")
        || lower.contains("path '")
        || lower.contains("invalid object name")
        || lower.contains("bad revision")
}

fn bytes_to_text(bytes: Option<&[u8]>) -> String {
    bytes
        .map(|value| String::from_utf8_lossy(value).to_string())
        .unwrap_or_default()
}

fn contains_nul(bytes: &[u8]) -> bool {
    bytes.iter().any(|byte| *byte == 0)
}

fn detect_language(path: &str) -> String {
    match path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "js" | "jsx" => "javascript".to_string(),
        "ts" | "tsx" => "typescript".to_string(),
        "json" => "json".to_string(),
        "html" | "htm" => "html".to_string(),
        "css" | "scss" => "css".to_string(),
        "md" | "markdown" => "markdown".to_string(),
        "py" => "python".to_string(),
        "xml" => "xml".to_string(),
        "rs" => "rust".to_string(),
        "sh" | "zsh" | "bash" => "shell".to_string(),
        _ => "text".to_string(),
    }
}

fn unstage_paths(workspace: &Path, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let mut restore_args = vec!["restore", "--staged", "--"];
    for path in paths {
        restore_args.push(path.as_str());
    }
    if run_git_checked(workspace, restore_args).is_ok() {
        return Ok(());
    }

    let mut reset_args = vec!["reset", "HEAD", "--"];
    for path in paths {
        reset_args.push(path.as_str());
    }
    if run_git_checked(workspace, reset_args).is_ok() {
        return Ok(());
    }

    for path in paths {
        run_git_checked(workspace, ["rm", "--cached", "-r", "--", path.as_str()])?;
    }
    Ok(())
}
