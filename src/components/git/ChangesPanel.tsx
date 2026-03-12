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

function TreeRow({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
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
            <TreeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }

  const file = node.file;
  return (
    <div className="changes-tree-row changes-tree-file-row" style={{ paddingLeft: `${depth * 14}px` }}>
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
    </div>
  );
}

export function ChangesPanel({ workspace }: ChangesPanelProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const [branch, setBranch] = useState("main");
  const [ahead, setAhead] = useState(0);
  const [files, setFiles] = useState<ChangedFile[]>(changedFiles);
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(files), [files]);

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
    setCommitMessage("");
    setFeedbackMessage(null);
  }, [workspace.path]);

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
        <button type="button" className="changes-tab is-active">Changes</button>
        <button type="button" className="changes-tab">Files</button>
        <div className="changes-tab-actions">
          <button type="button" className="changes-icon-button">⤢</button>
          <button type="button" className="changes-icon-button">×</button>
        </div>
      </div>

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
            <TreeRow key={node.id} node={node} />
          ))}
        </div>
      </div>
    </aside>
  );
}
