import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffEditor } from "./DiffEditor";
import { useFileIconUrl } from "./fileIcons";
import { getDiffFileDirectory, getDiffFileName, getGitStatusCode } from "./diffPresentation";
import type { GitChangedFile, GitDiffCategory } from "./gitTypes";

type AllDiffsViewProps = {
  workspacePath: string;
  stagedFiles: GitChangedFile[];
  unstagedFiles: GitChangedFile[];
  refreshToken: number;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onSelectionChange?: (selection: { file: GitChangedFile; category: GitDiffCategory } | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type DiffEntry = {
  id: string;
  category: GitDiffCategory;
  file: GitChangedFile;
};

function DiffFileIcon({ path }: { path: string }) {
  const iconUrl = useFileIconUrl(getDiffFileName(path), false, false);

  if (!iconUrl) {
    return <FileText className="all-diffs-item-icon-svg" />;
  }

  return <img src={iconUrl} alt="" className="all-diffs-item-icon-img" draggable={false} />;
}

function getWorkspaceName(workspacePath: string) {
  const parts = workspacePath.split(/[\\/]/);
  return parts[parts.length - 1] || workspacePath;
}

function DiffGroup({
  title,
  entries,
  workspacePath,
  refreshToken,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSaved,
  onEntryDirtyChange,
  collapsedState,
  onToggleEntry,
}: {
  title: string;
  entries: DiffEntry[];
  workspacePath: string;
  refreshToken: number;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onEntryDirtyChange: (id: string, dirty: boolean) => void;
  collapsedState: Record<string, boolean>;
  onToggleEntry: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  const workspaceName = getWorkspaceName(workspacePath);

  return (
    <section className="all-diffs-group">
      <div className="all-diffs-group-header">
        <span>{title}</span>
        <span>{entries.length}</span>
      </div>
      <div className="all-diffs-group-body">
        {entries.map((entry) => {
          const isCollapsed = collapsedState[entry.id] ?? false;
          const fileName = getDiffFileName(entry.file.path);
          const directory = getDiffFileDirectory(entry.file.path);
          const pathLabel = [workspaceName, directory].filter(Boolean).join("/");

          return (
            <section key={entry.id} className="all-diffs-item" data-collapsed={isCollapsed ? "true" : undefined}>
              <button
                type="button"
                className="all-diffs-item-header"
                onClick={() => onToggleEntry(entry.id)}
                title={entry.file.oldPath ? `${entry.file.oldPath} -> ${entry.file.path}` : entry.file.path}
              >
                <span className="all-diffs-item-header-main">
                  <span className="all-diffs-item-chevron">
                    {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </span>
                  <span className="all-diffs-item-icon">
                    <DiffFileIcon path={entry.file.path} />
                  </span>
                  <span className="all-diffs-item-copy">
                    <span className="all-diffs-item-name">{fileName}</span>
                    {pathLabel ? <span className="all-diffs-item-path">{pathLabel}</span> : null}
                  </span>
                </span>
                <span className="all-diffs-item-meta">
                  {entry.file.additions > 0 ? (
                    <span className="all-diffs-item-stat is-addition">+{entry.file.additions}</span>
                  ) : null}
                  {entry.file.deletions > 0 ? (
                    <span className="all-diffs-item-stat is-deletion">-{entry.file.deletions}</span>
                  ) : null}
                  <span className={cn("all-diffs-item-status", `is-${entry.file.status}`)}>
                    {getGitStatusCode(entry.file.status)}
                  </span>
                </span>
              </button>
              {isCollapsed ? null : (
                <div className="all-diffs-item-body">
                  <DiffEditor
                    workspacePath={workspacePath}
                    file={entry.file}
                    category={entry.category}
                    refreshToken={refreshToken}
                    embedded
                    onOpenFile={onOpenFile}
                    onStageFile={onStageFile}
                    onUnstageFile={onUnstageFile}
                    onDiscardFile={onDiscardFile}
                    onSaved={onSaved}
                    onDirtyChange={(dirty) => onEntryDirtyChange(entry.id, dirty)}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function AllDiffsView({
  workspacePath,
  stagedFiles,
  unstagedFiles,
  refreshToken,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSaved,
  onSelectionChange,
  onDirtyChange,
}: AllDiffsViewProps) {
  const entries = useMemo<DiffEntry[]>(
    () => [
      ...unstagedFiles.map((file) => ({ id: `unstaged:${file.path}`, category: "unstaged" as const, file })),
      ...stagedFiles.map((file) => ({ id: `staged:${file.path}`, category: "staged" as const, file })),
    ],
    [stagedFiles, unstagedFiles],
  );
  const unstagedEntries = useMemo(
    () => entries.filter((entry) => entry.category === "unstaged"),
    [entries],
  );
  const stagedEntries = useMemo(
    () => entries.filter((entry) => entry.category === "staged"),
    [entries],
  );
  const [dirtyState, setDirtyState] = useState<Record<string, boolean>>({});
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    onSelectionChange?.(null);
    return () => {
      onSelectionChange?.(null);
      onDirtyChange?.(false);
    };
  }, [onDirtyChange, onSelectionChange]);

  useEffect(() => {
    setDirtyState((currentState) => {
      const nextState: Record<string, boolean> = {};
      let changed = false;

      for (const entry of entries) {
        if (currentState[entry.id]) {
          nextState[entry.id] = true;
        }
      }

      const currentKeys = Object.keys(currentState);
      const nextKeys = Object.keys(nextState);
      if (currentKeys.length !== nextKeys.length) {
        changed = true;
      } else {
        changed = currentKeys.some((key) => !nextState[key]);
      }

      return changed ? nextState : currentState;
    });
  }, [entries]);

  useEffect(() => {
    setCollapsedState((currentState) => {
      const nextState: Record<string, boolean> = {};
      let changed = false;

      for (const entry of entries) {
        if (entry.id in currentState) {
          nextState[entry.id] = currentState[entry.id];
        }
      }

      const currentKeys = Object.keys(currentState);
      const nextKeys = Object.keys(nextState);
      if (currentKeys.length !== nextKeys.length) {
        changed = true;
      } else {
        changed = currentKeys.some((key) => currentState[key] !== nextState[key]);
      }

      return changed ? nextState : currentState;
    });
  }, [entries]);

  useEffect(() => {
    onDirtyChange?.(Object.values(dirtyState).some(Boolean));
  }, [dirtyState, onDirtyChange]);

  const handleEntryDirtyChange = (id: string, dirty: boolean) => {
    setDirtyState((currentState) => {
      if (dirty) {
        if (currentState[id]) return currentState;
        return { ...currentState, [id]: true };
      }

      if (!(id in currentState)) return currentState;
      const nextState = { ...currentState };
      delete nextState[id];
      return nextState;
    });
  };

  const handleToggleEntry = (id: string) => {
    setCollapsedState((currentState) => ({
      ...currentState,
      [id]: !currentState[id],
    }));
  };

  if (entries.length === 0) {
    return (
      <div className="all-diffs-empty">
        <GitCompareArrows className="size-6" />
        <p>No changes to compare.</p>
      </div>
    );
  }

  return (
    <div className="all-diffs-layout">
      <div className="all-diffs-scroll">
        <DiffGroup
          title="Changes"
          entries={unstagedEntries}
          workspacePath={workspacePath}
          refreshToken={refreshToken}
          onOpenFile={onOpenFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={onDiscardFile}
          onSaved={onSaved}
          onEntryDirtyChange={handleEntryDirtyChange}
          collapsedState={collapsedState}
          onToggleEntry={handleToggleEntry}
        />
        <DiffGroup
          title="Staged Changes"
          entries={stagedEntries}
          workspacePath={workspacePath}
          refreshToken={refreshToken}
          onOpenFile={onOpenFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={onDiscardFile}
          onSaved={onSaved}
          onEntryDirtyChange={handleEntryDirtyChange}
          collapsedState={collapsedState}
          onToggleEntry={handleToggleEntry}
        />
      </div>
    </div>
  );
}
