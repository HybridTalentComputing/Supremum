import {
  type ChangedFile,
  changedFiles,
  formatWorkspacePath,
  type WorkspaceContext
} from "../../lib/mock-data/workbench";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

type ChangesPanelProps = {
  workspace: WorkspaceContext;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
};

type GitStatusResponse = {
  branch: string;
  isGitRepo: boolean;
  ahead: number;
  changedFiles: ChangedFile[];
};

type GitCommitResponse = {
  summary: string;
};

type GitPushResponse = {
  summary: string;
};

type TreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "group" | "file";
  children?: TreeNode[];
  file?: ChangedFile;
  count: number;
};

type WorkspaceFileEntry = {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  hasChildren: boolean;
  children: WorkspaceFileEntry[];
};

function formatDelta(value?: number) {
  if (!value) {
    return null;
  }

  return `+${value}`;
}

function formatRemoved(value?: number) {
  if (!value) {
    return null;
  }

  return `-${value}`;
}

function statusGlyph(status?: string) {
  if (status === "??") {
    return "+";
  }

  if (status?.includes("M")) {
    return "•";
  }

  if (status?.includes("D")) {
    return "-";
  }

  return "•";
}

function buildTree(files: ChangedFile[]) {
  const rootFiles: ChangedFile[] = [];
  const groups = new Map<string, ChangedFile[]>();

  for (const file of files) {
    const path = file.path ?? file.name;
    const segments = path.split("/").filter(Boolean);
    if (segments.length <= 1) {
      rootFiles.push(file);
      continue;
    }

    const groupKey = segments.slice(0, -1).join("/");
    const groupEntries = groups.get(groupKey) ?? [];
    groupEntries.push(file);
    groups.set(groupKey, groupEntries);
  }

  const nodes: TreeNode[] = [];

  if (rootFiles.length > 0) {
    nodes.push({
      id: "root-files",
      name: "Root Path",
      path: "",
      kind: "group",
      count: rootFiles.length,
      children: rootFiles.map((file) => ({
        id: file.id,
        name: file.name,
        path: file.path ?? file.name,
        kind: "file",
        file,
        count: 1
      }))
    });
  }

  const groupKeys = [...groups.keys()].sort();
  for (const groupKey of groupKeys) {
    const groupFiles = groups.get(groupKey) ?? [];
    nodes.push({
      id: groupKey,
      name: groupKey,
      path: groupKey,
      kind: "group",
      count: groupFiles.length,
      children: groupFiles
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((file) => ({
          id: file.id,
          name: file.name,
          path: file.path ?? file.name,
          kind: "file",
          file,
          count: 1
        }))
    });
  }

  return nodes;
}

