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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutBranchPayload {
    pub workspace_path: String,
    pub branch: String,
    pub kind: GitBranchKind,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateBranchPayload {
    pub workspace_path: String,
    pub name: String,
    pub from: Option<String>,
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

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitBranchKind {
    Local,
    Remote,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchList {
    pub current: String,
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author_name: String,
    pub author_relative_time: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub is_head: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphResponse {
    pub commits: Vec<GitGraphCommit>,
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
pub fn git_list_branches(payload: GitWorkspacePayload) -> Result<GitBranchList, String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;

    let current = git_get_status(GitWorkspacePayload {
        workspace_path: payload.workspace_path.clone(),
    })?
    .branch;

    let local = parse_branch_lines(run_git_checked(
        &workspace,
        ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?);
    let remote = parse_branch_lines(run_git_checked(
        &workspace,
        ["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    )?)
    .into_iter()
    .filter(|branch| !branch.contains("HEAD ->"))
    .collect();

    Ok(GitBranchList {
        current,
        local,
        remote,
    })
}

#[tauri::command]
pub fn git_checkout_branch(payload: GitCheckoutBranchPayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    let branch = payload.branch.trim();
    if branch.is_empty() {
        return Err("Branch name is required.".to_string());
    }

    match payload.kind {
        GitBranchKind::Local => run_git_checked(&workspace, ["checkout", branch]).map(|_| ()),
        GitBranchKind::Remote => {
            let local_name = local_branch_name_from_remote(branch);
            if local_branch_exists(&workspace, &local_name)? {
                run_git_checked(&workspace, ["checkout", local_name.as_str()]).map(|_| ())
            } else {
                run_git_checked(
                    &workspace,
                    ["checkout", "-b", local_name.as_str(), "--track", branch],
                )
                .map(|_| ())
            }
        }
    }
}

#[tauri::command]
pub fn git_create_branch(payload: GitCreateBranchPayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;

    let name = payload.name.trim();
    if name.is_empty() {
        return Err("Branch name is required.".to_string());
    }
    ensure_valid_branch_name(&workspace, name)?;

    let from = payload.from.as_deref().map(str::trim).filter(|value| !value.is_empty());
    if let Some(source) = from {
        run_git_checked(&workspace, ["checkout", "-b", name, source]).map(|_| ())
    } else {
        run_git_checked(&workspace, ["checkout", "-b", name]).map(|_| ())
    }
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

#[tauri::command]
pub fn git_get_graph(payload: GitWorkspacePayload) -> Result<GitGraphResponse, String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;

    let head_hash = match run_git_checked(&workspace, ["rev-parse", "--verify", "HEAD"]) {
        Ok(output) => Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
        Err(error) if is_missing_revision_error(&error) => None,
        Err(error) => return Err(error),
    };

    let log_output = match run_git_checked(
        &workspace,
        [
            "log",
            "--max-count=40",
            "--topo-order",
            "--decorate=short",
            "--date=relative",
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%P%x1f%D%x1f%s%x1e",
            "HEAD",
        ],
    ) {
        Ok(output) => output,
        Err(error) if is_no_commits_error(&error) => {
            return Ok(GitGraphResponse { commits: Vec::new() });
        }
        Err(error) => return Err(error),
    };

    let commits = parse_git_graph_output(&log_output.stdout, head_hash.as_deref());
    Ok(GitGraphResponse { commits })
}

#[tauri::command]
pub fn git_fetch_all_remotes(payload: GitWorkspacePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    run_git_checked(&workspace, ["fetch", "--all", "--prune"]).map(|_| ())
}

#[tauri::command]
pub fn git_pull(payload: GitWorkspacePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    run_git_checked(&workspace, ["pull", "--ff-only"]).map(|_| ())
}

#[tauri::command]
pub fn git_push(payload: GitWorkspacePayload) -> Result<(), String> {
    let workspace = canonical_workspace(&payload.workspace_path)?;
    ensure_git_repo_ready(&workspace)?;
    run_git_checked(&workspace, ["push"]).map(|_| ())
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

fn parse_branch_lines(output: Output) -> Vec<String> {
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_git_graph_output(stdout: &[u8], head_hash: Option<&str>) -> Vec<GitGraphCommit> {
    let mut commits = Vec::new();

    for raw_record in stdout.split(|byte| *byte == 0x1e) {
        if raw_record.is_empty() {
            continue;
        }

        let record = String::from_utf8_lossy(raw_record);
        let fields: Vec<&str> = record.split('\x1f').collect();
        if fields.len() < 7 {
            continue;
        }

        let hash = fields[0].trim().to_string();
        if hash.is_empty() {
            continue;
        }

        commits.push(GitGraphCommit {
            short_hash: fields[1].trim().to_string(),
            author_name: fields[2].trim().to_string(),
            author_relative_time: fields[3].trim().to_string(),
            parents: split_git_graph_list(fields[4]),
            refs: split_git_graph_refs(fields[5]),
            subject: fields[6].trim().to_string(),
            is_head: head_hash.is_some_and(|head| head == hash),
            hash,
        });
    }

    commits
}

fn split_git_graph_list(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn split_git_graph_refs(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
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
        return vec![decode_git_quoted_path(raw_path)];
    }

    if let (Some(start), Some(end)) = (raw_path.find('{'), raw_path.find('}')) {
        let prefix = &raw_path[..start];
        let suffix = &raw_path[end + 1..];
        let middle = &raw_path[start + 1..end];
        let mut parts = middle.splitn(2, " => ");
        if let (Some(from), Some(to)) = (parts.next(), parts.next()) {
            return vec![
                decode_git_quoted_path(&format!("{prefix}{from}{suffix}")),
                decode_git_quoted_path(&format!("{prefix}{to}{suffix}")),
            ];
        }
    }

    let mut parts = raw_path.splitn(2, " => ");
    if let (Some(from), Some(to)) = (parts.next(), parts.next()) {
        return vec![decode_git_quoted_path(from), decode_git_quoted_path(to)];
    }

    vec![decode_git_quoted_path(raw_path)]
}

fn decode_git_quoted_path(raw_path: &str) -> String {
    if raw_path.len() < 2 || !raw_path.starts_with('"') || !raw_path.ends_with('"') {
        return raw_path.to_string();
    }

    let inner = &raw_path[1..raw_path.len() - 1];
    let mut decoded = Vec::with_capacity(inner.len());
    let bytes = inner.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        if byte != b'\\' {
            decoded.push(byte);
            index += 1;
            continue;
        }

        index += 1;
        if index >= bytes.len() {
            decoded.push(b'\\');
            break;
        }

        match bytes[index] {
            b'\\' => {
                decoded.push(b'\\');
                index += 1;
            }
            b'"' => {
                decoded.push(b'"');
                index += 1;
            }
            b't' => {
                decoded.push(b'\t');
                index += 1;
            }
            b'n' => {
                decoded.push(b'\n');
                index += 1;
            }
            b'r' => {
                decoded.push(b'\r');
                index += 1;
            }
            b'0'..=b'7' => {
                let mut value = 0u8;
                let mut consumed = 0;
                while consumed < 3 && index < bytes.len() {
                    let next = bytes[index];
                    if !(b'0'..=b'7').contains(&next) {
                        break;
                    }
                    value = (value << 3) + (next - b'0');
                    index += 1;
                    consumed += 1;
                }
                decoded.push(value);
            }
            other => {
                decoded.push(other);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).to_string()
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

fn local_branch_name_from_remote(branch: &str) -> String {
    branch
        .split_once('/')
        .map(|(_, name)| name)
        .unwrap_or(branch)
        .to_string()
}

fn local_branch_exists(workspace: &Path, branch: &str) -> Result<bool, String> {
    let output = run_git(
        workspace,
        ["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")],
    )
    .map_err(|error| format!("Failed to inspect local branches: {error}"))?;
    Ok(output.status.success())
}

fn ensure_valid_branch_name(workspace: &Path, branch: &str) -> Result<(), String> {
    run_git_checked(workspace, ["check-ref-format", "--branch", branch]).map(|_| ())
}

fn is_missing_git_object_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("does not exist in")
        || lower.contains("exists on disk, but not in")
        || lower.contains("path '")
        || lower.contains("invalid object name")
        || lower.contains("bad revision")
}

fn is_missing_revision_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("unknown revision or path not in the working tree")
        || lower.contains("fatal: ambiguous argument 'head'")
        || lower.contains("fatal: needed a single revision")
        || lower.contains("fatal: your current branch '")
        || lower.contains("fatal: no names found, cannot describe anything.")
}

fn is_no_commits_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("does not have any commits yet")
        || lower.contains("unknown revision or path not in the working tree")
        || lower.contains("fatal: ambiguous argument 'head'")
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