function TreeRow({
  node,
  depth = 0,
  activeFilePath,
  onSelectFile
}: {
  node: TreeNode;
  depth?: number;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
}) {
  if (node.kind === "group") {
    return (
      <div className="changes-tree-group">
        <div className="changes-tree-row changes-tree-group-row" style={{ paddingLeft: `${depth * 14}px` }}>
          <div className="changes-tree-main">
            <span className="changes-tree-caret">⌄</span>
            <span className="changes-tree-group-name">{node.name}</span>
          </div>
          <span className="changes-tree-group-count">{node.count}</span>
        </div>
        <div className="changes-tree-children">
          {node.children?.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      </div>
    );
  }

  const file = node.file;
  return (
    <button
      type="button"
      className={`changes-tree-row changes-tree-file-row changes-tree-file-button${
        activeFilePath === node.path ? " is-active" : ""
      }`}
      style={{ paddingLeft: `${depth * 14}px` }}
      onClick={() => onSelectFile(node.path)}
    >
      <div className="changes-tree-main">
        <span className={`changes-file-status changes-file-status-${file?.status === "??" ? "new" : "modified"}`}>
          {statusGlyph(file?.status)}
        </span>
        <span className="changes-file-name" title={node.path}>{node.name}</span>
      </div>
      <div className="changes-tree-statics">
        {formatDelta(file?.added) ? <span className="change-added">{formatDelta(file?.added)}</span> : null}
        {formatRemoved(file?.removed) ? <span className="change-removed">{formatRemoved(file?.removed)}</span> : null}
      </div>
    </button>
  );
}

function fileIconClass(name: string) {
  if (name === "package.json" || name === "package-lock.json") {
    return "is-package";
  }
  if (name.endsWith(".ts") || name.endsWith(".tsx")) {
    return "is-typescript";
  }
  if (name.endsWith(".rs")) {
    return "is-rust";
  }
  if (name.endsWith(".json")) {
    return "is-json";
  }
  if (name.endsWith(".md")) {
    return "is-markdown";
  }
  if (name.startsWith(".")) {
    return "is-dotfile";
  }
  return "is-file";
}

function filterWorkspaceFiles(entries: WorkspaceFileEntry[], query: string): WorkspaceFileEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries;
  }

  return entries
    .map((entry) => {
      if (entry.kind === "file") {
        const match = entry.name.toLowerCase().includes(normalized) || entry.path.toLowerCase().includes(normalized);
        return match ? entry : null;
      }

      const children = filterWorkspaceFiles(entry.children, query);
      const match = entry.name.toLowerCase().includes(normalized) || entry.path.toLowerCase().includes(normalized);
      if (match || children.length > 0) {
        return {
          ...entry,
          children
        };
      }

      return null;
    })
    .filter((entry): entry is WorkspaceFileEntry => entry !== null);
}

function FileTreeRow({
  entry,
  depth = 0,
  expandedDirectories,
  onToggleDirectory,
  activeFilePath,
  onSelectFile
}: {
  entry: WorkspaceFileEntry;
  depth?: number;
  expandedDirectories: Set<string>;
  onToggleDirectory: (id: string) => void;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
}) {
  if (entry.kind === "directory") {
    const expanded = expandedDirectories.has(entry.id);
    const showChildren = expanded && entry.children.length > 0;

    return (
      <div className="changes-tree-group">
        <button
          type="button"
          className="changes-tree-row changes-tree-group-row changes-tree-toggle"
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => onToggleDirectory(entry.id)}
        >
          <div className="changes-tree-main">
            <span className="changes-tree-caret">{expanded ? "⌄" : "›"}</span>
            <span className={`changes-folder-icon${expanded ? " is-open" : ""}`}>◪</span>
            <span className="changes-tree-group-name">{entry.name}</span>
          </div>
          {entry.hasChildren ? (
            <span className="changes-tree-group-count">{entry.children.length || ""}</span>
          ) : null}
        </button>
        {showChildren ? (
          <div className="changes-tree-children">
            {entry.children.map((child) => (
              <FileTreeRow
                key={child.id}
                entry={child}
                depth={depth + 1}
                expandedDirectories={expandedDirectories}
                onToggleDirectory={onToggleDirectory}
                activeFilePath={activeFilePath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`changes-tree-row changes-tree-file-row changes-tree-file-button${
        activeFilePath === entry.path ? " is-active" : ""
      }`}
      style={{ paddingLeft: `${depth * 14}px` }}
      onClick={() => onSelectFile(entry.path)}
    >
      <div className="changes-tree-main">
        <span className={`changes-file-glyph ${fileIconClass(entry.name)}`}>▣</span>
        <span className="changes-file-name" title={entry.path}>
          {entry.name}
        </span>
      </div>
    </button>
  );
}

export function ChangesPanel({
  workspace,
  activeFilePath,
  onSelectFile
}: ChangesPanelProps) {
  const [activeTab, setActiveTab] = useState<"changes" | "files">("changes");
  const [fileSearch, setFileSearch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [branch, setBranch] = useState("main");
  const [ahead, setAhead] = useState(0);
  const [files, setFiles] = useState<ChangedFile[]>(changedFiles);
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(["src-tauri", "src"])
  );

  const tree = useMemo(() => buildTree(files), [files]);
  const filteredWorkspaceFiles = useMemo(
    () => filterWorkspaceFiles(workspaceFiles, fileSearch),
    [workspaceFiles, fileSearch]
  );

  async function loadGitStatus() {
    setIsLoading(true);

    try {
      const result = await invoke<GitStatusResponse>("get_git_status", {
        payload: { workspacePath: workspace.path }
      });

      setBranch(result.branch || "detached");
      setAhead(result.ahead);
      setIsGitRepo(result.isGitRepo);
      setFiles(result.changedFiles);
    } catch {
      setBranch("main");
      setAhead(0);
      setIsGitRepo(true);
      setFiles(changedFiles);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadGitStatus();
  }, [workspace.path]);

  useEffect(() => {
    async function loadWorkspaceFiles() {
      setIsLoadingFiles(true);
      try {
        const result = await invoke<WorkspaceFileEntry[]>("list_workspace_files", {
          payload: { workspacePath: workspace.path }
        });
        setWorkspaceFiles(result);
      } catch {
        setWorkspaceFiles([]);
      } finally {
        setIsLoadingFiles(false);
      }
    }

    void loadWorkspaceFiles();
  }, [workspace.path]);

  useEffect(() => {
    setCommitMessage("");
    setFeedbackMessage(null);
    setActiveTab("changes");
    setFileSearch("");
    setExpandedDirectories(new Set(["src-tauri", "src"]));
  }, [workspace.path]);

  function toggleDirectory(id: string) {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const hasUncommittedChanges = files.length > 0;
  const canCommit =
    isGitRepo &&
    hasUncommittedChanges &&
    commitMessage.trim().length > 0 &&
    !isCommitting &&
    !isPushing &&
    !isLoading;
  const canPush =
    isGitRepo &&
    !hasUncommittedChanges &&
    ahead > 0 &&
    !isPushing &&
    !isCommitting &&
    !isLoading;

  async function handleCommit() {
    if (!canCommit) {
      return;
    }

    setIsCommitting(true);
    setFeedbackMessage(null);

    try {
      const result = await invoke<GitCommitResponse>("commit_git_changes", {
        payload: {
          workspacePath: workspace.path,
          message: commitMessage
        }
      });
      setCommitMessage("");
      setFeedbackMessage(result.summary || "Commit created.");
      await loadGitStatus();
    } catch (error) {
      setFeedbackMessage(
        error instanceof Error ? error.message : "Unable to create commit."
      );
    } finally {
      setIsCommitting(false);
    }
  }

  async function handlePush() {
    if (!canPush) {
      return;
    }

    setIsPushing(true);
    setFeedbackMessage(null);

    try {
      const result = await invoke<GitPushResponse>("push_git_changes", {
        payload: {
          workspacePath: workspace.path
        }
      });
      setFeedbackMessage(result.summary || "Push completed.");
      await loadGitStatus();
    } catch (error) {
      setFeedbackMessage(
        error instanceof Error ? error.message : "Unable to push changes."
      );
    } finally {
      setIsPushing(false);
    }
  }

  return (
    <aside className="changes-panel">
      <div className="changes-tabs">
        <button
          type="button"
          className={`changes-tab${activeTab === "changes" ? " is-active" : ""}`}
          onClick={() => setActiveTab("changes")}
        >
          Changes
        </button>
        <button
          type="button"
          className={`changes-tab${activeTab === "files" ? " is-active" : ""}`}
          onClick={() => setActiveTab("files")}
        >
          Files
        </button>
        <div className="changes-tab-actions">
          <button type="button" className="changes-icon-button">⤢</button>
          <button type="button" className="changes-icon-button">×</button>
        </div>
      </div>

      {activeTab === "changes" ? (
        <>
          <div className="changes-toolbar">
            <button type="button" className="changes-icon-button">⌥</button>
            <button type="button" className="changes-icon-button">⇩</button>
            <button type="button" className="changes-icon-button">☰</button>
            <button type="button" className="changes-icon-button">↻</button>
          </div>

          <div className="changes-panel-header">
            <div>
              <p className="changes-title">Review Changes</p>
              <p className="changes-subtitle">{workspace.name}</p>
            </div>
            <span className="changes-branch">⌘ {branch}</span>
          </div>

          <div className="changes-workspace-path">
            {formatWorkspacePath(workspace.path)}
          </div>

          <label className="changes-input-shell">
            <input
              className="changes-input"
              type="text"
              placeholder="Commit message"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              disabled={!isGitRepo || !hasUncommittedChanges || isCommitting || isPushing}
            />
          </label>

          <button
            className="push-button"
            type="button"
            onClick={() => void (hasUncommittedChanges ? handleCommit() : handlePush())}
            disabled={hasUncommittedChanges ? !canCommit : !canPush}
          >
            <span>
              {hasUncommittedChanges
                ? isCommitting
                  ? "Committing..."
                  : "Commit Changes"
                : isPushing
                  ? "Pushing..."
                  : "Publish Branch"}
            </span>
            <span className="push-count">{hasUncommittedChanges ? files.length : ahead}</span>
          </button>

          {feedbackMessage ? (
            <div className="changes-feedback">{feedbackMessage}</div>
          ) : null}

          <div className="changes-files-region">
            <div className="changes-section-header">
              <div className="changes-section-title">
                <span>⌄</span>
                <span>Unstaged</span>
                <span className="changes-section-count">{files.length}</span>
              </div>
              <button type="button" className="changes-add-button">＋</button>
            </div>

            <div className="changes-list">
              {isLoading ? <div className="changes-empty-state">Loading git status...</div> : null}
              {!isLoading && !isGitRepo ? (
                <div className="changes-empty-state">This workspace is not a Git repository.</div>
              ) : null}
              {!isLoading && isGitRepo && files.length === 0 ? (
                <div className="changes-empty-state">Working tree is clean.</div>
              ) : null}
              {!isLoading && isGitRepo && tree.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  activeFilePath={activeFilePath}
                  onSelectFile={onSelectFile}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <label className="changes-search-shell">
            <input
              className="changes-input"
              type="text"
              placeholder="Search files..."
              value={fileSearch}
              onChange={(event) => setFileSearch(event.target.value)}
            />
          </label>

          <div className="changes-toolbar">
            <button type="button" className="changes-icon-button">⊕</button>
            <button type="button" className="changes-icon-button">⊞</button>
            <button
              type="button"
              className="changes-icon-button"
              onClick={() => setExpandedDirectories(new Set())}
            >
              ×
            </button>
            <button
              type="button"
              className="changes-icon-button"
              onClick={() => {
                setExpandedDirectories(new Set(["src", "src-tauri"]));
                void (async () => {
                  setIsLoadingFiles(true);
                  try {
                    const result = await invoke<WorkspaceFileEntry[]>("list_workspace_files", {
                      payload: { workspacePath: workspace.path }
                    });
                    setWorkspaceFiles(result);
                  } finally {
                    setIsLoadingFiles(false);
                  }
                })();
              }}
            >
              ↻
            </button>
          </div>

          <div className="changes-list">
            {isLoadingFiles ? (
              <div className="changes-empty-state">Loading workspace files...</div>
            ) : null}
            {!isLoadingFiles && filteredWorkspaceFiles.length === 0 ? (
              <div className="changes-empty-state">No visible files found in this workspace.</div>
            ) : null}
            {!isLoadingFiles &&
              filteredWorkspaceFiles.map((entry) => (
                <FileTreeRow
                  key={entry.id}
                  entry={entry}
                  expandedDirectories={expandedDirectories}
                  onToggleDirectory={toggleDirectory}
                  activeFilePath={activeFilePath}
                  onSelectFile={onSelectFile}
                />
              ))}
          </div>
        </>
      )}
    </aside>
  );
}
